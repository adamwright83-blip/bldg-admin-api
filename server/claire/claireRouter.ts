import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  approveCustomerRecoveryDraft,
  createCustomerRecoveryIntervention,
  getRecoveryInterventionDetail,
  listRecoveryInterventions,
  markCustomerRecoveryContacted,
  prepareCustomerRecoveryManualContact,
  runCustomerChurnScan,
} from "../churnRadar/customerChurnService";
import {
  adminProcedure,
  dayforgeChurnProcedure,
  dayforgeMissionFieldProcedure,
  router,
} from "../_core/trpc";
import type { CanonicalGoldlineAction } from "../../shared/goldlineActionContract";
import { assertDriverCanReadMission } from "../commercialMissions/commercialMissionAuthorization";
import { dayDirectorActorId } from "../dayDirector/dayDirectorActor";
import { getCommercialMission } from "../commercialMissions/commercialMissionStore";
import {
  CLAIRE_ATTESTABLE_EVENT_TYPES,
  recordClaireAttestedEvent,
} from "./character/relationshipEmitters";
import { listClaireRelationshipEvents } from "./character/relationshipEvents";
import {
  getClaireRelationshipState,
  listClaireTierTransitions,
} from "./character/relationshipState";
import { assembleClaireDriveContext } from "./contextAssembler";
import {
  startClairePostStopCall,
  startClairePreDriveCall,
} from "./claireTwilio";
import { previewClairePreDrive } from "./preDriveRuntime";
import { setActiveMacroGoal } from "./macroGoalService";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { handleVoiceCommitmentTurn, type PendingProposalState } from "./voiceCommitmentLoop";
import {
  getClaireCallAnalysis,
  getClaireCallAudio,
  listClaireAnalysisInbox,
  markClaireAnalysisNotificationRead,
  markClaireCallAnalysisWrong,
  markClaireCallReviewed,
} from "./conversation/conversationQuery";
import {
  continueCapabilityEngineering,
  loadCapabilityGapForOperator,
} from "../goldline/engineering/capabilityEngineeringService";
import { GOLDLINE_CAPABILITY_REGISTRY } from "../../shared/goldlineCapabilities";

const uuid = z.string().uuid();

const ATTESTATION_CONFIRMATION =
  "I witnessed this exactly as described and attest it happened" as const;

export async function assertClaireMissionAccess(input: {
  tenantId: string;
  missionId: number;
  userId: string;
  isAdmin: boolean;
}): Promise<void> {
  const mission = await getCommercialMission({
    tenantId: input.tenantId,
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
      userId: input.userId,
      isAdmin: input.isAdmin,
    });
  } catch (error) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: (error as Error).message,
    });
  }
}

function recoveryAction(
  detail: NonNullable<Awaited<ReturnType<typeof getRecoveryInterventionDetail>>>
): CanonicalGoldlineAction {
  const completed = detail.status === "recovered";
  const contacted = detail.status === "contacted";
  return {
    actionId: `recover:intervention:${detail.id}`,
    kind: "RECOVER",
    target: {
      type: "customer",
      id: detail.customer.customerKey,
      displayName: detail.customer.customerName,
    },
    reason: detail.customer.reasons.join(" · "),
    authority: contacted || completed ? "HUMAN_EXECUTION" : "APPROVAL_REQUIRED",
    status: completed
      ? "completed"
      : contacted
        ? "executing"
        : detail.status === "approved"
          ? "approved"
          : "proposed",
    sourceReferences: detail.customer.evidence.flatMap(item =>
      item.sourceIds.map(id => `${item.source}:${id}`)
    ),
    inputs: {
      interventionId: detail.id,
      draftId: detail.draft.id,
      draftStatus: detail.draft.status,
      permission: detail.permission.status,
      estimatedMonthlyImpactCents: detail.customer.estimatedMonthlyImpactCents,
    },
    result: completed
      ? {
          outcome: "recovered_order",
          sourceReferences: detail.recoveredOrderId
            ? [`orders:${detail.recoveredOrderId}`]
            : [],
        }
      : null,
  };
}

const deskTalkStates = new Map<string, PendingProposalState>();

export const claireRouter = router({
  setMacroGoal: adminProcedure
    .input(
      z.object({
        operatorUserId: z.string().trim().min(1).max(128),
        objective: z.string().trim().min(1).max(512),
        metricKey: z.string().trim().min(1).max(64),
        targetValue: z.number().finite(),
        unit: z.string().trim().min(1).max(64),
        urgencyText: z.string().trim().min(1).max(191).nullable().optional(),
        targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        source: z.enum(["operator_attested", "admin"]),
        sourceNote: z.string().trim().min(1).max(512),
      })
    )
    .mutation(({ ctx, input }) => setActiveMacroGoal({ tenantId: ctx.tenantId, ...input })),

  previewPreDrive: adminProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .query(({ ctx, input }) =>
      previewClairePreDrive({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        timeZone: input.timeZone,
        dayDirectorActorId: dayDirectorActorId(ctx),
      })
    ),

  previewWorkday: dayforgeMissionFieldProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const context = await assembleClaireDriveContext({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        phase: "pre_drive",
        timeZone: input.timeZone,
      });
      const actorId = dayDirectorActorId(ctx);
      const workday = await previewWorkdayLoop({
        tenantId: ctx.tenantId,
        actorId,
        context,
      });
      return {
        session: workday.session,
        eveningSpeak: workday.eveningSpeak,
        morningSpeak: workday.morningSpeak,
        tomorrowDraft: workday.tomorrowDraft,
        deltas: workday.deltas,
        confirmedAt: workday.confirmed?.confirmedAt ?? null,
        writesBusinessTruth: false as const,
      };
    }),

  confirmTomorrow: dayforgeMissionFieldProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const context = await assembleClaireDriveContext({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        phase: "pre_drive",
        timeZone: input.timeZone,
      });
      const snapshot = await confirmWorkdayPlan({
        tenantId: ctx.tenantId,
        actorId: dayDirectorActorId(ctx),
        businessDate: context.clock?.tomorrowBusinessDate ?? context.businessDate,
        items: assembleTomorrowCandidates(context),
      });
      return { confirmedAt: snapshot.confirmedAt, itemCount: snapshot.items.length };
    }),

  talk: adminProcedure
    .input(
      z.object({
        utterance: z.string().trim().min(1).max(4000),
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const preview = await previewClairePreDrive({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        timeZone: input.timeZone,
        dayDirectorActorId: dayDirectorActorId(ctx),
      });
      const context = await assembleClaireDriveContext({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        phase: "pre_drive",
        timeZone: input.timeZone,
      });
      context.workday = preview.workday ?? undefined;
      const actorId = dayDirectorActorId(ctx);
      const stateKey = `${ctx.tenantId}:${actorId}`;
      const state = deskTalkStates.get(stateKey) ?? {};
      deskTalkStates.set(stateKey, state);
      const commitmentTurn = await handleVoiceCommitmentTurn({
        tenantId: ctx.tenantId,
        actorId,
        businessDate: context.businessDate,
        utterance: input.utterance,
        state,
        conversationId: `desk:${stateKey}`,
      });
      if (commitmentTurn.kind !== "not_applicable") {
        return {
          reply: "speak" in commitmentTurn ? commitmentTurn.speak : preview.brief,
          brief: preview.brief,
          workday: preview.workday,
          relationshipDimensions: preview.relationshipDimensions,
          disclosureTier: preview.disclosureTier,
        };
      }
      const reply = await answerClairePreDriveFollowUp({
        tenantId: ctx.tenantId,
        utterance: input.utterance,
        brief: preview.brief,
        context,
      });
      return {
        reply,
        brief: preview.brief,
        workday: preview.workday,
        relationshipDimensions: preview.relationshipDimensions,
        disclosureTier: preview.disclosureTier,
      };
    }),

  driveContext: dayforgeMissionFieldProcedure
    .input(
      z.object({
        phase: z.enum(["pre_drive", "post_stop"]),
        missionId: z.number().int().positive().optional(),
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      if (input.missionId != null) {
        await assertClaireMissionAccess({
          tenantId: ctx.tenantId,
          missionId: input.missionId,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      }
      return assembleClaireDriveContext({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        phase: input.phase,
        missionId: input.missionId,
        timeZone: input.timeZone,
      });
    }),

  callBeforeDrive: dayforgeMissionFieldProcedure
    .input(
      z.object({
        timeZone: z.string().trim().min(1).max(100).optional(),
        missionId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.missionId != null) {
        await assertClaireMissionAccess({
          tenantId: ctx.tenantId,
          missionId: input.missionId,
          userId: ctx.user.openId,
          isAdmin: ctx.dayforgeMembership.role !== "field",
        });
      }
      return startClairePreDriveCall({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        // Day Director's own commitments (and therefore the Driver dayline
        // that renders them) are keyed by dayDirectorActorId(ctx) — the
        // numeric user id, not the openId Claire otherwise uses. Any
        // commitment the voice loop creates must use this exact id or it
        // will never appear on Driver after the call.
        dayDirectorActorId: dayDirectorActorId(ctx),
        timeZone: input.timeZone,
        missionId: input.missionId,
      });
    }),

  callAfterStop: dayforgeMissionFieldProcedure
    .input(
      z.object({
        missionId: z.number().int().positive(),
        timeZone: z.string().trim().min(1).max(100).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.dayforgeMembership.role !== "field";
      await assertClaireMissionAccess({
        tenantId: ctx.tenantId,
        missionId: input.missionId,
        userId: ctx.user.openId,
        isAdmin,
      });
      return startClairePostStopCall({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        missionId: input.missionId,
        missionAccess: isAdmin ? "operator" : "field",
        timeZone: input.timeZone,
      });
    }),

  scanReactivation: dayforgeChurnProcedure
    .input(z.object({ requestId: uuid }))
    .mutation(({ ctx, input }) =>
      runCustomerChurnScan({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        requestId: input.requestId,
      })
    ),

  prepareReactivation: dayforgeChurnProcedure
    .input(z.object({ snapshotId: uuid, requestId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const detail = await createCustomerRecoveryIntervention({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        snapshotId: input.snapshotId,
        requestId: input.requestId,
      });
      if (!detail) throw new Error("Recovery intervention was not persisted");
      return { detail, action: recoveryAction(detail) };
    }),

  reactivationStatus: dayforgeChurnProcedure
    .input(z.object({ interventionId: uuid }))
    .query(async ({ ctx, input }) => {
      const all = await listRecoveryInterventions(ctx.tenantId);
      const detail = all.find(item => item.id === input.interventionId) ?? null;
      if (!detail) return null;
      return { detail, action: recoveryAction(detail) };
    }),

  approveReactivation: dayforgeChurnProcedure
    .input(
      z.object({
        interventionId: uuid,
        draftId: uuid,
        requestId: uuid,
        confirmation: z.literal(
          "I reviewed this exact message and approve it for this customer"
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const detail = await approveCustomerRecoveryDraft({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        interventionId: input.interventionId,
        draftId: input.draftId,
        requestId: input.requestId,
      });
      if (!detail) throw new Error("Recovery intervention not found");
      return { detail, action: recoveryAction(detail) };
    }),

  prepareManualReactivation: dayforgeChurnProcedure
    .input(z.object({ interventionId: uuid, requestId: uuid }))
    .mutation(async ({ ctx, input }) => {
      const detail = await getRecoveryInterventionDetail({
        tenantId: ctx.tenantId,
        interventionId: input.interventionId,
      });
      if (!detail) throw new Error("Recovery intervention not found");
      const prepared = await prepareCustomerRecoveryManualContact({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        interventionId: detail.id,
        draftId: detail.draft.id,
        contentHash: detail.draft.contentHash,
        requestId: input.requestId,
      });
      return {
        prepared,
        action: {
          ...recoveryAction(detail),
          authority: "HUMAN_EXECUTION" as const,
          status: "approved" as const,
        },
      };
    }),

  markReactivationContacted: dayforgeChurnProcedure
    .input(
      z.object({
        interventionId: uuid,
        requestId: uuid,
        confirmation: z.literal(
          "I manually sent this exact approved message to this customer"
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const detail = await getRecoveryInterventionDetail({
        tenantId: ctx.tenantId,
        interventionId: input.interventionId,
      });
      if (!detail) throw new Error("Recovery intervention not found");
      const updated = await markCustomerRecoveryContacted({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        interventionId: detail.id,
        draftId: detail.draft.id,
        contentHash: detail.draft.contentHash,
        requestId: input.requestId,
      });
      if (!updated) throw new Error("Recovery intervention not found");
      return { detail: updated, action: recoveryAction(updated) };
    }),

  // ── Claire relationship state (Pass 1) ──────────────────────────
  // Read-only self-view: an operator can see their own standing with
  // Claire. Never exposes another operator's state.
  relationshipState: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    getClaireRelationshipState({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
    })
  ),

  // Bounded, self-scoped shared-history view — never a full transcript
  // dump (Slice 4).
  relationshipHistory: dayforgeMissionFieldProcedure
    .input(z.object({ limit: z.number().int().min(1).max(20).default(10) }))
    .query(({ ctx, input }) =>
      listClaireRelationshipEvents({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        limit: input.limit,
      })
    ),

  // Human-attested relationship events (Slice: "operator-confirmed"
  // evidence). Restricted to event types that cannot be truthfully
  // inferred from runtime telemetry alone (see relationshipEmitters.ts) —
  // operator_follow_through/shared_hard_win/shared_failure are written
  // automatically from confirmed business outcomes and are NOT accepted
  // here, so this surface can never be used to self-award them.
  // Requires an explicit confirmation literal, matching the debrief-confirm
  // pattern used elsewhere for consequential, human-attested writes.
  recordRelationshipObservation: dayforgeMissionFieldProcedure
    .input(
      z.object({
        eventType: z.enum(CLAIRE_ATTESTABLE_EVENT_TYPES),
        summary: z.string().trim().min(1).max(512),
        relatedEntityType: z.string().trim().min(1).max(64).optional(),
        relatedEntityId: z.string().trim().min(1).max(64).optional(),
        confirmation: z.literal(ATTESTATION_CONFIRMATION),
      })
    )
    .mutation(({ ctx, input }) =>
      recordClaireAttestedEvent({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        eventType: input.eventType as (typeof CLAIRE_ATTESTABLE_EVENT_TYPES)[number],
        summary: input.summary,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        attestedByUserId: ctx.user.openId,
      })
    ),

  // Admin-only audit trail: which tier transitions happened for a given
  // operator, with reasons and supporting event ids (Slice 7).
  relationshipTierTransitions: adminProcedure
    .input(z.object({ operatorUserId: z.string().trim().min(1) }))
    .query(({ ctx, input }) =>
      listClaireTierTransitions({
        tenantId: ctx.tenantId,
        operatorUserId: input.operatorUserId,
      })
    ),

  analysisInbox: dayforgeMissionFieldProcedure.query(({ ctx }) =>
    listClaireAnalysisInbox({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
    })
  ),

  markAnalysisNotificationRead: dayforgeMissionFieldProcedure
    .input(z.object({ id: uuid }))
    .mutation(({ ctx, input }) =>
      markClaireAnalysisNotificationRead({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        id: input.id,
      })
    ),

  callAnalysis: dayforgeMissionFieldProcedure
    .input(
      z
        .object({
          sessionId: uuid.optional(),
          callSid: z.string().trim().min(1).max(64).optional(),
        })
        .refine(input => Boolean(input.sessionId || input.callSid), {
          message: "sessionId or callSid is required",
        })
    )
    .query(({ ctx, input }) =>
      getClaireCallAnalysis({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.dayforgeMembership.role !== "field",
        sessionId: input.sessionId,
        callSid: input.callSid,
      })
    ),

  callAudio: dayforgeMissionFieldProcedure
    .input(z.object({ sessionId: uuid }))
    .query(({ ctx, input }) =>
      getClaireCallAudio({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.dayforgeMembership.role !== "field",
        sessionId: input.sessionId,
      })
    ),

  markCallReviewed: dayforgeMissionFieldProcedure
    .input(z.object({ sessionId: uuid }))
    .mutation(({ ctx, input }) =>
      markClaireCallReviewed({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.dayforgeMembership.role !== "field",
        sessionId: input.sessionId,
      })
    ),

  markCallAnalysisWrong: dayforgeMissionFieldProcedure
    .input(
      z.object({
        sessionId: uuid,
        note: z.string().trim().min(1).max(1000),
      })
    )
    .mutation(({ ctx, input }) =>
      markClaireCallAnalysisWrong({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        isAdmin: ctx.user.role === "admin" || ctx.dayforgeMembership.role !== "field",
        sessionId: input.sessionId,
        note: input.note,
      })
    ),

  capabilities: dayforgeMissionFieldProcedure.query(() => GOLDLINE_CAPABILITY_REGISTRY),

  capabilityGap: dayforgeMissionFieldProcedure
    .input(z.object({ id: uuid }))
    .query(({ ctx, input }) =>
      loadCapabilityGapForOperator({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        id: input.id,
        isAdmin: ctx.user.role === "admin",
      })
    ),

  continueCapabilityEngineering: dayforgeMissionFieldProcedure
    .input(
      z.object({
        id: uuid,
        approve: z.boolean(),
      })
    )
    .mutation(({ ctx, input }) =>
      continueCapabilityEngineering({
        tenantId: ctx.tenantId,
        operatorUserId: ctx.user.openId,
        gapId: input.id,
        approve: input.approve,
      })
    ),
});
