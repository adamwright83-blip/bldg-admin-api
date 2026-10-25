/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { z } from "zod";
import { outreachSubmission } from "../../shared/beverlyHillsOutreach";
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
} from "../experience/goldline/world/worldEventStore";
import {
  approveAndPublishTower,
  getForgeReview,
  listForgeJobs,
  processTowerForgeJob,
  queueTowerForgeJob,
  rejectTowerForgeJob,
  selectTowerWeaponConcept,
} from "../field/propertyDiscovery/towerForgeWorkflow";
import { listCityWorldEntities } from "../experience/lanternCity/cityWorldService";
import {
  listPresentedTerritories,
  recordGuardianDefeated,
} from "../experience/goldline/world/territoryService";
import {
  chooseCampaignBranch,
  getOrMaterializeTodayCampaign,
  listOperatorCampaigns,
  recordCampaignGuardianFinaleForTerritory,
  upsertFictionAssignmentIfAbsent,
} from "../experience/goldline/world/campaignService";
import { resetProofWorldFromApi } from "../experience/goldline/world/goldlineProofWorld";
import { buildFrontierIntelligence } from "../field/targeting/frontierIntelligenceService";
import { getLanternCityOverview } from "../experience/lanternCity/lanternCityOverviewService";
import { listBehavioralLedgerEventsForOperatorCorrelation } from "../behavioralLedger/behavioralLedger";
import { ACTION_GRAMMAR_KINDS } from "../../shared/actionGrammar";
import { FICTION_ELIGIBILITY_CATALOG } from "../../shared/fictionEligibilityCatalog";
import { resolveProductionExperimentPolicy } from "../../shared/behavioralExperimentPolicy";
import { assignAuthorizedPresentation, acknowledgePresentationViewable, loadPresentationConsent } from "../behavioralExperiment/presentationRuntime";
import { PRESENTATION_CONSENT_TEXT, readPresentationConsent, setPresentationConsent } from "../behavioralExperiment/presentationConsentService";
import { loadPresentationExperimentReport } from "../behavioralExperiment/presentationOutcomes";
import { sendCozyOutreachNow } from "../experience/lanternCity/cozyVillagerOutreachService";
import { loadCozyRecoverySurfaces } from "../experience/lanternCity/cozyRecoverySurfaces";
import { silverLakeOperatorId } from "../experience/lanternCity/silverLakeScope";
import {
  PERSONAL_OUTREACH_SCHEDULE_APPROVAL,
  SMS_COMPOSE_APPROVAL_CONFIRMATION,
  SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
} from "../experience/lanternCity/personalNumber/smsComposeHandoff";

export const goldlineWorldRouter = router({
  lanternCityOverview: legacyDayforgeTenantOperatorProcedure.query(({ ctx }) =>
    getLanternCityOverview({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    })
  ),
  cozyVillagerMission: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({
          territoryId: z.string().optional(),
          requestedCustomerId: z.string().optional(),
          limit: z.number().int().min(1).max(8).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) =>
      loadCozyRecoverySurfaces({
        tenantId: ctx.tenantId,
        canonicalOperatorId: await silverLakeOperatorId(ctx),
        operatorId: ctx.user.openId,
        territoryId: input?.territoryId,
        requestedCustomerId: input?.requestedCustomerId,
        limit: input?.limit,
      }).then(surfaces => surfaces.mission)
    ),
  /** Reunion quests: fiction progress and explicit passes for the selected business. Never an outreach state. */
  reunionQuestEvents: legacyDayforgeTenantOperatorProcedure
    .input(z.object({ territoryId: z.string().default("silver-lake") }).optional())
    .query(async ({ ctx, input }) => {
      const { listReunionEvents } = await import("../experience/lanternCity/reunionQuestEvents");
      return { events: await listReunionEvents({ tenantId: ctx.tenantId, territoryId: input?.territoryId ?? "silver-lake" }) };
    }),
  recordReunionQuestEvent: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        territoryId: z.string().default("silver-lake"),
        customerId: z.string().min(1).max(191),
        templateId: z.string().min(3).max(64),
        kind: z.enum(["item_found", "reunited", "passed"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { recordReunionEvent } = await import("../experience/lanternCity/reunionQuestEvents");
      return recordReunionEvent({
        tenantId: ctx.tenantId,
        territoryId: input.territoryId,
        operatorId: ctx.user.openId,
        customerId: input.customerId,
        templateId: input.templateId,
        kind: input.kind,
      });
    }),
  /** Lantern City's Beverly Hills level: the selected business's real commercial prospects there (read-only). */
  beverlyHillsProspects: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const { loadBeverlyHillsProspects } = await import("../experience/lanternCity/beverlyHillsProspects");
    return loadBeverlyHillsProspects(ctx.tenantId);
  }),
  beverlyHillsOutreach: legacyDayforgeTenantOperatorProcedure.query(async ({ctx}) => {
    const {loadBeverlyOutreach}=await import("../experience/lanternCity/beverlyHillsOutreach");
    return loadBeverlyOutreach(ctx.tenantId,ctx.user.openId,["owner","admin"].includes(ctx.legacyDayforgeMembership.role));
  }),
  submitBeverlyHillsOutreach: legacyDayforgeTenantOperatorProcedure.input(outreachSubmission).mutation(async ({ctx,input}) => {
    const {submitBeverlyOutreach}=await import("../experience/lanternCity/beverlyHillsOutreach");
    return submitBeverlyOutreach(ctx.tenantId,ctx.user.openId,input);
  }),
  reviewBeverlyHillsOutreach: legacyDayforgeTenantAdminProcedure.input(z.object({id:z.string().uuid(),decision:z.enum(["verified","rejected"]),note:z.string().trim().min(12).max(2000)})).mutation(async ({ctx,input}) => {
    const {reviewBeverlyOutreach}=await import("../experience/lanternCity/beverlyHillsOutreach");
    return reviewBeverlyOutreach(ctx.tenantId,ctx.user.openId,input);
  }),
  getNeighborhoodMemory: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({
          territoryId: z.string().default("silver-lake"),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { loadNeighborhoodWorldMemory } = await import(
        "../experience/lanternCity/neighborhoodMemoryService"
      );
      return await loadNeighborhoodWorldMemory({
        tenantId: ctx.tenantId,
        territoryId: input?.territoryId,
      });
    }),
  saveNeighborhoodFeature: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        territoryId: z.string().default("silver-lake"),
        featureChoice: z.enum(["tea_table", "reading_bench", "lantern_post"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { saveNeighborhoodFeature } = await import(
        "../experience/lanternCity/neighborhoodMemoryService"
      );
      return await saveNeighborhoodFeature({
        tenantId: ctx.tenantId,
        territoryId: input.territoryId,
        featureChoice: input.featureChoice,
      });
    }),
  recordVillagerInteraction: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        territoryId: z.string().default("silver-lake"),
        villagerVariant: z.enum([
          "fox",
          "badger",
          "bunny",
          "bear",
          "otter",
          "hedgehog",
          "squirrel",
          "cat",
        ]),
        customerId: z.string().optional(),
        customerName: z.string().optional(),
        approach: z
          .enum(["warm_brief", "helpful_detailed", "cozy_care_perk", "custom"])
          .optional(),
        draftBody: z.string().optional(),
        actionType: z
          .enum([
            "draft_prepared",
            "scheduled",
            "compose_handoff_opened",
            "operator_reported_sent",
            "independently_verified_sent",
          ])
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { recordVillagerInteraction } = await import(
        "../experience/lanternCity/neighborhoodMemoryService"
      );
      return await recordVillagerInteraction({
        tenantId: ctx.tenantId,
        territoryId: input.territoryId,
        villagerVariant: input.villagerVariant as any,
        customerId: input.customerId,
        customerName: input.customerName,
        approach: input.approach as any,
        draftBody: input.draftBody,
        actionType: input.actionType,
      });
    }),
  saveUnfinishedLetterDraft: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        territoryId: z.string().default("silver-lake"),
        customerId: z.string().min(1),
        customerName: z.string().min(1),
        villagerVariant: z.enum([
          "fox",
          "badger",
          "bunny",
          "bear",
          "otter",
          "hedgehog",
          "squirrel",
          "cat",
        ]),
        selectedApproach: z.enum([
          "warm_brief",
          "helpful_detailed",
          "cozy_care_perk",
          "custom",
        ]),
        draftBody: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { saveUnfinishedLetterDraft } = await import(
        "../experience/lanternCity/neighborhoodMemoryService"
      );
      return await saveUnfinishedLetterDraft({
        tenantId: ctx.tenantId,
        territoryId: input.territoryId,
        customerId: input.customerId,
        customerName: input.customerName,
        villagerVariant: input.villagerVariant as any,
        selectedApproach: input.selectedApproach as any,
        draftBody: input.draftBody,
      });
    }),
  cozyRecoveryDayLineCard: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) =>
    loadCozyRecoverySurfaces({
      tenantId: ctx.tenantId,
      canonicalOperatorId: await silverLakeOperatorId(ctx),
      operatorId: ctx.user.openId,
    }).then(surfaces => surfaces.dayLineCard)
  ),
  sendCozyOutreachNow: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
        messageBody: z.string().min(1).max(500),
        expectedPhone: z.string().optional(),
        slotId: z.enum([
          "slot_01",
          "slot_02",
          "slot_03",
          "slot_04",
          "slot_05",
          "slot_06",
          "slot_07",
          "slot_08",
        ]).optional(),
        territoryId: z.string().optional(),
        idempotencyKey: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) =>
      sendCozyOutreachNow({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        canonicalOperatorId: await silverLakeOperatorId(ctx),
        customerId: input.customerId,
        messageBody: input.messageBody,
        expectedPhone: input.expectedPhone,
        slotId: input.slotId,
        territoryId: input.territoryId,
        idempotencyKey: input.idempotencyKey,
      })
    ),
  scheduleCozyOutreach: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        customerId: z.string().min(1),
        messageBody: z.string().min(1).max(500),
        scheduledFor: z.string().min(1),
        timezone: z.string().default("America/Los_Angeles"),
        expectedPhone: z.string().optional(),
        slotId: z.string().optional(),
        territoryId: z.string().optional(),
        dstAmbiguityChoice: z.enum(["first", "second"]).optional(),
        idempotencyKey: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { commitPersonalOutreachDraft } = await import(
        "../experience/lanternCity/cozyVillagerOutreachService"
      );
      return await commitPersonalOutreachDraft({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        canonicalOperatorId: await silverLakeOperatorId(ctx),
        customerId: input.customerId,
        messageBody: input.messageBody,
        scheduledFor: input.scheduledFor,
        timezone: input.timezone,
        expectedPhone: input.expectedPhone,
        slotId: input.slotId,
        territoryId: input.territoryId,
        dstAmbiguityChoice: input.dstAmbiguityChoice,
        idempotencyKey: input.idempotencyKey,
        deliveryIntent: "scheduled",
      });
    }),
  listScheduledOutreach: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { listScheduledOutreachMessages } = await import(
        "../experience/lanternCity/scheduledOutreachService"
      );
      return await listScheduledOutreachMessages({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        status: input?.status,
        limit: input?.limit,
      });
    }),
  editScheduledOutreach: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
        newMessageBody: z.string().min(1).max(500),
        expectedRevisionCount: z.number().int().positive().optional(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { editScheduledOutreachDraft } = await import(
        "../experience/lanternCity/scheduledOutreachService"
      );
      return await editScheduledOutreachDraft({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        messageId: input.messageId,
        newMessageBody: input.newMessageBody,
        expectedRevisionCount: input.expectedRevisionCount,
        reason: input.reason,
      });
    }),
  rescheduleOutreach: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
        newScheduledFor: z.string().min(1),
        timezone: z.string().default("America/Los_Angeles"),
        dstAmbiguityChoice: z.enum(["first", "second"]).optional(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { rescheduleOutreachDraft } = await import(
        "../experience/lanternCity/scheduledOutreachService"
      );
      return await rescheduleOutreachDraft({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        messageId: input.messageId,
        newScheduledFor: input.newScheduledFor,
        timezone: input.timezone,
        dstAmbiguityChoice: input.dstAmbiguityChoice,
        reason: input.reason,
      });
    }),
  cancelScheduledOutreach: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
        reason: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { cancelScheduledOutreachDraft } = await import(
        "../experience/lanternCity/scheduledOutreachService"
      );
      return await cancelScheduledOutreachDraft({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        messageId: input.messageId,
        reason: input.reason,
      });
    }),
  approvePersonalOutreach: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
        expectedRevisionCount: z.number().int().positive(),
        confirmation: z.literal(PERSONAL_OUTREACH_SCHEDULE_APPROVAL),
        territoryId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { approveDurablePersonalOutreach } = await import(
        "../experience/lanternCity/cozyVillagerOutreachService"
      );
      return await approveDurablePersonalOutreach({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        canonicalOperatorId: await silverLakeOperatorId(ctx),
        messageId: input.messageId,
        expectedRevisionCount: input.expectedRevisionCount,
        confirmation: input.confirmation,
        territoryId: input.territoryId,
      });
    }),
  sendEarlyOutreach: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { sendEarlyOutreachDraft } = await import(
        "../experience/lanternCity/scheduledOutreachService"
      );
      return await sendEarlyOutreachDraft({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        messageId: input.messageId,
        leaseHolder: `operator_${ctx.user.openId}`,
      });
    }),
  openSmsComposeHandoff: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1).max(128),
        revisionCount: z.number().int().positive(),
        approvedBody: z.string().min(1).max(500),
        recipientPhone: z.string().min(7).max(32),
        confirmation: z.literal(SMS_COMPOSE_APPROVAL_CONFIRMATION),
        clientKind: z.enum(["android", "ios", "desktop", "other"]),
        surface: z.enum(["cozy_composer", "scheduled_outreach"]),
        pageUrl: z.string().max(2000).optional(),
        origin: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { openApprovedSmsCompose } = await import(
        "../experience/lanternCity/personalNumber/smsComposeHandoffAudit"
      );
      return await openApprovedSmsCompose({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        messageId: input.messageId,
        revisionCount: input.revisionCount,
        approvedBody: input.approvedBody,
        recipientPhone: input.recipientPhone,
        confirmation: input.confirmation,
        clientKind: input.clientKind,
        surface: input.surface,
        pageUrl: input.pageUrl,
        origin: input.origin,
      });
    }),
  reportSmsComposeOperatorSent: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1).max(128),
        revisionCount: z.number().int().positive(),
        approvedBody: z.string().min(1).max(500),
        confirmation: z.literal(SMS_COMPOSE_REPORTED_SENT_CONFIRMATION),
        surface: z.enum(["cozy_composer", "scheduled_outreach"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { reportSmsComposeOperatorSent } = await import(
        "../experience/lanternCity/personalNumber/smsComposeHandoffAudit"
      );
      return await reportSmsComposeOperatorSent({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        messageId: input.messageId,
        revisionCount: input.revisionCount,
        approvedBody: input.approvedBody,
        confirmation: input.confirmation,
        surface: input.surface,
      });
    }),
  smsComposeHandoffSnapshot: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        items: z
          .array(
            z.object({
              messageId: z.string().min(1).max(128),
              revisionCount: z.number().int().positive(),
              approvedBody: z.string().max(500),
            })
          )
          .max(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const { smsComposeHandoffSnapshot } = await import(
        "../experience/lanternCity/personalNumber/smsComposeHandoffAudit"
      );
      return await smsComposeHandoffSnapshot({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        items: input.items,
      });
    }),
  personalSenderStatus: legacyDayforgeTenantOperatorProcedure.query(async ({ ctx }) => {
    const { getPersonalSenderStatus } = await import(
      "../experience/lanternCity/personalNumber/personalSenderIdentityStore"
    );
    return await getPersonalSenderStatus({
      tenantId: ctx.tenantId,
      operatorId: ctx.user.openId,
    });
  }),
  recordPersonalOutreachReply: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        customerId: z.string().min(1).max(128),
        customerName: z.string().min(1).max(255).optional(),
        replyText: z.string().min(1).max(1000),
        classification: z
          .enum(["pickup_interest", "question", "not_now", "complaint", "opt_out"])
          .optional(),
        messageId: z.string().max(128).nullable().optional(),
        territoryId: z.string().max(64).nullable().optional(),
        surface: z
          .enum(["cozy_composer", "day_line"])
          .default("cozy_composer"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { recordPersonalOutreachReply } = await import(
        "../experience/lanternCity/personalNumber/personalOutreachReplyService"
      );
      return await recordPersonalOutreachReply({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        customerId: input.customerId,
        customerName: input.customerName,
        replyText: input.replyText,
        classification: input.classification,
        messageId: input.messageId ?? null,
        territoryId: input.territoryId ?? null,
        surface: input.surface,
      });
    }),
  listPersonalOutreachReplies: legacyDayforgeTenantOperatorProcedure
    .input(
      z
        .object({
          customerId: z.string().max(128).optional(),
          direction: z.enum(["inbound", "outbound"]).optional(),
          source: z
            .enum(["provider_webhook", "device_observed", "operator_reported"])
            .optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const { listPersonalOutreachReplies } = await import(
        "../experience/lanternCity/personalNumber/personalOutreachReplyService"
      );
      return await listPersonalOutreachReplies({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        customerId: input?.customerId,
        direction: input?.direction,
        source: input?.source,
      });
    }),
  getScheduledOutreachRevisions: legacyDayforgeTenantOperatorProcedure
    .input(
      z.object({
        messageId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { getScheduledOutreachRevisions } = await import(
        "../experience/lanternCity/scheduledOutreachService"
      );
      return await getScheduledOutreachRevisions({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        messageId: input.messageId,
      });
    }),
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
        adaptationAllowed: (await loadPresentationConsent({ tenantId: ctx.tenantId, operatorUserId: ctx.user.openId })).adaptationAllowed,
        events: rows.map(row => ({
          tenantId: row.tenantId,
          operatorUserId: row.operatorUserId,
          eventType: row.eventType,
          sourceEntityId: row.sourceEntityId,
          correlationId: row.correlationId,
        })),
      };
    }),
  /** The operator's own randomized presentation outcomes by arm. Descriptive only, never a causal claim. */
  presentationExperimentReport: legacyDayforgeTenantMemberProcedure.query(({ ctx }) =>
    loadPresentationExperimentReport({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
      minSamplePerArm: resolveProductionExperimentPolicy().minSamplePerArmForCausalClaim,
    })
  ),
  /** The operator's own Daphne presentation consent, exactly as stored, with the text they agree to. */
  presentationConsent: legacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => ({
    ...(await readPresentationConsent({ tenantId: ctx.tenantId, operatorUserId: ctx.user.openId })),
    text: PRESENTATION_CONSENT_TEXT,
  })),
  setPresentationConsent: legacyDayforgeTenantMemberProcedure
    .input(z.object({ choice: z.enum(["adaptation", "experimentation"]), granted: z.boolean() }))
    .mutation(async ({ ctx, input }) => ({
      ...(await setPresentationConsent({ tenantId: ctx.tenantId, operatorUserId: ctx.user.openId, ...input })),
      text: PRESENTATION_CONSENT_TEXT,
    })),
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
      const result = await assignAuthorizedPresentation({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        correlationId: input.correlationId,
        occasionId: input.occasionId,
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
        rulesVersion: result.assignment.preferredTemplateId ? FICTION_ELIGIBILITY_CATALOG.find(t => t.id === result.assignment.preferredTemplateId)?.rulesVersion ?? null : null,
        assignmentProbability: result.assignment.assignmentProbability,
        assignmentMechanism: result.assignment.assignmentMechanism,
        /** False when Daphne throttled this occasion to the baseline (not randomized). */
        availability: result.assignment.availability,
        decisionPointId: result.assignment.decisionPointId,
        eligibleOptions: result.assignment.eligibleOptions,
        proximalOutcomeWindowMinutes: result.assignment.proximalOutcomeWindowMinutes,
      };
    }),
  acknowledgePresentationViewable: legacyDayforgeTenantMemberProcedure
    .input(z.object({ correlationId: z.string().min(1).max(128), occasionId: z.string().min(1).max(96),
      decisionPointId: z.string().min(1).max(128), templateId: z.string().min(1).max(64) }))
    .mutation(({ ctx, input }) => acknowledgePresentationViewable({ ...input, tenantId: ctx.tenantId, operatorUserId: ctx.user.openId })),
  resetProofWorld: legacyDayforgeTenantAdminProcedure.mutation(() =>
    resetProofWorldFromApi()
  ),
});
