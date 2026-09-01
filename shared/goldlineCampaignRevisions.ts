/**
 * Campaign revisions: past locked, active pinned unless invalidated, future may change.
 * Refresh / pan / inspect / arcade / guardian play are not revision sources.
 */

import type {
  CampaignChapter,
  CampaignDraft,
  CampaignInstance,
  CampaignRevisionDiff,
  CampaignRevisionReason,
} from "./goldlineCampaign";

function futureChapterIds(draft: Pick<CampaignDraft, "chapters" | "currentChapterId" | "completedChapterIds">) {
  const locked = new Set(draft.completedChapterIds);
  if (draft.currentChapterId) locked.add(draft.currentChapterId);
  return draft.chapters
    .map(chapter => chapter.stableChapterId)
    .filter(id => !locked.has(id));
}

function chapterStillValid(
  chapter: CampaignChapter,
  next: CampaignDraft
): boolean {
  const match = next.chapters.find(item => item.stableChapterId === chapter.stableChapterId);
  if (!match) {
    return next.chapters.some(
      item =>
        item.chapterKind === chapter.chapterKind &&
        item.objectiveIds.every(id => chapter.objectiveIds.includes(id)) &&
        chapter.objectiveIds.every(id => item.objectiveIds.includes(id))
    );
  }
  return match.objectiveIds.every(id => chapter.objectiveIds.includes(id));
}

export function detectRevisionReasons(input: {
  previousFingerprint: string;
  nextFingerprint: string;
  previous: CampaignDraft;
  next: CampaignDraft;
}): CampaignRevisionReason[] {
  if (input.previousFingerprint === input.nextFingerprint) return [];
  const reasons: CampaignRevisionReason[] = [];
  const prevIds = new Set(input.previous.chapters.flatMap(chapter => chapter.objectiveIds));
  const nextIds = new Set(input.next.chapters.flatMap(chapter => chapter.objectiveIds));
  const completedIds = new Set(input.next.authoritativeCompletedObjectiveIds ?? []);
  const prevHardIds = new Set(
    input.previous.chapters.filter(chapter => chapter.hardAnchor).flatMap(chapter => chapter.objectiveIds)
  );
  const nextHardIds = input.next.chapters
    .filter(chapter => chapter.hardAnchor)
    .flatMap(chapter => chapter.objectiveIds);
  if (nextHardIds.some(id => !prevHardIds.has(id))) reasons.push("NEW_FIXED_COMMITMENT");
  if (Array.from(nextIds).some(id => !prevIds.has(id)) && !reasons.includes("NEW_FIXED_COMMITMENT")) {
    reasons.push("REAL_OUTCOME_CHANGED");
  }

  const removedIds = Array.from(prevIds).filter(id => !nextIds.has(id));
  if (removedIds.some(id => completedIds.has(id))) {
    reasons.push("AUTHORITATIVE_ACTION_COMPLETED");
  }
  if (removedIds.some(id => !completedIds.has(id))) {
    reasons.push("OPPORTUNITY_NO_LONGER_ELIGIBLE");
  }

  const prevReady = input.previous.chapters.some(chapter => chapter.chapterKind === "guardian_finale");
  const nextReady = input.next.chapters.some(chapter => chapter.chapterKind === "guardian_finale");
  if (!prevReady && nextReady) reasons.push("TERRITORY_BECAME_READY");
  if (reasons.length === 0) reasons.push("REAL_OUTCOME_CHANGED");
  return Array.from(new Set(reasons));
}

/**
 * Merge a newly compiled draft onto an existing instance.
 * Completed chapters stay. The current chapter stays if still valid.
 */
export function recompileCampaignFuture(input: {
  instance: CampaignInstance;
  next: CampaignDraft;
}): { instance: CampaignInstance; diff: CampaignRevisionDiff | null } {
  if (input.instance.inputFingerprint === input.next.inputFingerprint) {
    return { instance: input.instance, diff: null };
  }
  const completedObjectiveIds = new Set(input.next.authoritativeCompletedObjectiveIds ?? []);
  const clearedTerritoryIds = new Set(input.next.clearedTerritoryIds ?? []);
  const absorbedCompleted = input.instance.chapters.filter(chapter => {
    if (input.instance.completedChapterIds.includes(chapter.stableChapterId)) return true;
    if (chapter.chapterKind === "guardian_finale") {
      return Boolean(chapter.territoryId && clearedTerritoryIds.has(chapter.territoryId));
    }
    if (chapter.objectiveIds.length === 0) return false;
    return chapter.objectiveIds.every(id => completedObjectiveIds.has(id));
  });
  const completedChapterIds = Array.from(
    new Set([
      ...input.instance.completedChapterIds,
      ...absorbedCompleted.map(chapter => chapter.stableChapterId),
    ])
  );
  const completed = input.instance.chapters.filter(chapter =>
    completedChapterIds.includes(chapter.stableChapterId)
  );
  const current = input.instance.chapters.find(
    chapter => chapter.stableChapterId === input.instance.currentChapterId
  );
  const currentStillValid =
    Boolean(current) &&
    !completedChapterIds.includes(current!.stableChapterId) &&
    chapterStillValid(current!, input.next);
  const lockedIds = new Set(completed.map(chapter => chapter.stableChapterId));
  if (currentStillValid && current) lockedIds.add(current.stableChapterId);

  const future = input.next.chapters.filter(chapter => {
    if (lockedIds.has(chapter.stableChapterId)) return false;
    if (currentStillValid && current && chapter.objectiveIds.length > 0) {
      return !chapter.objectiveIds.every(id => current.objectiveIds.includes(id));
    }
    return true;
  });

  const mergedChapters = [
    ...completed,
    ...(currentStillValid && current ? [current] : []),
    ...future,
  ];
  const previousFuture = futureChapterIds(input.instance);
  const nextFuture = future.map(chapter => chapter.stableChapterId);
  const added = nextFuture.filter(id => !previousFuture.includes(id));
  const removed = previousFuture.filter(id => !nextFuture.includes(id));
  const reordered =
    removed.length === 0 &&
    added.length === 0 &&
    previousFuture.some((id, index) => nextFuture[index] !== id)
      ? nextFuture
      : [];

  const revision = input.instance.revision + 1;
  const unfinished = mergedChapters.filter(
    chapter => !completedChapterIds.includes(chapter.stableChapterId)
  );
  const completedByReality = mergedChapters.length > 0 && unfinished.length === 0;
  const nextStatus = completedByReality
    ? "completed"
    : mergedChapters.length === 0
      ? "quiet"
      : input.instance.startedAt
        ? "active"
        : input.next.status;
  const nextCompletedAt = completedByReality
    ? input.instance.completedAt ?? new Date().toISOString()
    : input.instance.completedAt;

  const instance: CampaignInstance = {
    ...input.instance,
    ...input.next,
    id: input.instance.id,
    createdAt: input.instance.createdAt,
    startedAt: input.instance.startedAt,
    completedAt: nextCompletedAt,
    revision,
    chapters: mergedChapters,
    completedChapterIds,
    currentChapterId: completedByReality
      ? null
      : currentStillValid
        ? input.instance.currentChapterId
        : future[0]?.stableChapterId ?? null,
    status: nextStatus,
    campaignArchetypeId: input.instance.campaignArchetypeId,
    title: input.instance.title,
    premise: input.instance.premise,
    stableKey: input.instance.stableKey,
  };
  const diff: CampaignRevisionDiff = {
    campaignId: input.instance.id,
    revision,
    inputFingerprint: input.next.inputFingerprint,
    reasonCodes: detectRevisionReasons({
      previousFingerprint: input.instance.inputFingerprint,
      nextFingerprint: input.next.inputFingerprint,
      previous: input.instance,
      next: input.next,
    }),
    addedFutureChapterIds: added,
    removedFutureChapterIds: removed,
    reorderedFutureChapterIds: reordered,
  };
  return { instance, diff };
}

export function explainCampaignRevision(diff: CampaignRevisionDiff | null): string | null {
  if (!diff) return null;
  const phrases: string[] = [];
  for (const code of diff.reasonCodes) {
    if (code === "NEW_FIXED_COMMITMENT") {
      phrases.push("A real fixed commitment entered the day, so the unfinished future bent around it.");
    } else if (code === "OBLIGATION_BECAME_DUE") {
      phrases.push("A promise you made for today is now on the line.");
    } else if (code === "AUTHORITATIVE_ACTION_COMPLETED") {
      phrases.push("A real action completed. The morning stays history.");
    } else if (code === "TERRITORY_BECAME_READY") {
      phrases.push("A territory is confrontation-ready. The remaining business route is clear.");
    } else if (code === "ROUTE_WINDOW_CHANGED") {
      phrases.push("Real travel time changed a later window, so an optional branch moved.");
    } else if (code === "OPPORTUNITY_NO_LONGER_ELIGIBLE") {
      phrases.push("A later opportunity is no longer eligible. It was not marked lost.");
    } else {
      phrases.push("The unfinished future changed because the source day changed.");
    }
  }
  return phrases[0] ?? null;
}

export function markChapterCompleted(
  instance: CampaignInstance,
  chapterId: string,
  completedAt = new Date().toISOString()
): CampaignInstance {
  if (instance.completedChapterIds.includes(chapterId)) return instance;
  const remaining = instance.chapters.filter(
    chapter =>
      chapter.stableChapterId !== chapterId &&
      !instance.completedChapterIds.includes(chapter.stableChapterId)
  );
  return {
    ...instance,
    completedChapterIds: [...instance.completedChapterIds, chapterId],
    currentChapterId: remaining[0]?.stableChapterId ?? null,
    status: remaining.length === 0 ? "completed" : instance.status === "authored" ? "active" : instance.status,
    completedAt: remaining.length === 0 ? completedAt : instance.completedAt,
  };
}
