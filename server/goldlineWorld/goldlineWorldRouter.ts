/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import {
  legacyDayforgeMissionFieldProcedure,
  legacyDayforgeTenantAdminProcedure,
  legacyDayforgeTenantMemberProcedure,
  legacyDayforgeTenantOperatorProcedure,
  router,
} from "../_core/trpc";
import {
  listEntityChronicle,
  listCurrentEconomicReceipts,
  listUnpresentedCelebrationEvents,
  recordGoldlineEventReceipt,
} from "./worldEventStore";
import {
  approveAndPublishTower,
  getForgeReview,
  listForgeJobs,
  processTowerForgeJob,
  queueTowerForgeJob,
  rejectTowerForgeJob,
  selectTowerWeaponConcept,
} from "../worldForge/worldForgeService";
import { listCityWorldEntities } from "./cityWorldService";
import {
  listPresentedTerritories,
  recordGuardianDefeated,
} from "./territoryService";
import {
  chooseCampaignBranch,
  getOrMaterializeTodayCampaign,
  listOperatorCampaigns,
  recordCampaignGuardianFinaleForTerritory,
  upsertFictionAssignmentIfAbsent,
} from "./campaignService";
import { resetProofWorldFromApi } from "./goldlineProofWorld";
import { buildFrontierIntelligence } from "./frontierIntelligenceService";
import { getLanternCityOverview } from "./lanternCityOverviewService";
import { listBehavioralLedgerEventsForOperatorCorrelation } from "../behavioralLedger/behavioralLedger";
import { ACTION_GRAMMAR_KINDS } from "../../shared/actionGrammar";
import { FICTION_ELIGIBILITY_CATALOG } from "../../shared/fictionEligibilityCatalog";
import { resolveProductionExperimentPolicy } from "../../shared/behavioralExperimentPolicy";
import { assignExperimentalPresentation } from "../behavioralExperiment/assignPresentation";

export const goldlineWorldRouter = router({
  lanternCityOverview: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    getLanternCityOverview({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    })
  ),
  frontierIntelligence: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        territoryId: z.string().trim().min(2).max(80),
        neighbourhood: z.string().trim().min(2).max(80),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
    )
    .query(({ ctx, input }) =>
      buildFrontierIntelligence({ tenantId: ctx.tenantId, ...input })
    ),
  economicReceipts: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    listCurrentEconomicReceipts(ctx.tenantId)
  ),
  cityEntities: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    listCityWorldEntities({ tenantId: ctx.tenantId })
  ),
  unpresentedCelebrations: legacyDayforgeMissionFieldProcedure
    .input(
      z
        .object({ limit: z.number().int().min(1).max(50).default(20) })
        .optional()
    )
    .query(({ ctx, input }) =>
      listUnpresentedCelebrationEvents({
        tenantId: ctx.tenantId,
        viewerId: ctx.user.openId,
        limit: input?.limit,
      })
    ),
  markEvent: legacyDayforgeMissionFieldProcedure
    .input(
      z.object({
        worldEventId: z.string().uuid(),
        receiptType: z.enum(["presented", "read", "acknowledged"]),
      })
    )
    .mutation(({ ctx, input }) =>
      recordGoldlineEventReceipt({
        tenantId: ctx.tenantId,
        viewerId: ctx.user.openId,
        ...input,
      })
    ),
  chronicle: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        physicalEntityId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(100),
      })
    )
    .query(({ ctx, input }) =>
      listEntityChronicle({ tenantId: ctx.tenantId, ...input })
    ),
  forgeJobs: legacyDayforgeTenantAdminProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(100),
        })
        .optional()
    )
    .query(({ ctx, input }) =>
      listForgeJobs({ tenantId: ctx.tenantId, limit: input?.limit })
    ),
  forgeReview: legacyDayforgeTenantAdminProcedure
    .input(z.object({ forgeJobId: z.string().uuid() }))
    .query(({ ctx, input }) =>
      getForgeReview({ tenantId: ctx.tenantId, ...input })
    ),
  selectWeapon: legacyDayforgeTenantAdminProcedure
    .input(
      z.object({ forgeJobId: z.string().uuid(), conceptId: z.string().uuid() })
    )
    .mutation(({ ctx, input }) =>
      selectTowerWeaponConcept({ tenantId: ctx.tenantId, ...input })
    ),
  rejectForge: legacyDayforgeTenantAdminProcedure
    .input(
      z.object({
        forgeJobId: z.string().uuid(),
        confirmation: z.literal("REJECT"),
        reason: z.string().trim().min(3).max(512),
      })
    )
    .mutation(({ ctx, input }) =>
      rejectTowerForgeJob({
        tenantId: ctx.tenantId,
        forgeJobId: input.forgeJobId,
        reason: input.reason,
      })
    ),
  approveAndPublish: legacyDayforgeTenantAdminProcedure
    .input(
      z.object({
        forgeJobId: z.string().uuid(),
        assetId: z.string().uuid(),
        confirmation: z.literal("PUBLISH"),
      })
    )
    .mutation(({ ctx, input }) =>
      approveAndPublishTower({
        tenantId: ctx.tenantId,
        forgeJobId: input.forgeJobId,
        assetId: input.assetId,
        actorId: ctx.user.openId,
      })
    ),
  retryForge: legacyDayforgeTenantAdminProcedure
    .input(z.object({ forgeJobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      queueTowerForgeJob({
        tenantId: ctx.tenantId,
        forgeJobId: input.forgeJobId,
      });
      return { queued: true } as const;
    }),
  processForgeNow: legacyDayforgeTenantAdminProcedure
    .input(z.object({ forgeJobId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      processTowerForgeJob({
        tenantId: ctx.tenantId,
        forgeJobId: input.forgeJobId,
      })
    ),
  territories: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    listPresentedTerritories({ tenantId: ctx.tenantId })
  ),
  recordGuardianDefeat: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        territoryId: z.string().uuid(),
        guardianId: z.string().min(1).max(64),
        confrontationReady: z.boolean(),
        // Backward-compatible client snapshot only. The server deliberately
        // ignores it and resolves the matching persisted finale by territory.
        campaignChapterId: z.string().min(1).max(191).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Ensure a derived-ready finale is persisted even if the independent
      // client campaign query has not loaded yet. This is game projection only;
      // it does not change territory or business truth.
      await getOrMaterializeTodayCampaign({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
      });

      // Territory truth is validated/written first. Invalid readiness, guardian
      // mismatch, or a failed territory write can therefore never manufacture
      // campaign completion. On retry, an already-cleared territory still
      // returns recorded=true, allowing the persisted campaign finale to heal.
      const result = await recordGuardianDefeated({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        territoryId: input.territoryId,
        guardianId: input.guardianId,
        confrontationReady: input.confrontationReady,
      });
      if (!result.recorded) {
        return {
          ...result,
          campaignChapterCompleted: false,
          completedCampaignChapterId: null,
        };
      }
      const campaignResult = await recordCampaignGuardianFinaleForTerritory({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        territoryId: input.territoryId,
      });
      return {
        ...result,
        campaignChapterCompleted: campaignResult.completed,
        completedCampaignChapterId: campaignResult.chapterId,
      };
    }),
  campaign: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    getOrMaterializeTodayCampaign({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    })
  ),
  campaigns: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    listOperatorCampaigns({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    })
  ),
  chooseCampaignBranch: legacyDayforgeTenantMemberProcedure
    .input(z.object({ chapterId: z.string().min(1).max(191) }))
    .mutation(({ ctx, input }) =>
      chooseCampaignBranch({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        chapterId: input.chapterId,
      })
    ),
  upsertFictionAssignment: legacyDayforgeTenantMemberProcedure
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
  behavioralEventsForSubject: legacyDayforgeTenantMemberProcedure
    .input(z.object({ correlationId: z.string().min(1).max(191) }))
    .query(async ({ ctx, input }) => {
      const rows = await listBehavioralLedgerEventsForOperatorCorrelation(
        ctx.tenantId,
        ctx.user.openId,
        input.correlationId
      );
      return {
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        correlationId: input.correlationId,
        events: rows.map(row => ({
          tenantId: row.tenantId,
          operatorUserId: row.operatorUserId,
          eventType: row.eventType,
          sourceEntityId: row.sourceEntityId,
          correlationId: row.correlationId,
        })),
      };
    }),
  experimentalPresentationAssignment: legacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        correlationId: z.string().min(1).max(128),
        occasionId: z.string().min(1).max(96),
        emergency: z.boolean().optional(),
        grammar: z.object({
          kind: z.enum(ACTION_GRAMMAR_KINDS),
          businessActionId: z.string().nullable(),
          occurrenceId: z.number().nullable(),
          sourceType: z.enum(["mission", "field_move", "follow_up", "recovery", "scout"]),
          count: z.number(),
          locations: z.array(z.string()),
          channel: z.enum(["phone", "in_person", "none"]),
          requiresTravel: z.boolean(),
          requiresDriving: z.boolean(),
          timerSafe: z.boolean(),
          sensitiveConversation: z.boolean(),
        }),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await assignExperimentalPresentation({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        correlationId: input.correlationId,
        occasionId: input.occasionId,
        grammar: input.grammar,
        registry: FICTION_ELIGIBILITY_CATALOG,
        policy: resolveProductionExperimentPolicy(),
        emergency: input.emergency,
      });
      if (!result.usedExperiment) {
        return {
          usedExperiment: false as const,
          skipReason: result.skipReason,
          preferredTemplateId: null,
          assignedOption: null,
          assignmentProbability: null,
          assignmentMechanism: "deterministic_policy" as const,
          decisionPointId: null,
        };
      }
      return {
        usedExperiment: true as const,
        skipReason: null,
        preferredTemplateId: result.assignment.preferredTemplateId,
        assignedOption: result.assignment.assignedOption,
        assignmentProbability: result.assignment.assignmentProbability,
        assignmentMechanism: result.assignment.assignmentMechanism,
        decisionPointId: result.assignment.decisionPointId,
        eligibleOptions: result.assignment.eligibleOptions,
        proximalOutcomeWindowMinutes: result.assignment.proximalOutcomeWindowMinutes,
      };
    }),
  resetProofWorld: legacyDayforgeTenantAdminProcedure.mutation(() =>
    resetProofWorldFromApi()
  ),
});
