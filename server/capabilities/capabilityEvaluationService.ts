import { and, eq, gte, sql } from "drizzle-orm";
import { dayforgeSaasMemberships, dayforgeSaasTenantLocations, orders } from "../../drizzle/schema";
import { deterministicEstimate, sourcedFact, unknownValue } from "../../shared/businessGame";
import { getDb } from "../db";
import { listCustomerAssets } from "../customerAssets/customerAssetProjection";
import { getTruePnlCockpitSummary } from "../truePnlCockpit";
import type { CapabilityEvaluation } from "./capabilityTypes";

export type FirstHireInputs = {
  activeNonOwnerMembers: number;
  utilizationPct: number | null;
  profitableDeclinedDemandCents: number | null;
  marginPct: number | null;
  reserveMonths: number | null;
  recurringWorkloadPct: number | null;
  scheduleSaturationPct: number | null;
  trailingDemandRevenueCents: number | null;
};

const POLICY = {
  utilizationPct: 80,
  profitableDeclinedDemandCents: 1,
  marginPct: 20,
  reserveMonths: 3,
  recurringWorkloadPct: 30,
  scheduleSaturationPct: 75,
} as const;

export function evaluateFirstHireReadiness(input: FirstHireInputs, now = new Date()): CapabilityEvaluation {
  const checks = [
    ["utilizationPct", input.utilizationPct, POLICY.utilizationPct, ">= 80% booked production capacity"],
    ["profitableDeclinedDemandCents", input.profitableDeclinedDemandCents, POLICY.profitableDeclinedDemandCents, "> $0 documented profitable declined demand"],
    ["marginPct", input.marginPct, POLICY.marginPct, ">= 20% trusted true-net margin"],
    ["reserveMonths", input.reserveMonths, POLICY.reserveMonths, ">= 3 months recurring hire cost in reserve"],
    ["recurringWorkloadPct", input.recurringWorkloadPct, POLICY.recurringWorkloadPct, ">= 30% recurring workload"],
    ["scheduleSaturationPct", input.scheduleSaturationPct, POLICY.scheduleSaturationPct, ">= 75% schedule saturation"],
  ] as const;
  const missing = checks.filter(([, actual]) => actual == null).map(([metric]) => metric);
  const passed = checks.filter(([, actual, threshold]) => actual != null && actual >= threshold).length;
  const blockingConditions = checks.filter(([, actual, threshold]) => actual == null || actual < threshold).map(([metric, actual, , label]) => actual == null ? `${metric} is unavailable` : `${metric} does not meet policy: ${label}`);
  const status = input.activeNonOwnerMembers > 0 ? "ACTIVE" : missing.length ? "LOCKED" : passed === checks.length ? "READY" : passed >= 3 ? "APPROACHING" : "LOCKED";
  return {
    capability: "FIRST_HIRE_READY", status, evaluatedAt: now.toISOString(), confidence: missing.length ? "low" : "high",
    evidence: checks.map(([metric, actual, threshold, label]) => ({ metric, actual: actual == null ? unknownValue(`${metric} unavailable`) : deterministicEstimate(actual, "capability input adapter", "high"), policyThreshold: label, passes: actual == null ? null : actual >= threshold })),
    blockingConditions: status === "ACTIVE" ? [] : blockingConditions,
    supportingMetrics: { ...input },
    assumptions: ["Readiness policy v1 is conservative and auditable", "A READY result requires every listed business condition; motivational score is excluded", "Approved proposals and estimated pipeline value do not count as reserve or realized demand"],
    nextReevaluationConditions: missing.map(metric => `Configure or capture ${metric}`),
    dataQuality: { status: missing.length ? "insufficient" : "trusted", warnings: missing.map(metric => `Missing ${metric}`), sources: ["orders", "dayforge_saas_tenant_locations", "customer_assets", "true_pnl", "dayforge_saas_memberships"] },
  };
}

export async function getCapabilityEvaluations(input: { tenantId: string }): Promise<CapabilityEvaluation[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [orderMetrics, locations, members, assets, pnl] = await Promise.all([
    db.select({ count: sql<number>`count(*)`, revenue: sql<number>`coalesce(sum(${orders.total}),0)`, weight: sql<number>`sum(${orders.weightLbs})`, weightedCount: sql<number>`sum(case when ${orders.weightLbs} is not null then 1 else 0 end)` }).from(orders).where(and(sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`, gte(orders.createdAt, since))),
    db.select().from(dayforgeSaasTenantLocations).where(eq(dayforgeSaasTenantLocations.tenantId, input.tenantId)),
    db.select().from(dayforgeSaasMemberships).where(and(eq(dayforgeSaasMemberships.tenantId, input.tenantId), eq(dayforgeSaasMemberships.active, true))),
    listCustomerAssets({ tenantId: input.tenantId }),
    input.tenantId === "default" ? getTruePnlCockpitSummary({ period: "month" }) : Promise.resolve(null),
  ]);
  const metric = orderMetrics[0];
  const primary = locations.find(location => location.isPrimary) ?? locations[0];
  const totalWeight = metric?.weight == null ? null : Number(metric.weight);
  const capacity = primary ? primary.maxPoundsPerDay * 30 : null;
  const utilizationPct = totalWeight != null && capacity ? Math.round((totalWeight / capacity) * 100) : null;
  const customerCount = assets.filter(asset => asset.kind === "residential").length;
  const recurringCount = assets.filter(asset => asset.kind === "residential" && asset.service.recurring).length;
  return [evaluateFirstHireReadiness({
    activeNonOwnerMembers: members.filter(member => member.role !== "owner").length,
    utilizationPct,
    profitableDeclinedDemandCents: null,
    marginPct: pnl?.trusted ? pnl.marginPct : null,
    reserveMonths: null,
    recurringWorkloadPct: customerCount ? Math.round((recurringCount / customerCount) * 100) : null,
    scheduleSaturationPct: null,
    trailingDemandRevenueCents: metric?.revenue == null ? null : Math.round(Number(metric.revenue) * 100),
  })];
}
