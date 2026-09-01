import { z } from "zod";
import {
  dayforgeMissionFieldProcedure,
  dayforgeTenantAdminProcedure,
  dayforgeTenantMemberProcedure,
  dayforgeTenantOperatorProcedure,
  router,
} from "../_core/trpc";
import {
  listEntityChronicle,
  listUnpresentedCelebrationEvents,
  recordGoldlineEventReceipt,
} from "./worldEventStore";
import { approveAndPublishTower, getForgeReview, listForgeJobs, processTowerForgeJob, queueTowerForgeJob, rejectTowerForgeJob, selectTowerWeaponConcept } from "../worldForge/worldForgeService";
import { listCityWorldEntities } from "./cityWorldService";
import {
  listPresentedTerritories,
  recordGuardianDefeated,
} from "./territoryService";
import {
  chooseCampaignBranch,
  getOrMaterializeTodayCampaign,
  listOperatorCampaigns,
  recordCampaignChapterGameCompleted,
  upsertFictionAssignmentIfAbsent,
} from "./campaignService";

export const goldlineWorldRouter = router({
  cityEntities: dayforgeTenantOperatorProcedure.query(({ ctx }) => listCityWorldEntities({ tenantId: ctx.tenantId })),
  unpresentedCelebrations: dayforgeMissionFieldProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .query(({ ctx, input }) => listUnpresentedCelebrationEvents({
      tenantId: ctx.tenantId,
      viewerId: ctx.user.openId,
      limit: input?.limit,
    })),
  markEvent: dayforgeMissionFieldProcedure.input(z.object({
    worldEventId: z.string().uuid(),
    receiptType: z.enum(["presented", "read", "acknowledged"]),
  })).mutation(({ ctx, input }) => recordGoldlineEventReceipt({
    tenantId: ctx.tenantId,
    viewerId: ctx.user.openId,
    ...input,
  })),
  chronicle: dayforgeTenantOperatorProcedure.input(z.object({
    physicalEntityId: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(100),
  })).query(({ ctx, input }) => listEntityChronicle({ tenantId: ctx.tenantId, ...input })),
  forgeJobs: dayforgeTenantAdminProcedure.input(z.object({
    limit: z.number().int().min(1).max(200).default(100),
  }).optional()).query(({ ctx, input }) => listForgeJobs({ tenantId: ctx.tenantId, limit: input?.limit })),
  forgeReview: dayforgeTenantAdminProcedure.input(z.object({ forgeJobId: z.string().uuid() }))
    .query(({ ctx, input }) => getForgeReview({ tenantId: ctx.tenantId, ...input })),
  selectWeapon: dayforgeTenantAdminProcedure.input(z.object({ forgeJobId: z.string().uuid(), conceptId: z.string().uuid() }))
    .mutation(({ ctx, input }) => selectTowerWeaponConcept({ tenantId: ctx.tenantId, ...input })),
  rejectForge: dayforgeTenantAdminProcedure.input(z.object({ forgeJobId: z.string().uuid(), confirmation: z.literal("REJECT"), reason: z.string().trim().min(3).max(512) }))
    .mutation(({ ctx, input }) => rejectTowerForgeJob({ tenantId: ctx.tenantId, forgeJobId: input.forgeJobId, reason: input.reason })),
  approveAndPublish: dayforgeTenantAdminProcedure.input(z.object({ forgeJobId: z.string().uuid(), assetId: z.string().uuid(), confirmation: z.literal("PUBLISH") }))
    .mutation(({ ctx, input }) => approveAndPublishTower({ tenantId: ctx.tenantId, forgeJobId: input.forgeJobId, assetId: input.assetId, actorId: ctx.user.openId })),
  retryForge: dayforgeTenantAdminProcedure.input(z.object({ forgeJobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      queueTowerForgeJob({ tenantId: ctx.tenantId, forgeJobId: input.forgeJobId });
      return { queued: true } as const;
    }),
  processForgeNow: dayforgeTenantAdminProcedure.input(z.object({ forgeJobId: z.string().uuid() }))
    .mutation(({ ctx, input }) => processTowerForgeJob({ tenantId: ctx.tenantId, forgeJobId: input.forgeJobId })),
  territories: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    listPresentedTerritories({ tenantId: ctx.tenantId })
  ),
  recordGuardianDefeat: dayforgeTenantMemberProcedure
    .input(
      z.object({
        territoryId: z.string().uuid(),
        guardianId: z.string().min(1).max(64),
        confrontationReady: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      recordGuardianDefeated({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        ...input,
      })
    ),
  campaign: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    getOrMaterializeTodayCampaign({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    })
  ),
  campaigns: dayforgeTenantMemberProcedure.query(({ ctx }) =>
    listOperatorCampaigns({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    })
  ),
  chooseCampaignBranch: dayforgeTenantMemberProcedure
    .input(z.object({ chapterId: z.string().min(1).max(191) }))
    .mutation(({ ctx, input }) =>
      chooseCampaignBranch({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        chapterId: input.chapterId,
      })
    ),
  recordCampaignChapterGameCompleted: dayforgeTenantMemberProcedure
    .input(z.object({ chapterId: z.string().min(1).max(191) }))
    .mutation(({ ctx, input }) =>
      recordCampaignChapterGameCompleted({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        chapterId: input.chapterId,
      })
    ),
  upsertFictionAssignment: dayforgeTenantMemberProcedure
    .input(
      z.object({
        stableMissionKey: z.string().min(1).max(191),
        templateId: z.string().min(1).max(64),
        rulesVersion: z.number().int().min(1).max(32),
      })
    )
    .mutation(({ ctx, input }) =>
      upsertFictionAssignmentIfAbsent({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        ...input,
      })
    ),
});
