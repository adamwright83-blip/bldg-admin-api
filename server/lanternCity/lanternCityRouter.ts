/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Lantern City router. Read-only: there is no mutation here and there will
 * not be one. Lantern City projects business records; it never writes them.
 */
import { legacyDayforgeTenantMemberProcedure, router } from "../_core/trpc";
import { requireCanonicalOperatorIdentityForUser } from "../agents/persistentOperator/identity";
import { loadLanternObjectiveMarks } from "./objectiveMarksService";

export function lanternObjectiveMarksScope(input: {
  tenantId: string;
  dayDirectorActorId: string;
  dayDirectorActorIds: readonly string[];
  campaignOperatorUserIds: readonly string[];
}) {
  return {
    tenantId: input.tenantId,
    operatorId: input.dayDirectorActorId,
    operatorIds: [...new Set(input.dayDirectorActorIds)],
    operatorUserId: input.campaignOperatorUserIds[0],
    operatorUserIds: [...new Set(input.campaignOperatorUserIds)],
    viewerOpenIds: [...new Set(input.campaignOperatorUserIds)],
  };
}

export const lanternCityRouter = router({
  objectiveMarks: legacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({
      tenantId: ctx.tenantId,
      user: ctx.user,
      subsystem: "lantern_city",
    });
    return loadLanternObjectiveMarks(
      lanternObjectiveMarksScope({
        tenantId: identity.tenantId,
        dayDirectorActorId: identity.dayDirectorActorId,
        dayDirectorActorIds: identity.dayDirectorActorIds,
        campaignOperatorUserIds: [
          identity.canonicalOpenId,
          identity.sourceOpenId,
          ...identity.aliases.map(alias => alias.openId),
        ],
      })
    );
  }),
});
