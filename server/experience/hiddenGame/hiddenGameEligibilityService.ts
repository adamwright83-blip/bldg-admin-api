/**
 * hidden_game.lost_property: unlock eligibility reader.
 *
 * READ-ONLY toward the business. This module reads today's Day Line and the
 * completion records the owning systems already keep, then records one
 * game-owned fact: that a chapter was opened. It never completes, marks or
 * changes any Day Line item, commitment, objective or campaign run.
 *
 * Completion is NOT a field of CurrentDayLine, so there is no single flag to
 * read. Each surfaced item is resolved through its own lineage, the same
 * lineage `currentDayLine.completeItem` uses to write completion:
 *
 *   commitment -> day_director_commitments.status === "completed"
 *   objective  -> goal_cycle_objectives.status === "completed"
 *   campaign   -> a campaign run for that campaign with status "complete"
 *                 whose completedAt falls on today's business date
 *   candidate  -> resolved to commitment or campaign through
 *                 resolveCandidateCompletionLineage, never read directly
 *
 * Anything that cannot be resolved is "unknown" and counts as not complete.
 *
 * Evaluation happens on read and is idempotent. There is no worker and no
 * cron. Unlocks are monotonic: the ledger is insert-only.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { hiddenGameChapterUnlocks } from "../../../drizzle/schema";
import {
  businessDateInZone,
  type CurrentDayLine,
  type CurrentDayLineItem,
} from "../../../shared/currentDayLine";
import {
  chapterToUnlock,
  evaluateDayCompletion,
  projectEligibility,
  type HiddenGameEligibility,
  type ItemCompletion,
  type UnlockRecord,
} from "../../../shared/hiddenGameEligibility";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { getDb } from "../../db";
import { listGoalCycleObjectives } from "../../agents/persistentOperator/objectiveStore";
import { listOperatorRunsForIdentities } from "../../campaignRuns/campaignRunService";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { resolveCandidateCompletionLineage } from "../../planning/dayline/candidateCompletionLineage";
import { readCurrentDayLine } from "../../planning/dayline/currentDayLineService";
import { getLatestPlan } from "../../planning/missionDirector/missionDirectorService";

export type HiddenGameScope = {
  tenantId: string;
  /** Canonical operator id. Keys the unlock ledger. */
  canonicalOperatorId: string;
  /** Day Director actor ids, as the Day Line router passes them. */
  operatorId: string;
  operatorIds?: string[];
  /** Campaign Run owner ids (open ids), canonical first. */
  operatorUserId?: string;
  operatorUserIds?: string[];
};

export type HiddenGameEligibilityDeps = {
  readDayLine: (scope: HiddenGameScope) => Promise<CurrentDayLine>;
  readCompletion: (
    scope: HiddenGameScope,
    line: CurrentDayLine
  ) => Promise<Map<string, ItemCompletion>>;
  listUnlocks: (scope: HiddenGameScope) => Promise<UnlockRecord[]>;
  /** Insert-only. Must tolerate a concurrent identical insert without throwing. */
  recordUnlock: (
    scope: HiddenGameScope,
    row: UnlockRecord & { evidence: Record<string, unknown> }
  ) => Promise<void>;
};

function requireScope(scope: HiddenGameScope): void {
  // Never default a tenant. Throwing here is the tenant-isolation guarantee.
  if (!scope.tenantId?.trim()) throw new Error("hidden game eligibility requires a tenantId");
  if (!scope.canonicalOperatorId?.trim()) {
    throw new Error("hidden game eligibility requires a canonicalOperatorId");
  }
}

export async function readHiddenGameEligibility(
  scope: HiddenGameScope,
  deps: HiddenGameEligibilityDeps = defaultDeps
): Promise<HiddenGameEligibility> {
  requireScope(scope);

  const line = await deps.readDayLine(scope);
  const existing = await deps.listUnlocks(scope);

  const completionMap = await deps.readCompletion(scope, line).catch(error => {
    console.warn(
      "[hidden-game] completion unavailable; treating the day as not finished",
      error instanceof Error ? error.message : error
    );
    return new Map<string, ItemCompletion>();
  });
  const completion = evaluateDayCompletion(line, completionMap);

  let unlocks = existing;
  const toOpen = chapterToUnlock({
    existing,
    localDate: line.businessDate,
    todayComplete: completion.todayComplete,
  });
  if (toOpen !== null) {
    await deps.recordUnlock(scope, {
      chapter: toOpen,
      unlockedOnLocalDate: line.businessDate,
      evidence: {
        businessDate: line.businessDate,
        requiredIds: completion.requiredIds,
        required: completion.todayRequiredTotal,
        complete: completion.todayRequiredComplete,
      },
    });
    // Reread rather than assume: a concurrent read may have won the insert.
    unlocks = await deps.listUnlocks(scope);
  }

  const unlockedChapters = unlocks.reduce((max, row) => Math.max(max, row.chapter), 0);
  return projectEligibility({ unlockedChapters, completion });
}

// ── Default dependencies ─────────────────────────────────────────

async function readDayLineDefault(scope: HiddenGameScope): Promise<CurrentDayLine> {
  return readCurrentDayLine({
    tenantId: scope.tenantId,
    operatorId: scope.operatorId,
    ...(scope.operatorIds?.length ? { operatorIds: scope.operatorIds } : {}),
    ...(scope.operatorUserId ? { operatorUserId: scope.operatorUserId } : {}),
    ...(scope.operatorUserIds?.length ? { operatorUserIds: scope.operatorUserIds } : {}),
  });
}

type LineageLike = NonNullable<CurrentDayLineItem["lineage"]>;

async function readCompletionDefault(
  scope: HiddenGameScope,
  line: CurrentDayLine
): Promise<Map<string, ItemCompletion>> {
  const out = new Map<string, ItemCompletion>();
  const items: CurrentDayLineItem[] = [...line.items];
  if (line.designated && !items.some(item => item.id === line.designated!.id)) {
    items.push(line.designated);
  }
  if (items.length === 0) return out;

  const zone = getDashboardTimeZone();
  // Each source is read at most once, and only if some item needs it.
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T | null> => {
    if (!memo.has(key)) memo.set(key, load().catch(() => null));
    return memo.get(key) as Promise<T | null>;
  };

  const commitments = () =>
    once("commitments", () =>
      getDayDirectorState({
        tenantId: scope.tenantId,
        actorId: scope.operatorId,
        actorIds: scope.operatorIds,
        businessDate: line.businessDate,
      })
    );
  const objectives = () =>
    once("objectives", () =>
      listGoalCycleObjectives({
        tenantId: scope.tenantId,
        businessDate: line.businessDate,
      })
    );
  const runs = () =>
    once("runs", () =>
      listOperatorRunsForIdentities({
        tenantId: scope.tenantId,
        operatorUserIds: [
          ...(scope.operatorUserIds ?? []),
          ...(scope.operatorUserId ? [scope.operatorUserId] : []),
        ],
      })
    );
  const plan = () =>
    once("plan", () =>
      getLatestPlan({
        tenantId: scope.tenantId,
        operatorId: scope.operatorId,
        operatorIds: scope.operatorIds,
        businessDate: line.businessDate,
      })
    );

  const resolveLineage = async (
    lineage: LineageLike | null | undefined,
    itemId: string
  ): Promise<ItemCompletion> => {
    if (!lineage) return "unknown";

    if (lineage.kind === "commitment") {
      const state = await commitments();
      if (!state) return "unknown";
      const commitmentId = lineage.commitmentId || itemId;
      const found = state.commitments.find(c => c.id === commitmentId);
      if (!found) return "unknown";
      return found.status === "completed" ? "complete" : "incomplete";
    }

    if (lineage.kind === "objective") {
      const list = await objectives();
      if (!list) return "unknown";
      const objectiveId = lineage.objectiveId || itemId;
      const found = list.find(o => o.id === objectiveId);
      if (!found) return "unknown";
      return found.status === "completed" ? "complete" : "incomplete";
    }

    if (lineage.kind === "campaign") {
      const all = await runs();
      if (!all) return "unknown";
      const campaignId = lineage.campaignId || itemId;
      const forCampaign = all.filter(run => run.campaignId === campaignId);
      if (forCampaign.length === 0) return "incomplete";
      const finishedToday = forCampaign.some(
        run =>
          run.status === "complete" &&
          run.completedAt != null &&
          businessDateInZone(new Date(run.completedAt), zone) === line.businessDate
      );
      return finishedToday ? "complete" : "incomplete";
    }

    if (lineage.kind === "candidate") {
      // Candidate is a planning projection, not a completion authority.
      const latest = await plan();
      const candidateId = lineage.candidateId || itemId;
      const evidence =
        latest?.outcome.workPlan?.ranking.find(
          entry => entry.workId === candidateId && entry.eligible
        ) ?? null;
      if (!evidence) return "unknown";
      const resolved = resolveCandidateCompletionLineage(evidence.sourceRefs);
      if (!resolved) return "unknown";
      return resolveLineage(resolved, itemId);
    }

    return "unknown";
  };

  for (const item of items) {
    out.set(item.id, await resolveLineage(item.lineage, item.id));
  }
  return out;
}

async function listUnlocksDefault(scope: HiddenGameScope): Promise<UnlockRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select()
    .from(hiddenGameChapterUnlocks)
    .where(
      and(
        eq(hiddenGameChapterUnlocks.tenantId, scope.tenantId),
        eq(hiddenGameChapterUnlocks.operatorId, scope.canonicalOperatorId)
      )
    );
  return rows.map(row => ({
    chapter: row.chapter,
    unlockedOnLocalDate: row.unlockedOnLocalDate,
  }));
}

async function recordUnlockDefault(
  scope: HiddenGameScope,
  row: UnlockRecord & { evidence: Record<string, unknown> }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(hiddenGameChapterUnlocks)
    .values({
      id: randomUUID(),
      tenantId: scope.tenantId,
      operatorId: scope.canonicalOperatorId,
      chapter: row.chapter,
      unlockedOnLocalDate: row.unlockedOnLocalDate,
      evidenceJson: row.evidence,
    })
    // Two reads racing for the same chapter or the same day: the loser is a
    // no-op, never an overwrite. The ledger is insert-only.
    .onDuplicateKeyUpdate({ set: { id: sql`${hiddenGameChapterUnlocks.id}` } });
}

const defaultDeps: HiddenGameEligibilityDeps = {
  readDayLine: readDayLineDefault,
  readCompletion: readCompletionDefault,
  listUnlocks: listUnlocksDefault,
  recordUnlock: recordUnlockDefault,
};
