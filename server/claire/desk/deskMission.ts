import { formatInTimeZone } from "date-fns-tz";
import type { CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { listRecentDaphneObservationsBySource } from "../../agents/daphne/observationStore";
import { readDailyClaireCallStatus } from "../../agents/persistentOperator/dailyCallAuthorization";
import { latestStrategicProposal } from "../../strategy/strategicStore";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import { readWinBackDossier } from "../../strategy/winBackDossier";
import { buildShowrunnerBriefing, DESK_PREPARATION_SOURCE } from "../showrunner/showrunnerBriefing";

export type DeskMissionItem = {
  id: string;
  date: string;
  title: string;
  objective: string | null;
  /** Exactly as stored: a schedule label or window. Null when no time is known. */
  when: string | null;
  status: "committed" | "completed" | "awaiting_approval";
  note: string | null;
};

/**
 * Everything the Claire Desk shows, from stored truth only. Unknown values are
 * null, never estimated; nothing here writes.
 */
export async function buildDeskMission(input: { identity: CanonicalOperatorIdentity; timeZone: string; now?: Date }) {
  const now = input.now ?? new Date();
  const { identity, timeZone } = input;
  const businessDate = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const tomorrow = addDaysYmd(businessDate, 1);
  const briefing = await buildShowrunnerBriefing({ identity, purpose: "desk_planning", timeZone, now });
  const proposal =
    (await latestStrategicProposal(identity, weekStartMonday(tomorrow)).catch(() => null)) ??
    (await latestStrategicProposal(identity, weekStartMonday(businessDate)).catch(() => null));
  const pending = briefing.pendingDecision?.items ?? [];
  const proposalItem = (id: string) => proposal?.items.find(i => i.id === id);
  const fromDayLine = (date: string) => (i: (typeof briefing.today)[number]) => ({
      id: i.id,
      date,
      title: i.title,
      objective: i.objective,
      when: i.window,
      status: i.status === "completed" ? ("completed" as const) : ("committed" as const),
      note: i.note,
    });
  // Pending sales work first: it is what stands between Claire's plan and execution.
  const items: DeskMissionItem[] = [
    ...pending.map(i => {
      const p = proposalItem(i.id);
      return {
        id: i.id,
        date: i.date,
        title: i.title,
        objective: p?.objective ?? null,
        when: p?.timeWindow ? `${p.timeWindow.window}${p.timeWindow.time ? ` · ${p.timeWindow.time}` : ""}` : null,
        status: "awaiting_approval" as const,
        note: null,
      };
    }),
    ...briefing.today.filter(i => i.status === "open").map(fromDayLine(businessDate)),
    ...briefing.tomorrow.map(fromDayLine(tomorrow)),
  ].filter(i => !/^Claire confirmed workday plan$/i.test(i.title));
  const winBack = await readWinBackDossier({ tenantId: identity.tenantId, canonicalOperatorId: identity.canonicalOperatorId, timeZone, now }).catch(() => null);
  const reminders = await listRecentDaphneObservationsBySource({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    sourceType: DESK_PREPARATION_SOURCE,
    since: new Date(now.getTime() - 2 * 86_400_000),
    limit: 20,
  }).catch(() => []);
  const savedPreparation = reminders
    .map(r => ({ ...(r.payload as { need?: string; forDate?: string }), savedAt: new Date(r.occurredAt).toISOString() }))
    .filter(r => r.need && r.forDate === tomorrow)
    .map(r => ({ need: r.need!, savedAt: r.savedAt }));
  const calls = await readDailyClaireCallStatus(identity).catch(() => null);
  const diagnosis = proposal?.diagnosis;
  const action = diagnosis?.actions.find(a => a.territoryId) ?? diagnosis?.actions[0];
  return {
    timeZone,
    businessDate,
    tomorrow,
    tomorrowLabel: formatInTimeZone(new Date(`${tomorrow}T12:00:00Z`), "UTC", "EEEE, MMMM d"),
    objective: briefing.objective,
    area: diagnosis?.objective?.area ?? null,
    territoryId: action?.territoryId ?? null,
    items,
    pendingApproval:
      briefing.pendingDecision && pending.length
        ? { proposalId: briefing.pendingDecision.proposalId, revision: briefing.pendingDecision.revision, itemIds: pending.map(i => i.id), expiresAt: proposal?.expiresAt ?? null }
        : null,
    preparation: { planned: briefing.weekPlan?.preparation ?? [], saved: savedPreparation },
    uncertain: briefing.uncertain,
    adaptations: briefing.adaptations,
    rationale: diagnosis
      ? {
          diagnosis: diagnosis.diagnosis,
          approach: diagnosis.selectedApproach,
          evidence: diagnosis.evidence
            .filter(e => diagnosis.supportingEvidence.includes(e.id))
            .map(e => ({ description: e.description, classification: e.classification }))
            .slice(0, 4),
          completionCondition: action?.completionCondition ?? null,
        }
      : null,
    winBack,
    outcomes: briefing.weekToDate.reportedOutcomes,
    recentChange: briefing.weekPlan?.recentChanges.at(-1) ?? null,
    dailyCalls: calls,
  };
}

export type DeskMission = Awaited<ReturnType<typeof buildDeskMission>>;
