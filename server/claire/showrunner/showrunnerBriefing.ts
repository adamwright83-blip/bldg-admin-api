import { proposalItemExecutionWindow, strategicPlanningHorizon } from "../../../shared/weeklyMissionReadiness";
import type { StrategicPlanningProposal } from "../../../shared/strategicIntelligence";
import { weeklyHeadlineObjective } from "../../../shared/strategicHeadline";
import { investigateForPreparation } from "../../analytics/analysis/proactiveInvestigation";
import { formatInTimeZone } from "date-fns-tz";
import { listRecentDaphneObservationsBySource } from "../../agents/daphne/observationStore";
import type { CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { getDayDirectorState, listOpenDayDirectorCommitmentsBetween } from "../../planning/dayDirector/dayDirectorService";
import { actionParts, collapseOpenCommitments, type CarriedOpenItem } from "../dayLine/openItemLifecycle";
import { isTestFixtureTitle } from "../dayLine/testDataGuard";
import { looksLikeSalesFollowUp, mayRaiseOverdueSalesFollowUp } from "../dayLine/weekendQuietRule";
import { latestStrategicProposal, strategicResponses } from "../../strategy/strategicStore";
import { loadMissionPresentations, OPERATOR_SCOPE } from "../../agents/daphne/missionFollowUp";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { spokenDay } from "../briefing/briefingTiming";
import { weekStartMonday } from "../../../shared/weeklyMissionReadiness";
import type { ShowrunnerPurpose } from "./showrunnerTurn";
import { dedupeSpokenTitles } from "../speech/dedupeSpokenTitles";
import {
  buildStandingInstructionsView,
  loadActiveStandingInstructionsForOperator,
  REVIEW_TOPIC_OVERDUE_FOLLOWUPS,
  type StandingInstructionRecord,
} from "../../agents/daphne/standingInstructions";
import { drizzlePreparedItemStore, type PreparedItemRecord, type PreparedItemStore } from "../../agents/persistentOperator/preparedItems";
import { getClaireCampaignSummary, type ClaireCampaignSummary } from "../campaignAwareness";
import { readWinBackDossier, type WinBackDossier } from "../../strategy/winBackDossier";
import type { CustomerTruthDisposition } from "../../analytics/sourceCoverage";
import {
  loadDriverDayLineForCall,
  speakDriverDayLineCall,
  type DriverDayLineCallFacts,
} from "./driverDayLineCall";
import {
  productionGameMasterReaders,
  readGameMasterView,
  isNoRecord,
  type GameMasterReaders,
  type GameMasterView,
} from "../gameMaster/gameMasterView";
import {
  productionGoalProgressReaders,
  readGoalProgress,
  speakGoalProgress,
  type GoalProgress,
  type GoalProgressReaders,
} from "../gameMaster/goalProgress";

/** The game master view for the scheduled-call conductor, and which driver id it was read for. */
export type ShowrunnerGameState = GameMasterView & { readForDriverId: string };

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
  developments: Array<{ summary: string; date: string | null; reportedOn: string; kind?: string; spoken?: string }>;
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
  /**
   * Set by the dialer from the opening it actually spoke: false when the opening shed the carried
   * item's question to fit the spoken budget. The reply reader then never binds a bare "yes" to an
   * item that was not asked about. Unset means "derive it from the briefing".
   */
  openingAskedCarried?: boolean;
  /** The game master view: every Kingdom, Day 1 outcomes, progression, companions, chapters. Read only. */
  gameState?: ShowrunnerGameState | null;
  /**
   * The headline goal: the operator's macro goal (operator_macro_goals) and the
   * distance to it. `objective` above is the week's focus INSIDE it, never the headline.
   */
  goal?: GoalProgress | null;
  /** The operator's saved rules for calls, resolved for this moment. The opening and the prompt obey it. */
  standing?: {
    section: string | null;
    heldTopics: string[];
    askNowTopics: string[];
    encouragement: boolean;
    roleObligation: boolean;
  };
  /** Things Claire promised on an earlier call that the server prepared for this one. */
  preparedItems?: PreparedPropertyVisits[];
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

export type PreparedPropertyVisits = {
  id: string;
  kind: "property_visit_choice";
  forBusinessDate: string;
  promiseText: string;
  /** Re-read from the live campaign at call time: a visit completed since is not offered. */
  targets: Array<{ name: string; address: string | null }>;
  remainingCount: number;
};

/**
 * Loads the prepared items due now and refreshes their targets from the live campaign, so the opening
 * never offers a visit that has since been done. An item with nothing left to choose from is dropped.
 */
export async function loadPreparedItemsForCall(
  input: { identity: CanonicalOperatorIdentity; businessDate: string },
  deps: { store?: PreparedItemStore; loadCampaign?: () => Promise<ClaireCampaignSummary | null> } = {}
): Promise<PreparedPropertyVisits[]> {
  const scope = { tenantId: input.identity.tenantId, canonicalOperatorId: input.identity.canonicalOperatorId };
  const due: PreparedItemRecord[] = await (deps.store ?? drizzlePreparedItemStore()).listDue(scope, input.businessDate).catch(() => []);
  if (!due.length) return [];
  const campaign = await (
    deps.loadCampaign ??
    (() =>
      getClaireCampaignSummary({
        tenantId: input.identity.tenantId,
        actorId: input.identity.dayDirectorActorId,
        // The driver app keys Day 1 missions by openId; Day Director ids alone never find them.
        actorIds: [...(input.identity.dayDirectorActorIds ?? []), input.identity.canonicalOpenId].filter(Boolean),
      }))
  )().catch(() => null);
  // Unknown campaign state means the prepared list cannot be verified, so it is not offered.
  if (!campaign || !campaign.active) return [];
  return due
    .filter(item => item.kind === "property_visit_choice" && campaign.remainingTargets.length > 0)
    .map(item => ({
      id: item.id,
      kind: "property_visit_choice" as const,
      forBusinessDate: item.forBusinessDate,
      promiseText: item.promiseText,
      targets: campaign.remainingTargets,
      remainingCount: campaign.remainingCount,
    }));
}

/**
 * The week's headline for calls. The leading macro goal comes first, even when a
 * stored proposal's weeklyPlan.objective was written from an area focus before
 * this rule existed; only without a leading macro goal does the stored wording stand.
 */
export function briefingObjective(
  proposal: Pick<StrategicPlanningProposal, "diagnosis" | "weeklyPlan"> | null | undefined
): string | null {
  if (!proposal) return null;
  return weeklyHeadlineObjective(proposal.diagnosis) ?? proposal.weeklyPlan?.objective ?? proposal.diagnosis.objective?.statement ?? null;
}

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

/**
 * Game state for the briefing, read by the operator's SIGNED-IN openId.
 *
 * Driver-id split: production Day 1 rows exist under driver ids "1",
 * "driver-primary" and "adam-admin". The durable key the driver app and
 * `deriveKingdomStatuses` use is the signed-in openId (`identity.canonicalOpenId`),
 * so that is read first; the operator's alias openIds are tried only when it
 * holds no Day 1 mission, and the first mission with recorded visits wins.
 * Never throws: an unreadable game is a gap in the briefing, not a failed call.
 */
export async function loadShowrunnerGameState(
  input: { tenantId: string; openId: string; aliasOpenIds?: readonly string[]; canonicalOperatorId?: string | null },
  readers: GameMasterReaders = productionGameMasterReaders
): Promise<ShowrunnerGameState> {
  const ids = [input.openId, ...(input.aliasOpenIds ?? [])].map(id => id.trim()).filter((id, i, all) => id && all.indexOf(id) === i);
  let best: GameMasterView | null = null;
  const visited = (view: GameMasterView) => (isNoRecord(view.day1TenDoors) ? -1 : view.day1TenDoors.visitedCount);
  for (const openId of ids) {
    const view = await readGameMasterView(
      { tenantId: input.tenantId, operatorUserId: openId, canonicalOperatorId: input.canonicalOperatorId ?? null },
      readers
    );
    if (!best || visited(view) > visited(best)) best = view;
    // The signed-in openId wins whenever it holds a Day 1 mission.
    if (openId === input.openId && !isNoRecord(view.day1TenDoors)) break;
  }
  const view =
    best ??
    (await readGameMasterView({ tenantId: input.tenantId, operatorUserId: input.openId, canonicalOperatorId: input.canonicalOperatorId ?? null }, readers));
  return { ...view, readForDriverId: view.driverId };
}

/** The macro goal for the first of the operator's openIds that has one. Never throws. */
export async function loadShowrunnerGoal(
  input: { tenantId: string; openIds: readonly string[]; now: Date; timeZone: string },
  readers: GoalProgressReaders = productionGoalProgressReaders
): Promise<GoalProgress | null> {
  for (const operatorUserId of [...new Set(input.openIds.map(id => id.trim()).filter(Boolean))]) {
    const goal = await readGoalProgress({ tenantId: input.tenantId, operatorUserId, now: input.now, timeZone: input.timeZone }, readers).catch(() => null);
    if (goal) return goal;
  }
  return null;
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
  /** Test seam for the game-state read. Production reads the stores. */
  loadGameState?: typeof loadShowrunnerGameState;
  /** Test seam for the macro goal read. */
  loadGoal?: typeof loadShowrunnerGoal;
  /** Test seams for the standing-instruction and promise ledgers. */
  loadStandingInstructions?: () => Promise<StandingInstructionRecord[]>;
  loadPreparedItems?: () => Promise<PreparedPropertyVisits[]>;
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
    const spoken = [p.who, p.what].filter(Boolean).join(": ");
    const summary = spoken + (p.date ? ` (${p.date}${p.time ? ` ${p.time}` : ""})` : "");
    return { summary, spoken, kind: p.kind, date: p.date || null, reportedOn: formatInTimeZone(new Date(r.occurredAt), timeZone, "yyyy-MM-dd") };
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
        objective: briefingObjective(proposal) ?? proposal?.diagnosis.goal.statement ?? null,
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
  // Read by the signed-in openId; aliases only fill in when it holds no Day 1 mission.
  const gameState = await (input.loadGameState ?? loadShowrunnerGameState)({
    tenantId: identity.tenantId,
    openId: identity.canonicalOpenId,
    aliasOpenIds: (identity.aliases ?? []).map(alias => alias.openId),
    canonicalOperatorId: identity.canonicalOperatorId,
  }).catch(() => null);
  const goal = await (input.loadGoal ?? loadShowrunnerGoal)({
    tenantId: identity.tenantId,
    openIds: [identity.canonicalOpenId, identity.communicationOperatorUserId, ...(identity.aliases ?? []).map(alias => alias.openId)],
    now,
    timeZone,
  }).catch(() => null);
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
  const standingRecords = await (
    input.loadStandingInstructions ??
    (() => loadActiveStandingInstructionsForOperator({ tenantId: identity.tenantId, canonicalOperatorId: identity.canonicalOperatorId }))
  )().catch(() => []);
  const standingView = buildStandingInstructionsView(standingRecords, { now, timeZone });
  const preparedItems =
    input.purpose === "desk_planning"
      ? []
      : await (input.loadPreparedItems ?? (() => loadPreparedItemsForCall({ identity, businessDate })))().catch(() => []);
  return {
    standing: {
      section: standingView.section,
      heldTopics: standingView.heldTopics,
      askNowTopics: standingView.askNowTopics,
      encouragement: standingView.encouragement,
      roleObligation: standingView.roleObligation,
    },
    preparedItems,
    analyticalEvidence,
    opportunity,
    driverDayLine,
    carriedOpen,
    gameState,
    goal,
    purpose: input.purpose,
    businessDate,
    weekday: formatInTimeZone(now, timeZone, "EEEE"),
    objective: briefingObjective(proposal),
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

/**
 * The goal line every scheduled call opens with: the macro goal and the distance
 * to it, then the week's focus as a sub-objective when it differs.
 */
export function showrunnerGoalLine(b: Pick<ShowrunnerBriefing, "goal" | "objective">): string {
  const focus = b.objective?.trim().replace(/[.!]+$/, "") ?? "";
  if (b.goal) {
    const sameAsGoal = focus && focus.toLowerCase() === b.goal.objective.trim().replace(/[.!]+$/, "").toLowerCase();
    return [speakGoalProgress(b.goal), focus && !sameAsGoal ? `This week's focus inside that is ${focus}.` : ""].filter(Boolean).join(" ");
  }
  // No macro-goal read on this briefing (older proposal paths carry the headline as the week's
  // objective, already resolved from the leading macro goal): say it as the week's headline.
  return focus ? `This week is about: ${focus}.` : "I don't have your goal on record yet.";
}

/** How the opening is coloured. `tone` is Daphne's recorded, operator-stated motivational dimension. */
export type ShowrunnerOpeningOptions = { tone?: string | null };

/** The next game move, from the game master view, or "" when there is none. Same targets for every tone. */
function gameMoveLine(b: ShowrunnerBriefing, tone: string | null = null): string {
  const view = b.gameState;
  if (!view || isNoRecord(view.colosseum) || view.colosseum.satisfied || !view.colosseum.remaining.length) return "";
  const names = view.colosseum.remaining.map(target => target.name);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  const n = view.colosseum.remaining.length;
  const count = n === 1 ? "one" : n === 2 ? "two" : String(n);
  if (tone === "suspense") return `Only ${count} left between you and Clockhead: ${who}.`;
  if (tone === "comfort") return `No rush on the Colosseum: ${who}, ${count} left, whenever you're ready.`;
  return `The game move is ${who}: ${count} left for the Colosseum.`;
}

const OVERDUE_FOLLOW_UP = /\b(?:overdue|follow[- ]?up|circle back|check in with|reach out)\b/i;

/** True for Day Line items the operator asked Claire to hold for a review window. */
export function isHeldTopicItem(item: { title: string; timeLabel?: string | null }, heldTopics: readonly string[]): boolean {
  if (heldTopics.includes(REVIEW_TOPIC_OVERDUE_FOLLOWUPS)) {
    return OVERDUE_FOLLOW_UP.test(item.title) || /overdue/i.test(item.timeLabel ?? "");
  }
  return false;
}

/** The Day Line as Claire may speak it right now: items the operator asked her to hold for a later window are not raised. */
export function dayLineWithoutHeldTopics(
  line: DriverDayLineCallFacts | null | undefined,
  heldTopics: readonly string[] | undefined
): DriverDayLineCallFacts | null | undefined {
  if (!line || !heldTopics?.length) return line;
  return {
    ...line,
    stops: line.stops.filter(stop => !isHeldTopicItem(stop, heldTopics)),
    fieldBlockers: line.fieldBlockers.filter(item => !isHeldTopicItem({ title: item.title }, heldTopics)),
    pendingApproval: line.pendingApproval.filter(item => !isHeldTopicItem({ title: item.title }, heldTopics)),
  };
}

/**
 * The encouragement standing instruction, spoken from facts only: a count of work done with proof, or the
 * first open move, tied to the week's goal. Null when there is nothing true to say. Policy:
 * ENCOURAGEMENT_POLICY in server/claire/progression/policy.ts.
 */
export function openingEncouragement(b: ShowrunnerBriefing): string | null {
  // The verified macro goal when it is on record; the week's objective only without one. A week with
  // no strategic proposal still has a goal, and the standing rule still applies.
  const headline = b.goal?.objective?.trim() || b.objective?.trim() || null;
  if (!b.standing?.encouragement || !headline) return null;
  const line = dayLineWithoutHeldTopics(b.driverDayLine, b.standing.heldTopics);
  if (b.purpose === "evening_debrief") {
    const done = new Set(line?.stops.filter(stop => stop.completion === "completed_with_evidence").map(stop => stop.title) ?? []).size;
    return done > 0 ? `${done} done with proof today, and that is the work that moves "${headline}".` : null;
  }
  const first = line?.stops.find(stop => stop.executable)?.title;
  // The Day Line line already named it; say which one without saying it twice.
  return first ? `The first one is the move that serves "${headline}".` : null;
}

/**
 * The one prepared item the opening speaks, or null. The dialer records exactly this item's id on the
 * call, and it is consumed only once the operator is heard on that call (claireTwilio), never at dial.
 */
export function preparedItemSpoken(b: Pick<ShowrunnerBriefing, "preparedItems">): PreparedPropertyVisits | null {
  const item = b.preparedItems?.find(candidate => candidate.kind === "property_visit_choice");
  return item && item.targets.length ? item : null;
}

function preparedVisitsLine(b: ShowrunnerBriefing): string | null {
  const item = preparedItemSpoken(b);
  if (!item) return null;
  const names = item.targets.slice(0, 3).map(target => target.name);
  const more = item.remainingCount > names.length ? ` (${item.remainingCount} open in all)` : "";
  return `Last night I said I'd have the open property visits ready: ${list(names)}${more}. Which one do you want first?`;
}

/**
 * The carried open item the opening ASKS about on this call, or null. Shared by the opening and the
 * call's reply reader so a reply is only read as that item's answer when its question was asked.
 */
export function carriedItemAsked(b: ShowrunnerBriefing) {
  if (preparedItemSpoken(b)) return null;
  const held = b.standing?.heldTopics ?? [];
  const carried = b.carriedOpen?.find(item => !isHeldTopicItem({ title: item.title }, held)) ?? null;
  if (!carried) return null;
  const asked = b.openingAskedCarried ?? composeShowrunnerOpening(b).askedCarried;
  return asked ? carried : null;
}

/**
 * "Since yesterday" is only what the operator reported YESTERDAY about today or later, spoken with a day
 * word. 2026-10-23 opened with "Since yesterday: Visit three locations in person tomorrow… (2026-10-21)",
 * a two-day-old note with an ISO date read aloud. A reported commitment is already on the Day Line.
 */
export function sinceYesterdayLine(b: Pick<ShowrunnerBriefing, "developments" | "businessDate">): string {
  const yesterday = addDaysYmd(b.businessDate, -1);
  const d = b.developments.find(
    x => x.reportedOn === yesterday && x.kind !== "commitment" && (!x.date || x.date >= b.businessDate)
  );
  if (!d) return "";
  const what = (d.spoken ?? d.summary.replace(/\s*\(\d{4}-\d{2}-\d{2}[^)]*\)\s*$/, "")).replace(/[.\s]+$/, "");
  if (!what) return "";
  return `Since yesterday: ${what}${d.date ? `, ${spokenDay(d.date, b.businessDate)}` : ""}.`;
}

/**
 * How much opening a person on the phone will sit through before they want to
 * talk. About 30 seconds of speech. The 2026-10-27 evening opening ran 519
 * characters and closed on a dress-hanging question; the goal and the Day Line
 * are the opening, everything else is optional colour that is shed, in a fixed
 * order, until the opening fits.
 */
export const OPENING_SPOKEN_BUDGET_CHARS = 400;

/**
 * Sheds optional sections until the opening fits the budget. `sections` is in
 * spoken order; `optional` names the indices that may be dropped, in the order
 * they should go. Required sections are never dropped, so an opening that is
 * all goal and Day Line can still exceed the budget: that is the operator's
 * standing instruction, not colour.
 */
export function fitOpeningToBudget(
  sections: string[],
  optional: number[],
  budget = OPENING_SPOKEN_BUDGET_CHARS
): string {
  const kept = [...sections];
  const spoken = () => kept.filter(Boolean).join(" ");
  for (const index of optional) {
    if (spoken().length <= budget) break;
    kept[index] = "";
  }
  return spoken();
}

/** The spoken opening, built only from briefing facts. Goal first, then the one move. */
export function showrunnerOpening(b: ShowrunnerBriefing, options: ShowrunnerOpeningOptions = {}): string {
  return composeShowrunnerOpening(b, options).text;
}

/**
 * The opening and whether it kept the carried item's yes/no question. The dialer records
 * `askedCarried` on the briefing so the reply reader binds "yes" only to a question that was asked.
 */
export function composeShowrunnerOpening(
  b: ShowrunnerBriefing,
  options: ShowrunnerOpeningOptions = {}
): { text: string; askedCarried: boolean } {
  const text = composeOpeningText(b, options);
  const held = b.standing?.heldTopics ?? [];
  const carried = preparedItemSpoken(b) ? null : b.carriedOpen?.find(item => !isHeldTopicItem({ title: item.title }, held)) ?? null;
  return { text, askedCarried: Boolean(carried && text.includes(carried.question)) };
}

function composeOpeningText(b: ShowrunnerBriefing, options: ShowrunnerOpeningOptions): string {
  const tone = options.tone ?? null;
  if (b.purpose === "morning_readiness" || b.purpose === "evening_debrief") {
    const held = b.standing?.heldTopics ?? [];
    const line = speakDriverDayLineCall(dayLineWithoutHeldTopics(b.driverDayLine, held), b.purpose);
    const prepared = preparedVisitsLine(b);
    const encouragement = openingEncouragement(b);
    // One carried item, asked as a yes/no the operator can answer in a word, unless the operator
    // asked Claire to hold that kind of item for a review window.
    const carried = b.carriedOpen?.find(item => !isHeldTopicItem({ title: item.title }, held)) ?? null;
    // Exactly one question, and it closes the opening: last night's promised choice first, then the
    // carried yes/no, then the plain closer. A carried item is only mentioned on a call where it IS
    // the question; otherwise it would dangle without its yes/no.
    const askCarried = !prepared && carried ? carried : null;
    const carriedLine = askCarried
      ? `One thing has been open ${askCarried.ageDays} ${askCarried.ageDays === 1 ? "day" : "days"}${askCarried.ids.length > 1 ? ` across ${askCarried.ids.length} entries` : ""}: ${actionParts(askCarried.title).join(", then ")}.`
      : "";
    const closer = (fallback: string) => prepared ?? (askCarried ? askCarried.question : fallback);
    if (b.purpose === "morning_readiness") {
      const morning = (withCarried: boolean) => [
        "Good morning, it's Claire.",
        showrunnerGoalLine(b),
        line,
        // Right after the Day Line it refers to, so "the first one" can only mean its first stop.
        encouragement ?? "",
        gameMoveLine(b, tone),
        sinceYesterdayLine(b),
        withCarried ? carriedLine : "",
        withCarried ? closer("Are you ready to get going?") : prepared ?? "Are you ready to get going?",
      ];
      // Shed colour before the question: yesterday's recap, then encouragement. If the opening is
      // still long, the carried item waits for a later turn and the plain closer asks the question.
      const fitted = fitOpeningToBudget(morning(true), [5, 3]);
      return fitted.length <= OPENING_SPOKEN_BUDGET_CHARS || !askCarried ? fitted : fitOpeningToBudget(morning(false), [5, 3]);
    }
    // The operator told Claire to open with the goal and the plan: the evening wrap names tomorrow too.
    const tomorrowOpen = b.tomorrow.filter(i => i.status === "open");
    const tomorrowPlan =
      b.standing?.roleObligation && tomorrowOpen.length
        ? `Tomorrow's plan: ${list(dedupeSpokenTitles(tomorrowOpen.map(i => i.title)))}.`
        : "";
    const evening = (withCarried: boolean) => [
      "Hi, it's Claire for today's wrap.",
      showrunnerGoalLine(b),
      tomorrowPlan,
      "Tonight I need two things from you: what got done, and what's in the way of tomorrow.",
      line,
      encouragement ?? "",
      withCarried ? carriedLine : "",
      gameMoveLine(b, tone),
      withCarried ? closer("How did it go?") : prepared ?? "How did it go?",
    ];
    // Encouragement is the first colour to go. The carried item (the 2026-10-27 "hang Stella's
    // dresses" question) goes next: on a long evening it is not the opening's question.
    const fitted = fitOpeningToBudget(evening(true), [5]);
    return fitted.length <= OPENING_SPOKEN_BUDGET_CHARS || !askCarried ? fitted : fitOpeningToBudget(evening(false), [5]);
  }
  const held = b.standing?.heldTopics;
  const today = held?.length ? b.today.filter(i => !isHeldTopicItem(i, held)) : b.today;
  const open = today.filter(i => i.status === "open");
  return [
    `Hi, it's Claire for today's wrap.`,
    open.length || today.length
      ? `Today you had ${list(dedupeSpokenTitles(today.map(i => i.title)))}.`
      : "There wasn't anything on today's Day Line.",
    "How did it go?",
  ].join(" ");
}
