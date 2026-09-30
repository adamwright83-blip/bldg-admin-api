import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { requireCanonicalOperatorIdentityForUser } from "../../persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../../persistentOperator/observability";
import type { CampaignRun } from "../../../shared/campaignRun";
import type { CurrentDayLine } from "../../../shared/currentDayLine";
import { listOperatorRunsForIdentities } from "../../campaignRuns/campaignRunService";
import { bridgeDriverAction } from "../../persistentOperator/fieldEventBridge";
import { getGoalCycleObjective } from "../../persistentOperator/objectiveStore";
import { completeDayDirectorCommitment } from "../../dayDirector/dayDirectorService";
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
  today: legacyDayforgeTenantMemberProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const effectiveTenantId =
        ctx.user.role === "admin" && input?.targetTenantId
          ? input.targetTenantId
          : ctx.tenantId;

      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: effectiveTenantId,
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

  completeItem: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        targetTenantId: z.string().trim().min(1).optional(),
        itemId: z.string().trim().min(1),
        lineage: z
          .object({
            kind: z.enum(["objective", "campaign", "commitment"]),
            sourceReference: z.string().optional(),
            objectiveId: z.string().optional(),
            campaignId: z.string().optional(),
            commitmentId: z.string().optional(),
          })
          .optional(),
        evidenceReference: z.string().trim().min(1),
        sourceSystem: z.string().optional(),
        explanation: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const effectiveTenantId =
        ctx.user.role === "admin" && input.targetTenantId
          ? input.targetTenantId
          : ctx.tenantId;

      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: effectiveTenantId,
        user: ctx.user,
        subsystem: "day_line.completeItem",
      });

      const tenantId = identity.tenantId;
      const kind = input.lineage?.kind;

      // 1. Lineage: Persistent Growth Objective
      if (kind === "objective" || (!kind && (input.lineage?.objectiveId || input.itemId))) {
        const objectiveId = input.lineage?.objectiveId || input.itemId;
        const objective = await getGoalCycleObjective({
          tenantId,
          objectiveId,
        }).catch(() => null);

        if (objective || kind === "objective") {
          const bridged = await bridgeDriverAction({
            tenantId,
            actorId: identity.canonicalOpenId,
            objectiveId,
            evidenceReference: input.evidenceReference,
            sourceSystem: input.sourceSystem ?? "driver_cockpit_hud",
            explanation: input.explanation ?? `Day Line objective completed via HUD: ${objectiveId}`,
          });
          return {
            success: bridged.bridged,
            lineageKind: "objective" as const,
            itemId: objectiveId,
            receipt: bridged,
          };
        }
      }

      // 2. Lineage: Day Director Designated Commitment
      if (kind === "commitment" || (!kind && input.lineage?.commitmentId)) {
        const commitmentId = input.lineage?.commitmentId || input.itemId;
        let commitmentResult: any = null;
        try {
          commitmentResult = await completeDayDirectorCommitment({
            tenantId,
            actorId: identity.dayDirectorActorId,
            actorIds: identity.dayDirectorActorIds,
            commitmentId,
          });
        } catch (err) {
          if (kind === "commitment") throw err;
        }

        if (commitmentResult || kind === "commitment") {
          const bridged = await bridgeDriverAction({
            tenantId,
            actorId: identity.dayDirectorActorId,
            commitmentId,
            evidenceReference: input.evidenceReference,
            sourceSystem: input.sourceSystem ?? "driver_cockpit_hud",
            explanation: input.explanation ?? `Day Director commitment completed via HUD: ${commitmentId}`,
          }).catch(() => ({ bridged: false, reason: "no_linked_objective" }));

          await recordPersistentOperatorDiagnosticEvent({
            tenantId,
            canonicalOperatorId: identity.canonicalOperatorId,
            operatorUserId: identity.canonicalOpenId,
            subsystem: "day_line.completeItem",
            eventKind: "objective_verified",
            objectiveId: commitmentId,
          }).catch(() => undefined);

          return {
            success: true,
            lineageKind: "commitment" as const,
            itemId: commitmentId,
            receipt: { commitment: commitmentResult, bridged },
          };
        }
      }

      // 3. Lineage: Campaign
      if (kind === "campaign" || (!kind && input.lineage?.campaignId)) {
        const campaignId = input.lineage?.campaignId || input.itemId;
        const numericMissionId = Number.parseInt(campaignId, 10);
        const bridged = await bridgeDriverAction({
          tenantId,
          actorId: identity.canonicalOpenId,
          ...(Number.isFinite(numericMissionId) ? { missionId: numericMissionId } : {}),
          evidenceReference: input.evidenceReference,
          sourceSystem: input.sourceSystem ?? "driver_cockpit_hud",
          explanation: input.explanation ?? `Campaign work completed via HUD: ${campaignId}`,
          metadata: { campaignId },
        }).catch(() => ({ bridged: false, reason: "campaign_bridging_deferred" }));

        await recordPersistentOperatorDiagnosticEvent({
          tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          subsystem: "day_line.completeItem",
          eventKind: "objective_verified",
          objectiveId: campaignId,
        }).catch(() => undefined);

        return {
          success: true,
          lineageKind: "campaign" as const,
          itemId: campaignId,
          receipt: { bridged },
        };
      }

      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Day Line item '${input.itemId}' could not be resolved to an active objective, commitment, or campaign on tenant '${tenantId}'`,
      });
    }),
});
