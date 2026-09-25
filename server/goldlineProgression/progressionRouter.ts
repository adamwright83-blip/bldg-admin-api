/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { ProgressionForgeError, ProgressionNotPermittedError } from "./progressionContract";
import {
  acknowledgeColosseumAuthoredFinale,
  beginCoastalMarketRookHunt,
  beginWaywardContactGate,
  completeCoastalMarketRookCatch,
  completeWaywardContactGate,
  readGoldlineProgression,
} from "./progressionService";

/**
 * Progression read, plus one acknowledgement of the authored Clockhead finale.
 * The input is the literal clockhead_finale.rook_joined_the_party. It refuses
 * resolved, rookOwned, kingdomComplete, levelColosseumResolved, and
 * companionRookOwned. Tenancy and operator id come from the session.
 * A satisfied binding records level.colosseum and then companion.rook.
 * It does not complete kingdom.brass_republic and does not grant
 * capability.rook.contact.
 */
export const progressionRouter = router({
  get: legacyDayforgeTenantMemberProcedure
    .input(z.object({}).strict())
    .query(({ ctx }) =>
      readGoldlineProgression({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        capabilityOperatorId: String(ctx.user.id),
      })
    ),
  acknowledgeColosseumFinale: legacyDayforgeTenantMemberProcedure
    .input(
      z
        .object({
          authoredConsequence: z.literal(COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE),
        })
        .strict()
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await acknowledgeColosseumAuthoredFinale({
          tenantId: ctx.tenantId,
          operatorId: ctx.user.openId,
          capabilityOperatorId: String(ctx.user.id),
          authoredConsequence: input.authoredConsequence,
        });
      } catch (error) {
        if (error instanceof ProgressionForgeError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        if (error instanceof ProgressionNotPermittedError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        }
        throw error;
      }
  beginCoastalRookHunt: legacyDayforgeTenantMemberProcedure
    .input(z.object({}).strict())
    .mutation(({ ctx }) =>
      beginCoastalMarketRookHunt({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
      })
    ),
  completeCoastalRookCatch: legacyDayforgeTenantMemberProcedure
    .input(z.object({ runId: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) =>
      completeCoastalMarketRookCatch({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        runId: input.runId,
      })
    ),
  beginWaywardContactGate: legacyDayforgeTenantMemberProcedure
    .input(z.object({}).strict())
    .mutation(({ ctx }) =>
      beginWaywardContactGate({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
      })
    ),
  completeWaywardContactGate: legacyDayforgeTenantMemberProcedure
    .input(z.object({ runId: z.string().uuid() }).strict())
    .mutation(({ ctx, input }) =>
      completeWaywardContactGate({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        runId: input.runId,
      })
    ),
    }),
});
