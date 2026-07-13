import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const VENDOR_UNAUTHED_MSG = "Please login to the vendor portal (10003)";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({ ctx: { ...ctx, user: ctx.user } });
  })
);

export const platformProcedure = adminProcedure;

export const adminOrDriverProcedure = t.procedure.use(
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

export const vendorProcedure = t.procedure.use(requireVendorSession);

/** Requires an authenticated platform operator (admin or driver) OR a vendor session. For order operations; chargeCard stays admin-only. */
export const platformOrVendorProcedure = t.procedure.use(
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
