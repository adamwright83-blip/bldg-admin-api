/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { legacyLegacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { listDormantRescueCandidates } from "./listCandidates";
import { reconcilePaidOrderConsequencesForOperator } from "./consequenceReconciliation";
import {
  approveAndSendRescue,
  cancelRescueMission,
  deferRescueMission,
  enterRescueMission,
  instantiateRescueMission,
  listRescueMissions,
  prepareRescueDraft,
} from "./rescueMissionService";

function asTrpc(error: unknown): never {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code: string }).code) : "";
  if (code === "APPROVAL_REQUIRED" || code === "FORBIDDEN" || code === "PROOF_SEND_DISABLED") {
    throw new TRPCError({ code: "FORBIDDEN", message: (error as Error).message });
  }
  if (code === "NOT_FOUND" || code === "UNKNOWN_CUSTOMER") {
    throw new TRPCError({ code: "NOT_FOUND", message: (error as Error).message });
  }
  if (code === "STORE_UNAVAILABLE") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: (error as Error).message });
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
 * Proof/demo environments must refuse the authoritative send, not mint a fake
 * provider_accepted receipt. Tests inject fake adapters into the service.
 */
export function assertAuthoritativeRescueSendEnabled(): void {
  if (process.env.GOLDLINE_PROOF_MODE === "1") {
    throw Object.assign(
      new Error("Authoritative rescue send is disabled in proof mode. Fake receipts cannot complete a rescue."),
      { code: "PROOF_SEND_DISABLED" }
    );
  }
}

export const spiritHumanRescueRouter = router({
  listCandidates: legacyLegacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    try {
      return await listDormantRescueCandidates({ tenantId: tenantOf(ctx) });
    } catch {
      return [];
    }
  }),

  listMine: legacyLegacyDayforgeTenantMemberProcedure.query(async ({ ctx }) =>
    listRescueMissions({
      tenantId: tenantOf(ctx),
      operatorUserId: ctx.user.openId,
    })
  ),

  reconcileConsequences: legacyLegacyDayforgeTenantMemberProcedure.mutation(async ({ ctx }) => {
    try {
      return await reconcilePaidOrderConsequencesForOperator({
        tenantId: tenantOf(ctx),
        operatorUserId: ctx.user.openId,
      });
    } catch (error) {
      asTrpc(error);
    }
  }),

  instantiate: legacyLegacyDayforgeTenantMemberProcedure
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

  enter: legacyLegacyDayforgeTenantMemberProcedure
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

  prepareDraft: legacyLegacyDayforgeTenantMemberProcedure
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
   * Proof mode refuses this mutation instead of faking provider_accepted truth.
   */
  approveAndSend: legacyLegacyDayforgeTenantMemberProcedure
    .input(
      z.object({
        missionId: z.string().min(1),
        operatorAuthorizedSend: z.literal(true),
        editedDraft: z.string().max(480).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertAuthoritativeRescueSendEnabled();
        return await approveAndSendRescue({
          tenantId: tenantOf(ctx),
          operatorUserId: ctx.user.openId,
          missionId: input.missionId,
          approvedByUserId: ctx.user.openId,
          operatorAuthorizedSend: input.operatorAuthorizedSend,
          editedDraft: input.editedDraft,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),

  cancel: legacyLegacyDayforgeTenantMemberProcedure
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

  defer: legacyLegacyDayforgeTenantMemberProcedure
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
