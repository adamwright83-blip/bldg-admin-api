import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { WAYWARD_ROOK_CONTACT_CONSEQUENCE } from "../../shared/rookContact";
import { dayforgeTenantMemberProcedure, router } from "../_core/trpc";
import {
  ProgressionForgeError,
  ProgressionNotPermittedError,
  ProgressionSchemaBlockedError,
} from "../goldlineProgression/progressionContract";
import { acknowledgeWaywardRookContact } from "../goldlineProgression/progressionService";

/**
 * Authenticated acknowledgement of wayward.rook_contact_demonstrated.
 * Tenant and operator come from the session. The client cannot submit a
 * grant flag, a capability id, or a completion flag.
 */
export const rookContactRouter = router({
  acknowledge: dayforgeTenantMemberProcedure
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
        if (error instanceof ProgressionForgeError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        if (error instanceof ProgressionNotPermittedError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        }
        if (error instanceof ProgressionSchemaBlockedError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
        }
        throw error;
      }
    }),
});
