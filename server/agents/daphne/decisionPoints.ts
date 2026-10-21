/**
 * Daphne decision points on Claire's scheduled calls (W6, behind DAPHNE_V2_DECISION_POINTS).
 *
 * Two decision occasions per business day:
 *   - morning_first_action: how Claire frames the first action on the morning readiness call;
 *   - evening_tomorrow_move: how Claire frames tomorrow's first move on the evening debrief.
 *
 * The option set is a framing of the SAME work item, never different work:
 *   - plain_instruction        the ordinary presentation (STANDARD_PRESENTATION baseline arm);
 *   - implementation_intention a when-then plan ("when X, you will Y");
 *   - choice_of_two            a choice between two real open items.
 *
 * What this module records (docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md §5):
 * a decision-point observation with availability and the eligible options, then an
 * intervention row with the chosen option, its probability, the full propensity map,
 * the policy version, the framing registry version, and the proximal outcome window,
 * all written BEFORE the call is placed. The outcome is recorded later from Day Line
 * evidence only (a completion on the Day Line or authoritative field evidence),
 * never from what the operator says on a call.
 *
 * Consent (plan §9.5): honouring an explicit operator preference needs only that
 * adaptation is allowed. Randomized assignment additionally needs an active
 * safe_experimentation consent. Without it every decision is the standard
 * presentation, recorded with probability 1 and selectionMode "deterministic";
 * those rows support only observational description, never a comparison of framings.
 *
 * This module makes no claim that any framing changes what the operator does.
 */
import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import type { ShowrunnerBriefing } from "../../claire/showrunner/showrunnerBriefing";
import type { DriverDayLineCallFacts, DriverDayLineStopFact } from "../../claire/showrunner/driverDayLineCall";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { daphneAdaptationAllowed, loadDaphneMetaPreferences, type DaphneMetaPreferenceKey, type DaphneMetaPreferenceRecord } from "./goalsPreferences";
import { listDaphneInterventions, recordDaphneIntervention, type DaphneInterventionRecord } from "./interventionLedger";
import { listDaphneOutcomes, recordDaphneOutcome, type DaphneOutcomeRecord } from "./outcomeLedger";
import { recordDaphneObservation } from "./observationStore";
import { buildDaphneResponseModel, type DaphneResponseEstimate } from "./responseModel";
import { loadMissionPresentations } from "./missionFollowUp";

export const DAPHNE_DECISION_POINTS_FLAG = "DAPHNE_V2_DECISION_POINTS" as const;
export const DAPHNE_DECISION_POINT_POLICY_VERSION = "daphne_framing_policy_v1";
export const DAPHNE_DECISION_POINT_SOURCE = "daphne_decision_point";
export const DAPHNE_STARTED_MEASURE = "started";

export const DAPHNE_DECISION_POINT_KINDS = ["morning_first_action", "evening_tomorrow_move"] as const;
export type DaphneDecisionPointKind = (typeof DAPHNE_DECISION_POINT_KINDS)[number];

export const DAPHNE_FRAMINGS = ["plain_instruction", "implementation_intention", "choice_of_two"] as const;
export type DaphneFraming = (typeof DAPHNE_FRAMINGS)[number];
/** The ordinary presentation; always eligible, always the arm used without experimentation consent. */
export const DAPHNE_STANDARD_FRAMING: DaphneFraming = "plain_instruction";

/**
 * Versioned framing registry. Annotations are proposals about content, not evidence
 * of effect for this operator (foundation §2.1, §2.7, §6). Nothing here is
 * expert_reviewed or empirically_supported.
 */
export const DAPHNE_FRAMING_REGISTRY = {
  version: 1,
  annotationStatus: "proposed" as const,
  definitions: {
    plain_instruction: {
      label: "Plain instruction (standard presentation)",
      guidance:
        "Name the first action as one plain instruction, e.g. 'First: <action>.' No condition, no alternatives.",
      annotation: null,
    },
    implementation_intention: {
      label: "Implementation-intention prompt",
      guidance:
        "Name the first action as a when-then plan: 'When <a cue the operator already has today>, you will <action>.' Use only a cue from BRIEFING or the operator's own words; if there is none, use a clock time ('At nine, you will <action>'). One sentence.",
      annotation: { construct: "implementation intention (if-then planning)", annotationStatus: "proposed" as const },
    },
    choice_of_two: {
      label: "Choice of two",
      guidance:
        "Offer the first action as a choice between exactly the two items named below, and ask which one they will start first. Never add a third option and never invent one.",
      annotation: { construct: "choice between two concrete actions", annotationStatus: "proposed" as const },
    },
  } satisfies Record<DaphneFraming, { label: string; guidance: string; annotation: unknown }>,
};

/** Proximal outcome windows, declared on the intervention row before any outcome exists. */
export const DAPHNE_DECISION_POINT_WINDOW_MINUTES: Record<DaphneDecisionPointKind, number> = {
  morning_first_action: 10 * 60,
  evening_tomorrow_move: 24 * 60,
};

/** Minimum verified outcomes per option before the response model tilts the draw. */
export const DAPHNE_MIN_SUPPORT_PER_OPTION = 5;
/** Every eligible option keeps at least this probability once the draw is tilted. */
export const DAPHNE_PROPENSITY_FLOOR = 0.2;

function explicitlyOn(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** Off unless DAPHNE_V2_DECISION_POINTS is 1/true; DAPHNE_V2_DECISION_POINTS_TENANTS narrows it. */
export function isDaphneDecisionPointsEnabled(tenantId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!explicitlyOn(env[DAPHNE_DECISION_POINTS_FLAG])) return false;
  const tenants = (env.DAPHNE_V2_DECISION_POINTS_TENANTS ?? "").split(",").map(t => t.trim()).filter(Boolean);
  return tenants.length === 0 || tenants.includes(tenantId.trim());
}

export type DaphneDecisionTarget = { id: string; title: string; businessDate: string };

export type DaphneDecisionConsent = {
  /** Adaptation and memory recall are not revoked (absent counts as allowed, as everywhere in Daphne). */
  adaptationAllowed: boolean;
  /** safe_experimentation is active and true, and adaptation is allowed. */
  experimentationAllowed: boolean;
  /** The operator's own "keep it plain" request, when recorded. */
  declaredPlainSourceRef: string | null;
};

export function daphneDecisionConsent(
  preferences: Partial<Record<DaphneMetaPreferenceKey, DaphneMetaPreferenceRecord>>,
  declaredPlainSourceRef: string | null
): DaphneDecisionConsent {
  const adaptationAllowed = daphneAdaptationAllowed(preferences);
  const experiment = preferences.safe_experimentation;
  return {
    adaptationAllowed,
    experimentationAllowed: adaptationAllowed && experiment?.status === "active" && experiment.value === true,
    declaredPlainSourceRef,
  };
}

const titleKey = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function openStops(line: DriverDayLineCallFacts | null | undefined): DriverDayLineStopFact[] {
  if (!line || line.read !== "read") return [];
  const seen = new Set<string>();
  return line.stops.filter(stop => {
    if (!stop.executable || stop.completion !== "unfinished") return false;
    const key = titleKey(stop.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pure: the work item this decision frames, and a second real item when one exists.
 * Morning: the designated mission when it is an open stop, else the first open executable stop.
 * Evening: tomorrow's first open Day Director item, else none (no target, no decision).
 */
export function daphneDecisionTargets(
  kind: DaphneDecisionPointKind,
  briefing: Pick<ShowrunnerBriefing, "businessDate" | "driverDayLine" | "tomorrow">
): { primary: DaphneDecisionTarget | null; second: DaphneDecisionTarget | null } {
  if (kind === "morning_first_action") {
    const stops = openStops(briefing.driverDayLine);
    const designated = briefing.driverDayLine?.designatedMission;
    const first =
      (designated && stops.find(s => s.id === designated.id || titleKey(s.title) === titleKey(designated.title))) || stops[0] || null;
    const second = stops.find(s => s !== first) ?? null;
    const as = (s: DriverDayLineStopFact | null) => (s ? { id: s.id, title: s.title, businessDate: briefing.businessDate } : null);
    return { primary: as(first), second: as(second) };
  }
  const tomorrow = addDaysYmd(briefing.businessDate, 1);
  const seen = new Set<string>();
  const open = briefing.tomorrow.filter(item => {
    if (item.status !== "open") return false;
    const key = titleKey(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const as = (i: (typeof open)[number] | undefined) =>
    i ? { id: `commitment-${i.id}`, title: i.title, businessDate: tomorrow } : null;
  return { primary: as(open[0]), second: as(open[1]) };
}

export type DaphneFramingSelection = {
  chosen: DaphneFraming;
  selectionMode: "deterministic" | "randomized" | "propensity";
  probability: number;
  propensity: Record<string, number>;
  reason:
    | "explicit_plain_preference"
    | "standard_presentation_without_experimentation_consent"
    | "uniform_randomization_without_support"
    | "response_model_tilt_with_floor";
  supportByOption: Record<string, number>;
};

/**
 * Pure selection. Explicit preference wins; without experimentation consent the
 * standard presentation is used; with consent the draw is uniform until every
 * eligible option has DAPHNE_MIN_SUPPORT_PER_OPTION verified outcomes in this
 * context, then tilted toward the higher observed rate with a floor on every option,
 * so every option keeps a known, non-zero probability.
 */
export function selectDaphneFraming(input: {
  eligible: readonly DaphneFraming[];
  consent: DaphneDecisionConsent;
  estimates: readonly DaphneResponseEstimate[];
  contextKey: string;
  random: () => number;
  minSupport?: number;
  floor?: number;
}): DaphneFramingSelection {
  const eligible = DAPHNE_FRAMINGS.filter(f => input.eligible.includes(f));
  if (!eligible.includes(DAPHNE_STANDARD_FRAMING)) throw new Error("The standard presentation must always be eligible");
  const supportByOption = Object.fromEntries(
    eligible.map(f => [f, input.estimates.find(e => e.actionKey === f && e.contextKey === input.contextKey)?.n ?? 0])
  );
  const point = (reason: DaphneFramingSelection["reason"]): DaphneFramingSelection => ({
    chosen: DAPHNE_STANDARD_FRAMING,
    selectionMode: "deterministic",
    probability: 1,
    propensity: Object.fromEntries(eligible.map(f => [f, f === DAPHNE_STANDARD_FRAMING ? 1 : 0])),
    reason,
    supportByOption,
  });
  if (input.consent.declaredPlainSourceRef) return point("explicit_plain_preference");
  if (!input.consent.experimentationAllowed || eligible.length === 1)
    return point("standard_presentation_without_experimentation_consent");

  const minSupport = input.minSupport ?? DAPHNE_MIN_SUPPORT_PER_OPTION;
  const floor = Math.min(input.floor ?? DAPHNE_PROPENSITY_FLOOR, 1 / eligible.length);
  const supported = eligible.every(f => supportByOption[f]! >= minSupport);
  let propensity: Record<string, number>;
  let reason: DaphneFramingSelection["reason"];
  let mode: DaphneFramingSelection["selectionMode"];
  if (!supported) {
    propensity = Object.fromEntries(eligible.map(f => [f, 1 / eligible.length]));
    reason = "uniform_randomization_without_support";
    mode = "randomized";
  } else {
    const rate = (f: DaphneFraming) =>
      input.estimates.find(e => e.actionKey === f && e.contextKey === input.contextKey)?.successRate ?? 0;
    const best = [...eligible].sort((a, b) => rate(b) - rate(a) || a.localeCompare(b))[0]!;
    const top = 1 - floor * (eligible.length - 1);
    propensity = Object.fromEntries(eligible.map(f => [f, f === best ? top : floor]));
    reason = "response_model_tilt_with_floor";
    mode = "propensity";
  }
  for (const f of eligible) propensity[f] = Number(propensity[f]!.toFixed(6));
  // Re-normalize the rounding residue onto the standard arm so the map sums to 1 exactly.
  const residue = 1 - eligible.reduce((s, f) => s + propensity[f]!, 0);
  propensity[DAPHNE_STANDARD_FRAMING] = Number((propensity[DAPHNE_STANDARD_FRAMING]! + residue).toFixed(6));
  const r = Math.min(Math.max(input.random(), 0), 0.999999999);
  let acc = 0;
  let chosen: DaphneFraming = eligible[eligible.length - 1]!;
  for (const f of eligible) {
    acc += propensity[f]!;
    if (r < acc) {
      chosen = f;
      break;
    }
  }
  return { chosen, selectionMode: mode, probability: propensity[chosen]!, propensity, reason, supportByOption };
}

/** What the showrunner carries for the call: the recorded decision and how to say it. */
export type DaphneCallDecision = {
  interventionId: string;
  decisionPointId: string;
  kind: DaphneDecisionPointKind;
  framing: DaphneFraming;
  target: DaphneDecisionTarget;
  second: DaphneDecisionTarget | null;
};

/** One line for the showrunner system prompt. Style only; it never adds work or facts. */
export function daphneDecisionPromptLine(decision: DaphneCallDecision | null | undefined): string {
  if (!decision) return "";
  const def = DAPHNE_FRAMING_REGISTRY.definitions[decision.framing];
  const subject = decision.kind === "morning_first_action" ? "today's first action" : "tomorrow's first move";
  const items =
    decision.framing === "choice_of_two" && decision.second
      ? ` The two items: "${decision.target.title}" or "${decision.second.title}".`
      : ` The item: "${decision.target.title}".`;
  return (
    `FRAMING FOR ${subject.toUpperCase()} (recorded decision ${decision.decisionPointId}): when you name ${subject}, ${def.guidance}${items}` +
    " Say it once, in your own words. If the operator has already chosen something else, follow the operator."
  );
}

export function daphneDecisionPointId(input: {
  kind: DaphneDecisionPointKind;
  tenantId: string;
  canonicalOperatorId: string;
  businessDate: string;
}): string {
  const who = createHash("sha256").update(`${input.tenantId}\u0000${input.canonicalOperatorId}`).digest("hex").slice(0, 16);
  return `${input.kind}:${input.businessDate}:${who}`;
}

export type DaphneDecisionPorts = {
  loadPreferences: typeof loadDaphneMetaPreferences;
  loadDeclaredPlainSourceRef: (scope: { tenantId: string; canonicalOperatorId: string }) => Promise<string | null>;
  listInterventions: typeof listDaphneInterventions;
  listOutcomes: typeof listDaphneOutcomes;
  recordObservation: typeof recordDaphneObservation;
  recordIntervention: typeof recordDaphneIntervention;
  recordOutcome: typeof recordDaphneOutcome;
  random: () => number;
};

async function declaredPlainSourceRef(scope: { tenantId: string; canonicalOperatorId: string }): Promise<string | null> {
  const presentations = await loadMissionPresentations(scope);
  for (const p of presentations.values())
    if (p.adjustment.kind === "presentation_style" && p.adjustment.style === "plain")
      return `daphne_observations:${p.sourceObservationId}`;
  return null;
}

export const defaultDaphneDecisionPorts: DaphneDecisionPorts = {
  loadPreferences: loadDaphneMetaPreferences,
  loadDeclaredPlainSourceRef: declaredPlainSourceRef,
  listInterventions: listDaphneInterventions,
  listOutcomes: listDaphneOutcomes,
  recordObservation: recordDaphneObservation,
  recordIntervention: recordDaphneIntervention,
  recordOutcome: recordDaphneOutcome,
  random: Math.random,
};

export type DaphneDecisionOperator = {
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
};

/**
 * Opens one decision point for a scheduled call and records it. Returns null (and
 * records only availability) when nothing is eligible. Idempotent per operator,
 * kind and business date: a retried call reuses the stored assignment.
 */
export async function openDaphneDecisionPoint(
  input: {
    operator: DaphneDecisionOperator;
    purpose: "morning_readiness" | "evening_debrief";
    briefing: Pick<ShowrunnerBriefing, "businessDate" | "driverDayLine" | "tomorrow">;
    now: Date;
    env?: NodeJS.ProcessEnv;
  },
  ports: DaphneDecisionPorts = defaultDaphneDecisionPorts
): Promise<DaphneCallDecision | null> {
  const { operator } = input;
  if (!isDaphneDecisionPointsEnabled(operator.tenantId, input.env)) return null;
  const kind: DaphneDecisionPointKind = input.purpose === "morning_readiness" ? "morning_first_action" : "evening_tomorrow_move";
  const scope = { tenantId: operator.tenantId, canonicalOperatorId: operator.canonicalOperatorId };
  const preferences = await ports.loadPreferences(scope);
  const plainRef = await ports.loadDeclaredPlainSourceRef(scope).catch(() => null);
  const consent = daphneDecisionConsent(preferences, plainRef);
  // Adaptation off means Daphne does not personalize or remember: no decision, no row.
  if (!consent.adaptationAllowed) return null;

  const decisionPointId = daphneDecisionPointId({ kind, ...scope, businessDate: input.briefing.businessDate });
  const { primary, second } = daphneDecisionTargets(kind, input.briefing);
  const eligible: DaphneFraming[] = primary
    ? ["plain_instruction", "implementation_intention", ...(second ? (["choice_of_two"] as const) : [])]
    : [];
  const observation = await ports.recordObservation({
    ...scope,
    operatorUserId: operator.operatorUserId,
    actorType: "system",
    actorId: "daphne",
    agentId: "claire",
    observationKind: "system_context_event",
    evidenceChannel: "system_record",
    verificationStatus: "verified",
    sourceType: DAPHNE_DECISION_POINT_SOURCE,
    sourceReference: decisionPointId,
    occurredAt: input.now,
    payload: {
      schemaVersion: 1,
      decisionPointId,
      kind,
      availability: Boolean(primary),
      unavailableReason: primary ? null : kind === "morning_first_action" ? "no_open_executable_stop" : "no_open_item_tomorrow",
      eligibleOptions: eligible,
      target: primary,
      second,
      consent: {
        experimentationAllowed: consent.experimentationAllowed,
        explicitPlainPreference: consent.declaredPlainSourceRef,
      },
    },
    idempotencyKey: `decision_point:${decisionPointId}`,
  });
  if (!primary) return null;

  const contextKey = kind;
  const [interventions, outcomes] = await Promise.all([
    ports.listInterventions({ ...scope, limit: 500 }),
    ports.listOutcomes({ ...scope, limit: 500 }),
  ]);
  const estimates = buildDaphneResponseModel({
    interventions: interventions.filter(i => i.agentId === "claire" && i.contextKey === contextKey),
    outcomes,
    successMeasureKey: DAPHNE_STARTED_MEASURE,
  });
  const selection = selectDaphneFraming({ eligible, consent, estimates, contextKey, random: ports.random });
  const window = DAPHNE_DECISION_POINT_WINDOW_MINUTES[kind];
  const row = await ports.recordIntervention({
    ...scope,
    agentId: "claire",
    decisionPointId,
    contextKey,
    acceptableActions: eligible,
    chosenAction: selection.chosen,
    selectionMode: selection.selectionMode,
    selectionProbability: selection.probability,
    propensity: selection.propensity,
    policyVersion: DAPHNE_DECISION_POINT_POLICY_VERSION,
    policyReceipt: {
      reason: selection.reason,
      supportByOption: selection.supportByOption,
      minSupportPerOption: DAPHNE_MIN_SUPPORT_PER_OPTION,
      propensityFloor: DAPHNE_PROPENSITY_FLOOR,
      target: primary,
      second,
      purpose: input.purpose,
      deliveryProven: false,
      outcomeRule:
        "started = 1 when the target's Day Line stop shows completion evidence inside the window; 0 when the window closes without it. Operator statements on calls are never evidence.",
    },
    interventionDefinitionVersion: DAPHNE_FRAMING_REGISTRY.version,
    proximalOutcomeWindowMinutes: window,
    sourceObservationIds: [observation.id],
    idempotencyKey: `decision:${decisionPointId}`,
  });
  return {
    interventionId: row.id,
    decisionPointId,
    kind,
    framing: row.chosenAction as DaphneFraming,
    target: primary,
    second,
  };
}

function targetFromIntervention(i: DaphneInterventionRecord): DaphneDecisionTarget | null {
  const t = (i.policyReceipt as { target?: DaphneDecisionTarget } | null)?.target;
  return t && typeof t.id === "string" && typeof t.businessDate === "string" ? t : null;
}

function stopFor(line: DriverDayLineCallFacts, target: DaphneDecisionTarget): DriverDayLineStopFact | null {
  return (
    line.stops.find(s => s.id === target.id) ??
    line.stops.find(s => titleKey(s.title) === titleKey(target.title)) ??
    null
  );
}

/**
 * Records the proximal outcome for every open decision whose target date has a
 * readable Day Line. started=1 needs completion evidence on the Day Line inside
 * the declared window; started=0 is written only after the window has closed with
 * the Day Line readable and no such evidence. An unreadable Day Line records nothing.
 */
export async function evaluateDaphneDecisionOutcomes(
  input: {
    operator: DaphneDecisionOperator;
    now: Date;
    timeZone: string;
    /** Reads the Day Line for a business date (the briefing's line is reused for its own date). */
    loadDayLine: (businessDate: string) => Promise<DriverDayLineCallFacts | null>;
    env?: NodeJS.ProcessEnv;
  },
  ports: Pick<DaphneDecisionPorts, "listInterventions" | "listOutcomes" | "recordOutcome"> = defaultDaphneDecisionPorts
): Promise<DaphneOutcomeRecord[]> {
  if (!isDaphneDecisionPointsEnabled(input.operator.tenantId, input.env)) return [];
  const scope = { tenantId: input.operator.tenantId, canonicalOperatorId: input.operator.canonicalOperatorId };
  const [interventions, outcomes] = await Promise.all([
    ports.listInterventions({ ...scope, limit: 200 }),
    ports.listOutcomes({ ...scope, limit: 500 }),
  ]);
  const measured = new Set(
    outcomes.filter(o => o.measureKey === DAPHNE_STARTED_MEASURE && o.interventionId).map(o => o.interventionId!)
  );
  const today = formatInTimeZone(input.now, input.timeZone, "yyyy-MM-dd");
  const lines = new Map<string, DriverDayLineCallFacts | null>();
  const recorded: DaphneOutcomeRecord[] = [];
  for (const i of interventions) {
    if (i.policyVersion !== DAPHNE_DECISION_POINT_POLICY_VERSION || measured.has(i.id)) continue;
    const target = targetFromIntervention(i);
    if (!target || target.businessDate > today || !i.proximalOutcomeWindowMinutes) continue;
    const windowStart = new Date(i.createdAt);
    const windowEnd = new Date(windowStart.getTime() + i.proximalOutcomeWindowMinutes * 60_000);
    if (!lines.has(target.businessDate))
      lines.set(target.businessDate, await input.loadDayLine(target.businessDate).catch(() => null));
    const line = lines.get(target.businessDate);
    if (!line || line.read !== "read") continue;
    const stop = stopFor(line, target);
    const evidenced = stop?.completion === "completed_with_evidence";
    const closed = input.now.getTime() >= windowEnd.getTime();
    if (!evidenced && !closed) continue;
    const inWindow = evidenced && input.now.getTime() <= windowEnd.getTime();
    const value = inWindow
      ? { value: 1, basis: "day_line_completion_evidence", evidence: stop?.evidence ?? null }
      : {
          value: 0,
          basis: evidenced ? "completion_evidence_after_window" : "no_day_line_start_evidence_in_window",
          // A completion the operator marked without evidence is shown, never counted.
          markedDoneWithoutEvidence: stop?.completion === "completed_without_evidence",
          stopFound: Boolean(stop),
        };
    recorded.push(
      await ports.recordOutcome({
        ...scope,
        interventionId: i.id,
        outcomeClass: "proximal",
        measureKey: DAPHNE_STARTED_MEASURE,
        value,
        evidenceClass: "system_record",
        verificationStatus: "verified",
        sourceReference: `day_line:${target.businessDate}:${target.id}`.slice(0, 191),
        windowStart,
        windowEnd,
        observedAt: inWindow ? input.now : windowEnd,
        idempotencyKey: `decision_outcome:${i.id}:${DAPHNE_STARTED_MEASURE}`,
      })
    );
  }
  return recorded;
}
