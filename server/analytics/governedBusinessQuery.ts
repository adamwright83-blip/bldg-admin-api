import { createHash } from "node:crypto";
import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import { getDashboardTimeZone } from "../dashboardZoned";
import { addressScope, buildingScope, lineageScope, normalizeUtterance } from "../claire/business/businessLanguage";
import { businessToday, freezePeriod, isValidYmd, parsePeriodPhrase, previousPeriod, resolvePeriod, type PeriodSpec } from "./businessPeriods";
import { defaultBusinessQuery, runBusinessQuery, type BusinessQuery, type BusinessQueryResult } from "./businessQuery";
import { evaluateGovernedMetricExpression, GovernedMetricError, type MetricExpression, type MetricObservation } from "./governedMetricExpression";
import { METRICS } from "./metricRegistry";

/** A server-authorized query plan. The model chooses criteria and arithmetic;
 * observations, units, receipts, coverage and every calculated number are owned
 * by this adapter and the existing canonical business reader. */
export type GovernedBusinessPlan = {
  version: 1;
  observations: Array<{ key: string; metricId: string; period: "current" | "previous" | PeriodSpec }>;
  outputs: Array<{ key: string; expression: MetricExpression }>;
};

export type GovernedCalculationCell = {
  key: string;
  label: string;
  value: number | null;
  unit: string | null;
  precision: "exact" | "recorded_only" | "missing";
  reason: string | null;
  sourceRefs: string[];
  periods: Array<{ start: string; end: string }>;
};

export type GovernedCalculation = {
  version: 1;
  tenantId: string;
  observationReference: string;
  scopeReference: string;
  cells: GovernedCalculationCell[];
  observations: Array<{ key: string; metricId: string; value: number | null; precision: GovernedCalculationCell["precision"]; reason: string | null; sourceRef: string | null }>;
};

type ObservationRead = { observation: MetricObservation | null; precision: GovernedCalculationCell["precision"]; reason: string | null };
const digest = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
const KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const ADAPTERS: Record<string, { metric: BusinessQuery["metric"]; minOrders?: number; field: string }> = {
  revenue_paid_stripe: { metric: "revenue", field: "revenueCents" },
  orders_paid: { metric: "orders", field: "orderCount" },
  avg_order_value: { metric: "aov", field: "aovCents" },
  active_customer_count: { metric: "active_customers", field: "count" },
  repeat_customer_count: { metric: "active_customers", minOrders: 2, field: "count" },
  new_customer_count: { metric: "new_customers", field: "count" },
  refund_paid: { metric: "revenue", field: "refundCents" },
  credits_used: { metric: "revenue", field: "creditCents" },
  discounts: { metric: "revenue", field: "discountCents" },
};

function expressionKeys(expression: MetricExpression, keys = new Set<string>(), depth = 0, count = { value: 0 }): Set<string> {
  if (!expression || typeof expression !== "object" || ++count.value > 32 || depth > 12) throw new GovernedMetricError("BAD_EXPRESSION", "Metric expression is too large or malformed");
  if (expression.kind === "observation") {
    if (typeof expression.key !== "string" || !KEY.test(expression.key)) throw new GovernedMetricError("BAD_EXPRESSION", "Invalid observation key");
    keys.add(expression.key);
  } else if (expression.kind === "divide") {
    expressionKeys(expression.numerator, keys, depth + 1, count);
    expressionKeys(expression.denominator, keys, depth + 1, count);
  } else if (expression.kind === "percent_change") {
    expressionKeys(expression.current, keys, depth + 1, count);
    expressionKeys(expression.previous, keys, depth + 1, count);
  } else if (expression.kind === "percent") expressionKeys(expression.expression, keys, depth + 1, count);
  else if (["add", "subtract", "difference", "multiply"].includes(expression.kind)) {
    const binary = expression as Extract<MetricExpression, { left: MetricExpression }>;
    expressionKeys(binary.left, keys, depth + 1, count);
    expressionKeys(binary.right, keys, depth + 1, count);
  } else throw new GovernedMetricError("BAD_EXPRESSION", "Unknown expression operation");
  return keys;
}

function validatePeriod(period: PeriodSpec): void {
  if (!period || typeof period !== "object") throw new GovernedMetricError("BAD_VALUE", "Invalid period");
  if (period.kind === "between" && (!isValidYmd(period.start) || !isValidYmd(period.end) || period.start > period.end)) throw new GovernedMetricError("BAD_VALUE", "Invalid calendar period");
  if (period.kind === "since" && !isValidYmd(period.start)) throw new GovernedMetricError("BAD_VALUE", "Invalid calendar date");
  if (period.kind === "trailing_days" && (!Number.isInteger(period.days) || period.days < 1 || period.days > 3660)) throw new GovernedMetricError("BAD_VALUE", "Invalid trailing period");
  if (!["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_year", "last_year", "trailing_days", "between", "since", "all_time"].includes(period.kind)) throw new GovernedMetricError("BAD_VALUE", "Unknown calendar period");
}

function observationPeriod(query: BusinessQuery, requested: GovernedBusinessPlan["observations"][number]["period"], now: Date, timeZone: string): PeriodSpec {
  if (requested === "current") return query.period;
  if (requested === "previous") return query.comparison && query.comparison !== "previous" ? query.comparison : freezePeriod(previousPeriod(resolvePeriod(query.period, now, timeZone), now));
  validatePeriod(requested);
  return requested;
}

function expressionLabel(expression: MetricExpression, observations: GovernedBusinessPlan["observations"]): string {
  if (expression.kind === "observation") {
    const item = observations.find(item => item.key === expression.key);
    return item ? METRICS[item.metricId]?.label ?? item.metricId.replace(/_/g, " ") : "Unavailable observation";
  }
  if (expression.kind === "percent") return `Percentage of (${expressionLabel(expression.expression, observations)})`;
  if (expression.kind === "divide") return `(${expressionLabel(expression.numerator, observations)}) per (${expressionLabel(expression.denominator, observations)})`;
  if (expression.kind === "percent_change") return `Percent change in (${expressionLabel(expression.current, observations)})`;
  const op = expression.kind === "add" ? "+" : expression.kind === "multiply" ? "×" : "−";
  return `(${expressionLabel(expression.left, observations)} ${op} ${expressionLabel(expression.right, observations)})`;
}

export async function runGovernedBusinessPlan(input: {
  tenantId: string;
  query: BusinessQuery;
  now: Date;
  timeZone: string;
  runQuery?: (tenantId: string, query: BusinessQuery) => Promise<BusinessQueryResult>;
}): Promise<GovernedCalculation> {
  const { tenantId, query, now, timeZone } = input;
  const plan = query.calculation;
  if (!tenantId.trim() || !plan || plan.version !== 1 || !Array.isArray(plan.observations) || !Array.isArray(plan.outputs) || plan.observations.length > 16 || plan.outputs.length < 1 || plan.outputs.length > 8) throw new GovernedMetricError("BAD_EXPRESSION", "Invalid governed metric plan");
  validatePeriod(query.period);
  const scopeReference = `business-scope:${digest({ filters: query.filters ?? null, filterUnion: query.filterUnion ?? null, serviceType: query.serviceType, customerName: query.customerName })}`;
  const keys = new Set<string>();
  for (const item of plan.observations) {
    if (!item || !KEY.test(item.key) || keys.has(item.key) || typeof item.metricId !== "string" || item.metricId.length > 128) throw new GovernedMetricError("BAD_EXPRESSION", "Invalid or duplicate observation key");
    keys.add(item.key);
  }
  for (const output of plan.outputs) {
    if (!output || !KEY.test(output.key)) throw new GovernedMetricError("BAD_EXPRESSION", "Invalid output key");
    for (const key of expressionKeys(output.expression)) if (!keys.has(key)) throw new GovernedMetricError("MISSING_EVIDENCE", `Undefined observation: ${key}`);
  }
  const reads = new Map<string, Promise<BusinessQueryResult>>();
  const observations = new Map<string, ObservationRead>();
  await Promise.all(plan.observations.map(async item => {
    const adapter = Object.hasOwn(ADAPTERS, item.metricId) ? ADAPTERS[item.metricId] : null;
    if (!adapter) {
      observations.set(item.key, { observation: null, precision: "missing", reason: `No authorized source is connected for ${item.metricId.replace(/_/g, " ")}.` });
      return;
    }
    const period = observationPeriod(query, item.period, now, timeZone);
    validatePeriod(period);
    const resolved = resolvePeriod(period, now, timeZone);
    const observationQuery: BusinessQuery = { ...query, calculation: undefined, metric: adapter.metric, period, comparison: null, minOrders: adapter.minOrders ?? 1 };
    const readKey = digest(observationQuery);
    if (!reads.has(readKey)) reads.set(readKey, (input.runQuery ?? runBusinessQuery)(tenantId, observationQuery));
    try {
      const result = await reads.get(readKey)!;
      if (result.tenantId !== tenantId || result.period.start !== resolved.start || result.period.end !== resolved.end || digest(result.query) !== digest(observationQuery)) throw new GovernedMetricError("UNAUTHORIZED", "Canonical observation tenant, period or dimensions do not match the authorized query");
      if (result.status !== "ok" || !result.coverage?.observationReference) {
        observations.set(item.key, { observation: null, precision: "missing", reason: "Canonical business evidence is unavailable." });
        return;
      }
      let value: number | null = null;
      if (result.data.kind === "totals") {
        if (adapter.field === "revenueCents") value = result.data.current.revenueCents / 100;
        else if (adapter.field === "orderCount") value = result.data.current.orderCount;
        else if (adapter.field === "aovCents") value = result.data.current.aovCents == null ? null : result.data.current.aovCents / 100;
        else {
          const money = result.coverage.money;
          const amount = adapter.field === "refundCents" ? money?.refundCents : adapter.field === "creditCents" ? money?.creditCents : money?.discountCents;
          value = amount == null ? null : amount / 100;
        }
      } else if (result.data.kind === "customers") value = result.data.population.count;
      if (value == null || !Number.isFinite(value)) {
        observations.set(item.key, { observation: null, precision: "missing", reason: `The canonical source does not record ${METRICS[item.metricId].label.toLowerCase()} for this period and scope.` });
        return;
      }
      const canonical = result.coverage.canonicalRevenue;
      const exact = canonical?.mayStateExact === true && result.coverage.completeness === "complete" && (!result.data || result.data.kind !== "customers" || result.data.population.unmatchedCount === 0) && item.metricId !== "new_customer_count";
      // Recorded nonzero observations remain useful, but an unproven empty
      // source must never become a zero input to a ratio or financial claim.
      if (!exact && value === 0) {
        observations.set(item.key, { observation: null, precision: "missing", reason: "Source coverage cannot establish that this metric is zero." });
        return;
      }
      const staleCurrent = resolved.end >= businessToday(now, timeZone) && canonical?.cleanCloudFresh === false;
      observations.set(item.key, {
        precision: exact ? "exact" : "recorded_only",
        reason: exact ? null : item.metricId === "new_customer_count" ? "First observed in retained records; first-ever acquisition is not proven." : "Calculated from recorded inputs; complete source coverage is not proven.",
        observation: { metricId: item.metricId, tenantId, sourceRef: `canonical-metric:${digest({ tenantId, metricId: item.metricId, scopeReference, period: { start: resolved.start, end: resolved.end }, source: result.coverage.observationReference, value })}`,
          period: { start: resolved.start, end: resolved.end }, value, unit: METRICS[item.metricId].unit, verified: true, stale: staleCurrent, scopeRef: scopeReference },
      });
    } catch (error) {
      observations.set(item.key, { observation: null, precision: "missing", reason: error instanceof GovernedMetricError ? error.message : "Canonical business evidence could not be read." });
    }
  }));
  const cells: GovernedCalculationCell[] = plan.outputs.map(output => {
    const used = [...expressionKeys(output.expression)].map(key => observations.get(key)!);
    const admitted = Object.fromEntries([...observations].flatMap(([key, item]) => item.observation ? [[key, item.observation]] : []));
    const periods = [...new Map(used.flatMap(item => item.observation ? [[JSON.stringify(item.observation.period), item.observation.period] as const] : [])).values()];
    const base = { key: output.key, label: expressionLabel(output.expression, plan.observations), periods };
    try {
      const missing = used.filter(item => !item.observation);
      if (missing.length) return { ...base, value: null, unit: null, precision: "missing", sourceRefs: [], reason: [...new Set(missing.map(item => item.reason))].join(" ") };
      const value = evaluateGovernedMetricExpression({ tenantId, expression: output.expression, observations: admitted });
      return { ...base, value: value.value, unit: value.unit, precision: used.every(item => item.precision === "exact") ? "exact" : "recorded_only", sourceRefs: value.sourceRefs, reason: [...new Set(used.map(item => item.reason).filter(Boolean))].join(" ") || null };
    } catch (error) {
      return { ...base, value: null, unit: null, precision: "missing", sourceRefs: [], reason: error instanceof Error ? error.message : "Governed calculation is unavailable." };
    }
  });
  return { version: 1, tenantId, scopeReference, observationReference: `governed-calculation:${digest({ tenantId, scopeReference, plan, cells })}`, cells,
    observations: plan.observations.map(item => { const read = observations.get(item.key)!; return { key: item.key, metricId: item.metricId, value: read.observation?.value ?? null, precision: read.precision, reason: read.reason, sourceRef: read.observation?.sourceRef ?? null }; }) };
}

export function isGovernedCalculationQuestion(question: string): boolean {
  const lower = normalizeUtterance(question);
  if (/\b(?:remind me|add (?:a |an )?(?:task|reminder)|schedule|put .*day ?line|send|text|email|call)\b/.test(lower) && !/\bcalculate\b/.test(lower)) return false;
  return /\b(?:divided by|minus|subtract|multiplied by|times the|ratio|percentage of|percent of|per (?:paying |active |repeat )?customers?|revenue per|repeat (?:rate|percentage)|refund rate|calculate|formula)\b/.test(lower) ||
    /\b(?:revenue|sales|orders|customers|aov|refunds)\b.*\band\b.*\b(?:revenue|sales|orders|customers|aov|refunds)\b/.test(lower);
}

const ref = (key: string): MetricExpression => ({ kind: "observation", key });
function simplePlan(question: string): GovernedBusinessPlan | null {
  const lower = normalizeUtterance(question);
  const ratio = /\b(?:repeat (?:rate|percentage)|refund rate)\b/.test(lower);
  if (ratio) return { version: 1, observations: [{ key: "part", metricId: /refund/.test(lower) ? "refund_paid" : "repeat_customer_count", period: "current" }, { key: "whole", metricId: /refund/.test(lower) ? "revenue_paid_stripe" : "active_customer_count", period: "current" }], outputs: [{ key: "ratio", expression: { kind: "percent", expression: { kind: "divide", numerator: ref("part"), denominator: ref("whole") } } }] };
  if (/\b(revenue|sales)\b.*\b(?:per|divided by)\b.*\bcustomers?\b/.test(lower)) return { version: 1, observations: [{ key: "revenue", metricId: "revenue_paid_stripe", period: "current" }, { key: "customers", metricId: "active_customer_count", period: "current" }], outputs: [{ key: "per_customer", expression: { kind: "divide", numerator: ref("revenue"), denominator: ref("customers") } }] };
  return null;
}

const plannerShape = z.object({
  nodes: z.array(z.object({ key: z.string(), kind: z.enum(["metric", "add", "subtract", "difference", "multiply", "divide", "percent_change", "percent"]), metricId: z.string(), period: z.enum(["current", "previous"]), left: z.string(), right: z.string() })).min(1).max(32),
  outputs: z.array(z.string()).min(1).max(8),
});

/** Flat bounded DAG schema avoids unbounded recursive model outputs. No SQL,
 * values, tenant IDs or source receipts are accepted from the planner. */
export async function planGovernedBusinessQuestion(input: { question: string; previous?: BusinessQuery | null; now?: Date; timeZone?: string; invoke?: typeof invokeLLM }): Promise<BusinessQuery | null> {
  if (!isGovernedCalculationQuestion(input.question)) return null;
  const now = input.now ?? new Date(), timeZone = input.timeZone ?? getDashboardTimeZone();
  const lower = normalizeUtterance(input.question);
  const periodText = lower.split(/\b(?:versus|vs\.?|compared (?:with|to))\b/)[0]!;
  const period = parsePeriodPhrase(periodText, now, timeZone) ?? input.previous?.period ?? { kind: "trailing_days" as const, days: 30 };
  const lineage = lineageScope(lower, false), buildings = buildingScope(lower), address = addressScope(lower);
  const filters = lineage || buildings || address ? { ...lineage, ...(buildings?.include ? { includeBuildings: buildings.include } : {}), ...(buildings?.exclude ? { excludeBuildings: buildings.exclude } : {}), ...address } : input.previous?.filters ?? null;
  const query: BusinessQuery = { ...defaultBusinessQuery("revenue"), period, filters, filterUnion: input.previous?.filterUnion ?? null, serviceType: /wash.{0,5}fold/.test(lower) ? "wash_fold" : /dry.clean/.test(lower) ? "dry_cleaning" : input.previous?.serviceType ?? null, comparison: /\b(?:versus|vs|compared|change|growth)\b/.test(lower) ? "previous" : null };
  let plan = simplePlan(input.question);
  if (!plan) {
    try {
      const response = await (input.invoke ?? invokeLLM)({ temperature: 0, maxTokens: 1400,
        outputSchema: { name: "governed_business_calculation", strict: true, schema: { type: "object", additionalProperties: false, required: ["nodes", "outputs"], properties: {
          nodes: { type: "array", items: { type: "object", additionalProperties: false, required: ["key", "kind", "metricId", "period", "left", "right"], properties: { key: { type: "string" }, kind: { type: "string", enum: ["metric", "add", "subtract", "difference", "multiply", "divide", "percent_change", "percent"] }, metricId: { type: "string" }, period: { type: "string", enum: ["current", "previous"] }, left: { type: "string" }, right: { type: "string" } } } }, outputs: { type: "array", items: { type: "string" } } } } },
        messages: [{ role: "system", content: `Translate the read-only business calculation to a bounded DAG. Available measures: ${Object.keys(ADAPTERS).join(", ")}. Signed refunds are negative, net paid revenue already includes them. Repeat customer count means at least two positive purchases in the period. New customer count means first observed in retained history. Any requested costs, profit inputs or unavailable measure MUST get a metric node with its precise missing metricId, never revenue as a substitute. Nodes reference earlier node keys. Empty fields use ''. Metric nodes use current or previous period; divide uses left numerator/right denominator; percent converts a ratio to percentage; difference compares periods, subtract requires same period; percent_change uses left current/right previous. Preserve EVERY requested calculation as an output. No values, literals, SQL, facts or estimates.` }, { role: "user", content: JSON.stringify({ question: input.question.slice(0, 1500), period, filters, previous: input.previous ?? null }) }],
      });
      const content = response.choices[0]?.message.content;
      const parsed = plannerShape.parse(JSON.parse(typeof content === "string" ? content : ""));
      const expressions = new Map<string, MetricExpression>();
      const observations: GovernedBusinessPlan["observations"] = [];
      for (const node of parsed.nodes) {
        if (!KEY.test(node.key) || expressions.has(node.key)) throw new Error("Invalid node key");
        if (node.kind === "metric") { observations.push({ key: node.key, metricId: node.metricId, period: node.period }); expressions.set(node.key, ref(node.key)); continue; }
        const left = expressions.get(node.left), right = expressions.get(node.right);
        if (!left || (node.kind !== "percent" && !right)) throw new Error("Invalid or cyclic expression reference");
        const expression: MetricExpression = node.kind === "divide" ? { kind: "divide", numerator: left, denominator: right! } : node.kind === "percent_change" ? { kind: "percent_change", current: left, previous: right! } : node.kind === "percent" ? { kind: "percent", expression: left } : { kind: node.kind, left, right: right! };
        expressionKeys(expression);
        expressions.set(node.key, expression);
      }
      // Language interpretation cannot erase a requested unavailable cost.
      if (/\b(?:costs?|labor|expenses?|profit|margin|rent|payroll)\b/.test(lower) && !observations.some(item => !Object.hasOwn(ADAPTERS, item.metricId))) throw new Error("Requested cost omitted by planner");
      plan = { version: 1, observations, outputs: parsed.outputs.map(key => { const expression = expressions.get(key); if (!expression) throw new Error("Unknown output"); return { key, expression }; }) };
    } catch {
      // A failed plan is a truthful unavailable result, never another metric.
      plan = { version: 1, observations: [{ key: "missing", metricId: /cost|labor|profit|margin|expense/.test(lower) ? "requested_cost_inputs" : "requested_calculation_plan", period: "current" }], outputs: [{ key: "unavailable", expression: ref("missing") }] };
    }
  }
  return { ...query, calculation: plan };
}
