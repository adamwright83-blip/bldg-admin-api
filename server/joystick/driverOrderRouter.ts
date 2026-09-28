/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { NOT_ADMIN_ERR_MSG } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isLegacyDayforgeTenant } from "../saas/tenantAccess";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { isLegacySharedPasswordOpenId } from "./tenantIdentity";
import {
  listDriverOrdersByDateForMember,
  listDriverOrdersByStatusForMember,
  requireDriverSessionTenant,
  updateDriverOrderStatusForMember,
  type DriverOrderListStatus,
} from "./driverOrderService";

const listStatus = z.enum([
  "new",
  "intake-pending",
  "collected",
  "processing",
  "ready",
  "delivered",
]);

/**
 * Field orders for the signed-in membership. Tenant comes from that
 * membership, never from the request body. The shared driver password is
 * not authority for a SaaS tenant. platformOrVendorProcedure stays closed.
 */
const driverOrderProcedure = legacyDayforgeTenantMemberProcedure.use(async opts => {
  const user = opts.ctx.user;
  const membership = opts.ctx.legacyDayforgeMembership;
  if (!user || !membership) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: NOT_ADMIN_ERR_MSG });
  }
  if (membership.tenantId !== opts.ctx.tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  if (
    isLegacySharedPasswordOpenId(user.openId) &&
    (!isLegacyDayforgeTenant(opts.ctx.tenantId) ||
      !isLegacyDayforgeTenant(membership.tenantId))
  ) {
    throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
  }
  const tenantId = requireDriverSessionTenant(membership.tenantId);
  return opts.next({
    ctx: { ...opts.ctx, user, tenantId },
  });
});

function actor(user: {
  id?: number | null;
  name?: string | null;
  email?: string | null;
}) {
  return {
    actorUserId: user.id ?? null,
    actorDisplayName: user.name ?? user.email ?? null,
  };
}

export const driverOrderRouter = router({
  listByStatus: driverOrderProcedure
    .input(z.object({ status: listStatus }).strict())
    .query(({ ctx, input }) =>
      listDriverOrdersByStatusForMember({
        tenantId: ctx.tenantId,
        status: input.status as DriverOrderListStatus,
      })
    ),
  listByDate: driverOrderProcedure
    .input(
      z
        .object({
          date: z.string().min(1).max(20),
          status: listStatus,
          dateField: z.enum(["pickupDate", "deliveryDate"]).default("pickupDate"),
        })
        .strict()
    )
    .query(({ ctx, input }) =>
      listDriverOrdersByDateForMember({
        tenantId: ctx.tenantId,
        status: input.status as DriverOrderListStatus,
        date: input.date,
        dateField: input.dateField,
      })
    ),
  updateStatus: driverOrderProcedure
    .input(
      z
        .object({
          orderId: z.number().int().positive(),
          status: z.enum(["collected", "delivered"]),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      updateDriverOrderStatusForMember({
        tenantId: ctx.tenantId,
        orderId: input.orderId,
        status: input.status,
        ...actor(ctx.user),
      })
    ),
});
