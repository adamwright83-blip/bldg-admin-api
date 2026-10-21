import { proposalItemExecutionWindow, strategicPlanningHorizon } from "../../../shared/weeklyMissionReadiness";
import type { StrategicPlanningProposal } from "../../../shared/strategicIntelligence";
import { investigateForPreparation } from "../../analytics/analysis/proactiveInvestigation";
import { formatInTimeZone } from "date-fns-tz";
import { listRecentDaphneObservationsBySource } from "../../agents/daphne/observationStore";
import type { CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { getDayDirectorState, listOpenDayDirectorCommitmentsBetween } from "../../planning/dayDirector/dayDirectorService";
import { collapseOpenCommitments, type CarriedOpenItem } from "../dayLine/openItemLifecycle";
import { isTestFixtureTitle } from "../dayLine/testDataGuard";
import { looksLikeSalesFollowUp, mayRaiseOverdueSalesFollowUp } from "../dayLine/weekendQuietRule";
import { latestStrategicProposal, strategicResponses } from "../../strategy/strategicStore";
import { loadMissionPresentations, OPERATOR_SCOPE } from "../../agents/daphne/missionFollowUp";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import type { ShowrunnerPurpose } from "./showrunnerTurn";
import { readWinBackDossier, type WinBackDossier } from "../../strategy/winBackDossier";
import type { CustomerTruthDisposition } from "../../analytics/sourceCoverage";
import {
  loadDriverDayLineForCall,
  speakDriverDayLineCall,
  type DriverDayLineCallFacts,
} from "./driverDayLineCall";

export const SHOWRUNNER_DEVELOPMENT_SOURCE = "claire_showrunner_development";
export const DESK_PREPARATION_SOURCE = "claire_desk_preparation";

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
  /** Unapproved proposal work whose execution window has passed: shown, never offered for approval, to be rescheduled. */
  needsReschedule?: Array<{ id: string; date: string; title: string; window: string | null }>;
  adaptations: string[];
  uncertain: string[];
  /** This week so far: operator-reported outcomes and plan changes, for the week review. */
  weekToDate: { reportedOutcomes: string[]; planChanges: string[] };
  /** Desk only: the revenue opportunity Claire found, from stored evidence. */
  analyticalEvidence?: { answer: string; receiptIds: string[]; limitations: string[] } | null;
  /**
   * The Day Line the driver executes for this business date.
   * Morning and evening calls speak this, not a separate list.
   */
  driverDayLine?: DriverDayLineCallFacts | null;
  /**
   * The same commitment open across more than one business date, as ONE item with its age and a yes/no
   * question. At most the first is asked on a call. Empty on a weekend for sales follow-ups unless asked.
   */
  carriedOpen?: CarriedOpenItem[];
  opportunity?: null | {
    diagnosis: string;
    approach: string;
    evidence: string[];
    customerTruth: CustomerTruthDisposition | null;
    lapsedCount: number | null;
    emptyMeansNoLapsedCustomers: boolean;
    withheldReason: string | null;
    lapsedCustomers: Array<{ name: string; lastOrderDate: string | null; paidOrders: number; lifetimeDollars: number; contactOnFile: boolean }>;
  };
};

const UNREADABLE_WIN_BACK = "Win-back dossier could not be read. That is not an empty customer list.";

/** Empty lapsed names stay empty. The withheld reason says why that is not zero customers. */
export function describeWinBackForBriefing(dossier: WinBackDossier | null): {
  customerTruth: CustomerTruthDisposition | null;
  lapsedCount: number | null;
  emptyMeansNoLapsedCustomers: boolean;
  withheldReason: string | null;
  lapsedCustomers: NonNullable<ShowrunnerBriefing["opportunity"]>["lapsedCustomers"];
} {
  if (!dossier) {
    return {
      customerTruth: null,
      lapsedCount: null,
      emptyMeansNoLapsedCustomers: false,
      withheldReason: UNREADABLE_WIN_BACK,
      lapsedCustomers: [],
    };
  }
  return {
    customerTruth: dossier.freshness,
    lapsedCount: dossier.lapsedCount,
    emptyMeansNoLapsedCustomers: dossier.emptyMeansNoLapsedCustomers,
    withheldReason: dossier.withheldReason,
    lapsedCustomers: dossier.contacts.map(c => ({
      name: c.name,
      lastOrderDate: c.lastOrderDate,
      paidOrders: c.paidOrders,
      lifetimeDollars: Math.round(c.lifetimeCents / 100),
      contactOnFile: Boolean(c.phone || c.email),
    })),
  };
}

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

/**
 * Splits a proposal's unapproved work for the operator. Work dated before today is not
 * shown. Work whose execution window is open may be offered for approval; today's work
 * after the cutoff (without an explicit later time) stays visible but must be rescheduled.
 * This also covers a fallback to the calendar week after Friday's window closes: its
 * Friday work is shown for rescheduling, never as awaiting approval.
 */
export function proposalItemsForApproval(input: {
  proposal: Pick<StrategicPlanningProposal, "items">;
  businessDate: string;
  localTime: string;
}): { approvable: StrategicPlanningProposal["items"]; needsReschedule: StrategicPlanningProposal["items"] } {
  const visible = input.proposal.items.filter(i => i.businessDate >= input.businessDate);
  const open = (i: (typeof visible)[number]) => proposalItemExecutionWindow(i, input) === "open";
  return { approvable: visible.filter(open), needsReschedule: visible.filter(i => !open(i)) };
}

export async function buildShowrunnerBriefing(input: {
  identity: CanonicalOperatorIdentity;
  purpose: ShowrunnerPurpose;
  timeZone: string;
  now: Date;
  loadDriverDayLine?: typeof loadDriverDayLineForCall;
  /** Test seam. Production callers keep the live day-director read. */
  getDay?: typeof getDayDirectorState;
  listOpen?: typeof listOpenDayDirectorCommitmentsBetween;
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
  const getDay = input.getDay ?? getDayDirectorState;
  const [todayState, tomorrowState] = await Promise.all([
    getDay({ ...stateArgs, businessDate }),
    getDay({ ...stateArgs, businessDate: tomorrowDate }),
  ]);
  const localTime = formatInTimeZone(now, timeZone, "HH:mm");
  const weekStart = strategicPlanningHorizon({ businessDate, localTime }).weekStart;
  const proposal =
    (await latestStrategicProposal(identity, weekStart).catch(() => null)) ??
    (await latestStrategicProposal(identity, weekStartMonday(businessDate)).catch(() => null));
  let pendingDecision: ShowrunnerBriefing["pendingDecision"] = null;
  let needsReschedule: NonNullable<ShowrunnerBriefing["needsReschedule"]> = [];
  if (proposal && Date.parse(proposal.expiresAt) > now.getTime()) {
    const responses = await strategicResponses(identity, proposal.id).catch(() => []);
    const decided = new Set(responses.flatMap(r => (r.action === "approve" ? r.itemIds : [])));
    const closed = responses.some(r => ["reject", "defer"].includes(r.action));
    const split = proposalItemsForApproval({ proposal, businessDate, localTime });
    const open = closed ? [] : split.approvable.filter(i => !decided.has(i.id));
    needsReschedule = closed
      ? []
      : split.needsReschedule
          .filter(i => !decided.has(i.id))
          .map(i => ({ id: i.id, date: i.businessDate, title: i.title, window: i.timeWindow?.window ?? null }));
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
  const weekStartDate = weekStartMonday(businessDate);
  const outcomeRows = await listRecentDaphneObservationsBySource({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
    sourceType: "claire_debrief_mission_outcome",
    since: new Date(Date.parse(`${weekStartDate}T00:00:00Z`) - 86_400_000),
    limit: 40,
  }).catch(() => []);
  const reportedOutcomes = outcomeRows
    .reverse()
    .map(r => {
      const p = (r.payload ?? {}) as Record<string, string>;
      return `${p.businessDate ?? ""}: ${p.title ?? "a mission"} — ${p.outcome ?? "reported"}${p.answer || p.operatorWords ? ` ("${String(p.answer ?? p.operatorWords).slice(0, 100)}")` : ""}`;
    });
  const presentations = await loadMissionPresentations({
    tenantId: identity.tenantId,
    canonicalOperatorId: identity.canonicalOperatorId,
  }).catch(() => new Map());
  const adaptations = [...presentations.entries()].map(([type, p]) =>
    type === OPERATOR_SCOPE ? `For you generally: ${p.note}` : `For ${type.replaceAll("_", " ")} work: ${p.note}`
  );
  // Test data never reaches a call Claire speaks (morning and evening). The Desk planning board is the
  // operator's own working surface and shows what is on the Day Line, test rows included, so they can be seen and removed.
  const spoken = input.purpose !== "desk_planning";
  const today = items(todayState).filter(i => !spoken || !isTestFixtureTitle(i.title));
  const tomorrow = items(tomorrowState).filter(i => !spoken || !isTestFixtureTitle(i.title));
  const uncertain = [
    ...today
      .filter(i => i.status === "open" && /meet|visit|building|property|pitch/i.test(`${i.title} ${i.objective ?? ""}`))
      .map(i => `Whether materials and the address for "${i.title}" are ready is unknown.`),
    ...(proposal?.weeklyPlan?.uncertainty ?? []).slice(0, 2),
  ];
  let opportunity: ShowrunnerBriefing["opportunity"] = undefined;
  if (input.purpose === "desk_planning" && proposal) {
    const refs = new Set(proposal.diagnosis.supportingEvidence);
    const dossier = await readWinBackDossier({ tenantId: identity.tenantId, canonicalOperatorId: identity.canonicalOperatorId, timeZone, now }).catch(() => null);
    const winBack = describeWinBackForBriefing(dossier);
    if (winBack.withheldReason) uncertain.push(winBack.withheldReason);
    opportunity = {
      diagnosis: proposal.diagnosis.diagnosis,
      approach: proposal.diagnosis.selectedApproach,
      evidence: proposal.diagnosis.evidence.filter(e => refs.has(e.id)).map(e => `${e.description} [${e.classification}]`),
      ...winBack,
    };
  }
  let analyticalEvidence: ShowrunnerBriefing["analyticalEvidence"] = null;
  if (input.purpose === "morning_readiness") {
    const saved =
      proposal?.diagnosis.evidence.filter(
        e => e.source === "analyzeBusinessData"
      ) ?? [];
    if (
      saved.length &&
      now.getTime() - Date.parse(saved[0]!.capturedAt) < 3600000
    ) {
      analyticalEvidence = {
        answer: String(saved[0]!.value),
        receiptIds: saved.map(e => e.id),
        limitations: [saved[0]!.description],
      };
    } else {
      const research = await investigateForPreparation({
        tenantId: identity.tenantId,
        objective:
          proposal?.weeklyPlan?.objective ??
          proposal?.diagnosis.goal.statement ??
          null,
        now,
        timeZone,
      });
      if (research)
        analyticalEvidence = {
          answer: research.answer,
          receiptIds: research.citedReceiptIds,
          limitations: research.limitations,
        };
    }
  }
  const pendingApproval =
    pendingDecision?.items.map(item => ({ id: item.id, title: item.title })) ?? [];
  const driverDayLine =
    input.purpose === "desk_planning"
      ? null
      : await (input.loadDriverDayLine ?? loadDriverDayLineForCall)({
          caller: {
            tenantId: identity.tenantId,
            userId: identity.canonicalOpenId,
            includeAllAssignees: identity.membership.canonical !== "field",
            dayDirectorActorId: identity.dayDirectorActorId,
            dayDirectorActorIds: identity.dayDirectorActorIds,
            canonicalOperatorId: identity.canonicalOperatorId,
          },
          businessDate,
          now,
          timeZone,
          pendingApproval,
        });
  let carriedOpen: CarriedOpenItem[] = [];
  if (input.purpose !== "desk_planning") {
    const open = await (input.listOpen ?? listOpenDayDirectorCommitmentsBetween)({
      tenantId: identity.tenantId,
      actorIds: identity.dayDirectorActorIds?.length ? identity.dayDirectorActorIds : [identity.dayDirectorActorId],
      fromBusinessDate: addDaysYmd(businessDate, -120),
      throughBusinessDate: businessDate,
    }).catch(() => []);
    carriedOpen = collapseOpenCommitments(
      open.filter(row => !isTestFixtureTitle(row.title)),
      businessDate
    ).filter(item => !looksLikeSalesFollowUp(item.title) || mayRaiseOverdueSalesFollowUp({ businessDate }));
  }
  return {
    analyticalEvidence,
    opportunity,
    driverDayLine,
    carriedOpen,
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
    needsReschedule,
    adaptations,
    uncertain,
    weekToDate: { reportedOutcomes, planChanges: (proposal?.weeklyPlan?.changes ?? []).map(c => c.summary) },
  };
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** The spoken opening, built only from briefing facts. */
export function showrunnerOpening(b: ShowrunnerBriefing): string {
  if (b.purpose === "morning_readiness" || b.purpose === "evening_debrief") {
    const line = speakDriverDayLineCall(b.driverDayLine, b.purpose);
    // One carried item, asked as a yes/no the operator can answer in a word, instead of a list or a generic closer.
    const carried = b.carriedOpen?.[0] ?? null;
    const carriedLine = carried
      ? `${carried.title} has been open ${carried.ageDays} ${carried.ageDays === 1 ? "day" : "days"}${carried.ids.length > 1 ? ` across ${carried.ids.length} entries` : ""}.`
      : "";
    if (b.purpose === "morning_readiness") {
      return [
        "Good morning, it's Claire.",
        b.objective ? `This week is about: ${b.objective}.` : "",
        line,
        b.developments.length ? `Since yesterday: ${b.developments[0]!.summary}.` : "",
        carriedLine,
        carried ? carried.question : "Are you ready to get going?",
      ]
        .filter(Boolean)
        .join(" ");
    }
    return ["Hi, it's Claire for today's wrap.", line, carriedLine, carried ? carried.question : "How did it go?"].filter(Boolean).join(" ");
  }
  const open = b.today.filter(i => i.status === "open");
  return [
    `Hi, it's Claire for today's wrap.`,
    open.length || b.today.length
      ? `Today you had ${list([...new Set(b.today.map(i => i.title))])}.`
      : "There wasn't anything on today's Day Line.",
    "How did it go?",
  ].join(" ");
}
