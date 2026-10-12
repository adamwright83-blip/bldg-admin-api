import { z } from "zod";
import {
  router,
  legacyDayforgeTenantAdminProcedure as admin,
  legacyDayforgeTenantOperatorProcedure as operator,
} from "../../../_core/trpc";
import {
  intakeOrderSchema,
  intakeProductSchema,
  intakePlanSchema,
  intakePreparedSchema,
} from "../../../../shared/cleancloudIntake";
import {
  intakeConnection,
  captureIntake,
  listIntake,
  commandIntake,
  claimIntake,
  finishIntake,
  authorizeIntakeSubmit,
  pauseIntake,
} from "./service";
const source = z.object({
  bindingId: z.string().uuid(),
  storeLabel: z.string().min(1).max(255),
});
const snapshot = source
  .extend({
    observedAt: z.string().datetime(),
    rows: z.array(intakeOrderSchema).max(1000),
    catalog: z.array(intakeProductSchema).min(1).max(1000),
  })
  .strict();
const actor = (ctx: { tenantId: string; user: { openId: string } }) => ({
  tenantId: ctx.tenantId,
  actorId: ctx.user.openId,
});
export const cleancloudIntakeRouter = router({
  authorize: operator
    .input(
      source
        .extend({
          id: z.string().uuid(),
          revision: z.string().uuid(),
          leaseToken: z.string().uuid(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) => authorizeIntakeSubmit(actor(ctx), input)),
  pause: admin.mutation(({ ctx }) => pauseIntake(actor(ctx))),
  connection: operator.query(({ ctx }) => intakeConnection(actor(ctx))),
  connect: admin
    .input(snapshot)
    .mutation(({ ctx, input }) => captureIntake(actor(ctx), input, true)),
  capture: operator
    .input(snapshot)
    .mutation(({ ctx, input }) => captureIntake(actor(ctx), input)),
  list: admin.query(({ ctx }) => listIntake(actor(ctx))),
  prepare: admin
    .input(z.object({ id: z.string().uuid(), plan: intakePlanSchema }).strict())
    .mutation(({ ctx, input }) =>
      commandIntake(actor(ctx), { ...input, action: "prepare" })
    ),
  approve: admin
    .input(
      z
        .object({
          id: z.string().uuid(),
          revision: z.string().uuid(),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          reviewed: z.literal(true),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      commandIntake(actor(ctx), { ...input, action: "approve" })
    ),
  focus: admin
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) =>
      commandIntake(actor(ctx), { ...input, action: "focus" })
    ),
  verify: admin
    .input(z.object({ id: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) =>
      commandIntake(actor(ctx), { ...input, action: "verify" })
    ),
  claim: operator
    .input(source.strict())
    .mutation(({ ctx, input }) => claimIntake(actor(ctx), input)),
  receipt: operator
    .input(
      source
        .extend({
          id: z.string().uuid(),
          revision: z.string().uuid(),
          leaseToken: z.string().uuid(),
          prepared: intakePreparedSchema.optional(),
          verified: z.boolean().optional(),
          error: z.string().max(512).optional(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) => finishIntake(actor(ctx), input)),
});
