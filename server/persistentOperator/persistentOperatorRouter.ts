import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  legacyDayforgeTenantAdminProcedure,
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
  identity: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
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
        dayDirectorActorId: identity.dayDirectorActorId,
      });
    } catch (error) {
      identityFailure(error);
    }
  }),

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
});
