/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  legacyLegacyDayforgeProposalFieldProcedure,
  legacyLegacyDayforgeProposalOperatorProcedure,
  router,
} from "../_core/trpc";
import { assertDriverCanReadMission } from "../commercialMissions/commercialMissionAuthorization";
import { getCommercialMission } from "../commercialMissions/commercialMissionStore";
import {
  approveCommercialProposal,
  generateCommercialProposal,
  getCommercialProposalProfile,
  getLatestCommercialProposalForMission,
  recordCommercialProposalBrowserPrint,
  saveCommercialProposalProfile,
} from "./commercialProposalService";

const profileSchema = z.object({
  storeName: z.string().trim().min(1).max(255),
  operatorName: z.string().trim().min(1).max(255),
  phone: z.string().trim().min(7).max(64),
  email: z.string().trim().email().max(320),
  website: z.string().trim().url().max(512),
  address: z.string().trim().min(1).max(512),
  logoUrl: z.string().trim().url().max(1024).nullable(),
  commercialPricePerPoundCents: z.number().int().positive().max(100_000),
  minimumOrderCents: z.number().int().nonnegative().max(100_000_000).nullable(),
  turnaroundLabel: z.string().trim().min(1).max(255),
  pickupScheduleLabel: z.string().trim().min(1).max(255),
  serviceAreaLabel: z.string().trim().min(1).max(255),
  insuranceLabel: z.string().trim().min(1).max(255).nullable(),
  services: z.array(z.string().trim().min(1).max(255)).min(1).max(20),
});

async function authorizedMission(input: {
  tenantId: string;
  missionId: number;
  userId: string;
  isAdmin: boolean;
}) {
  const mission = await getCommercialMission(input);
  if (!mission)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Commercial mission not found",
    });
  try {
    assertDriverCanReadMission({
      mission,
      userId: input.userId,
      isAdmin: input.isAdmin,
    });
  } catch (error) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: (error as Error).message,
    });
  }
  return mission;
}

export const commercialProposalRouter = router({
  profile: legacyLegacyDayforgeProposalOperatorProcedure.query(({ ctx }) =>
    getCommercialProposalProfile(ctx.tenantId)
  ),

  saveProfile: legacyLegacyDayforgeProposalOperatorProcedure
    .input(profileSchema)
    .mutation(({ ctx, input }) =>
      saveCommercialProposalProfile({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        profile: input,
      })
    ),

  forMission: legacyLegacyDayforgeProposalFieldProcedure
    .input(z.object({ missionId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await authorizedMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
        userId: ctx.user.openId,
        isAdmin: ctx.legacyLegacyDayforgeMembership.role !== "field",
      });
      return getLatestCommercialProposalForMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
        approvedOnly: ctx.legacyLegacyDayforgeMembership.role === "field",
      });
    }),

  generate: legacyLegacyDayforgeProposalOperatorProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      generateCommercialProposal({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  approve: legacyLegacyDayforgeProposalOperatorProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        proposalId: z.string().uuid(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(({ ctx, input }) =>
      approveCommercialProposal({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  recordBrowserPrint: legacyLegacyDayforgeProposalFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        proposalId: z.string().uuid(),
        requestId: z.string().uuid(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await authorizedMission({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
        userId: ctx.user.openId,
        isAdmin: ctx.legacyLegacyDayforgeMembership.role !== "field",
      });
      return recordCommercialProposalBrowserPrint({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      });
    }),
});
