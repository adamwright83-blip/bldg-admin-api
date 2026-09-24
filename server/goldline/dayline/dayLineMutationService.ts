/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { and, eq } from "drizzle-orm";
import {
  commercialFollowUps,
  commercialMissions,
  commercialMissionEvents,
  dayDirectorCommitments,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { ensureAdamBoard } from "../../claire/proactive/boardService";
import { getDayDirectorState } from "../../dayDirector/dayDirectorService";
import { listLegacyDayforgeToday } from "../../legacyDayforgeToday/legacyDayforgeTodayService";
import { getCommercialMission, listCommercialMissions } from "../../commercialMissions/commercialMissionStore";
import {
  dayLineDisplayTitle,
  extractCancellationReason,
  extractRequestedActionTitle,
  isDayLineCancelled,
  matchDayLineItem,
  mergeDayLineOverlay,
  readDayLineOverlay,
  type DayLineItemRef,
} from "../../../shared/goldlineDayLine";

const COMPLETED_MISSION_STATUSES = new Set([
  "game_completed",
  "visit_completed",
  "won",
  "lost",
]);

function actorMatches(assignedTo: string | null | undefined, actorIds: string[]): boolean {
  if (!assignedTo) return true;
  return actorIds.includes(assignedTo);
}

export async function listActiveDayLineItems(input: {
  tenantId: string;
  actorId: string;
  operatorUserId?: string;
  businessDate: string;
}): Promise<DayLineItemRef[]> {
  await ensureAdamBoard({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId ?? input.actorId,
    actorId: input.actorId,
  }).catch(error => {
    console.warn("[ClaireProactive] board sweep skipped", error instanceof Error ? error.message : error);
  });
  const actorIds = Array.from(
    new Set([input.actorId, input.operatorUserId].filter((value): value is string => Boolean(value)))
  );
  const [director, missions, today] = await Promise.all([
    getDayDirectorState({
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: input.businessDate,
    }),
    listCommercialMissions({ tenantId: input.tenantId, assignedTo: input.actorId, limit: 250 }),
    listLegacyDayforgeToday({ tenantId: input.tenantId, userId: input.actorId, includeAllAssignees: false }).catch(
      () => []
    ),
  ]);
  const extraMissions =
    input.operatorUserId && input.operatorUserId !== input.actorId
      ? await listCommercialMissions({
          tenantId: input.tenantId,
          assignedTo: input.operatorUserId,
          limit: 250,
        })
      : [];
  const items: DayLineItemRef[] = [];
  for (const commitment of director.commitments) {
    items.push({
      sourceType: "day_director_commitment",
      sourceId: commitment.id,
      displayTitle: commitment.title,
      accountName: commitment.title,
      actionId: commitment.id,
      editableCapabilities: ["dayline.edit", "dayline.cancel", "dayline.complete"],
      status: commitment.status === "completed" ? "completed" : "active",
      assignedTo: input.actorId,
    });
  }
  const seenMissions = new Set<number>();
  for (const mission of [...missions, ...extraMissions]) {
    if (seenMissions.has(mission.id)) continue;
    seenMissions.add(mission.id);
    if (!actorMatches(mission.assignedTo, actorIds)) continue;
    const overlay = readDayLineOverlay(mission.brief);
    const complete = COMPLETED_MISSION_STATUSES.has(mission.status);
    items.push({
      sourceType: "commercial_mission",
      sourceId: String(mission.id),
      displayTitle: dayLineDisplayTitle(overlay, mission.account.name),
      accountId: null,
      accountName: mission.account.name,
      missionId: mission.id,
      editableCapabilities: complete ? [] : ["dayline.edit", "dayline.cancel"],
      status: overlay.notPursuing ? "cancelled" : complete ? "completed" : "active",
      assignedTo: mission.assignedTo,
    });
  }
  for (const row of today) {
    if (row.kind === "follow_up" && row.followUpId) {
      items.push({
        sourceType: "commercial_follow_up",
        sourceId: row.followUpId,
        displayTitle: row.accountName,
        accountName: row.accountName,
        missionId: row.missionId,
        followupId: row.followUpId,
        pipelineId: row.pipelineId,
        editableCapabilities: ["dayline.edit", "dayline.cancel"],
        status: "active",
        assignedTo: input.actorId,
      });
    }
  }
  return items;
}

export function resolveDayLineTargets(
  items: DayLineItemRef[],
  utterance: string
): DayLineItemRef[] {
  const active = items.filter(item => item.status === "active");
  const matches = dedupe(active.filter(item => matchDayLineItem(item, utterance)));
  if (matches.length > 1) {
    // "Louise North" names one item exactly even when "Louise South" shares a word.
    const said = utterance.toLowerCase().replace(/[^a-z0-9]+/g, " ");
    const exact = matches.filter(item => {
      const title = item.displayTitle.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return title.length > 0 && said.includes(title);
    });
    if (exact.length === 1) return exact;
  }
  if (matches.length) return matches;
  const completed = items
    .filter(item => item.status === "completed")
    .filter(item => matchDayLineItem(item, utterance));
  return dedupe(completed);
}

function dedupe(items: DayLineItemRef[]): DayLineItemRef[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.sourceType}:${item.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function writeMissionOverlay(input: {
  tenantId: string;
  actorId: string;
  missionId: number;
  overlay: Parameters<typeof mergeDayLineOverlay>[1];
  eventName: string;
  metadata: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const mission = await getCommercialMission({
    tenantId: input.tenantId,
    missionId: input.missionId,
  });
  if (!mission) throw new Error("Commercial mission not found");
  if (mission.assignedTo && mission.assignedTo !== input.actorId) {
    throw new Error("Not authorized to change another operator's Day Line work");
  }
  const nextBrief = mergeDayLineOverlay(mission.brief, input.overlay);
  await db
    .update(commercialMissions)
    .set({ missionBriefJson: nextBrief })
    .where(
      and(
        eq(commercialMissions.tenantId, input.tenantId),
        eq(commercialMissions.id, input.missionId)
      )
    );
  await db.insert(commercialMissionEvents).values({
    tenantId: input.tenantId,
    missionId: input.missionId,
    eventName: input.eventName,
    fromStatus: mission.status,
    toStatus: mission.status,
    actorType: "operator",
    actorId: input.actorId,
    idempotencyKey: `${input.eventName}:${input.missionId}:${Date.now()}`,
    metadataJson: input.metadata,
  });
}

async function writeCommitmentOverlay(input: {
  tenantId: string;
  actorId: string;
  commitmentId: string;
  overlay: Parameters<typeof mergeDayLineOverlay>[1];
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [existing] = await db
    .select()
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.actorId, input.actorId),
        eq(dayDirectorCommitments.id, input.commitmentId)
      )
    )
    .limit(1);
  if (!existing) throw new Error("Day Director commitment not found");
  const current =
    existing.metadataJson && typeof existing.metadataJson === "object"
      ? (existing.metadataJson as Record<string, unknown>)
      : {};
  await db
    .update(dayDirectorCommitments)
    .set({ metadataJson: mergeDayLineOverlay(current, input.overlay) })
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, input.tenantId),
        eq(dayDirectorCommitments.actorId, input.actorId),
        eq(dayDirectorCommitments.id, input.commitmentId)
      )
    );
  return existing;
}

export async function editDayLineItem(input: {
  tenantId: string;
  actorId: string;
  item: DayLineItemRef;
  actionTitle: string;
}): Promise<{
  ok: true;
  sourceType: DayLineItemRef["sourceType"];
  sourceId: string;
  previousTitle: string;
  displayTitle: string;
  accountName: string | null;
}> {
  const actionTitle = input.actionTitle.trim().slice(0, 255);
  if (!actionTitle) throw new Error("Action title is required");
  if (input.item.status === "completed") {
    throw new Error("completed_history");
  }
  if (input.item.sourceType === "day_director_commitment") {
    const existing = await writeCommitmentOverlay({
      tenantId: input.tenantId,
      actorId: input.actorId,
      commitmentId: input.item.sourceId,
      overlay: {
        originalTitle: input.item.accountName ?? input.item.displayTitle,
        actionTitleOverride: actionTitle,
      },
    });
    return {
      ok: true,
      sourceType: input.item.sourceType,
      sourceId: input.item.sourceId,
      previousTitle: existing.title,
      displayTitle: actionTitle,
      accountName: existing.title,
    };
  }
  const missionId = input.item.missionId;
  if (!missionId) throw new Error("This Day Line item cannot change its action title");
  const mission = await getCommercialMission({ tenantId: input.tenantId, missionId });
  if (!mission) throw new Error("Commercial mission not found");
  await writeMissionOverlay({
    tenantId: input.tenantId,
    actorId: input.actorId,
    missionId,
    overlay: {
      originalTitle: mission.account.name,
      actionTitleOverride: actionTitle,
    },
    eventName: "dayline_title_edited",
    metadata: {
      previousTitle: dayLineDisplayTitle(readDayLineOverlay(mission.brief), mission.account.name),
      newTitle: actionTitle,
      accountName: mission.account.name,
      operator: input.actorId,
    },
  });
  return {
    ok: true,
    sourceType: input.item.sourceType,
    sourceId: input.item.sourceId,
    previousTitle: dayLineDisplayTitle(readDayLineOverlay(mission.brief), mission.account.name),
    displayTitle: actionTitle,
    accountName: mission.account.name,
  };
}

export async function cancelDayLineItem(input: {
  tenantId: string;
  actorId: string;
  item: DayLineItemRef;
  reason?: string | null;
}): Promise<{
  ok: true;
  sourceType: DayLineItemRef["sourceType"];
  sourceId: string;
  reasonStored: boolean;
  accountName: string | null;
  displayTitle: string;
}> {
  if (input.item.status === "completed") {
    throw new Error("completed_history");
  }
  const reason = input.reason?.trim().slice(0, 500) || null;
  const overlay = {
    notPursuing: true,
    cancelledAt: new Date().toISOString(),
    cancelledBy: input.actorId,
    cancelledReason: reason,
  };
  if (input.item.sourceType === "day_director_commitment") {
    await writeCommitmentOverlay({
      tenantId: input.tenantId,
      actorId: input.actorId,
      commitmentId: input.item.sourceId,
      overlay,
    });
    return {
      ok: true,
      sourceType: input.item.sourceType,
      sourceId: input.item.sourceId,
      reasonStored: Boolean(reason),
      accountName: input.item.accountName ?? null,
      displayTitle: input.item.displayTitle,
    };
  }
  const missionId = input.item.missionId;
  if (!missionId) throw new Error("This Day Line item cannot be cancelled");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await writeMissionOverlay({
    tenantId: input.tenantId,
    actorId: input.actorId,
    missionId,
    overlay,
    eventName: "dayline_cancelled",
    metadata: {
      reason,
      operatorAttested: true,
      fabricatedLostSale: false,
      operator: input.actorId,
    },
  });
  if (input.item.followupId) {
    await db
      .update(commercialFollowUps)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(commercialFollowUps.tenantId, input.tenantId),
          eq(commercialFollowUps.id, input.item.followupId),
          eq(commercialFollowUps.status, "open")
        )
      );
  } else {
    await db
      .update(commercialFollowUps)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(commercialFollowUps.tenantId, input.tenantId),
          eq(commercialFollowUps.missionId, missionId),
          eq(commercialFollowUps.status, "open")
        )
      );
  }
  return {
    ok: true,
    sourceType: input.item.sourceType,
    sourceId: input.item.sourceId,
    reasonStored: Boolean(reason),
    accountName: input.item.accountName ?? null,
    displayTitle: input.item.displayTitle,
  };
}

export function speakEditResult(displayTitle: string): string {
  return `Changed it to ‘${displayTitle}.’`;
}

export function speakCancelResult(input: {
  displayTitle: string;
  reasonStored: boolean;
}): string {
  const name = input.displayTitle.replace(/\s+/g, " ").trim() || "that stop";
  return input.reasonStored
    ? `Removed ${name} from the Day Line. I kept the reason with the record.`
    : `Removed ${name} from the Day Line.`;
}

export function speakCompletedHistory(displayTitle: string): string {
  return `That one is already completed history. I can remove any future follow-up, but I won’t erase what already happened.`;
}

export function speakAmbiguousTargets(items: DayLineItemRef[]): string {
  const names = items.slice(0, 3).map(item => item.displayTitle);
  return `Which one — ${names.join(", or ")}?`;
}

export { extractRequestedActionTitle, extractCancellationReason, isDayLineCancelled };
