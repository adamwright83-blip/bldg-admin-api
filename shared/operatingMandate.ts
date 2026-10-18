import type { DoctrineRules } from "./claireProactive";
import type { BusinessDriver } from "./strategicIntelligence";
import {
  goalContribution,
  type GoalContributionTier,
  type WeeklyGrowthMotion,
} from "./weeklyGrowthCandidates";
import type { StrategyOpportunityPopulation } from "./workThread";

/**
 * Operating Mandate (Phase 2 · Slice B).
 *
 * One resolved, versioned answer to "what is this operator trying to do, and on
 * what terms", composed from the stores that already hold each part:
 *
 *  - Outcomes: the operator's confirmed goals (`operator_macro_goals`). Several
 *    may be active at once; none is primary unless the operator said so.
 *  - Focuses: where or on whom to concentrate. A remark Daphne heard in
 *    conversation (`daphne_goals`) is inferred; an operator decision recorded
 *    through the app (`operating_mandate_decisions`) is confirmed.
 *  - Hypotheses: ways to move an outcome. The operator's stated method is
 *    their confirmed choice, never proof; open Work Threads are the
 *    opportunities already being pursued.
 *  - Constraints: operator doctrine (contact limits, quiet periods).
 *  - Commitments: open, admitted Day Line work.
 *
 * Precedence is by confirmation before recency: a newer conversational remark
 * never overrides a confirmed goal, focus or decision; it waits for the
 * operator to confirm it. The resolver is pure; `revision` is a digest of
 * everything resolved, so the same stored state always yields the same
 * revision and any change to it yields a new one.
 */
export const OPERATING_MANDATE_SCHEMA_VERSION = 1 as const;
export const OPERATING_MANDATE_POLICY_VERSION = "operating-mandate-v1";

// ── Outcome metric scope ────────────────────────────────────────────────────

/** Goal metrics whose total can be limited to the tenant's own orders in one area. */
export const AREA_SCOPABLE_METRICS = ["net_sales_per_period", "paid_orders_per_period"] as const;
const AREA_SCOPE_MARKER = "@area:";
const AREA_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;
/** `operator_macro_goals.metricKey` and `macro_goal_runs.metricKey` are varchar(64). */
const METRIC_KEY_MAX = 64;

/**
 * Pure: a stored goal metric key as its base metric and area scope. A scoped
 * key (`net_sales_per_period@area:silver_lake`) is its own goal, run and
 * supersession scope, so a Silver Lake target never replaces a business-wide
 * one. Null means a malformed scoped key, which nothing may measure.
 */
export function parseOutcomeMetricKey(
  metricKey: string
): { baseMetricKey: string; area: string | null } | null {
  const at = metricKey.indexOf(AREA_SCOPE_MARKER);
  if (at < 0) return { baseMetricKey: metricKey, area: null };
  const baseMetricKey = metricKey.slice(0, at);
  const area = metricKey.slice(at + AREA_SCOPE_MARKER.length);
  if (!(AREA_SCOPABLE_METRICS as readonly string[]).includes(baseMetricKey) || !AREA_KEY.test(area)) return null;
  return { baseMetricKey, area };
}

/** Pure: the stored key for an area-scoped goal. Throws for a metric that cannot be area-scoped. */
export function scopedOutcomeMetricKey(baseMetricKey: string, area: string): string {
  const key = `${baseMetricKey}${AREA_SCOPE_MARKER}${area}`;
  if (!parseOutcomeMetricKey(key)) throw new Error(`Goal metric ${baseMetricKey} cannot be limited to an area`);
  if (key.length > METRIC_KEY_MAX) throw new Error("Area name is too long for a goal metric");
  return key;
}

/** Throws unless a goal metric key is unscoped or a supported area scope. */
export function assertOutcomeMetricKey(metricKey: string): void {
  if (!parseOutcomeMetricKey(metricKey)) throw new Error(`Unsupported goal metric scope: ${metricKey}`);
  if (metricKey.length > METRIC_KEY_MAX) throw new Error("Goal metric key is too long");
}

// ── Operator decisions ──────────────────────────────────────────────────────

export const MANDATE_DECISION_KINDS = ["primary_outcome", "focus", "method"] as const;
export type MandateDecisionKind = (typeof MANDATE_DECISION_KINDS)[number];

/** Levers and populations the strategic diagnosis can plan as an operator-stated method. */
export const STATED_METHOD_LEVERS = ["retention", "acquisition"] as const;
export const STATED_METHOD_POPULATIONS = ["lapsed_customers", "new_customers"] as const;

export type MandateDecisionPayload =
  /** Which active goal comes first. `outcomeId: null` withdraws the choice. */
  | { kind: "primary_outcome"; outcomeId: string | null }
  /** Confirm an area as a focus (for one goal, or on its own), or dismiss it. */
  | {
      kind: "focus";
      action: "confirm" | "dismiss";
      area: string;
      label: string;
      statement: string;
      servesOutcomeId: string | null;
    }
  /** The operator's chosen way to pursue a goal (or the business). `withdrawn` retracts it. */
  | {
      kind: "method";
      outcomeId: string | null;
      lever: (typeof STATED_METHOD_LEVERS)[number];
      population: (typeof STATED_METHOD_POPULATIONS)[number];
      area: string | null;
      statement: string;
      withdrawn?: boolean;
    };

export type MandateDecisionRecord = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  kind: MandateDecisionKind;
  subjectKey: string;
  payload: MandateDecisionPayload;
  status: "active" | "superseded";
  supersedesId: string | null;
  supersededById: string | null;
  decidedByOpenId: string;
  source: "authenticated_app";
  decidedAt: string;
};

/** Pure: decisions about the same subject supersede each other; different subjects coexist. */
export function mandateDecisionSubjectKey(payload: MandateDecisionPayload): string {
  if (payload.kind === "primary_outcome") return "primary_outcome";
  if (payload.kind === "focus") return `focus:${payload.area}`;
  return `method:${payload.outcomeId ?? "business"}`;
}

// ── Sources ─────────────────────────────────────────────────────────────────

export type MandateGoalSource = {
  id: string;
  operatorUserId: string;
  objective: string;
  metricKey: string;
  targetValue: number;
  unit: string;
  targetDate: string | null;
  source: string;
  status: string;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
};

/** A Daphne goal: something the operator said in conversation. Area is parsed from its statement. */
export type MandateRemarkSource = {
  id: string;
  statement: string;
  createdAt: string;
  area: { key: string; label: string } | null;
};

export type MandateThreadSource = {
  id: string;
  title: string;
  lever: BusinessDriver;
  population: StrategyOpportunityPopulation;
  area: string | null;
  createdAt: string;
};

export type MandateCommitmentSource = {
  id: string;
  title: string;
  businessDate: string;
  status: string;
  workThreadId: string | null;
  objectiveId: string | null;
};

export type MandateSources = {
  tenantId: string;
  canonicalOperatorId: string;
  verticalKey: string;
  /** False for businesses with no physical service area (an online market): no area focus applies. */
  areaPlanning: boolean;
  /** The operator's business date. */
  businessDate: string;
  goals: readonly MandateGoalSource[];
  remarks: readonly MandateRemarkSource[];
  decisions: readonly MandateDecisionRecord[];
  doctrine: { rules: DoctrineRules; defaults: DoctrineRules; sourceRef: string } | null;
  threads: readonly MandateThreadSource[];
  commitments: readonly MandateCommitmentSource[];
  /**
   * Admitted orders on record in each area an unconfirmed remark names. Null
   * means the count could not be read in full (an outage), which is not
   * evidence of absence. A remark about an area the business verifiably has no
   * orders in is not applied until the operator confirms it.
   */
  areaOrders: Readonly<Record<string, number | null>>;
};

// ── Resolved mandate ────────────────────────────────────────────────────────

export type MandateOutcome = {
  id: string;
  goalId: string;
  statement: string;
  metricKey: string;
  baseMetricKey: string;
  area: string | null;
  target: number;
  unit: string;
  confirmation: "confirmed";
  sourceRef: string;
  source: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  primary: boolean;
  revision: string;
  uncertainty: string[];
};

export type MandateFocusStatus =
  | "active"
  | "superseded"
  | "pending_confirmation"
  | "overridden"
  | "dismissed"
  | "not_applicable";

export type MandateFocusRelationship =
  | { kind: "serves"; outcomeId: string; confirmation: "confirmed" | "inferred" }
  | { kind: "independent" }
  | { kind: "unresolved" };

export type MandateFocus = {
  id: string;
  sourceRef: string;
  /** Normalized area key, or null for an emphasis with no place in it. */
  area: string | null;
  label: string | null;
  statement: string;
  confirmation: "confirmed" | "inferred";
  status: MandateFocusStatus;
  statusReason: string | null;
  /** The confirmed decision that overrides or outranks this remark. */
  overriddenBy: string | null;
  relationship: MandateFocusRelationship;
  effectiveFrom: string;
  revision: string;
  uncertainty: string[];
};

export type MandateHypothesis = {
  id: string;
  sourceRef: string;
  origin: "operator_stated" | "work_thread";
  statement: string;
  lever: BusinessDriver;
  population: StrategyOpportunityPopulation;
  area: string | null;
  /** An operator-stated method is their confirmed choice; a Work Thread is Claire's open opportunity. */
  confirmation: "confirmed" | "inferred";
  /** Neither kind is evidence that the approach works. */
  epistemicStatus: "unproven";
  outcomeId: string | null;
  /** Goals whose metric this kind of work moves (a ranking-policy judgment, not a forecast). */
  servesOutcomeIds: string[];
  status: "active" | "stale";
  effectiveFrom: string;
  revision: string;
  uncertainty: string[];
};

export type MandateConstraint = {
  id: string;
  sourceRef: string;
  origin: "operator_doctrine" | "system_default";
  key: keyof DoctrineRules;
  statement: string;
  value: number | string | null;
  confirmation: "confirmed" | "default";
  effectiveUntil: string | null;
  revision: string;
};

export type MandateCommitment = {
  id: string;
  sourceRef: string;
  title: string;
  businessDate: string;
  status: string;
  workThreadId: string | null;
  objectiveId: string | null;
  confirmation: "confirmed";
  revision: string;
};

export type MandateConflict = {
  id: string;
  kind: "competing_outcomes" | "remark_vs_confirmed_intent" | "stale_reference";
  /** What the parties compete for. Mission Director plans one primary piece of growth work a day. */
  resource: "daily_primary_work" | null;
  refs: string[];
  status: "unresolved" | "resolved";
  resolution: { by: "confirmed_primary" | "confirmed_intent_precedence"; ref: string } | null;
  description: string;
};

export type MandateHistoryEntry = {
  ref: string;
  kind: "outcome" | "decision";
  status: string;
  supersededBy: string | null;
  statement: string;
  at: string;
};

export type ResolvedOperatingMandate = {
  schemaVersion: typeof OPERATING_MANDATE_SCHEMA_VERSION;
  policyVersion: string;
  tenantId: string;
  canonicalOperatorId: string;
  verticalKey: string;
  businessDate: string;
  revision: string;
  outcomes: MandateOutcome[];
  /** Set only by an explicit operator decision naming an active goal. */
  primaryOutcomeId: string | null;
  /** The goal work is addressed to: the confirmed primary, or the only active goal. */
  leadingOutcome: { id: string; basis: "confirmed_primary" | "sole_outcome" } | null;
  focuses: MandateFocus[];
  /** The area focus planning uses: a confirmed one first, else the newest applicable remark. */
  appliedFocusId: string | null;
  hypotheses: MandateHypothesis[];
  /** The operator-stated method for the leading goal (or the business), when one is active. */
  statedMethodId: string | null;
  constraints: MandateConstraint[];
  commitments: MandateCommitment[];
  conflicts: MandateConflict[];
  uncertainty: string[];
  history: MandateHistoryEntry[];
};

// ── Policy helpers ──────────────────────────────────────────────────────────

/** Pure: the Weekly Growth motion the strategic diagnosis gives work on this lever. */
export function motionForLever(lever: BusinessDriver): WeeklyGrowthMotion {
  return lever === "retention" ? "retention" : lever === "acquisition" ? "account_acquisition" : "investigation";
}

/**
 * Pure: how directly work moves one goal. A goal limited to an area is moved
 * only by work in that same area; work with no area is never assumed to land
 * there. Null when the work is outside the goal's scope.
 */
export function outcomeContribution(
  outcome: Pick<MandateOutcome, "baseMetricKey" | "area">,
  work: { motion: WeeklyGrowthMotion; area: string | null | undefined }
): { tier: GoalContributionTier; effect: number; reason: string } | null {
  if (outcome.area && outcome.area !== (work.area ?? null)) return null;
  return goalContribution(outcome.baseMetricKey, work.motion);
}

/** Effect weight for a goal that is not the confirmed primary while one is. */
export const NON_PRIMARY_OUTCOME_WEIGHT = 0.5;

const DOCTRINE_CONSTRAINTS: ReadonlyArray<{
  key: keyof DoctrineRules;
  statement: (rules: DoctrineRules) => string | null;
}> = [
  { key: "dormantQuietDays", statement: r => `A customer counts as lapsed after ${r.dormantQuietDays} days without an order.` },
  { key: "minPriorOrders", statement: r => `Win-back contacts only for customers with at least ${r.minPriorOrders} paid orders.` },
  { key: "maxRecoveryPerDay", statement: r => `At most ${r.maxRecoveryPerDay} win-back contacts a day.` },
  { key: "outreachCooldownDays", statement: r => `At least ${r.outreachCooldownDays} days between contacts to the same customer.` },
  {
    key: "skipSalesUntil",
    statement: r => (r.skipSalesUntil ? `No sales outreach until ${r.skipSalesUntil}${r.skipSalesReason ? ` (${r.skipSalesReason})` : ""}.` : null),
  },
];

const byAtThenId = <T extends { at: string; ref: string }>(a: T, b: T) =>
  b.at.localeCompare(a.at) || a.ref.localeCompare(b.ref);

const focusLabel = (f: Pick<MandateFocus, "label" | "statement">) => f.label ?? f.statement;

type Digest = (text: string) => string;

// ── Focus resolution ────────────────────────────────────────────────────────

/**
 * Pure: every focus the operator has stated or confirmed, with its standing.
 * Confirmation outranks recency: a remark older than a confirmed focus is
 * overridden by it; a remark newer than one waits for confirmation instead of
 * replacing it. Without any confirmation the newest applicable remark applies,
 * but only in an area the business actually has orders in.
 */
/**
 * An operator decision that names an area to work in: a confirmed focus, or a
 * stated method with an area ("find new Echo Park customers" confirms Echo Park).
 */
type AreaConfirmation = {
  decision: MandateDecisionRecord;
  area: string;
  label: string;
  statement: string;
  servesOutcomeId: string | null;
};

function areaConfirmations(decisions: readonly MandateDecisionRecord[], labelFor: (area: string) => string): AreaConfirmation[] {
  const byArea = new Map<string, AreaConfirmation>();
  for (const d of decisions) {
    if (d.status !== "active") continue;
    const p = d.payload;
    const confirmation =
      p.kind === "focus" && p.action === "confirm"
        ? { decision: d, area: p.area, label: p.label, statement: p.statement, servesOutcomeId: p.servesOutcomeId }
        : p.kind === "method" && p.area && !p.withdrawn
          ? { decision: d, area: p.area, label: labelFor(p.area), statement: p.statement, servesOutcomeId: p.outcomeId }
          : null;
    if (!confirmation) continue;
    const prior = byArea.get(confirmation.area);
    // One confirmed focus per area: the newest decision naming it.
    if (!prior || d.decidedAt > prior.decision.decidedAt || (d.decidedAt === prior.decision.decidedAt && d.id > prior.decision.id))
      byArea.set(confirmation.area, confirmation);
  }
  return [...byArea.values()];
}

/** "silver_lake" → "Silver Lake", for an area named only by its key. */
export function areaLabelFromKey(area: string): string {
  return area.split("_").map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function resolveMandateFocuses(
  sources: Pick<MandateSources, "remarks" | "decisions" | "areaPlanning" | "areaOrders">,
  digest: Digest
): { focuses: MandateFocus[]; appliedFocusId: string | null; conflicts: MandateConflict[] } {
  const confirms = areaConfirmations(sources.decisions, area => {
    const remark = sources.remarks.find(r => r.area?.key === area);
    return remark?.area?.label ?? areaLabelFromKey(area);
  });
  const dismissals = new Map<string, MandateDecisionRecord>();
  for (const d of sources.decisions)
    if (d.status === "active" && d.payload.kind === "focus" && d.payload.action === "dismiss") dismissals.set(d.payload.area, d);
  const confirmedAreas = new Map(confirms.map(c => [c.area, c.decision] as const));
  const latest = [...confirms].sort(
    (a, b) => b.decision.decidedAt.localeCompare(a.decision.decidedAt) || a.decision.id.localeCompare(b.decision.id)
  )[0] ?? null;

  const focuses: MandateFocus[] = [];
  const conflicts: MandateConflict[] = [];
  const finish = (f: Omit<MandateFocus, "revision">): MandateFocus => ({ ...f, revision: digest(JSON.stringify(f)).slice(0, 16) });

  for (const c of confirms) {
    const ref = `operating_mandate_decisions:${c.decision.id}`;
    focuses.push(
      finish({
        id: ref,
        sourceRef: ref,
        area: c.area,
        label: c.label,
        statement: c.statement,
        confirmation: "confirmed",
        status: sources.areaPlanning ? "active" : "not_applicable",
        statusReason: sources.areaPlanning ? null : "no_physical_service_area",
        overriddenBy: null,
        // Completed by the full resolver, which knows the active goals.
        relationship: c.servesOutcomeId
          ? { kind: "serves", outcomeId: c.servesOutcomeId, confirmation: "confirmed" }
          : { kind: "independent" },
        effectiveFrom: c.decision.decidedAt,
        uncertainty: [],
      })
    );
  }

  const candidates: Array<Omit<MandateFocus, "revision">> = [];
  for (const r of sources.remarks) {
    const ref = `daphne_goals:${r.id}`;
    const base = {
      id: ref,
      sourceRef: ref,
      area: r.area?.key ?? null,
      label: r.area?.label ?? null,
      statement: r.statement,
      confirmation: "inferred" as const,
      overriddenBy: null as string | null,
      relationship: { kind: "unresolved" } as MandateFocusRelationship,
      effectiveFrom: r.createdAt,
      uncertainty: ["From conversation; not confirmed by the operator."],
    };
    if (!r.area) {
      // An emphasis with no place in it ("more commercial accounts"): context, never a plan.
      focuses.push(finish({ ...base, status: "active", statusReason: "no_area" }));
      continue;
    }
    const confirmedHere = confirmedAreas.get(r.area.key);
    const dismissal = dismissals.get(r.area.key);
    if (confirmedHere) {
      focuses.push(finish({ ...base, status: "superseded", statusReason: "confirmed_by_operator", overriddenBy: `operating_mandate_decisions:${confirmedHere.id}` }));
    } else if (dismissal) {
      const decisionRef = `operating_mandate_decisions:${dismissal.id}`;
      const older = r.createdAt <= dismissal.decidedAt;
      focuses.push(
        finish({
          ...base,
          status: older ? "dismissed" : "pending_confirmation",
          statusReason: older ? "dismissed_by_operator" : "newer_remark_does_not_override_dismissal",
          overriddenBy: decisionRef,
        })
      );
      if (!older)
        conflicts.push({
          id: `conflict:remark:${r.id}`,
          kind: "remark_vs_confirmed_intent",
          resource: null,
          refs: [ref, decisionRef],
          status: "resolved",
          resolution: { by: "confirmed_intent_precedence", ref: decisionRef },
          description: `${r.area.label} came up again after you set it aside; it stays aside until you confirm it.`,
        });
    } else if (latest) {
      const decisionRef = `operating_mandate_decisions:${latest.decision.id}`;
      const older = r.createdAt <= latest.decision.decidedAt;
      focuses.push(
        finish({
          ...base,
          status: older ? "overridden" : "pending_confirmation",
          statusReason: older ? "older_than_confirmed_focus" : "newer_remark_does_not_override_confirmed_focus",
          overriddenBy: decisionRef,
        })
      );
      conflicts.push({
        id: `conflict:remark:${r.id}`,
        kind: "remark_vs_confirmed_intent",
        resource: null,
        refs: [ref, decisionRef],
        status: "resolved",
        resolution: { by: "confirmed_intent_precedence", ref: decisionRef },
        description: older
          ? `${r.area.label} was mentioned before you confirmed ${latest.label}; the confirmed focus applies.`
          : `${r.area.label} was mentioned after you confirmed ${latest.label}; it is not applied until you confirm it.`,
      });
    } else if (!sources.areaPlanning) {
      focuses.push(finish({ ...base, status: "not_applicable", statusReason: "no_physical_service_area" }));
    } else if (sources.areaOrders[r.area.key] == null) {
      // Unknown is not absence: while the orders cannot be read the remark
      // stays, and the readers that measure it withhold its figures.
      candidates.push({
        ...base,
        status: "active",
        statusReason: "area_orders_unknown",
        uncertainty: [...base.uncertainty, `Whether the business has orders in ${r.area.label} could not be read.`],
      });
    } else if (sources.areaOrders[r.area.key] === 0) {
      // A neighborhood the business has never sold in is not a focus until the operator confirms it.
      focuses.push(finish({ ...base, status: "not_applicable", statusReason: "no_orders_in_area" }));
    } else {
      candidates.push({ ...base, status: "active", statusReason: null });
    }
  }
  // Without a confirmation the newest applicable remark applies; older ones are replaced by it.
  candidates.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.id.localeCompare(b.id));
  candidates.forEach((f, i) =>
    focuses.push(finish(i === 0 ? f : { ...f, status: "superseded", statusReason: "newer_remark" }))
  );

  const confirmedApplied = focuses
    .filter(f => f.confirmation === "confirmed" && f.status === "active" && f.area)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.id.localeCompare(b.id))[0];
  const inferredApplied = candidates[0] ? focuses.find(f => f.id === candidates[0]!.id)! : null;
  focuses.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id));
  return {
    focuses,
    appliedFocusId: confirmedApplied?.id ?? inferredApplied?.id ?? null,
    conflicts,
  };
}

// ── Full resolution ─────────────────────────────────────────────────────────

/** Pure: the operator's resolved mandate. `digest` must be a stable hash (sha256 on the server). */
export function resolveOperatingMandate(sources: MandateSources, digest: Digest): ResolvedOperatingMandate {
  const elementRevision = (value: unknown) => digest(JSON.stringify(value)).slice(0, 16);
  const uncertainty: string[] = [];
  const conflicts: MandateConflict[] = [];

  // Outcomes: every active confirmed goal, oldest first. No recency pick.
  const activeGoals = sources.goals
    .filter(g => g.status === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const activeIds = new Set(activeGoals.map(g => `operator_macro_goals:${g.id}`));
  const primaryDecision = sources.decisions.find(d => d.status === "active" && d.payload.kind === "primary_outcome");
  const primaryChoice = primaryDecision?.payload.kind === "primary_outcome" ? primaryDecision.payload.outcomeId : null;
  const primaryOutcomeId = primaryChoice && activeIds.has(primaryChoice) ? primaryChoice : null;
  if (primaryChoice && !primaryOutcomeId) {
    const ref = `operating_mandate_decisions:${primaryDecision!.id}`;
    conflicts.push({
      id: `conflict:stale:${primaryDecision!.id}`,
      kind: "stale_reference",
      resource: null,
      refs: [ref, primaryChoice],
      status: "unresolved",
      resolution: null,
      description: "The goal you chose to come first is no longer active; no goal is first until you choose again.",
    });
  }

  const outcomes: MandateOutcome[] = activeGoals.map(g => {
    const id = `operator_macro_goals:${g.id}`;
    const parsed = parseOutcomeMetricKey(g.metricKey);
    const body = {
      id,
      goalId: g.id,
      statement: g.objective,
      metricKey: g.metricKey,
      baseMetricKey: parsed?.baseMetricKey ?? g.metricKey,
      area: parsed?.area ?? null,
      target: g.targetValue,
      unit: g.unit,
      confirmation: "confirmed" as const,
      sourceRef: id,
      source: g.source,
      effectiveFrom: g.createdAt,
      effectiveUntil: g.targetDate,
      primary: id === primaryOutcomeId,
      uncertainty: parsed ? [] : ["This goal's metric scope is not supported, so its progress cannot be measured."],
    };
    return { ...body, revision: elementRevision(body) };
  });

  const leadingOutcome = primaryOutcomeId
    ? { id: primaryOutcomeId, basis: "confirmed_primary" as const }
    : outcomes.length === 1
      ? { id: outcomes[0]!.id, basis: "sole_outcome" as const }
      : null;
  if (!outcomes.length) uncertainty.push("No confirmed goal is active; work is planned from the business's own figures.");
  if (outcomes.length >= 2) {
    const ids = outcomes.map(o => o.id);
    conflicts.push({
      id: `conflict:outcomes:${digest(ids.join("|")).slice(0, 16)}`,
      kind: "competing_outcomes",
      resource: "daily_primary_work",
      refs: ids,
      status: primaryOutcomeId ? "resolved" : "unresolved",
      resolution: primaryOutcomeId ? { by: "confirmed_primary", ref: `operating_mandate_decisions:${primaryDecision!.id}` } : null,
      description: primaryOutcomeId
        ? `${outcomes.length} goals share one primary piece of growth work a day; you chose which comes first.`
        : `${outcomes.length} goals are active and none is confirmed as first; each day's primary work can serve only some of them.`,
    });
    if (!primaryOutcomeId) uncertainty.push(`${outcomes.length} goals are active and none is confirmed as first.`);
  }

  // Focuses, then their relationship to the goals.
  const focusResolution = resolveMandateFocuses(sources, digest);
  conflicts.push(...focusResolution.conflicts);
  const focuses = focusResolution.focuses.map(f => {
    let relationship = f.relationship;
    const extra: string[] = [];
    if (f.confirmation === "confirmed" && relationship.kind === "serves" && !activeIds.has(relationship.outcomeId)) {
      relationship = { kind: "unresolved" };
      extra.push("The goal this focus was confirmed for is no longer active.");
    }
    if (f.confirmation === "inferred" && f.area) {
      const sameArea = outcomes.filter(o => o.area === f.area);
      const served = sameArea.length === 1 ? sameArea[0]! : sameArea.find(o => o.primary) ?? null;
      relationship = served
        ? { kind: "serves", outcomeId: served.id, confirmation: "inferred" }
        : leadingOutcome
          ? { kind: "serves", outcomeId: leadingOutcome.id, confirmation: "inferred" }
          : { kind: "unresolved" };
    }
    if (relationship === f.relationship && !extra.length) return f;
    const next: Omit<MandateFocus, "revision"> = {
      id: f.id,
      sourceRef: f.sourceRef,
      area: f.area,
      label: f.label,
      statement: f.statement,
      confirmation: f.confirmation,
      status: f.status,
      statusReason: f.statusReason,
      overriddenBy: f.overriddenBy,
      relationship,
      effectiveFrom: f.effectiveFrom,
      uncertainty: [...f.uncertainty, ...extra],
    };
    return { ...next, revision: elementRevision(next) };
  });
  const applied = focuses.find(f => f.id === focusResolution.appliedFocusId) ?? null;
  if (applied?.confirmation === "inferred")
    uncertainty.push(`${focusLabel(applied)} comes from conversation, not a confirmed goal or focus; confirm it or set it aside.`);
  for (const f of focuses) {
    if (f.status === "pending_confirmation")
      uncertainty.push(`${focusLabel(f)} was mentioned after a confirmed decision; it is not applied until you confirm it.`);
    if (f.status === "not_applicable" && f.statusReason === "no_orders_in_area")
      uncertainty.push(`${focusLabel(f)} was mentioned, but none of the business's recorded orders are there, so it is not applied.`);
  }

  // Hypotheses: operator-stated methods and open Work Threads.
  const hypotheses: MandateHypothesis[] = [];
  for (const d of sources.decisions) {
    const p = d.payload;
    if (d.status !== "active" || p.kind !== "method" || p.withdrawn) continue;
    const ref = `operating_mandate_decisions:${d.id}`;
    const stale = Boolean(p.outcomeId && !activeIds.has(p.outcomeId));
    const body = {
      id: ref,
      sourceRef: ref,
      origin: "operator_stated" as const,
      statement: p.statement,
      lever: p.lever as BusinessDriver,
      population: p.population as StrategyOpportunityPopulation,
      area: p.area,
      confirmation: "confirmed" as const,
      epistemicStatus: "unproven" as const,
      outcomeId: p.outcomeId,
      servesOutcomeIds: outcomes
        .filter(o => (outcomeContribution(o, { motion: motionForLever(p.lever), area: p.area })?.tier ?? "none") !== "none")
        .map(o => o.id),
      status: stale ? ("stale" as const) : ("active" as const),
      effectiveFrom: d.decidedAt,
      uncertainty: stale ? ["The goal this method was stated for is no longer active."] : [],
    };
    hypotheses.push({ ...body, revision: elementRevision(body) });
    if (stale)
      conflicts.push({
        id: `conflict:stale:${d.id}`,
        kind: "stale_reference",
        resource: null,
        refs: [ref, p.outcomeId!],
        status: "unresolved",
        resolution: null,
        description: "A stated method points to a goal that is no longer active.",
      });
  }
  for (const t of sources.threads) {
    const ref = `work_threads:${t.id}`;
    const body = {
      id: ref,
      sourceRef: ref,
      origin: "work_thread" as const,
      statement: t.title,
      lever: t.lever,
      population: t.population,
      area: t.area,
      confirmation: "inferred" as const,
      epistemicStatus: "unproven" as const,
      outcomeId: null,
      servesOutcomeIds: outcomes
        .filter(o => (outcomeContribution(o, { motion: motionForLever(t.lever), area: t.area })?.tier ?? "none") !== "none")
        .map(o => o.id),
      status: "active" as const,
      effectiveFrom: t.createdAt,
      uncertainty: [],
    };
    hypotheses.push({ ...body, revision: elementRevision(body) });
  }
  hypotheses.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id));
  // The method that applies: the one stated for the goal work is addressed to;
  // else the one that set the applied focus (a method naming an area confirms
  // it); else one stated for the business as a whole.
  const activeMethods = hypotheses.filter(h => h.origin === "operator_stated" && h.status === "active");
  const statedMethod =
    (leadingOutcome && activeMethods.filter(h => h.outcomeId === leadingOutcome.id).at(-1)) ||
    activeMethods.find(h => h.id === applied?.id) ||
    activeMethods.filter(h => h.outcomeId === null).at(-1) ||
    null;

  // Constraints: operator doctrine; values the operator never changed are system defaults.
  const constraints: MandateConstraint[] = [];
  if (sources.doctrine) {
    const { rules, defaults, sourceRef } = sources.doctrine;
    for (const c of DOCTRINE_CONSTRAINTS) {
      if (c.key === "skipSalesUntil" && (!rules.skipSalesUntil || rules.skipSalesUntil < sources.businessDate)) continue;
      const statement = c.statement(rules);
      if (!statement) continue;
      const changed = rules[c.key] !== defaults[c.key];
      const body = {
        id: `${sourceRef}:${c.key}`,
        sourceRef,
        origin: changed ? ("operator_doctrine" as const) : ("system_default" as const),
        key: c.key,
        statement,
        value: (rules[c.key] ?? null) as number | string | null,
        confirmation: changed ? ("confirmed" as const) : ("default" as const),
        effectiveUntil: c.key === "skipSalesUntil" ? rules.skipSalesUntil : null,
      };
      constraints.push({ ...body, revision: elementRevision(body) });
    }
  }

  const commitments: MandateCommitment[] = [...sources.commitments]
    .sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.id.localeCompare(b.id))
    .map(c => {
      const ref = `day_director_commitments:${c.id}`;
      const body = {
        id: ref,
        sourceRef: ref,
        title: c.title,
        businessDate: c.businessDate,
        status: c.status,
        workThreadId: c.workThreadId,
        objectiveId: c.objectiveId,
        confirmation: "confirmed" as const,
      };
      return { ...body, revision: elementRevision(body) };
    });

  const history: MandateHistoryEntry[] = [
    ...sources.goals
      .filter(g => g.status !== "active")
      .map(g => ({
        ref: `operator_macro_goals:${g.id}`,
        kind: "outcome" as const,
        status: g.status,
        supersededBy: g.supersededById ? `operator_macro_goals:${g.supersededById}` : null,
        statement: g.objective,
        at: g.updatedAt,
      })),
    ...sources.decisions
      .filter(d => d.status !== "active")
      .map(d => ({
        ref: `operating_mandate_decisions:${d.id}`,
        kind: "decision" as const,
        status: d.status,
        supersededBy: d.supersededById ? `operating_mandate_decisions:${d.supersededById}` : null,
        statement: d.subjectKey,
        at: d.decidedAt,
      })),
  ]
    .sort(byAtThenId)
    .slice(0, 20);

  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  const body = {
    schemaVersion: OPERATING_MANDATE_SCHEMA_VERSION,
    policyVersion: OPERATING_MANDATE_POLICY_VERSION,
    tenantId: sources.tenantId,
    canonicalOperatorId: sources.canonicalOperatorId,
    verticalKey: sources.verticalKey,
    businessDate: sources.businessDate,
    outcomes,
    primaryOutcomeId,
    leadingOutcome,
    focuses,
    appliedFocusId: applied?.id ?? null,
    hypotheses,
    statedMethodId: statedMethod?.id ?? null,
    constraints,
    commitments,
    conflicts,
    uncertainty: [...new Set(uncertainty)],
    history,
  };
  return { ...body, revision: `mandate_${digest(JSON.stringify(body)).slice(0, 40)}` };
}

/** The active goal a mandate element names, if it is still active. */
export function mandateOutcome(mandate: ResolvedOperatingMandate, id: string | null | undefined): MandateOutcome | null {
  return (id && mandate.outcomes.find(o => o.id === id)) || null;
}

export function appliedMandateFocus(mandate: ResolvedOperatingMandate): MandateFocus | null {
  return mandate.focuses.find(f => f.id === mandate.appliedFocusId) ?? null;
}

export function statedMandateMethod(mandate: ResolvedOperatingMandate): MandateHypothesis | null {
  return mandate.hypotheses.find(h => h.id === mandate.statedMethodId) ?? null;
}

// ── Evidence attribution ────────────────────────────────────────────────────

/**
 * One verified business result, e.g. a paid order observed after an attempt.
 * `area` is where it happened when known (a targeted customer chosen from an
 * area's own orders); `firstPurchase` is null when not established.
 */
export type MandateEvidenceItem = {
  evidenceRef: string;
  kind: "paid_order";
  cents: number | null;
  area: string | null;
  firstPurchase: boolean | null;
};

/** Pure: whether a result is progress on a goal's own metric and scope. */
export function evidenceAdvancesOutcome(outcome: Pick<MandateOutcome, "baseMetricKey" | "area">, item: MandateEvidenceItem): boolean {
  if (item.kind !== "paid_order") return false;
  switch (outcome.baseMetricKey) {
    case "net_sales_per_period":
    case "paid_orders_per_period":
      return !outcome.area || outcome.area === item.area;
    case "active_customers":
      return !outcome.area;
    case "new_paying_customers":
      return !outcome.area && item.firstPurchase === true;
    default:
      return false;
  }
}

/**
 * Pure: each result attributed to every goal it advances, counted once. The
 * same sale can be evidence for a revenue goal and a customer goal; it is one
 * economic event, so totals across goals never add it twice.
 */
export function attributeMandateEvidence(outcomes: readonly MandateOutcome[], items: readonly MandateEvidenceItem[]) {
  const seen = new Map<string, MandateEvidenceItem>();
  for (const item of items) if (!seen.has(item.evidenceRef)) seen.set(item.evidenceRef, item);
  const attributed = [...seen.values()].map(item => ({
    ...item,
    advancesOutcomeIds: outcomes.filter(o => evidenceAdvancesOutcome(o, item)).map(o => o.id),
  }));
  const counted = attributed.filter(a => a.advancesOutcomeIds.length);
  return {
    items: attributed,
    byOutcome: Object.fromEntries(
      outcomes.map(o => [o.id, attributed.filter(a => a.advancesOutcomeIds.includes(o.id)).map(a => a.evidenceRef)])
    ) as Record<string, string[]>,
    distinctEvidenceCount: counted.length,
    distinctCents: counted.reduce((sum, a) => sum + (a.cents ?? 0), 0),
  };
}
