/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import { legacyLegacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { ProgressionForgeError, ProgressionNotPermittedError } from "./progressionContract";
import { acknowledgeColosseumAuthoredFinale, readGoldlineProgression } from "./progressionService";

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
  get: legacyLegacyDayforgeTenantMemberProcedure
    .input(z.object({}).strict())
    .query(({ ctx }) =>
      readGoldlineProgression({
        tenantId: ctx.tenantId,
        operatorId: ctx.user.openId,
        capabilityOperatorId: String(ctx.user.id),
      })
    ),
  acknowledgeColosseumFinale: legacyLegacyDayforgeTenantMemberProcedure
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
    }),
});
