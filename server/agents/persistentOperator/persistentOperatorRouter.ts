import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  legacyDayforgeTenantAdminProcedure,
  legacyDayforgeTenantMemberProcedure,
  legacyDayforgeTenantOperatorProcedure,
  router,
} from "../../_core/trpc";
import {
  bindOperatorIdentityAlias,
  CanonicalOperatorIdentityError,
  OPERATOR_IDENTITY_SURFACES,
  requireCanonicalOperatorIdentityForUser,
  requireEffectiveOperatorIdentityForTenant,
  revokeOperatorIdentityAlias,
} from "./identity";
import { loadClaireAutonomyEvidence } from "./autonomyEvidence";
import { evaluateClaireAutonomyReadiness } from "./earnedAutonomyReadiness";
import { loadPersistentOperatorDiagnostics } from "./observability";
import { operationReceipt } from "./operationReceipt";
import {
  getAuthoritativeScoreboard,
  getLoadoutDelta,
  getPersistentGrowthHistory,
} from "./proofReadModels";
import {
  bridgeDriverAction,
  bridgeCleanCloudPaidOrder,
} from "./fieldEventBridge";
import { STATED_METHOD_LEVERS, STATED_METHOD_POPULATIONS } from "../../../shared/operatingMandate";

function identityFailure(error: unknown): never {
  if (error instanceof CanonicalOperatorIdentityError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.reason,
    });
  }
  throw error;
}

export const persistentOperatorRouter = router({
  identity: legacyDayforgeTenantMemberProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const identity = await requireEffectiveOperatorIdentityForTenant({
          callerUser: ctx.user,
          callerTenantId: ctx.tenantId,
          targetTenantId: input?.targetTenantId,
          subsystem: "persistent_operator.identity",
        });
        return {
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          canonicalOpenId: identity.canonicalOpenId,
          canonicalUserId: identity.canonicalUserId,
          sourceOpenId: identity.sourceOpenId,
          sourceUserId: identity.sourceUserId,
          dayDirectorActorId: identity.dayDirectorActorId,
          dayDirectorActorIds: identity.dayDirectorActorIds,
          weeklyOperatorId: identity.weeklyOperatorId,
          campaignOperatorUserId: identity.campaignOperatorUserId,
          communicationOperatorUserId: identity.communicationOperatorUserId,
          membership: identity.membership,
          aliases: identity.aliases,
        };
      } catch (error) {
        identityFailure(error);
      }
    }),

  autonomyReadiness: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ exactAction: z.string().trim().min(1).max(128), standingAuthorizationId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({ tenantId: ctx.tenantId, user: ctx.user, subsystem: "persistent_operator.autonomy_readiness" });
      const evidence = await loadClaireAutonomyEvidence({ ...input, tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: identity.canonicalOpenId, requestedLevel: 2 });
      return { ...evaluateClaireAutonomyReadiness(evidence), evidence,
        unavailable: ["execution_path_certification", "current_source_coverage_certification", "revocation_certification", "critical_defect_register", "broader_autonomy_level_approval"] };
    }),

  diagnostics: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const identity = await requireEffectiveOperatorIdentityForTenant({
          callerUser: ctx.user,
          callerTenantId: ctx.tenantId,
          targetTenantId: input?.targetTenantId,
          subsystem: "persistent_operator.diagnostics",
        });
        return loadPersistentOperatorDiagnostics({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          operatorUserIds: [
            identity.canonicalOpenId,
            identity.sourceOpenId,
            ...identity.aliases.map(alias => alias.openId),
          ],
          dayDirectorActorId: identity.dayDirectorActorId,
          dayDirectorActorIds: identity.dayDirectorActorIds,
        });
      } catch (error) {
        identityFailure(error);
      }
    }),

  /**
   * Observation-bridge backlog (Phase 2 · Slices C and D): source events that
   * have not reached their goal objective, by status, the oldest still
   * retrying, and the ones that need a person. Read-only.
   */
  observationBacklog: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const identity = await requireEffectiveOperatorIdentityForTenant({
          callerUser: ctx.user,
          callerTenantId: ctx.tenantId,
          targetTenantId: input?.targetTenantId,
          subsystem: "persistent_operator.observation_backlog",
        });
        const { readObservationBridgeBacklog, listObservationObligationsNeedingAttention } = await import("./observationBridgeStore");
        return {
          ...(await readObservationBridgeBacklog({ tenantId: identity.tenantId })),
          attention: await listObservationObligationsNeedingAttention({ tenantId: identity.tenantId }),
        };
      } catch (error) {
        identityFailure(error);
      }
    }),

  /**
   * The operator's resolved operating mandate (Phase 2 · Slice B): active
   * goals, focuses, stated methods and open Work Threads, constraints, open
   * commitments, conflicts and uncertainty, with its revision. Each verified
   * result is attributed once to every goal it advances. Read-only.
   */
  operatingMandate: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ targetTenantId: z.string().trim().min(1).optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const identity = await requireEffectiveOperatorIdentityForTenant({
          callerUser: ctx.user,
          callerTenantId: ctx.tenantId,
          targetTenantId: input?.targetTenantId,
          subsystem: "persistent_operator.operating_mandate",
        });
        const { loadOperatingMandate, loadMandateEvidence } = await import("../../planning/operatingMandate/loadOperatingMandate");
        const mandate = await loadOperatingMandate({ identity });
        return { mandate, evidence: await loadMandateEvidence({ mandate }) };
      } catch (error) {
        identityFailure(error);
      }
    }),

  /**
   * The operator settles part of their mandate: which goal comes first, an
   * area to focus on or set aside, or how they want a goal pursued. Their own
   * tenant only; append-only; a repeated decision records nothing new.
   */
  decideOperatingMandate: legacyDayforgeTenantOperatorProcedure
    .input(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("primary_outcome"), outcomeId: z.string().trim().min(1).max(191).nullable() }),
        z.object({
          kind: z.literal("focus"),
          action: z.enum(["confirm", "dismiss"]),
          area: z.string().trim().min(1).max(80),
          statement: z.string().trim().min(1).max(500),
          servesOutcomeId: z.string().trim().min(1).max(191).nullable().optional(),
        }),
        z.object({
          kind: z.literal("method"),
          outcomeId: z.string().trim().min(1).max(191).nullable(),
          lever: z.enum(STATED_METHOD_LEVERS),
          population: z.enum(STATED_METHOD_POPULATIONS),
          area: z.string().trim().min(1).max(80).nullable(),
          statement: z.string().trim().min(1).max(500),
          withdrawn: z.boolean().optional(),
        }),
      ])
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const identity = await requireCanonicalOperatorIdentityForUser({
          tenantId: ctx.tenantId,
          user: ctx.user,
          subsystem: "persistent_operator.operating_mandate_decision",
        });
        const { recordOperatingMandateDecision, MandateDecisionRejected } = await import("../../planning/operatingMandate/mandateDecisions");
        try {
          return await recordOperatingMandateDecision({ identity, decidedByOpenId: ctx.user.openId, decision: input });
        } catch (error) {
          if (error instanceof MandateDecisionRejected) throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          throw error;
        }
      } catch (error) {
        identityFailure(error);
      }
    }),

  operationReceipt: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ decisionId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      operationReceipt({
        tenantId: ctx.tenantId,
        decisionId: input.decisionId,
      })
    ),

  bindAlias: legacyDayforgeTenantAdminProcedure
    .input(
      z.object({
        canonicalOpenId: z.string().trim().min(1).max(64),
        aliasOpenId: z.string().trim().min(1).max(64),
        surface: z.enum(OPERATOR_IDENTITY_SURFACES),
      })
    )
    .mutation(({ ctx, input }) =>
      bindOperatorIdentityAlias({
        tenantId: ctx.tenantId,
        canonicalOpenId: input.canonicalOpenId,
        aliasOpenId: input.aliasOpenId,
        surface: input.surface,
        createdByOpenId: ctx.user.openId,
      })
    ),

  revokeAlias: legacyDayforgeTenantAdminProcedure
    .input(z.object({ bindingId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      revokeOperatorIdentityAlias({
        tenantId: ctx.tenantId,
        bindingId: input.bindingId,
      })
    ),

  scoreboard: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({
          goalRunId: z.string().uuid().optional(),
          targetTenantId: z.string().trim().min(1).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const identity = await requireEffectiveOperatorIdentityForTenant({
        callerUser: ctx.user,
        callerTenantId: ctx.tenantId,
        targetTenantId: input?.targetTenantId,
        subsystem: "persistent_operator.scoreboard",
      });
      return getAuthoritativeScoreboard({
        tenantId: identity.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        goalRunId: input?.goalRunId,
      });
    }),

  loadoutDelta: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ deltaId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "persistent_operator.loadout_delta",
      });
      return getLoadoutDelta({
        tenantId: ctx.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        deltaId: input?.deltaId,
      });
    }),

  history: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "persistent_operator.history",
      });
      return getPersistentGrowthHistory({
        tenantId: ctx.tenantId,
        canonicalOperatorId: identity.canonicalOperatorId,
        limit: input?.limit,
      });
    }),

  bridgeDriverAction: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        targetTenantId: z.string().trim().min(1).optional(),
        objectiveId: z.string().uuid().optional(),
        missionId: z.number().int().positive().optional(),
        orderId: z.number().int().positive().optional(),
        commitmentId: z.string().optional(),
        stopId: z.string().optional(),
        evidenceReference: z.string().min(1),
        sourceSystem: z.string().optional(),
        outcomeKind: z.string().optional(),
        explanation: z.string().optional(),
        observedAt: z.coerce.date().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const effectiveTenantId =
        ctx.user.role === "admin" && input?.targetTenantId
          ? input.targetTenantId
          : ctx.tenantId;

      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: effectiveTenantId,
        user: ctx.user,
        subsystem: "persistent_operator.field_bridge",
      });
      return bridgeDriverAction({
        tenantId: effectiveTenantId,
        actorId: identity.dayDirectorActorId,
        ...input,
      });
    }),

  bridgeCleanCloudOrder: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        cleancloudOrderId: z.string().min(1),
        cleancloudCustomerId: z.string().optional(),
        customerEmail: z.string().optional(),
        customerPhone: z.string().optional(),
        paid: z.boolean(),
        totalCents: z.number().int().nonnegative(),
        paidDateUtc: z.coerce.date().optional(),
        objectiveId: z.string().uuid().optional(),
        explanation: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return bridgeCleanCloudPaidOrder({
        tenantId: ctx.tenantId,
        ...input,
      });
    }),

  bridgeCommercialResolution: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        resolution: z.enum(["won", "lost"]),
        evidenceReference: z.string().min(1),
        explanation: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
        subsystem: "persistent_operator.field_bridge",
      });
      const { bridgeCommercialResolution } = await import("./fieldEventBridge");
      return bridgeCommercialResolution({
        tenantId: ctx.tenantId,
        actorId: identity.dayDirectorActorId,
        ...input,
      });
    }),

  reconcilePendingLearnings: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const { processPendingOutcomeLearnings } = await import("./learningStore");
      return processPendingOutcomeLearnings({
        tenantId: ctx.tenantId,
        limit: input?.limit,
      });
    }),
});

