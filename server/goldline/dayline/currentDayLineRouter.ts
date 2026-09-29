/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { requireCanonicalOperatorIdentityForUser } from "../../persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../../persistentOperator/observability";
import type { CampaignRun } from "../../../shared/campaignRun";
import type { CurrentDayLine } from "../../../shared/currentDayLine";
import { listOperatorRunsForIdentities } from "../../campaignRuns/campaignRunService";
import { readCurrentDayLine } from "./currentDayLineService";

export function surfacedObjectiveIds(
  line: CurrentDayLine,
  runs: readonly CampaignRun[]
): string[] {
  const newestActiveRunByCampaign = new Map<string, string>();
  for (const run of runs) {
    if (run.status !== "active" || newestActiveRunByCampaign.has(run.campaignId)) continue;
    newestActiveRunByCampaign.set(run.campaignId, run.campaignRunId);
  }
  const surfaced = new Set<string>();
  for (const item of line.items) {
    surfaced.add(newestActiveRunByCampaign.get(item.id) ?? item.id);
  }
  if (line.designated) {
    surfaced.add(
      newestActiveRunByCampaign.get(line.designated.id) ?? line.designated.id
    );
  }
  return [...surfaced];
}

export const currentDayLineRouter = router({
  today: legacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({
      tenantId: ctx.tenantId,
      user: ctx.user,
      subsystem: "day_line",
    });
    const line = await readCurrentDayLine({
      tenantId: identity.tenantId,
      operatorId: identity.dayDirectorActorId,
      operatorIds: identity.dayDirectorActorIds,
      operatorUserId: identity.canonicalOpenId,
      operatorUserIds: identity.aliases.map(alias => alias.openId),
    });

    const reason =
      line.rankingStatus === "unavailable"
        ? "day_line_unavailable"
        : line.items.length === 0 && !line.designated
          ? "legitimate_no_work"
          : null;
    await recordPersistentOperatorDiagnosticEvent({
      tenantId: identity.tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      operatorUserId: identity.canonicalOpenId,
      subsystem: "day_line",
      eventKind: "selection_attempt",
      reason,
    }).catch(() => undefined);

    const operatorUserIds = [...new Set([
      identity.canonicalOpenId,
      identity.sourceOpenId,
      ...identity.aliases.map(alias => alias.openId),
    ])];
    const runs = await listOperatorRunsForIdentities({
      tenantId: identity.tenantId,
      operatorUserIds,
    }).catch(() => []);
    await Promise.all(
      surfacedObjectiveIds(line, runs).map(objectiveId =>
        recordPersistentOperatorDiagnosticEvent({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          subsystem: "day_line",
          eventKind: "objective_surfaced",
          objectiveId,
        }).catch(() => undefined)
      )
    );
    return line;
  }),
});
