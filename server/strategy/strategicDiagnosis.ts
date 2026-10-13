import { createHash } from "node:crypto";
import type {
  BusinessDriver,
  StrategicDiagnosis,
  StrategyAction,
  StrategyEvidence,
  StrategyMarketContext,
  StrategyOption,
} from "../../shared/strategicIntelligence";
import type { VerticalRegistry } from "./verticalTemplates/registry";
import {
  STRATEGY_DOCTRINE_VERSION,
  validateStrategicDiagnosis,
} from "./strategyDoctrine";

export type DiagnosisInput = {
  tenantId: string;
  canonicalOperatorId: string;
  verticalKey: string;
  businessDate: string;
  now: Date;
  goal: StrategicDiagnosis["goal"];
  evidence: StrategyEvidence[];
  /** Keys are capabilities in the selected VerticalRegistry module, never client guesses. */
  metrics: Partial<Record<string, string>>;
  market: StrategyMarketContext;
  outcomes: Array<{
    id: string;
    actionDriver: BusinessDriver;
    result: "supported" | "contradicted" | "inconclusive";
    evidenceRef: string;
  }>;
  commitments: string[];
};

export function assembleStrategicDiagnosis(
  input: DiagnosisInput,
  registry: VerticalRegistry
): StrategicDiagnosis {
  let industry: ReturnType<VerticalRegistry["get"]>["strategicIntelligence"];
  try {
    industry = registry.get(input.verticalKey).strategicIntelligence;
  } catch {
    /* unsupported remains explicit */
  }
  const evidence = input.evidence.filter(
    e =>
      e.tenantId === input.tenantId &&
      Date.parse(e.capturedAt) <= input.now.getTime()
  );
  const byId = new Map(evidence.map(e => [e.id, e]));
  const metric = (key: string): number | null => {
    if (!industry?.metrics.includes(key)) return null;
    const e = byId.get(input.metrics[key] ?? "");
    if (
      !e ||
      e.quality !== "complete" ||
      !["verified", "operator_input"].includes(e.classification) ||
      typeof e.value !== "number" ||
      !Number.isFinite(e.value)
    )
      return null;
    if (input.now.getTime() - Date.parse(e.capturedAt) > 7 * 86400000)
      return null;
    return e.value;
  };
  const ref = (key: string) =>
    input.metrics[key] ? [input.metrics[key]!] : [];
  const goalEvidence =
    input.goal.evidenceRef && byId.has(input.goal.evidenceRef)
      ? [input.goal.evidenceRef]
      : [];
  const contribution = metric("contribution_per_order_cents");
  const capacity = metric("available_capacity");
  const sample = metric("mature_cohort_customers");
  const repeat = metric("mature_cohort_repeat_customers");
  const demand = metric("qualified_demand");
  const needed = metric("required_qualified_demand");
  const cash = metric("cash_runway_weeks");
  let driver: BusinessDriver = "investigation";
  let diagnosis =
    "The available evidence does not isolate the limiting business driver. A bounded investigation is the defensible next step.";
  let support = goalEvidence.length
    ? goalEvidence
    : evidence.slice(0, 1).map(e => e.id);
  if (contribution != null && contribution < 0) {
    driver = "contribution";
    support = ref("contribution_per_order_cents");
    diagnosis =
      "Recorded variable costs exceed revenue per order. Additional volume could increase contribution losses; inspect price and fulfillment costs before scaling.";
  } else if (cash != null && cash < 4) {
    driver = "cash_flow";
    support = ref("cash_runway_weeks");
    diagnosis =
      "The observed cash runway is short. Protect near-term cash while comparing collections and cost reductions.";
  } else if (capacity != null && capacity <= 0) {
    driver = "capacity";
    support = ref("available_capacity");
    diagnosis =
      "Configured available capacity is exhausted. Validate fulfillment constraints before adding demand.";
  } else if (
    sample != null &&
    repeat != null &&
    sample >= 20 &&
    repeat >= 0 &&
    repeat <= sample &&
    repeat / sample < 0.3
  ) {
    driver = "retention";
    support = [
      ...ref("mature_cohort_customers"),
      ...ref("mature_cohort_repeat_customers"),
    ];
    diagnosis =
      "Few customers in the observed mature cohort purchased again. Retention is a plausible constraint; investigate service and repeat-purchase barriers before increasing acquisition.";
  } else if (
    sample != null &&
    repeat != null &&
    sample >= 20 &&
    repeat <= sample &&
    repeat / sample >= 0.7 &&
    demand != null &&
    needed != null &&
    demand < needed
  ) {
    driver = "acquisition";
    support = [
      ...ref("mature_cohort_customers"),
      ...ref("mature_cohort_repeat_customers"),
      ...ref("qualified_demand"),
      ...ref("required_qualified_demand"),
    ];
    diagnosis =
      "Observed repeat purchasing is strong while qualified demand is below the recorded requirement. Acquisition is a plausible constraint.";
  }
  const contradicted = input.outcomes.filter(
    o =>
      o.result === "contradicted" &&
      byId.get(o.evidenceRef)?.classification === "verified" &&
      byId.get(o.evidenceRef)?.quality === "complete"
  );
  const revisitingFailedHypothesis = contradicted.some(
    o => o.actionDriver === driver
  );
  if (revisitingFailedHypothesis) {
    support = [
      ...support,
      ...contradicted
        .filter(o => o.actionDriver === driver)
        .map(o => o.evidenceRef),
    ];
    driver = "investigation";
    diagnosis =
      "Verified outcomes contradicted the earlier approach. Reassess the mechanism and customer evidence before repeating that experiment.";
  }
  const labels: Record<string, [string, string]> = {
    contribution: [
      "Audit price and variable cost on a bounded order sample",
      "Compare a reversible price test with fulfillment cost reduction",
    ],
    capacity: [
      "Audit the fulfillment bottleneck and recover usable capacity",
      "Compare scheduling changes with a limited capacity expansion",
    ],
    cash_flow: [
      "Review overdue collections and the short-term cash calendar",
      "Compare discretionary cost deferral with faster collections",
    ],
    retention: [
      "Investigate first-to-second-purchase barriers",
      "Prepare a bounded reactivation test for eligible customers",
    ],
    acquisition: [
      "Test a qualified customer segment within the operating market",
      "Improve conversion of existing qualified demand",
    ],
    investigation: [
      "Audit missing business drivers and customer evidence",
      "Observe the next reporting period before making a growth bet",
    ],
  };
  let [chosen, alternative] = labels[driver]!;
  if (revisitingFailedHypothesis) {
    chosen =
      "Review the contradicted strategic hypothesis and compare a different mechanism";
    alternative =
      "Repeat the earlier approach only after resolving its failed assumptions";
  }
  if (input.verticalKey === "software" && driver === "retention") {
    chosen = "Investigate activation and subscription renewal barriers";
    alternative =
      "Prepare a bounded product-value experiment for an eligible software cohort";
  }
  const options: StrategyOption[] = [chosen, alternative].map(
    (approach, i) => ({
      id: `option-${i + 1}`,
      approach,
      driver,
      evidenceRefs: support,
      economics:
        contribution == null
          ? "Contribution margin, gross profit, and cash-flow impact are unknown; revenue is not profit."
          : `Observed contribution per order: ${contribution} cents; fixed costs and cash timing remain distinct.`,
      cost:
        i === 0
          ? "No paid expansion proposed; any cost requires a separate budget and approval."
          : "Incremental cost is unmeasured; gather a bounded estimate before approval.",
      effort:
        i === 0
          ? "One desk investigation using existing records."
          : "Additional operator effort and customer eligibility need confirmation.",
      timeToResults:
        "Review at the next weekly cycle; causal results may take longer.",
      capacity:
        capacity == null
          ? "Capacity unknown; do not presume ability to absorb more demand."
          : `${capacity} configured units available; confirm current reservations.`,
      risk:
        i === 0
          ? "Small samples and incomplete attribution can mislead."
          : "May consume cash or scarce operating time without validating the cause.",
      reversibility:
        "Preparation is reversible; no spend, contact, or commitment is authorized by this recommendation.",
      eligible: i === 0 || driver === "investigation",
      reason:
        i === 0
          ? "Tests the central uncertainty with limited commitment."
          : "Kept as an alternative; validate economics and mechanism before selection.",
    })
  );
  const action: StrategyAction = {
    id: `strategy-${driver}`,
    title: chosen,
    driver,
    motion:
      driver === "retention"
        ? "retention"
        : driver === "acquisition"
          ? "account_acquisition"
          : "investigation",
    hypothesis:
      driver === "investigation"
        ? "Resolving missing driver evidence will distinguish the competing explanations."
        : `${driver} is the pivotal constraint; this audit can test that explanation.`,
    rationale: diagnosis,
    completionCondition:
      "Prepare one written comparison from at least five eligible records (or every available record if fewer), with source references, missing fields, and a next-test decision.",
    leadingIndicator:
      "Eligible source records reviewed and missing fields resolved.",
    intendedOutcome: `A defensible next experiment toward: ${input.goal.statement}`,
    evidenceRefs: support,
    reviewCondition:
      "Review at the next weekly cycle; reject the hypothesis if the source records or verified outcomes contradict it.",
    territoryId: null,
  };
  const marketLabels = input.market.territories.map(t => t.label);
  const d: StrategicDiagnosis = {
    id: "",
    schemaVersion: 1,
    doctrineVersion: STRATEGY_DOCTRINE_VERSION,
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    verticalKey: input.verticalKey,
    businessDate: input.businessDate,
    generatedAt: input.now.toISOString(),
    goal: input.goal,
    currentCondition:
      input.goal.current == null
        ? "Goal progress is unobserved."
        : `Observed ${input.goal.metricKey}: ${input.goal.current}; operator target: ${input.goal.target}.`,
    primaryConstraint: driver,
    diagnosis,
    supportingEvidence: support,
    competingExplanations:
      driver === "retention"
        ? [
            "Service issues",
            "Normal purchasing cadence",
            "Cohort or identity coverage bias",
          ]
        : [
            "Demand quality",
            "Customer conversion or repeat behavior",
            "Pricing, fulfillment, or source coverage",
          ],
    options,
    selectedOptionId: options[0]!.id,
    selectedApproach: chosen,
    notPrioritized: [
      driver === "acquisition"
        ? "Broad untargeted expansion"
        : "Additional acquisition spending before the constraint is validated",
    ],
    economicAssumptions: [
      options[0]!.economics,
      "Account value estimates and completed tasks are not verified revenue or profit.",
    ],
    customerUnderstanding:
      "Observed transactions describe purchasing; buyer motives, discovery channels, alternatives, and repeat barriers need customer evidence.",
    localFit:
      input.market.mode === "online"
        ? "Online operating model; no physical service radius assumed."
        : marketLabels.length
          ? `Configured market: ${marketLabels.join("; ")}. Public prospect presence is not demonstrated demand.`
          : "Operating territory unresolved; no local targeting is proposed.",
    industryFit: industry
      ? `${input.verticalKey}: ${industry.economics.join("; ")}`
      : "Unsupported industry capabilities; universal investigation only.",
    actions: [action],
    successMeasures: [
      action.leadingIndicator,
      `Track ${input.goal.metricKey} from the same authoritative reader; assess contribution separately.`,
    ],
    revisionTrigger: action.reviewCondition,
    uncertainty: [
      "Diagnostic thresholds (20 observations, 30%/70% repeat, four-week cash runway) are versioned triage heuristics, not causal proof.",
      ...input.market.limitations,
      ...(!industry
        ? ["Industry metric readers unsupported."]
        : industry.limitations),
      ...(contribution == null
        ? [
            "Variable costs, gross profit, contribution, and cash flow are unmeasured.",
          ]
        : []),
      ...(input.commitments.length
        ? [
            "Existing obligations remain protected; strategic work must fit around them.",
          ]
        : []),
    ],
    evidence,
    market: input.market,
    outcomeRefs: input.outcomes
      .filter(o => byId.has(o.evidenceRef))
      .map(o => o.id),
    quality: {
      structuralErrors: [],
      judgment: "unreviewed",
      reasons: [
        "Structural validity does not certify strategic quality; independent review remains required.",
      ],
    },
  };
  d.id = `diagnosis_${createHash("sha256")
    .update(JSON.stringify({ ...d, generatedAt: undefined }))
    .digest("hex")
    .slice(0, 40)}`;
  d.quality.structuralErrors = validateStrategicDiagnosis(d);
  return d;
}
