/**
 * Lost Property unlock query.
 * Session identity selects the tenant and operator. The client sends no
 * sale, objective, or chapter. The durable read records a chapter the
 * ledger just opened. This file does not issue SQL.
 */
import { TRPCError } from "@trpc/server";
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import {
  CanonicalOperatorIdentityError,
  requireCanonicalOperatorIdentityForUser,
  type CanonicalOperatorIdentity,
} from "../../agents/persistentOperator/identity";
import type { LostPropertyUnlockRead } from "../../../shared/lostPropertyUnlock";
import { readDurableLostPropertyUnlock } from "./lostPropertyChapterUnlock";
import type { LostPropertyScope } from "./lostPropertyUnlockRead";

export type LostPropertyUnlockRouterDeps = {
  resolveIdentity: (input: {
    tenantId: string;
    user: { id?: unknown; openId: string; role: "admin" | "driver" | "user" };
  }) => Promise<CanonicalOperatorIdentity>;
  readUnlock: (scope: LostPropertyScope) => Promise<LostPropertyUnlockRead>;
};

export function lostPropertyOpenIds(identity: CanonicalOperatorIdentity): string[] {
  return [
    ...new Set(
      [identity.canonicalOpenId, identity.sourceOpenId, ...identity.aliases.map(alias => alias.openId)]
        .map(id => id.trim())
        .filter(Boolean)
    ),
  ];
}

/** Session tenant wins. A resolved identity for a different tenant is refused. */
export function lostPropertyScopeFromIdentity(input: {
  requestTenantId: string;
  identity: CanonicalOperatorIdentity;
}): LostPropertyScope {
  const requestTenantId = input.requestTenantId.trim();
  const identityTenantId = input.identity.tenantId.trim();
  if (!requestTenantId || identityTenantId !== requestTenantId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Lost Property eligibility tenant does not match the session",
    });
  }
  return {
    tenantId: identityTenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    actorIds: [...new Set(input.identity.dayDirectorActorIds.map(id => id.trim()).filter(Boolean))],
    operatorOpenIds: lostPropertyOpenIds(input.identity),
  };
}

const defaultRouterDeps: LostPropertyUnlockRouterDeps = {
  resolveIdentity: input =>
    requireCanonicalOperatorIdentityForUser({
      tenantId: input.tenantId,
      user: input.user,
      subsystem: "hidden_game.lost_property",
    }),
  readUnlock: scope => readDurableLostPropertyUnlock(scope),
};

export function createLostPropertyUnlockRouter(
  deps: LostPropertyUnlockRouterDeps = defaultRouterDeps
) {
  return router({
    eligibility: legacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Lost Property eligibility requires a user",
        });
      }
      let identity: CanonicalOperatorIdentity;
      try {
        identity = await deps.resolveIdentity({
          tenantId: ctx.tenantId,
          user: { id: ctx.user.id, openId: ctx.user.openId, role: ctx.user.role },
        });
      } catch (error) {
        if (error instanceof CanonicalOperatorIdentityError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Lost Property eligibility requires a resolved operator",
          });
        }
        throw error;
      }
      return deps.readUnlock(
        lostPropertyScopeFromIdentity({ requestTenantId: ctx.tenantId, identity })
      );
    }),
  });
}

export const lostPropertyUnlockRouter = createLostPropertyUnlockRouter();
