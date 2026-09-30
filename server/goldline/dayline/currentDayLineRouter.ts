import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { requireEffectiveOperatorIdentityForTenant } from "../../persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../../persistentOperator/observability";
import type { CampaignRun } from "../../../shared/campaignRun";
import type { CurrentDayLine } from "../../../shared/currentDayLine";
import { listOperatorRunsForIdentities } from "../../campaignRuns/campaignRunService";
import { bridgeDriverAction } from "../../persistentOperator/fieldEventBridge";
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
      const identity = await requireEffectiveOperatorIdentityForTenant({
        callerUser: ctx.user,
        callerTenantId: ctx.tenantId,
        targetTenantId: input?.targetTenantId,
        subsystem: "day_line.today",
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
      const identity = await requireEffectiveOperatorIdentityForTenant({
        callerUser: ctx.user,
        callerTenantId: ctx.tenantId,
        targetTenantId: input.targetTenantId,
        subsystem: "day_line.completeItem",
      });

      const tenantId = identity.tenantId;

      // 1. Authoritative truth check: reread today's Day Line for the effective tenant & operator
      const dayLine = await readCurrentDayLine({
        tenantId,
        operatorId: identity.dayDirectorActorId,
        operatorIds: identity.dayDirectorActorIds,
        operatorUserId: identity.canonicalOpenId,
        operatorUserIds: identity.aliases.map(a => a.openId),
      });

      // 2. Locate the exact item on today's authoritative Day Line
      const lineItem = dayLine.items.find(item => item.id === input.itemId);
      if (!lineItem) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Item '${input.itemId}' is not present on today's authoritative Day Line for tenant '${tenantId}'`,
        });
      }

      // 3. Derive lineage authoritatively from the server-produced Day Line item
      const serverLineage = lineItem.lineage;
      if (!serverLineage) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Day Line item '${input.itemId}' lacks authoritative server lineage`,
        });
      }

      // 4. Reject client-forged lineage: optimistic token must match server truth
      if (input.lineage?.kind && input.lineage.kind !== serverLineage.kind) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Lineage conflict: client declared '${input.lineage.kind}' but authoritative Day Line item is '${serverLineage.kind}'`,
        });
      }

      // 5. Execute completion contract strictly using server-derived lineage

      // (a) Lineage: Persistent Growth Objective
      if (serverLineage.kind === "objective") {
        const objectiveId = serverLineage.objectiveId || lineItem.id;
        const bridged = await bridgeDriverAction({
          tenantId,
          actorId: identity.canonicalOpenId,
          objectiveId,
          evidenceReference: input.evidenceReference,
          sourceSystem: input.sourceSystem ?? "driver_cockpit_hud",
          explanation: input.explanation ?? `Day Line objective completed via HUD: ${objectiveId}`,
        });

        if (!bridged.bridged) {
          return {
            success: false,
            lineageKind: "objective" as const,
            itemId: lineItem.id,
            reason: bridged.reason,
            message: bridged.message,
            receipt: bridged,
          };
        }

        return {
          success: true,
          lineageKind: "objective" as const,
          itemId: lineItem.id,
          receipt: bridged,
        };
      }

      // (b) Lineage: Day Director Designated Commitment
      if (serverLineage.kind === "commitment") {
        const commitmentId = serverLineage.commitmentId || lineItem.id;
        const commitmentResult = await completeDayDirectorCommitment({
          tenantId,
          actorId: identity.dayDirectorActorId,
          actorIds: identity.dayDirectorActorIds,
          commitmentId,
        });

        const bridged = await bridgeDriverAction({
          tenantId,
          actorId: identity.dayDirectorActorId,
          commitmentId,
          evidenceReference: input.evidenceReference,
          sourceSystem: input.sourceSystem ?? "driver_cockpit_hud",
          explanation: input.explanation ?? `Day Director commitment completed via HUD: ${commitmentId}`,
        }).catch(() => ({ bridged: false as const, reason: "no_linked_objective" as const }));

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
          itemId: lineItem.id,
          receipt: { commitment: commitmentResult, bridged },
        };
      }

      // (c) Lineage: Campaign
      if (serverLineage.kind === "campaign") {
        const campaignId = serverLineage.campaignId || lineItem.id;
        const numericMissionId = Number.parseInt(campaignId, 10);
        const bridged = await bridgeDriverAction({
          tenantId,
          actorId: identity.canonicalOpenId,
          ...(Number.isFinite(numericMissionId) ? { missionId: numericMissionId } : {}),
          evidenceReference: input.evidenceReference,
          sourceSystem: input.sourceSystem ?? "driver_cockpit_hud",
          explanation: input.explanation ?? `Campaign work completion attempt via HUD: ${campaignId}`,
          metadata: { campaignId },
        }).catch(() => ({ bridged: false as const, reason: "campaign_bridging_unavailable" as const }));

        // Authoritative truth guard: campaign completion NEVER succeeds without authoritative domain evidence
        if (!bridged.bridged) {
          return {
            success: false,
            lineageKind: "campaign" as const,
            itemId: lineItem.id,
            reason: "campaign_requires_evidence" as const,
            message: `Campaign '${campaignId}' cannot complete through generic Day Line assertion. Authoritative campaign progress requires domain evidence (e.g. territory presence, flyer placement) via Campaign Run ledger.`,
            receipt: { bridged },
          };
        }

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
          itemId: lineItem.id,
          receipt: { bridged },
        };
      }

      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Unsupported Day Line lineage kind '${(serverLineage as any).kind}'`,
      });
    }),
});
