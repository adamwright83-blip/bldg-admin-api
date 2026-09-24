/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type {
  LegacyDayforgeEntitlement,
  SaasTenantMemberRole,
} from "@shared/saasTenant";
import {
  hasDayforgeEntitlement,
  resolveDayforgeMembership,
  roleAllows,
} from "../saas/tenantAccess";
import { authorizeJoystickClaireDesk } from "../joystick/tenantIdentity";
import { assertTrpcMutationOrigin } from "../legacyDayforgeSecurity/legacyDayforgeSecurity";

const VENDOR_UNAUTHED_MSG = "Please login to the vendor portal (10003)";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
const mutationOriginGuard = t.middleware(async opts => {
  // Direct in-process callers (including policy/store tests) have no HTTP
  // request and therefore no browser CSRF surface. Express always supplies
  // req for network calls.
  if (!opts.ctx.req?.headers) return opts.next();
  const decision = assertTrpcMutationOrigin({
    req: opts.ctx.req,
    isMutation: opts.type === "mutation",
  });
  if (!decision.allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Invalid request origin",
    });
  }
  return opts.next();
});

const baseProcedure = t.procedure.use(mutationOriginGuard);
export const publicProcedure = baseProcedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = baseProcedure.use(requireUser);

export const adminProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

export const platformProcedure = adminProcedure;

function legacyDayforgeProcedure(input: {
  entitlement: LegacyDayforgeEntitlement;
  roles: readonly SaasTenantMemberRole[];
}) {
  return baseProcedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: UNAUTHED_ERR_MSG,
        });
      }
      const membership = await resolveDayforgeMembership({
        tenantId: ctx.tenantId,
        userOpenId: ctx.user.openId,
        platformRole: ctx.user.role,
      });
      if (!membership || !roleAllows(membership.role, input.roles)) {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }
      if (
        !(await hasDayforgeEntitlement({
          tenantId: ctx.tenantId,
          entitlement: input.entitlement,
        }))
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "This DayForge capability is not enabled for the tenant.",
        });
      }
      return next({
        ctx: { ...ctx, user: ctx.user, legacyDayforgeMembership: membership },
      });
    })
  );
}

function legacyDayforgeTenantProcedureForRoles(
  roles: readonly SaasTenantMemberRole[]
) {
  return baseProcedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;
      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: UNAUTHED_ERR_MSG,
        });
      }
      const membership = await resolveDayforgeMembership({
        tenantId: ctx.tenantId,
        userOpenId: ctx.user.openId,
        platformRole: ctx.user.role,
      });
      if (!membership || !roleAllows(membership.role, roles)) {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }
      return next({
        ctx: { ...ctx, user: ctx.user, legacyDayforgeMembership: membership },
      });
    })
  );
}

const operatorRoles = ["owner", "admin", "operator"] as const;
const fieldRoles = ["owner", "admin", "operator", "field"] as const;
export const legacyDayforgeTenantMemberProcedure =
  legacyDayforgeTenantProcedureForRoles(fieldRoles);
export const legacyDayforgeTenantAdminProcedure = legacyDayforgeTenantProcedureForRoles([
  "owner",
  "admin",
]);
export const legacyDayforgeTenantOperatorProcedure =
  legacyDayforgeTenantProcedureForRoles(operatorRoles);

export const legacyDayforgeTerritoryProcedure = legacyDayforgeProcedure({
  entitlement: "territory_intelligence",
  roles: operatorRoles,
});
export const legacyDayforgeMissionOperatorProcedure = legacyDayforgeProcedure({
  entitlement: "boreslay",
  roles: operatorRoles,
});
export const legacyDayforgeMissionFieldProcedure = legacyDayforgeProcedure({
  entitlement: "dayforge_field",
  roles: fieldRoles,
});
export const legacyDayforgeProposalOperatorProcedure = legacyDayforgeProcedure({
  entitlement: "commercial_pipeline",
  roles: operatorRoles,
});
export const legacyDayforgeProposalFieldProcedure = legacyDayforgeProcedure({
  entitlement: "commercial_pipeline",
  roles: fieldRoles,
});
export const legacyDayforgePipelineProcedure = legacyDayforgeProcedure({
  entitlement: "commercial_pipeline",
  roles: operatorRoles,
});
export const legacyDayforgeChurnProcedure = legacyDayforgeProcedure({
  entitlement: "churn_radar",
  roles: operatorRoles,
});

/**
 * Claire desk on Admin and Driver. Members use membership; shared driver password does not.
 * Field procedures still run their entitlement check. This guard runs as well so a legacy
 * driver shortcut cannot confirm a plan or open a desk route.
 */
const joystickClaireDeskGuard = t.middleware(async opts => {
  const decision = await authorizeJoystickClaireDesk({
    tenantId: opts.ctx.tenantId,
    user: opts.ctx.user
      ? { openId: opts.ctx.user.openId, role: opts.ctx.user.role }
      : null,
  });
  if (!decision.ok) {
    throw new TRPCError({
      code: decision.reason === "unauthenticated" ? "UNAUTHORIZED" : "FORBIDDEN",
      message:
        decision.reason === "unauthenticated"
          ? UNAUTHED_ERR_MSG
          : NOT_ADMIN_ERR_MSG,
    });
  }
  return opts.next({
    ctx: {
      ...opts.ctx,
      user: opts.ctx.user!,
      tenantId: decision.tenantId,
    },
  });
});

export const joystickClaireDeskProcedure = baseProcedure.use(
  joystickClaireDeskGuard
);

/** Desk routes that also require a field-capable membership and the field entitlement. */
export const joystickClaireDeskFieldProcedure =
  legacyDayforgeMissionFieldProcedure.use(joystickClaireDeskGuard);

export const adminOrDriverProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (
      !ctx.user ||
      (ctx.user.role !== "admin" && ctx.user.role !== "driver")
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

const requireVendorSession = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.vendorSession) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: VENDOR_UNAUTHED_MSG });
  }
  return next({ ctx: { ...ctx, vendorSession: ctx.vendorSession } });
});

export const vendorProcedure = baseProcedure.use(requireVendorSession);

/** Requires an authenticated platform operator (admin or driver) OR a vendor session. For order operations; chargeCard stays admin-only. */
export const platformOrVendorProcedure = baseProcedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    const isPlatformOperator =
      ctx.user && (ctx.user.role === "admin" || ctx.user.role === "driver");
    const isVendor = !!ctx.vendorSession;
    if (!isPlatformOperator && !isVendor) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
    }
    return next({
      ctx: { ...ctx, user: ctx.user, vendorSession: ctx.vendorSession },
    });
  })
);
