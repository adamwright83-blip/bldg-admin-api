/**
 * Lantern City objective marks: server loader.
 *
 * READ-ONLY. This module reads today's Day Line and the tenant's Campaign Run
 * evidence and hands them to the pure projection in
 * shared/lanternCityObjectiveMarks.ts. It never inserts, updates or deletes;
 * `objectiveMarksService.test.ts` enforces that structurally.
 *
 * Runs are read tenant-wide, not per signed-in user: Admin and Driver can be
 * signed in as different users of the same business, and the map is the
 * business's map. The tenant is the isolation boundary, and every reader is
 * called with the caller's tenant.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import { goldlineCampaignRuns } from "../../drizzle/schema";
import type { CampaignRun, CampaignRunStatus } from "../../shared/campaignRun";
import {
  projectLanternObjectiveMarks,
  type LanternObjectiveMarks,
  type LanternRunInput,
} from "../../shared/lanternCityObjectiveMarks";
import type { CurrentDayLine } from "../../shared/currentDayLine";
import { listRunEvents, listRunSlots, listTargets } from "../campaignRuns/campaignRunService";
import { getDb } from "../db";
import { readCurrentDayLine } from "../planning/dayline/currentDayLineService";

/** Most recent runs considered for history. Bounded so one tenant cannot make the map unbounded. */
export const LANTERN_MARK_RUN_LIMIT = 50;

export type ObjectiveMarksDeps = {
  readDayLine: (input: {
    tenantId: string;
    operatorId: string;
    operatorIds?: string[];
    operatorUserId?: string;
    operatorUserIds?: string[];
  }) => Promise<CurrentDayLine>;
  listTenantRuns: (input: { tenantId: string; limit: number }) => Promise<CampaignRun[]>;
  listRunSlots: typeof listRunSlots;
  listTargets: typeof listTargets;
  listRunEvents: typeof listRunEvents;
};

export async function listTenantCampaignRuns(input: {
  tenantId: string;
  limit: number;
}): Promise<CampaignRun[]> {
  const db = await getDb();
  if (!db) return [];
  const [activeRows, historicalRows] = await Promise.all([
    db
      .select()
      .from(goldlineCampaignRuns)
      .where(
        and(
          eq(goldlineCampaignRuns.tenantId, input.tenantId),
          eq(goldlineCampaignRuns.status, "active")
        )
      )
      .orderBy(desc(goldlineCampaignRuns.startedAt)),
    db
      .select()
      .from(goldlineCampaignRuns)
      .where(
        and(
          eq(goldlineCampaignRuns.tenantId, input.tenantId),
          ne(goldlineCampaignRuns.status, "active")
        )
      )
      .orderBy(desc(goldlineCampaignRuns.startedAt))
      .limit(input.limit),
  ]);
  const rows = [...activeRows, ...historicalRows];
  return rows.map(row => ({
    campaignRunId: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    campaignId: row.campaignId,
    campaignVersion: row.campaignVersion,
    fictionPackId: row.fictionPackId ?? null,
    fictionPackVersion: row.fictionPackVersion ?? null,
    targetSetId: row.targetSetId,
    startedAt: row.startedAt.toISOString(),
    status: row.status as CampaignRunStatus,
    completedAt: row.completedAt?.toISOString() ?? null,
  }));
}

const defaultDeps: ObjectiveMarksDeps = {
  readDayLine: input => readCurrentDayLine(input),
  listTenantRuns: listTenantCampaignRuns,
  listRunSlots,
  listTargets,
  listRunEvents,
};

export async function loadLanternObjectiveMarks(
  input: {
    tenantId: string;
    operatorId: string;
    operatorIds?: readonly string[];
    operatorUserId?: string;
    operatorUserIds?: readonly string[];
    viewerOpenId?: string;
    viewerOpenIds?: readonly string[];
  },
  deps: ObjectiveMarksDeps = defaultDeps
): Promise<LanternObjectiveMarks> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    return projectLanternObjectiveMarks({
      tenantId: "",
      operatorId: input.operatorId,
      viewerOpenId: input.viewerOpenId,
      viewerOpenIds: input.viewerOpenIds,
      dayLine: null,
      runs: [],
    });
  }

  let dayLine: CurrentDayLine | null = null;
  try {
    dayLine = await deps.readDayLine({
      tenantId,
      operatorId: input.operatorId,
      ...(input.operatorIds?.length
        ? { operatorIds: [...input.operatorIds] }
        : {}),
      ...(input.operatorUserId ? { operatorUserId: input.operatorUserId } : {}),
      ...(input.operatorUserIds?.length
        ? { operatorUserIds: [...input.operatorUserIds] }
        : {}),
    });
  } catch (error) {
    console.warn(
      "[lantern-city] Day Line unavailable for objective marks",
      error instanceof Error ? error.message : error
    );
  }

  const runs = await deps.listTenantRuns({ tenantId, limit: LANTERN_MARK_RUN_LIMIT });
  const inputs: LanternRunInput[] = await Promise.all(
    runs
      .filter(run => run.tenantId === tenantId)
      .map(async run => {
        const [slots, targets, events] = await Promise.all([
          deps.listRunSlots({ tenantId, campaignRunId: run.campaignRunId }),
          deps.listTargets({ tenantId, targetSetId: run.targetSetId }),
          deps.listRunEvents({ tenantId, campaignRunId: run.campaignRunId }),
        ]);
        return { run, slots, targets, events };
      })
  );

  return projectLanternObjectiveMarks({
    tenantId,
    operatorId: input.operatorId,
    viewerOpenId: input.viewerOpenId,
    viewerOpenIds: input.viewerOpenIds,
    dayLine,
    runs: inputs,
  });
}
