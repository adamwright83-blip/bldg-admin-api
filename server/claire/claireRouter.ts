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

const uuid = z.string().uuid();

const ATTESTATION_CONFIRMATION =
  "I witnessed this exactly as described and attest it happened" as const;

async function assertClaireMissionAccess(input: {
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

export const claireRouter = router({
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
      })
    ),

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
      })
    )
    .mutation(({ ctx, input }) =>
      startClairePreDriveCall({
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
        timeZone: input.timeZone,
      })
    ),

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
});
