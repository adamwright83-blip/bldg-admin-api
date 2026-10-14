import { formatInTimeZone } from "date-fns-tz";
import { listRecentDaphneObservationsBySource } from "../../agents/daphne/observationStore";
import type { CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { latestStrategicProposal, strategicResponses } from "../../strategy/strategicStore";
import { loadMissionPresentations, OPERATOR_SCOPE } from "../../agents/daphne/missionFollowUp";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import type { ShowrunnerPurpose } from "./showrunnerTurn";

export const SHOWRUNNER_DEVELOPMENT_SOURCE = "claire_showrunner_development";

export type BriefingItem = {
  id: string;
  title: string;
  objective: string | null;
  status: "open" | "completed" | "proposed";
  window: string | null;
  note: string | null;
};

export type ShowrunnerBriefing = {
  purpose: ShowrunnerPurpose;
  businessDate: string;
  weekday: string;
  objective: string | null;
  weekPlan: null | { outcomes: string[]; contingency: string; preparation: string[]; recentChanges: string[] };
  today: BriefingItem[];
  tomorrow: BriefingItem[];
  /** Operator-reported developments from recent calls. Reported, not verified. */
  developments: Array<{ summary: string; date: string | null; reportedOn: string }>;
  pendingDecision: null | { proposalId: string; revision: string; summary: string; items: Array<{ id: string; date: string; title: string; window: string | null }> };
  adaptations: string[];
  uncertain: string[];
};

function items(state: Awaited<ReturnType<typeof getDayDirectorState>>): BriefingItem[] {
  return state.commitments.map(c => ({
    id: c.id,
    title: c.title,
    objective: c.sourceText ?? null,
    status: c.status === "completed" ? "completed" : "open",
    window:
      c.presentation?.adjustment.kind === "timing"
        ? c.presentation.adjustment.window
        : (c.scheduleLabel ?? c.command?.constraints?.scheduleLabel ?? null),
    note: c.presentation?.note ?? null,
  }));
}

export async function buildShowrunnerBriefing(input: {
  identity: CanonicalOperatorIdentity;
  purpose: ShowrunnerPurpose;
  timeZone: string;
  now: Date;
}): Promise<ShowrunnerBriefing> {
  const { identity, now, timeZone } = input;
  const businessDate = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  const tomorrowDate = addDaysYmd(businessDate, 1);
  const stateArgs = {
    tenantId: identity.tenantId,
    actorId: identity.dayDirectorActorId,
    actorIds: identity.dayDirectorActorIds,
    canonicalOperatorId: identity.canonicalOperatorId,
  };
  const [todayState, tomorrowState] = await Promise.all([
    getDayDirectorState({ ...stateArgs, businessDate }),
    getDayDirectorState({ ...stateArgs, businessDate: tomorrowDate }),
  ]);
  const weekStart = weekStartMonday(input.purpose === "evening_debrief" ? tomorrowDate : businessDate);
  const proposal =
    (await latestStrategicProposal(identity, weekStart).catch(() => null)) ??
    (await latestStrategicProposal(identity, weekStartMonday(businessDate)).catch(() => null));
  let pendingDecision: ShowrunnerBriefing["pendingDecision"] = null;
  if (proposal && Date.parse(proposal.expiresAt) > now.getTime()) {
    const responses = await strategicResponses(identity, proposal.id).catch(() => []);
    const decided = new Set(responses.flatMap(r => (r.action === "approve" ? r.itemIds : [])));
    const closed = responses.some(r => ["reject", "defer"].includes(r.action));
    const open = closed ? [] : proposal.items.filter(i => !decided.has(i.id) && i.businessDate >= businessDate);
    if (open.length)
      pendingDecision = {
        proposalId: proposal.id,
        revision: proposal.revision,
        summary: proposal.weeklyPlan?.changes.at(-1)?.summary ?? `${open.length} proposed item(s) await your approval.`,
        items: open.map(i => ({ id: i.id, date: i.businessDate, title: i.title, window: i.timeWindow?.window ?? null })),
      };
  }
  const devRows = await listRecentDaphneObservationsBySource({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    sourceType: SHOWRUNNER_DEVELOPMENT_SOURCE,
    since: new Date(now.getTime() - 3 * 86_400_000),
  }).catch(() => []);
  const developments = devRows.map(r => {
    const p = (r.payload ?? {}) as Record<string, string>;
    const summary = [p.who, p.what].filter(Boolean).join(": ") + (p.date ? ` (${p.date}${p.time ? ` ${p.time}` : ""})` : "");
    return { summary, date: p.date || null, reportedOn: formatInTimeZone(new Date(r.occurredAt), timeZone, "yyyy-MM-dd") };
  });
  const presentations = await loadMissionPresentations({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
  }).catch(() => new Map());
  const adaptations = [...presentations.entries()].map(([type, p]) =>
    type === OPERATOR_SCOPE ? `For you generally: ${p.note}` : `For ${type.replaceAll("_", " ")} work: ${p.note}`
  );
  const today = items(todayState);
  const tomorrow = items(tomorrowState);
  const uncertain = [
    ...today
      .filter(i => i.status === "open" && /meet|visit|building|property|pitch/i.test(`${i.title} ${i.objective ?? ""}`))
      .map(i => `Whether materials and the address for "${i.title}" are ready is unknown.`),
    ...(proposal?.weeklyPlan?.uncertainty ?? []).slice(0, 2),
  ];
  return {
    purpose: input.purpose,
    businessDate,
    weekday: formatInTimeZone(now, timeZone, "EEEE"),
    objective: proposal?.weeklyPlan?.objective ?? proposal?.diagnosis.objective?.statement ?? null,
    weekPlan: proposal?.weeklyPlan
      ? {
          outcomes: proposal.weeklyPlan.outcomes,
          contingency: proposal.weeklyPlan.contingency,
          preparation: proposal.weeklyPlan.preparation,
          recentChanges: proposal.weeklyPlan.changes.slice(-3).map(c => c.summary),
        }
      : null,
    today,
    tomorrow,
    developments,
    pendingDecision,
    adaptations,
    uncertain,
  };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const withWindow = (i: BriefingItem) => `${i.title}${i.window ? ` (${i.window})` : ""}`;

/** The spoken opening, built only from briefing facts. */
export function showrunnerOpening(b: ShowrunnerBriefing): string {
  const open = b.today.filter(i => i.status === "open");
  if (b.purpose === "morning_readiness") {
    return [
      `Good morning, it's Claire.`,
      b.objective ? `This week is about: ${b.objective}.` : "",
      open.length
        ? `Today you've got ${list(open.map(withWindow))}.`
        : b.today.length
          ? "Today's Day Line is already done."
          : "Nothing is on today's Day Line yet.",
      b.developments.length ? `Since yesterday: ${b.developments[0]!.summary}.` : "",
      b.pendingDecision ? `One change is waiting for your OK: ${b.pendingDecision.summary}` : "",
      "Are you ready to get going?",
    ]
      .filter(Boolean)
      .join(" ");
  }
  return [
    `Hi, it's Claire for today's wrap.`,
    open.length || b.today.length
      ? `Today you had ${list(b.today.map(i => i.title))}.`
      : "There wasn't anything on today's Day Line.",
    "How did it go?",
  ].join(" ");
}
