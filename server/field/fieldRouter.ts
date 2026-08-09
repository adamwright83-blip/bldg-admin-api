import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { activateCommercialMissionForField } from "../commercialMissions/commercialMissionActivationService";
import { getFieldMoves } from "./fieldOpportunityService";
import { getFieldToday } from "./fieldTodayService";

export const fieldRouter = router({
  today: dayforgeTenantMemberProcedure.query(({ ctx }) => getFieldToday({
    tenantId: ctx.tenantId, userId: ctx.user.openId,
    includeAllAssignees: ctx.dayforgeMembership.role !== "field",
  })),
  moves: dayforgeTenantMemberProcedure.input(z.object({
    currentLocation: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable().optional(),
    nextCommitmentAt: z.coerce.date().nullable().optional(), capacityFull: z.boolean().optional(),
  }).default({})).query(({ ctx, input }) => getFieldMoves({ ...input, tenantId: ctx.tenantId, userId: ctx.user.openId })),
  acceptMove: dayforgeTenantMemberProcedure.input(z.object({
    moveId: z.string().regex(/^mission:\d+:(?:visit|call)$/), missionId: z.number().int().positive(), expectedVersion: z.number().int().positive(), requestId: z.string().uuid(),
  })).mutation(({ ctx, input }) => activateCommercialMissionForField({
    tenantId: ctx.tenantId, missionId: input.missionId, expectedVersion: input.expectedVersion,
    assignedTo: ctx.user.openId, actorId: ctx.user.openId, requestId: input.requestId,
  })),
});
