/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { driverOrderRouter } from "../domains/orders/driver/driverOrderRouter";
import {
  legacyDayforgeMissionFieldProcedure,
  legacyDayforgeTenantMemberProcedure,
  router,
} from "../_core/trpc";
import { assertDriverCanReadMission } from "../commercialMissions/commercialMissionAuthorization";
import { completeDirectMissionPath } from "../commercialMissions/directMissionCompletion";
import { getCommercialMission } from "../commercialMissions/commercialMissionStore";
import { activateCommercialMissionForField } from "../commercialMissions/commercialMissionActivationService";
import { getFieldMoves } from "./fieldOpportunityService";
import { getFieldToday } from "./fieldTodayService";
import {
  getAuthoritativeVisitRoute,
  startAuthoritativeVisitRoute,
} from "./authoritativeVisitRouteService";

export const fieldRouter = router({
  orders: driverOrderRouter,
  today: legacyDayforgeTenantMemberProcedure.query(({ ctx }) => getFieldToday({
    tenantId: ctx.tenantId, userId: ctx.user.openId,
    includeAllAssignees: ctx.legacyDayforgeMembership.role !== "field",
  })),
  moves: legacyDayforgeTenantMemberProcedure.input(z.object({
    currentLocation: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable().optional(),
    nextCommitmentAt: z.coerce.date().nullable().optional(), capacityFull: z.boolean().optional(),
  }).default({})).query(({ ctx, input }) => getFieldMoves({ ...input, tenantId: ctx.tenantId, userId: ctx.user.openId })),
  visitRoute: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    getAuthoritativeVisitRoute({
      tenantId: ctx.tenantId,
      actorId: ctx.user.openId,
    })
  ),
  startVisitRoute: legacyDayforgeTenantMemberProcedure.input(z.object({
    requestId: z.string().uuid(),
    missionIds: z.array(z.number().int().positive()).min(2).max(3),
    currentLocation: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable().optional(),
    nextCommitmentAt: z.coerce.date().nullable().optional(),
  })).mutation(({ ctx, input }) => startAuthoritativeVisitRoute({
    ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId,
  })),
  completeMissionDirectly: legacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        expectedVersion: z.number().int().positive(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const mission = await getCommercialMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
      });
      if (!mission) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Commercial mission not found",
        });
      }
      try {
        assertDriverCanReadMission({
          mission,
          userId: ctx.user.openId,
          isAdmin: ctx.legacyDayforgeMembership.role !== "field",
        });
      } catch (error) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: (error as Error).message,
        });
      }
      return completeDirectMissionPath({
        tenantId: ctx.tenantId,
        mission,
        expectedVersion: input.expectedVersion,
        requestId: input.requestId,
        actor: {
          type: ctx.legacyDayforgeMembership.role === "field" ? "driver" : "operator",
          id: ctx.user.openId,
        },
      });
    }),
  acceptMove: legacyDayforgeTenantMemberProcedure.input(z.object({
    moveId: z.string().regex(/^mission:\d+:(?:visit|call)$/), missionId: z.number().int().positive(), expectedVersion: z.number().int().positive(), requestId: z.string().uuid(),
  })).mutation(({ ctx, input }) => activateCommercialMissionForField({
    tenantId: ctx.tenantId, missionId: input.missionId, expectedVersion: input.expectedVersion,
    assignedTo: ctx.user.openId, actorId: ctx.user.openId, requestId: input.requestId,
  })),
});
