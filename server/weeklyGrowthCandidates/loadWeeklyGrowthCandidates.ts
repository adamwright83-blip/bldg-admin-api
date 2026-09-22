import { createHash } from "node:crypto";
import { businessToday } from "../analytics/businessPeriods";
import {
  canonicalWeeklyGrowthFeed,
  type LoadWeeklyGrowthCandidatesInput,
  type WeeklyGrowthCandidateFeed,
} from "../../shared/weeklyGrowthCandidates";
import { assembleWeeklyGrowthCandidates } from "./assemble";
import { readWeeklyGrowthSources } from "./productionReaders";
import type { WeeklyGrowthSourceBundle } from "./rawRecord";

export type WeeklyGrowthCandidateDeps = {
  readSources: (input: {
    tenantId: string;
    operatorUserId: string;
    dayDirectorActorId: string;
    timeZone: string;
  }) => Promise<WeeklyGrowthSourceBundle>;
  today?: (now: Date, timeZone: string) => string;
};

const productionDeps: WeeklyGrowthCandidateDeps = {
  readSources: readWeeklyGrowthSources,
  today: businessToday,
};

/**
 * Read-only menu of growth motions the business already supports.
 * Project A calls this. It does not need churn, board, campaign, or follow-up internals.
 */
export async function loadWeeklyGrowthCandidates(
  input: LoadWeeklyGrowthCandidatesInput,
  deps: WeeklyGrowthCandidateDeps = productionDeps
): Promise<WeeklyGrowthCandidateFeed> {
  const today = (deps.today ?? businessToday)(input.now, input.timeZone);
  const bundle = await deps.readSources({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    dayDirectorActorId: input.dayDirectorActorId,
    timeZone: input.timeZone,
  });
  const assembled = assembleWeeklyGrowthCandidates({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    dayDirectorActorId: input.dayDirectorActorId,
    remainingDates: input.remainingDates,
    today,
    observedAt: input.now.toISOString(),
    bundle,
  });
  const generatedAt = input.now.toISOString();
  const fingerprint = createHash("sha256")
    .update(canonicalWeeklyGrowthFeed({ ...assembled, generatedAt, fingerprint: "" }))
    .digest("hex");
  return { ...assembled, generatedAt, fingerprint };
}
