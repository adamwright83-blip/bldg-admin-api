import { strategicPlanningHorizon } from "../../../shared/weeklyMissionReadiness";
import { drizzleStandingInstructionStore } from "../../agents/daphne/standingInstructions";
import { drizzlePreparedItemStore } from "../../agents/persistentOperator/preparedItems";
import { formatInTimeZone } from "date-fns-tz";
import type { CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { listRecentDaphneObservationsBySource } from "../../agents/daphne/observationStore";
import { readDailyClaireCallStatus } from "../../agents/persistentOperator/dailyCallAuthorization";
import { latestStrategicProposal } from "../../strategy/strategicStore";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import { loadConfirmedWorkdayPlan } from "../workdayPlanService";
import { readWinBackDossier } from "../../strategy/winBackDossier";
import { buildShowrunnerBriefing, DESK_PREPARATION_SOURCE } from "../showrunner/showrunnerBriefing";

export type DeskMissionItem = {
  id: string;
  date: string;
  title: string;
  objective: string | null;
  /** Exactly as stored: a schedule label or window. Null when no time is known. */
  when: string | null;
  /** needs_reschedule: unapproved work whose execution window passed; it is shown, never offered for approval. */
  status: "committed" | "completed" | "awaiting_approval" | "needs_reschedule";
  note: string | null;
};

const STATUS_ORDER: Record<DeskMissionItem["status"], number> = { committed: 0, awaiting_approval: 1, needs_reschedule: 2, completed: 3 };

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
    (await latestStrategicProposal(identity, strategicPlanningHorizon({ businessDate, localTime: formatInTimeZone(now, timeZone, "HH:mm") }).weekStart).catch(() => null)) ??
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
    ...(briefing.needsReschedule ?? []).map(i => {
      const p = proposalItem(i.id);
      return {
        id: i.id,
        date: i.date,
        title: i.title,
        objective: p?.objective ?? null,
        when: p?.timeWindow ? `${p.timeWindow.window}${p.timeWindow.time ? ` · ${p.timeWindow.time}` : ""}` : null,
        status: "needs_reschedule" as const,
        note: "Its time has passed. Choose a new day before approving it.",
      };
    }),
    ...briefing.today.filter(i => i.status === "open").map(fromDayLine(businessDate)),
    ...briefing.tomorrow.map(fromDayLine(tomorrow)),
  ]
    .filter(i => !/^Claire confirmed workday plan$/i.test(i.title))
    // Earliest work first; on the same day, what is already committed leads what still awaits approval.
    .sort((a, b) => a.date.localeCompare(b.date) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
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
  // What Claire has heard and what she has promised, so the operator can see it was kept in the system.
  const scope = { tenantId: identity.tenantId, canonicalOperatorId: identity.canonicalOperatorId };
  const heardRows = await drizzleStandingInstructionStore().listActive(scope).catch(() => []);
  const promisedRows = await drizzlePreparedItemStore().listRecent(scope, 5).catch(() => []);
  const heard = heardRows
    .map(r => ({ id: r.id, kind: r.kind, rule: r.text, quote: r.quote, heardOn: r.createdAt.slice(0, 10), version: r.version }))
    .reverse();
  const promised = promisedRows
    .map(r => ({ id: r.id, kind: r.kind, forDate: r.forBusinessDate, status: r.status, said: r.promiseText, summary: r.payload.targets.map(t => t.name).slice(0, 5) }))
    .reverse();
  const calls = await readDailyClaireCallStatus(identity).catch(() => null);
  const tomorrowPlan = await loadConfirmedWorkdayPlan({ tenantId: identity.tenantId, actorId: identity.dayDirectorActorId, businessDate: tomorrow }).catch(() => null);
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
    heard,
    promised,
    rationale: diagnosis
      ? {
          diagnosis: diagnosis.diagnosis,
          approach: diagnosis.selectedApproach,
          evidence: diagnosis.evidence
            .filter(e => diagnosis.supportingEvidence.includes(e.id))
            .map(e => ({
              id: e.id,
              source: e.source,
              description: e.description,
              classification: e.classification,
              value: e.value,
            }))
            .slice(0, 4),
          completionCondition: action?.completionCondition ?? null,
        }
      : null,
    winBack,
    tomorrowConfirmedAt: tomorrowPlan?.confirmedAt ?? null,
    outcomes: briefing.weekToDate.reportedOutcomes,
    recentChange: briefing.weekPlan?.recentChanges.at(-1) ?? null,
    dailyCalls: calls,
  };
}

export type DeskMission = Awaited<ReturnType<typeof buildDeskMission>>;
