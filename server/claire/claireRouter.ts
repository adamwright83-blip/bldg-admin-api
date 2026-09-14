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
import { assembleClaireDriveContext } from "./contextAssembler";
import {
  startClairePostStopCall,
  startClairePreDriveCall,
} from "./claireTwilio";
import { previewClairePreDrive } from "./preDriveRuntime";

const uuid = z.string().uuid();

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
});
