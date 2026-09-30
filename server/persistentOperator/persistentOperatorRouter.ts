import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  legacyDayforgeTenantAdminProcedure,
  legacyDayforgeTenantMemberProcedure,
  legacyDayforgeTenantOperatorProcedure,
  router,
} from "../_core/trpc";
import {
  bindOperatorIdentityAlias,
  CanonicalOperatorIdentityError,
  OPERATOR_IDENTITY_SURFACES,
  requireCanonicalOperatorIdentityForUser,
  revokeOperatorIdentityAlias,
} from "./identity";
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
  identity: legacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    try {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
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

  diagnostics: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    try {
      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: ctx.tenantId,
        user: ctx.user,
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
      const effectiveTenantId =
        ctx.user.role === "admin" && input?.targetTenantId
          ? input.targetTenantId
          : ctx.tenantId;

      const identity = await requireCanonicalOperatorIdentityForUser({
        tenantId: effectiveTenantId,
        user: ctx.user,
        subsystem: "persistent_operator.scoreboard",
      });
      return getAuthoritativeScoreboard({
        tenantId: effectiveTenantId,
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

