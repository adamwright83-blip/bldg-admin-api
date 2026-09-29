/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { legacyDayforgeTenantMemberProcedure, router } from "../../_core/trpc";
import { requireCanonicalOperatorIdentityForUser } from "../../persistentOperator/identity";
import { recordPersistentOperatorDiagnosticEvent } from "../../persistentOperator/observability";
import { readCurrentDayLine } from "./currentDayLineService";

export const currentDayLineRouter = router({
  today: legacyDayforgeTenantMemberProcedure.query(async ({ ctx }) => {
    const identity = await requireCanonicalOperatorIdentityForUser({
      tenantId: ctx.tenantId,
      user: ctx.user,
      subsystem: "day_line",
    });
    const line = await readCurrentDayLine({
      tenantId: identity.tenantId,
      operatorId: identity.dayDirectorActorId,
      operatorIds: identity.dayDirectorActorIds,
      operatorUserId: identity.canonicalOpenId,
      operatorUserIds: identity.aliases.map(alias => alias.openId),
    });

    const reason =
      line.rankingStatus === "unavailable"
        ? "day_line_unavailable"
        : line.items.length === 0 && !line.designated
          ? "legitimate_no_work"
          : null;
    await recordPersistentOperatorDiagnosticEvent({
      tenantId: identity.tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      operatorUserId: identity.canonicalOpenId,
      subsystem: "day_line",
      eventKind: "selection_attempt",
      reason,
    }).catch(() => undefined);

    const surfaced = new Set(line.items.map(item => item.id));
    if (line.designated) surfaced.add(line.designated.id);
    await Promise.all(
      [...surfaced].map(objectiveId =>
        recordPersistentOperatorDiagnosticEvent({
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          subsystem: "day_line",
          eventKind: "objective_surfaced",
          objectiveId,
        }).catch(() => undefined)
      )
    );
    return line;
  }),
});
