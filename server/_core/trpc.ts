import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import type {
  DayforgeEntitlement,
  SaasTenantMemberRole,
} from "@shared/saasTenant";
import {
  hasDayforgeEntitlement,
  resolveDayforgeMembership,
  roleAllows,
} from "../saas/tenantAccess";
import { assertTrpcMutationOrigin } from "../dayforgeSecurity/dayforgeSecurity";

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

function dayforgeProcedure(input: {
  entitlement: DayforgeEntitlement;
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
        ctx: { ...ctx, user: ctx.user, dayforgeMembership: membership },
      });
    })
  );
}

function dayforgeTenantProcedureForRoles(
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
        ctx: { ...ctx, user: ctx.user, dayforgeMembership: membership },
      });
    })
  );
}

const operatorRoles = ["owner", "admin", "operator"] as const;
const fieldRoles = ["owner", "admin", "operator", "field"] as const;
export const dayforgeTenantMemberProcedure =
  dayforgeTenantProcedureForRoles(fieldRoles);
export const dayforgeTenantAdminProcedure = dayforgeTenantProcedureForRoles([
  "owner",
  "admin",
]);
export const dayforgeTenantOperatorProcedure =
  dayforgeTenantProcedureForRoles(operatorRoles);

export const dayforgeTerritoryProcedure = dayforgeProcedure({
  entitlement: "territory_intelligence",
  roles: operatorRoles,
});
export const dayforgeMissionOperatorProcedure = dayforgeProcedure({
  entitlement: "boreslay",
  roles: operatorRoles,
});
export const dayforgeMissionFieldProcedure = dayforgeProcedure({
  entitlement: "dayforge_field",
  roles: fieldRoles,
});
export const dayforgeProposalOperatorProcedure = dayforgeProcedure({
  entitlement: "commercial_pipeline",
  roles: operatorRoles,
});
export const dayforgeProposalFieldProcedure = dayforgeProcedure({
  entitlement: "commercial_pipeline",
  roles: fieldRoles,
});
export const dayforgePipelineProcedure = dayforgeProcedure({
  entitlement: "commercial_pipeline",
  roles: operatorRoles,
});
export const dayforgeChurnProcedure = dayforgeProcedure({
  entitlement: "churn_radar",
  roles: operatorRoles,
});

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
