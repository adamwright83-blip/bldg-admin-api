import { joystickClaireDeskFieldProcedure, router } from "../_core/trpc";
import { loadClaireRelationshipHistory } from "./character/relationshipHistory";
import { composeClaireRelationshipClosing } from "./character/relationshipOffboarding";

/**
 * Slice 7: a deliberately tiny API surface over Slice 6's offboarding domain
 * contract. This endpoint is self-scoped by the authenticated DayForge actor.
 * It only composes a closing artifact; it never deletes or mutates business
 * records, relationship events, approval state, or operational truth.
 */
export const claireRelationshipOffboardingRouter = router({
  preview: joystickClaireDeskFieldProcedure.query(async ({ ctx }) => {
    const history = await loadClaireRelationshipHistory({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
    });

    return composeClaireRelationshipClosing({
      tenantId: ctx.tenantId,
      operatorUserId: ctx.user.openId,
      history,
    });
  }),
});
