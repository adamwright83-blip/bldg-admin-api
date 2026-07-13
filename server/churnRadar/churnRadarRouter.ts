import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  approveCustomerRecoveryDraft,
  createCustomerRecoveryIntervention,
  getCustomerRecoveryProfile,
  getLatestChurnScan,
  getRecoveryInterventionDetail,
  listRecoveryInterventions,
  markCustomerRecoveryContacted,
  prepareCustomerRecoveryManualContact,
  reviseCustomerRecoveryDraft,
  runCustomerChurnScan,
  saveCustomerRecoveryProfile,
  setCustomerRecoveryPermission,
} from "./customerChurnService";

const uuid = z.string().uuid();

function required<T>(value: T | null, message: string): T {
  if (value === null) throw new TRPCError({ code: "NOT_FOUND", message });
  return value;
}

export const churnRadarRouter = router({
  profile: adminProcedure.query(({ ctx }) =>
    getCustomerRecoveryProfile(ctx.tenantId)
  ),

  saveProfile: adminProcedure
    .input(
      z.object({
        storeName: z.string().trim().min(1).max(255),
        senderName: z.string().trim().min(1).max(255),
        schedulingUrl: z.string().trim().url().max(1024).nullable(),
      })
    )
    .mutation(({ ctx, input }) =>
      saveCustomerRecoveryProfile({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  latestScan: adminProcedure.query(({ ctx }) =>
    getLatestChurnScan(ctx.tenantId)
  ),

  runScan: adminProcedure
    .input(z.object({ requestId: uuid }))
    .mutation(({ ctx, input }) =>
      runCustomerChurnScan({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  interventions: adminProcedure.query(({ ctx }) =>
    listRecoveryInterventions(ctx.tenantId)
  ),

  intervention: adminProcedure
    .input(z.object({ interventionId: uuid }))
    .query(async ({ ctx, input }) =>
      required(
        await getRecoveryInterventionDetail({
          tenantId: ctx.tenantId,
          interventionId: input.interventionId,
        }),
        "Recovery mission not found"
      )
    ),

  createIntervention: adminProcedure
    .input(z.object({ snapshotId: uuid, requestId: uuid }))
    .mutation(async ({ ctx, input }) =>
      required(
        await createCustomerRecoveryIntervention({
          ...input,
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
        }),
        "Recovery mission was not persisted"
      )
    ),

  reviseDraft: adminProcedure
    .input(
      z.object({
        interventionId: uuid,
        requestId: uuid,
        message: z.string().trim().min(1).max(320),
      })
    )
    .mutation(async ({ ctx, input }) =>
      required(
        await reviseCustomerRecoveryDraft({
          ...input,
          tenantId: ctx.tenantId,
          actorId: ctx.user.openId,
        }),
        "Recovery mission not found"
      )
    ),

  approveDraft: adminProcedure
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
    .mutation(({ ctx, input }) =>
      approveCustomerRecoveryDraft({
        interventionId: input.interventionId,
        draftId: input.draftId,
        requestId: input.requestId,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  setPermission: adminProcedure
    .input(
      z
        .object({
          interventionId: uuid,
          requestId: uuid,
          status: z.enum(["opted_in", "opted_out"]),
          sourceReference: z.string().trim().min(3).max(512),
          capturedAt: z.date(),
          expiresAt: z.date().nullable(),
        })
        .superRefine((input, ctx) => {
          if (input.capturedAt.getTime() > Date.now())
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["capturedAt"],
              message: "Consent capture time cannot be in the future",
            });
          if (
            input.expiresAt &&
            input.expiresAt.getTime() <= input.capturedAt.getTime()
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["expiresAt"],
              message: "Consent expiry must be after capture time",
            });
        })
    )
    .mutation(({ ctx, input }) =>
      setCustomerRecoveryPermission({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  prepareManualContact: adminProcedure
    .input(
      z.object({
        interventionId: uuid,
        draftId: uuid,
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        requestId: uuid,
      })
    )
    .mutation(({ ctx, input }) =>
      prepareCustomerRecoveryManualContact({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),

  markContacted: adminProcedure
    .input(
      z.object({
        interventionId: uuid,
        draftId: uuid,
        contentHash: z.string().regex(/^[a-f0-9]{64}$/),
        requestId: uuid,
        confirmation: z.literal(
          "I manually sent this exact approved message to this customer"
        ),
      })
    )
    .mutation(({ ctx, input }) =>
      markCustomerRecoveryContacted({
        interventionId: input.interventionId,
        draftId: input.draftId,
        contentHash: input.contentHash,
        requestId: input.requestId,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),
});
