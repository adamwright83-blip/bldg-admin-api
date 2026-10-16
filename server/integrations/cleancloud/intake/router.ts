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
import {
  commitCleanCloudOrderOperation,
  proposeCleanCloudOrderOperation,
} from "../../../claire/cleancloudOrderOperation";
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
  clairePropose: admin
    .input(
      z
        .object({
          id: z.string().uuid(),
          action: z.enum(["prepare", "approve_submit"]),
          plan: intakePlanSchema.optional(),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      proposeCleanCloudOrderOperation({
        actor: actor(ctx),
        orderId: input.id,
        action: input.action,
        plan: input.plan,
      })
    ),
  claireCommit: admin
    .input(
      z
        .object({
          id: z.string().uuid(),
          action: z.enum(["prepare", "approve_submit"]),
          plan: intakePlanSchema.optional(),
          fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
          revision: z.string().uuid().nullable(),
          reviewed: z.literal(true),
        })
        .strict()
    )
    .mutation(({ ctx, input }) =>
      commitCleanCloudOrderOperation({
        actor: actor(ctx),
        approvedByUserId: ctx.user.openId,
        orderId: input.id,
        action: input.action,
        plan: input.plan,
        fingerprint: input.fingerprint,
        revision: input.revision,
        reviewed: input.reviewed,
      })
    ),
});
