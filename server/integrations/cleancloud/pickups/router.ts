import { z } from "zod";
import {
  router,
  legacyDayforgeTenantAdminProcedure,
  legacyDayforgeTenantOperatorProcedure,
  legacyDayforgeTenantMemberProcedure,
} from "../../../_core/trpc";
import {
  cleancloudPickupRowSchema,
  pickupCountsSchema,
} from "../../../../shared/cleancloudPickup";
import {
  capturePickups,
  claimPickup,
  connectPickups,
  finishPickup,
  renewPickupLease,
  pickupConnection,
  recordPickup,
  retryPickup,
} from "./service";
const source = z.object({
  bindingId: z.string().uuid(),
  storeLabel: z.string().trim().min(1).max(255),
});
const snapshot = source.extend({
  observedAt: z.string().datetime(),
  rows: z.array(cleancloudPickupRowSchema).max(1000),
});
const actor = (ctx: { tenantId: string; user: { openId: string } }) => ({
  tenantId: ctx.tenantId,
  actorId: ctx.user.openId,
});
export const cleancloudPickupRouter = router({
  connection: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => ({
    ...(await pickupConnection(actor(ctx))),
    tenantId: ctx.tenantId,
    actorId: ctx.user.openId,
  })),
  connect: legacyDayforgeTenantAdminProcedure
    .input(
      snapshot
        .extend({
          excludedOrderIds: z
            .array(z.string().regex(/^[1-9]\d{0,15}$/))
            .max(1000),
        })
        .strict()
    )
    .mutation(({ ctx, input }) => connectPickups(actor(ctx), input)),
  capture: legacyDayforgeTenantOperatorProcedure
    .input(snapshot.strict())
    .mutation(({ ctx, input }) => capturePickups(actor(ctx), input)),
  claim: legacyDayforgeTenantOperatorProcedure
    .input(source.strict())
    .mutation(({ ctx, input }) => claimPickup(actor(ctx), input)),
  renew: legacyDayforgeTenantOperatorProcedure
    .input(
      source
        .extend({ id: z.string().uuid(), leaseToken: z.string().uuid() })
        .strict()
    )
    .mutation(({ ctx, input }) => renewPickupLease(actor(ctx), input)),
  receipt: legacyDayforgeTenantOperatorProcedure
    .input(
      source
        .extend({
          id: z.string().uuid(),
          leaseToken: z.string().uuid(),
          verified: z.boolean(),
          externalOrderId: z.string().regex(/^[1-9]\d{0,15}$/),
          customerName: z.string().min(1).max(191),
          detailRowId: z.string().nullable(),
          observedAt: z.string().datetime(),
          error: z.string().max(512).optional(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) => finishPickup(actor(ctx), input)),
  collected: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({ id: z.string().uuid(), counts: pickupCountsSchema }).strict()
    )
    .mutation(({ ctx, input }) =>
      recordPickup(actor(ctx), { id: input.id, ...input.counts })
    ),
  retry: legacyDayforgeTenantMemberProcedure
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) => retryPickup(actor(ctx), input.id)),
});
