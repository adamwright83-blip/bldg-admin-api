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
  /** Sales sources that were stale or unreadable for the comparison window. */
  sourceGaps?: { evidenceRef: string; description: string };
  /** The operator's durable objective and its neighborhood evidence, when stated. */
  focus?: {
    statement: string;
    area: string;
    evidenceRef: string;
    windowDays: number;
    sales: number | null;
    priorSales: number | null;
    orders: number | null;
    priorOrders: number | null;
    salesRef: string | null;
    dormant: number | null;
    dormantRef: string | null;
    dormantTop: Array<{ name: string; lastOrderDate: string | null; revenueCents: number }>;
    figuresVerified: boolean;
  };
  /** Sources current, but some orders are not payment-verified: figures are usable as recorded, never as confirmed. */
  recordedFigures?: { evidenceRef: string; description: string };
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
  const recordedValue = (key: string): number | null => {
    if (!industry?.metrics.includes(key)) return null;
    const e = byId.get(input.metrics[key] ?? "");
    return e && typeof e.value === "number" && Number.isFinite(e.value) &&
      (e.quality === "partial" || e.quality === "stale")
      ? e.value
      : null;
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
  const recordedUsable = Boolean(input.recordedFigures && byId.has(input.recordedFigures.evidenceRef));
  const recordedOrExact = (key: string) => metric(key) ?? (recordedUsable ? recordedValue(key) : null);
  const sales = recordedOrExact("net_sales_cents");
  const priorSales = recordedOrExact("prior_net_sales_cents");
  const orders = recordedOrExact("paid_orders");
  const priorOrders = recordedOrExact("prior_paid_orders");
  const aov = recordedOrExact("average_order_value_cents");
  const mtd = recordedOrExact("mtd_net_sales_cents");
  const priorMtd = recordedOrExact("prior_mtd_net_sales_cents");
  const newCustomers = recordedOrExact("new_customers_30d");
  const returningCustomers = recordedOrExact("returning_customers_30d");
  const dormant = metric("dormant_customers");
  const observed = describeObservedComparison({
    sales, priorSales, orders, priorOrders, aov, mtd, priorMtd,
    newCustomers, returningCustomers, dormant,
  });
  // Recorded but incomplete figures: shown only as labelled context, never decisive.
  const recorded = (key: string): number | null => {
    if (!industry?.metrics.includes(key)) return null;
    const e = byId.get(input.metrics[key] ?? "");
    return e && typeof e.value === "number" && Number.isFinite(e.value) &&
      (e.quality === "partial" || e.quality === "stale")
      ? e.value
      : null;
  };
  if (recordedUsable && observed.lines.length)
    observed.lines.unshift("Recorded sales (sources current; not all orders payment-verified):");
  const salesChange =
    sales != null && priorSales != null && priorSales > 0
      ? (sales - priorSales) / priorSales
      : null;
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
    salesChange != null &&
    salesChange <= -0.1 &&
    dormant != null &&
    dormant > 0
  ) {
    driver = "retention";
    support = [
      ...ref("net_sales_cents"),
      ...ref("prior_net_sales_cents"),
      ...ref("dormant_customers"),
      ...ref("returning_customers_30d"),
      ...(recordedUsable ? [input.recordedFigures!.evidenceRef] : []),
    ];
    diagnosis = `Recorded sales fell ${pct(salesChange)} against the prior 30 days while ${dormant} previously active customers are dormant. Recovering known buyers is the most direct, observable lever; the cause of the decline is not yet established.`;
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
  const sourceGap =
    driver === "investigation" && input.sourceGaps && byId.has(input.sourceGaps.evidenceRef)
      ? input.sourceGaps
      : null;
  const recordedView = sourceGap
    ? describeObservedComparison({
        sales: recorded("net_sales_cents"), priorSales: recorded("prior_net_sales_cents"),
        orders: recorded("paid_orders"), priorOrders: recorded("prior_paid_orders"),
        aov: null, mtd: recorded("mtd_net_sales_cents"), priorMtd: recorded("prior_mtd_net_sales_cents"),
        newCustomers: recorded("new_customers_30d"), returningCustomers: recorded("returning_customers_30d"),
        dormant,
      })
    : null;
  if (sourceGap) {
    support = [sourceGap.evidenceRef];
    diagnosis = `Sales data is incomplete: ${sourceGap.description}. Recorded figures cannot show whether sales fell or the data stopped arriving, so no growth driver can be isolated until the source is restored.`;
  }
  // The operator's stated objective outranks generic triage unless the business
  // has a hard constraint (negative contribution, cash, capacity) or data outage.
  const focusPlan =
    input.focus && !input.sourceGaps && !["contribution", "cash_flow", "capacity"].includes(driver)
      ? planForObjective(input.focus, aov, byId)
      : null;
  if (focusPlan) {
    driver = focusPlan.driver;
    diagnosis = focusPlan.diagnosis;
    support = focusPlan.support;
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
    retention:
      dormant != null && dormant > 0 && salesChange != null && salesChange <= -0.1 && !revisitingFailedHypothesis
        ? [
            "Contact eligible dormant customers with a bounded recovery offer",
            "Acquire new customers to replace lost volume",
          ]
        : [
            "Investigate first-to-second-purchase barriers",
            "Prepare a bounded reactivation test for eligible customers",
          ],
    acquisition: [
      "Test a qualified customer segment within the operating market",
      "Improve conversion of existing qualified demand",
    ],
    investigation: sourceGap
      ? [
          "Restore the stale sales data source, then re-run the sales comparison",
          "Act now on the incomplete recorded figures",
        ]
      : [
          "Audit missing business drivers and customer evidence",
          "Observe the next reporting period before making a growth bet",
        ],
  };
  let [chosen, alternative] = focusPlan ? [focusPlan.chosen, focusPlan.alternative] : labels[driver]!;
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
  const recovery =
    driver === "retention" && !revisitingFailedHypothesis &&
    dormant != null && dormant > 0 && salesChange != null && salesChange <= -0.1;
  enrichOptions(options, driver, { aov, dormant, newCustomers, returningCustomers, capacity, observed, recovery, sourceGap, recordedView });
  if (focusPlan && !revisitingFailedHypothesis) {
    Object.assign(options[0]!, focusPlan.chosenFields, { eligible: true });
    Object.assign(options[1]!, focusPlan.altFields);
  }
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
    completionCondition: focusPlan || recovery
      ? options[0]!.nextMeasurableAction!
      : "Prepare one written comparison from at least five eligible records (or every available record if fewer), with source references, missing fields, and a next-test decision.",
    leadingIndicator: focusPlan
      ? focusPlan.leadingIndicator
      : recovery
      ? "Consented recovery contacts prepared; replies and orders recorded."
      : "Eligible source records reviewed and missing fields resolved.",
    intendedOutcome: `A defensible next experiment toward: ${input.focus?.statement ?? input.goal.statement}`,
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
    ...(input.focus ? { objective: { statement: input.focus.statement, area: input.focus.area } } : {}),
    currentCondition:
      (focusPlan ? `${focusPlan.condition} ` : "") +
      (input.goal.current == null
        ? "Goal progress is unobserved."
        : `Observed ${input.goal.metricKey}: ${input.goal.current}; operator target: ${input.goal.target}.`) +
      (observed.lines.length ? ` ${observed.lines.join(" ")}` : ""),
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
      ...evidence
        .filter(e => e.source === "analyzeBusinessData")
        .map(
          e =>
            `Analytical research (model interpretation, not causal proof): ${e.description} [${e.id}]`
        ),
      ...evidence
        .filter(e => e.source === "analyzeBusinessData")
        .map(
          e =>
            `Analytical research (model interpretation, not causal proof): ${e.description} [${e.id}]`
        ),
      ...evidence
        .filter(e => e.source === "analyzeBusinessData")
        .map(
          e =>
            `Analytical research (model interpretation, not causal proof): ${e.description} [${e.id}]`
        ),
      ...input.market.limitations,
      ...(!industry
        ? ["Industry metric readers unsupported."]
        : industry.limitations),
      ...observed.missing.map(m => `${m} is unmeasured.`),
      ...(focusPlan ? focusPlan.uncertainty : []),
      ...(recordedUsable ? [`${input.recordedFigures!.description}.`] : []),
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

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const pct = (ratio: number) => `${Math.abs(Math.round(ratio * 100))}%`;

type ObservedFigures = {
  sales: number | null; priorSales: number | null;
  orders: number | null; priorOrders: number | null;
  aov: number | null; mtd: number | null; priorMtd: number | null;
  newCustomers: number | null; returningCustomers: number | null;
  dormant: number | null;
};

/** States only comparisons whose both sides were observed; names what is missing. */
export function describeObservedComparison(f: ObservedFigures) {
  const lines: string[] = [];
  const missing: string[] = [];
  const change = (now: number, before: number) =>
    before > 0 ? `${now >= before ? "up" : "down"} ${pct((now - before) / before)}` : "no prior base";
  if (f.sales != null && f.priorSales != null)
    lines.push(`Recorded sales last 30 days ${dollars(f.sales)} vs ${dollars(f.priorSales)} the prior 30 (${change(f.sales, f.priorSales)}).`);
  else missing.push("Prior-period sales comparison");
  if (f.orders != null && f.priorOrders != null)
    lines.push(`Paid orders ${f.orders} vs ${f.priorOrders}.`);
  if (f.mtd != null && f.priorMtd != null)
    lines.push(`Month-to-date ${dollars(f.mtd)} vs ${dollars(f.priorMtd)} at the same point last month.`);
  else missing.push("Month-to-date comparison");
  if (f.newCustomers != null && f.returningCustomers != null)
    lines.push(`${f.newCustomers} new and ${f.returningCustomers} returning customers in the last 30 days.`);
  else missing.push("New versus returning customer mix");
  if (f.dormant != null) lines.push(`${f.dormant} dormant customers are recovery candidates.`);
  else missing.push("Dormant customer count");
  return { lines, missing };
}

function enrichOptions(
  options: StrategyOption[],
  driver: BusinessDriver,
  f: {
    aov: number | null; dormant: number | null;
    newCustomers: number | null; returningCustomers: number | null;
    capacity: number | null; observed: ReturnType<typeof describeObservedComparison>;
    recovery: boolean;
    sourceGap: { description: string } | null;
    recordedView: ReturnType<typeof describeObservedComparison> | null;
  }
) {
  const basis = f.observed.lines.join(" ") || "No comparable-period figures were observed.";
  const perOrder = (n: number) =>
    f.aov == null
      ? "Average order value is unobserved, so no sales arithmetic is stated."
      : `${n} additional order${n === 1 ? "" : "s"} at the observed average of ${dollars(f.aov)} is about ${dollars(n * f.aov)} recorded sales (arithmetic on an average, not a forecast or profit).`;
  for (const [i, o] of options.entries()) {
    o.observedBasis = basis;
    if (f.sourceGap) {
      o.observedBasis = f.recordedView?.lines.length
        ? `Recorded, incomplete: ${f.recordedView.lines.join(" ")}`
        : basis;
      if (i === 0) {
        o.expectedBenefit = "Makes the sales comparison decision-grade; no sales effect is claimed.";
        o.uncertainty = `${f.sourceGap.description}.`;
        o.nextMeasurableAction = "Restore source access and confirm one successful import covering the missing days, then re-run Claire's comparison.";
        o.reason = "Preferred: an apparent sales drop may be missing data, and acting on it could target the wrong problem.";
      } else {
        o.expectedBenefit = "Cannot be sized: the recorded figures are incomplete.";
        o.uncertainty = "Any decline shown may be a data gap rather than lost customers.";
        o.nextMeasurableAction = "Only after restoring data: compare recovered figures with the prior period.";
        o.reason = "Not preferred: acting on incomplete figures risks chasing a drop that did not happen.";
      }
    } else if (f.recovery) {
      const n = Math.min(5, f.dormant!);
      if (i === 0) {
        o.expectedBenefit = `If ${n} of ${f.dormant} dormant customers each place one order: ${perOrder(n)}`;
        o.uncertainty = "Reply and return rates for this business are unobserved; consent and eligibility may reduce the reachable list.";
        o.nextMeasurableAction = `Prepare ${n} consented recovery contacts and record replies and orders within 14 days.`;
        o.reason = "Preferred: known buyers with an existing relationship, measurable within one cycle, and no acquisition spend.";
      } else {
        o.expectedBenefit = f.newCustomers == null
          ? "New-customer volume is unobserved; benefit cannot be sized."
          : `Last 30 days brought ${f.newCustomers} new customer${f.newCustomers === 1 ? "" : "s"}. ${perOrder(1)}`;
        o.uncertainty = "Acquisition cost and conversion are unmeasured.";
        o.nextMeasurableAction = "Record acquisition cost per new customer before committing spend.";
        o.reason = "Not preferred now: replacing lost buyers with new ones costs more and leaves the dormant base unexplained.";
      }
    } else {
      o.expectedBenefit ??= i === 0
        ? "Resolves the central uncertainty; no direct sales effect is claimed."
        : "Benefit cannot be sized until the preferred investigation reports.";
      o.uncertainty ??= f.observed.missing.length
        ? `Missing: ${f.observed.missing.join(", ")}.`
        : "Causal effect remains unproven.";
      o.nextMeasurableAction ??= i === 0
        ? "Review at least five eligible source records and record the next-test decision."
        : "Re-evaluate after the preferred action reports.";
    }
    if (f.capacity != null && f.capacity <= 0)
      o.uncertainty += " Configured capacity is exhausted; added orders may not be serviceable.";
  }
}

type Focus = NonNullable<DiagnosisInput["focus"]>;

/** Pure: competing options for the operator's neighborhood objective, from observed figures only. */
export function planForObjective(focus: Focus, businessAov: number | null, byId: Map<string, unknown>) {
  const area = focus.area;
  const unverified = focus.figuresVerified ? "" : " (recorded; not all orders payment-verified)";
  const change =
    focus.sales != null && focus.priorSales != null && focus.priorSales > 0
      ? (focus.sales - focus.priorSales) / focus.priorSales
      : null;
  const areaAov = focus.sales != null && focus.orders ? focus.sales / focus.orders : businessAov;
  const salesLine =
    focus.sales != null && focus.priorSales != null
      ? `${area} recorded sales were ${dollars(focus.sales)} over the last ${focus.windowDays} days vs ${dollars(focus.priorSales)} the prior ${focus.windowDays}${
          change == null ? "" : ` (${change < 0 ? "down" : "up"} ${pct(change)})`
        }, ${focus.orders} vs ${focus.priorOrders} orders${unverified}.`
      : `${area} sales could not be measured.`;
  const dormantLine =
    focus.dormant != null ? ` ${focus.dormant} ${area} customers who ordered before have not ordered in the last 60 days.` : "";
  const condition = `Your objective: ${focus.statement}. ${salesLine}${dormantLine}`;
  const support = [focus.evidenceRef, focus.salesRef, focus.dormantRef].filter(
    (r): r is string => Boolean(r && byId.has(r))
  );
  const profit = "Profitability can't be judged yet: contribution per order is unmeasured, so this targets recorded sales.";
  const worth = (n: number) =>
    areaAov == null
      ? "Order value is unmeasured, so no sales arithmetic is stated."
      : `${n} returning order${n === 1 ? "" : "s"} at the ${area} average of ${dollars(areaAov)} is about ${dollars(n * areaAov)} in recorded sales (arithmetic, not a forecast).`;
  const outreach = `Find new ${area} customers through building and door outreach`;
  if (focus.dormant != null && focus.dormant > 0) {
    const n = Math.min(5, focus.dormant);
    const names = focus.dormantTop.slice(0, n).map(c => c.name).filter(Boolean);
    const who = names.length
      ? `${names.join(", ")} — your ${names.length} highest-spending lapsed ${area} customers`
      : `the ${n} highest-spending lapsed ${area} customers`;
    return {
      driver: "retention" as BusinessDriver,
      condition,
      support,
      diagnosis: `For "${focus.statement}", the fastest evidence-backed lever is winning back the ${focus.dormant} lapsed ${area} customers before spending effort on new ones.`,
      chosen: `Win back lapsed ${area} customers`,
      alternative: outreach,
      leadingIndicator: "Win-back contacts made; replies and returning orders recorded.",
      uncertainty: [profit, "Why these customers stopped ordering is unknown; ask when you contact them."],
      chosenFields: {
        observedBasis: condition,
        reason: `Preferred: ${focus.dormant} ${area} customers already know the service, so a few returning is the quickest measurable lift toward your objective, with no acquisition spend.`,
        expectedBenefit: `If ${n} return once: ${worth(n)}`,
        uncertainty: `Return rate is unobserved. ${profit}`,
        nextMeasurableAction: `Contact ${who} with a return offer you approve; record replies and orders within 14 days.`,
      },
      altFields: {
        observedBasis: condition,
        reason: `Not preferred first: new ${area} customers take more time and effort to win, and the lapsed ones are a cheaper, untested lever. Do this next if win-backs stall.`,
        expectedBenefit: `Each new ${area} order is worth about ${areaAov == null ? "an unmeasured amount" : dollars(areaAov)}.`,
        uncertainty: "Conversion of new buildings or doors is unmeasured.",
        nextMeasurableAction: `Pick one ${area} building and log outreach and responses.`,
      },
    };
  }
  return {
    driver: "acquisition" as BusinessDriver,
    condition,
    support,
    diagnosis: `${salesLine} No lapsed ${area} customers are recorded, so growth has to come from new customers.`,
    chosen: outreach,
    alternative: `Raise order frequency of current ${area} customers`,
    leadingIndicator: "Outreach logged; new orders recorded.",
    uncertainty: [profit],
    chosenFields: {
      observedBasis: condition,
      reason: `Preferred: with no lapsed ${area} customers to win back, new customers are the available lever.`,
      expectedBenefit: `Each new ${area} order is worth about ${areaAov == null ? "an unmeasured amount" : dollars(areaAov)}.`,
      uncertainty: "Conversion is unmeasured.",
      nextMeasurableAction: `Pick one ${area} building and log outreach and responses this week.`,
    },
    altFields: {
      observedBasis: condition,
      reason: `Not preferred first: current ${area} customers are few, so frequency gains are small.`,
      expectedBenefit: worth(1),
      uncertainty: "Order cadence is unmeasured.",
      nextMeasurableAction: `Ask current ${area} customers about a regular pickup day.`,
    },
  };
}
