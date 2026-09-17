import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { listDormantRescueCandidates } from "./listCandidates";
import {
  approveAndSendRescue,
  cancelRescueMission,
  deferRescueMission,
  enterRescueMission,
  instantiateRescueMission,
  listRescueMissions,
  prepareRescueDraft,
} from "./rescueMissionService";
import { createFakeOutboundSendAdapter } from "./outboundSendAdapter";

const proofSendAdapter = createFakeOutboundSendAdapter();

function asTrpc(error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
  if (code === "APPROVAL_REQUIRED") {
    throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
  }
  if (code === "FORBIDDEN") {
    throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
  }
  if (code === "NOT_FOUND" || code === "UNKNOWN_CUSTOMER") {
    throw new TRPCError({ code: "NOT_FOUND", message: (error as Error).message });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : "Rescue request failed.",
  });
}

function tenantOf(ctx: { tenantId?: string | null }): string {
  return ctx.tenantId ?? "default";
}

/**
 * Production send uses the Twilio receipt adapter unless GOLDLINE_PROOF_MODE
 * is set, in which case the fake adapter is used so proof/CI never texts a customer.
 */
function sendDeps() {
  if (process.env.GOLDLINE_PROOF_MODE === "1") {
    return { sendAdapter: proofSendAdapter };
  }
  return {};
}

export const spiritHumanRescueRouter = router({
  listCandidates: dayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    try {
      return await listDormantRescueCandidates({ tenantId: tenantOf(ctx) });
    } catch {
      return [];
    }
  }),

  listMine: dayforgeTenantMemberProcedure.query(async ({ ctx }) =>
    listRescueMissions({
      tenantId: tenantOf(ctx),
      operatorUserId: ctx.user.openId,
    })
  ),

  instantiate: dayforgeTenantMemberProcedure
    .input(z.object({ snapshotCustomerId: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await instantiateRescueMission(
          {
            tenantId: tenantOf(ctx),
            operatorUserId: ctx.user.openId,
            snapshotCustomerId: input.snapshotCustomerId,
          },
          { persistOpsTask: true }
        );
      } catch (error) {
        asTrpc(error);
      }
    }),

  enter: dayforgeTenantMemberProcedure
    .input(z.object({ missionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await enterRescueMission({
          tenantId: tenantOf(ctx),
          operatorUserId: ctx.user.openId,
          missionId: input.missionId,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),

  prepareDraft: dayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().min(1),
        editedDraft: z.string().max(480).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await prepareRescueDraft({
          tenantId: tenantOf(ctx),
          operatorUserId: ctx.user.openId,
          missionId: input.missionId,
          editedDraft: input.editedDraft,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),

  /**
   * Explicit operator send. Preview/draft/enter never call this.
   * `operatorAuthorizedSend` must be true; approvedByUserId is the signed-in operator.
   */
  approveAndSend: dayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().min(1),
        operatorAuthorizedSend: z.literal(true),
        editedDraft: z.string().max(480).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await approveAndSendRescue(
          {
            tenantId: tenantOf(ctx),
            operatorUserId: ctx.user.openId,
            missionId: input.missionId,
            approvedByUserId: ctx.user.openId,
            operatorAuthorizedSend: input.operatorAuthorizedSend,
            editedDraft: input.editedDraft,
          },
          sendDeps()
        );
      } catch (error) {
        asTrpc(error);
      }
    }),

  cancel: dayforgeTenantMemberProcedure
    .input(z.object({ missionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelRescueMission({
          tenantId: tenantOf(ctx),
          operatorUserId: ctx.user.openId,
          missionId: input.missionId,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),

  defer: dayforgeTenantMemberProcedure
    .input(z.object({ missionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await deferRescueMission({
          tenantId: tenantOf(ctx),
          operatorUserId: ctx.user.openId,
          missionId: input.missionId,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),
});
