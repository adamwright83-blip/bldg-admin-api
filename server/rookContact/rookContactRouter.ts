/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { WAYWARD_ROOK_CONTACT_CONSEQUENCE } from "../../shared/rookContact";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  ProgressionForgeError,
  ProgressionNotPermittedError,
  ProgressionSchemaBlockedError,
} from "../goldlineProgression/progressionContract";
import { acknowledgeWaywardRookContact } from "../goldlineProgression/progressionService";
import {
  RookContactClosedError,
  RookContactForgeError,
  authorizeRookContactSession,
  groundRookContactDraft,
  prepareRookContactSession,
  startRookContactBridge,
} from "./rookContactService";

function asTrpc(error: unknown): never {
  if (error instanceof ProgressionForgeError || error instanceof RookContactForgeError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (
    error instanceof ProgressionNotPermittedError ||
    error instanceof ProgressionSchemaBlockedError ||
    error instanceof RookContactClosedError
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw error;
}

const sentenceInput = z
  .object({
    text: z.string().trim().min(1).max(500),
    claimKey: z.string().trim().min(1).max(64).nullable().optional(),
    evidenceReferenceId: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();

/**
 * CONTACT acknowledgement and execution.
 * Tenant and operator come from the session. The client may name an account
 * and a contact. The client may not submit a phone number, a grant flag, or
 * a transcript approval.
 */
export const rookContactRouter = router({
  acknowledge: legacyDayforgeTenantMemberProcedure
    .input(
      z
        .object({
          authoredConsequence: z.literal(WAYWARD_ROOK_CONTACT_CONSEQUENCE),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await acknowledgeWaywardRookContact({
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          authoredConsequence: input.authoredConsequence,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),
  prepare: legacyDayforgeTenantMemberProcedure
    .input(
      z
        .object({
          accountId: z.number().int().positive(),
          contactId: z.number().int().positive(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await prepareRookContactSession({
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          accountId: input.accountId,
          contactId: input.contactId,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),
  authorize: legacyDayforgeTenantMemberProcedure
    .input(
      z
        .object({
          contactSessionId: z.string().uuid(),
          contactId: z.number().int().positive(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await authorizeRookContactSession({
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          contactSessionId: input.contactSessionId,
          contactId: input.contactId,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),
  start: legacyDayforgeTenantMemberProcedure
    .input(
      z
        .object({
          contactSessionId: z.string().uuid(),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await startRookContactBridge({
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          contactSessionId: input.contactSessionId,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),
  groundDraft: legacyDayforgeTenantMemberProcedure
    .input(
      z
        .object({
          contactSessionId: z.string().uuid(),
          sentences: z.array(sentenceInput).max(12),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await groundRookContactDraft({
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          contactSessionId: input.contactSessionId,
          sentences: input.sentences,
        });
      } catch (error) {
        asTrpc(error);
      }
    }),
});
