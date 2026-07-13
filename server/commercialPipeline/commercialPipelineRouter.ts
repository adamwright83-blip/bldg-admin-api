import { z } from "zod";
import { dayforgePipelineProcedure, router } from "../_core/trpc";
import {
  advanceCommercialRelationshipStage,
  approveCommercialAgreement,
  attributeCommercialOrder,
  completeCommercialFollowUp,
  getCommercialPipelineDetail,
  listCommercialPipeline,
  reconcileCommercialPipelineRevenue,
  resolveCommercialPipelineMission,
  scheduleCommercialFollowUp,
} from "./commercialPipelineService";

const requestId = z.string().uuid();

export const commercialPipelineRouter = router({
  list: dayforgePipelineProcedure.query(({ ctx }) =>
    listCommercialPipeline(ctx.tenantId)
  ),
  detail: dayforgePipelineProcedure
    .input(z.object({ pipelineId: z.number().int().positive() }))
    .query(({ ctx, input }) =>
      getCommercialPipelineDetail({
        tenantId: ctx.tenantId,
        pipelineId: input.pipelineId,
      })
    ),
  advanceRelationship: dayforgePipelineProcedure
    .input(
      z.object({
        pipelineId: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        stage: z.enum([
          "follow_up",
          "proposal_sent",
          "pilot_requested",
          "verbal_yes",
        ]),
        note: z.string().trim().min(1).max(2_000),
        requestId,
      })
    )
    .mutation(({ ctx, input }) =>
      advanceCommercialRelationshipStage({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  resolve: dayforgePipelineProcedure
    .input(
      z.object({
        pipelineId: z.number().int().positive(),
        expectedMissionVersion: z.number().int().positive(),
        action: z.enum(["won", "lost", "reopen"]),
        reason: z.string().trim().min(1).max(500).optional(),
        requestId,
      })
    )
    .mutation(({ ctx, input }) =>
      resolveCommercialPipelineMission({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  scheduleFollowUp: dayforgePipelineProcedure
    .input(
      z
        .object({
          pipelineId: z.number().int().positive(),
          dueAt: z.date(),
          note: z.string().trim().min(1).max(2_000),
          requestId,
        })
        .superRefine((input, ctx) => {
          if (input.dueAt.getTime() <= Date.now())
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["dueAt"],
              message: "Follow-up must be scheduled in the future",
            });
        })
    )
    .mutation(({ ctx, input }) =>
      scheduleCommercialFollowUp({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  completeFollowUp: dayforgePipelineProcedure
    .input(
      z.object({
        pipelineId: z.number().int().positive(),
        followUpId: z.string().uuid(),
        requestId,
      })
    )
    .mutation(({ ctx, input }) =>
      completeCommercialFollowUp({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  approveAgreement: dayforgePipelineProcedure
    .input(
      z.object({
        pipelineId: z.number().int().positive(),
        approvedAnnualValueCents: z
          .number()
          .int()
          .positive()
          .max(1_000_000_000),
        evidenceReference: z.string().trim().min(3).max(1_024),
        confirmation: z.literal(
          "I verified this approved agreement value and its evidence"
        ),
        requestId,
      })
    )
    .mutation(({ ctx, input }) =>
      approveCommercialAgreement({
        pipelineId: input.pipelineId,
        approvedAnnualValueCents: input.approvedAnnualValueCents,
        evidenceReference: input.evidenceReference,
        requestId: input.requestId,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  attributeOrder: dayforgePipelineProcedure
    .input(
      z.object({
        pipelineId: z.number().int().positive(),
        orderId: z.number().int().positive(),
        confirmation: z.literal(
          "I verified this order belongs to this commercial account"
        ),
        requestId,
      })
    )
    .mutation(({ ctx, input }) =>
      attributeCommercialOrder({
        pipelineId: input.pipelineId,
        orderId: input.orderId,
        requestId: input.requestId,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
  reconcileRevenue: dayforgePipelineProcedure.mutation(({ ctx }) =>
    reconcileCommercialPipelineRevenue(ctx.tenantId)
  ),
});
