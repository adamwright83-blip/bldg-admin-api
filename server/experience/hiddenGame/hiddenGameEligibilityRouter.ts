/**
 * hidden_game.lost_property eligibility router.
 *
 * One query, no mutation. The game reads whether a chapter is open; the
 * unlock itself is recorded server-side by the read, from business records
 * the game cannot touch.
 */
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { requireCanonicalOperatorIdentityForUser } from "../../agents/persistentOperator/identity";
import { readHiddenGameEligibility } from "./hiddenGameEligibilityService";

export const hiddenGameEligibilityRouter = router({
  eligibility: legacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({
      tenantId: ctx.tenantId,
      user: ctx.user,
      subsystem: "hidden_game",
    });
    const campaignOperatorUserIds = [
      ...new Set([
        identity.canonicalOpenId,
        identity.sourceOpenId,
        ...identity.aliases.map(alias => alias.openId),
      ]),
    ];
    return readHiddenGameEligibility({
      tenantId: identity.tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      operatorId: identity.dayDirectorActorId,
      operatorIds: [...new Set(identity.dayDirectorActorIds)],
      operatorUserId: campaignOperatorUserIds[0],
      operatorUserIds: campaignOperatorUserIds,
    });
  }),
});
