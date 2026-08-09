import { and, desc, eq } from "drizzle-orm";
import {
  commercialMissionEvents,
  dayforgeSaasMemberships,
  dayforgeSaasTenantLocations,
  dayforgeSaasTenants,
  orderPaymentEvents,
  territoryScanResults,
} from "../../drizzle/schema";
import { sourcedFact, unknownValue } from "../../shared/businessGame";
import { getDb } from "../db";
import { listCustomerAssets } from "../customerAssets/customerAssetProjection";
import type { RankedTerritoryOpportunity } from "../territory/territoryDiscovery";
import type { BusinessStage, BusinessWorldProjection, WorldPoint } from "./businessWorldTypes";
import { getCapabilityEvaluations } from "../capabilities/capabilityEvaluationService";

export function deriveBusinessStage(input: { activeNonOwnerMembers: number; firstHireReady?: boolean; capacityConstrained?: boolean; sustainableSolo?: boolean }): BusinessStage {
  if (input.activeNonOwnerMembers >= 8) return "OPERATOR";
  if (input.activeNonOwnerMembers >= 3) return "CREW_CHIEF";
  if (input.activeNonOwnerMembers >= 1) return "TEAM";
  if (input.firstHireReady) return "FIRST_HIRE_READY";
  if (input.capacityConstrained) return "CAPACITY_CONSTRAINED";
  if (input.sustainableSolo) return "SUSTAINABLE_SOLO";
  return "SOLO";
}

function territoryAccount(value: unknown): RankedTerritoryOpportunity["account"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const account = value as Partial<RankedTerritoryOpportunity["account"]>;
  return typeof account.name === "string" && typeof account.latitude === "number" && typeof account.longitude === "number"
    ? account as RankedTerritoryOpportunity["account"] : null;
}

function territoryScore(value: unknown): (RankedTerritoryOpportunity["score"] & { primarySignal?: string }) | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RankedTerritoryOpportunity["score"] : null;
}

export async function getBusinessWorld(input: { tenantId: string; now?: Date }): Promise<BusinessWorldProjection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = input.now ?? new Date();
  const [assets, tenants, locations, memberships, territoryRows, paymentEvents, missionEvents, capabilityEvaluations] = await Promise.all([
    listCustomerAssets({ tenantId: input.tenantId }),
    db.select().from(dayforgeSaasTenants).where(eq(dayforgeSaasTenants.id, input.tenantId)).limit(1),
    db.select().from(dayforgeSaasTenantLocations).where(eq(dayforgeSaasTenantLocations.tenantId, input.tenantId)),
    db.select().from(dayforgeSaasMemberships).where(and(eq(dayforgeSaasMemberships.tenantId, input.tenantId), eq(dayforgeSaasMemberships.active, true))),
    db.select().from(territoryScanResults).where(eq(territoryScanResults.tenantId, input.tenantId)).orderBy(desc(territoryScanResults.createdAt)).limit(100),
    db.select().from(orderPaymentEvents).where(eq(orderPaymentEvents.tenantId, input.tenantId)).orderBy(desc(orderPaymentEvents.occurredAt)).limit(20),
    db.select().from(commercialMissionEvents).where(eq(commercialMissionEvents.tenantId, input.tenantId)).orderBy(desc(commercialMissionEvents.createdAt)).limit(20),
    getCapabilityEvaluations({ tenantId: input.tenantId }),
  ]);
  const tenant = tenants[0];
  const primaryLocation = locations.find(location => location.isPrimary) ?? locations[0] ?? null;
  const activeNonOwnerMembers = memberships.filter(member => member.role !== "owner").length;
  const firstHire = capabilityEvaluations.find(item => item.capability === "FIRST_HIRE_READY");
  const paidRevenue = assets.filter(asset => asset.kind === "residential").reduce((sum, asset) => sum + (asset.lifetimeValue.value ?? 0), 0);
  const commercialRevenue = assets.filter(asset => asset.kind === "commercial").reduce((sum, asset) => sum + (asset.commercial?.realizedRevenue.value ?? 0), 0);
  const receivables = assets.filter(asset => asset.kind === "residential").reduce((sum, asset) => sum + (asset.outstandingReceivables.value ?? 0), 0);
  const properties: WorldPoint[] = assets.filter(asset => asset.kind === "residential").map(asset => ({
    id: asset.id, kind: "customer", name: asset.displayName,
    latitude: asset.property.latitude == null ? null : Number(asset.property.latitude), longitude: asset.property.longitude == null ? null : Number(asset.property.longitude),
    geoStatus: asset.property.geoStatus, state: asset.health, value: asset.lifetimeValue,
    detailPath: `/product/customer/${encodeURIComponent(asset.id)}`, sourceReference: asset.lifetimeValue.sourceReference ?? asset.id, customerAsset: asset,
  }));
  const commercialAssets: WorldPoint[] = assets.filter(asset => asset.kind === "commercial").map(asset => ({
    id: asset.id, kind: "commercial", name: asset.displayName,
    latitude: asset.property.latitude == null ? null : Number(asset.property.latitude), longitude: asset.property.longitude == null ? null : Number(asset.property.longitude),
    geoStatus: asset.property.geoStatus, state: asset.commercial?.stage ?? "prospect", value: asset.commercial?.realizedRevenue ?? asset.lifetimeValue,
    detailPath: `/product/customer/${encodeURIComponent(asset.id)}`, sourceReference: `commercial_accounts:${asset.commercial?.accountId}`, customerAsset: asset,
  }));
  const territorySignals: WorldPoint[] = territoryRows.flatMap(row => {
    const account = territoryAccount(row.accountSnapshotJson);
    const score = territoryScore(row.scoreSnapshotJson);
    if (!account) return [];
    return [{
      id: `territory:${row.id}`, kind: "territory_signal" as const, name: account.name, latitude: account.latitude, longitude: account.longitude,
      geoStatus: "resolved" as const, state: score?.grade ?? "unknown",
      value: score?.estimatedAnnualValueCents == null ? null : { value: score.estimatedAnnualValueCents, provenance: "DETERMINISTIC_ESTIMATE" as const, sourceReference: `territory_scan_results:${row.id}`, confidence: score.grade ?? "unknown" },
      detailPath: null, sourceReference: `territory_scan_results:${row.id}`, customerAsset: null,
    }];
  });
  const hqName = tenant?.brandName ?? (input.tenantId === "default" ? "Laundry Butler" : input.tenantId);
  const recentChanges = [
    ...paymentEvents.map(item => ({ id: `payment:${item.id}`, occurredAt: item.occurredAt.toISOString(), title: `Order #${item.orderId}: ${item.eventType}`, sourceReference: `order_payment_events:${item.id}`, verificationClass: (item.providerEventId ? "VERIFIED" : "ATTESTED") as "VERIFIED" | "ATTESTED" })),
    ...missionEvents.map(item => ({ id: `mission:${item.id}`, occurredAt: item.createdAt.toISOString(), title: `Mission #${item.missionId}: ${item.eventName.replace(/_/g, " ")}`, sourceReference: `commercial_mission_events:${item.id}`, verificationClass: (item.actorType === "system" || item.actorType === "game" ? "VERIFIED" : "ATTESTED") as "VERIFIED" | "ATTESTED" })),
  ].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 12);
  const openThreats = assets.flatMap(asset => [
    ...(asset.health === "at_risk" ? [{ id: `health:${asset.id}`, type: "customer_decay", title: `${asset.displayName} is at risk`, sourceReference: asset.dataQuality.sources.includes("customer_churn_snapshots") ? `customer_churn_snapshots:${asset.identityKey}` : asset.id, severity: "urgent" as const }] : []),
    ...((asset.outstandingReceivables.value ?? 0) > 0 ? [{ id: `receivable:${asset.id}`, type: "receivable", title: `${asset.displayName} has an outstanding balance`, sourceReference: asset.outstandingReceivables.sourceReference ?? asset.id, severity: "watch" as const }] : []),
  ]);
  return {
    generatedAt: now.toISOString(),
    business: { tenantId: input.tenantId, name: tenant?.businessName ?? hqName, brandName: hqName, stage: deriveBusinessStage({ activeNonOwnerMembers, firstHireReady: firstHire?.status === "READY" }), primaryColor: tenant?.primaryColor ?? "#0B5FFF" },
    hq: { id: "hq", kind: "hq", name: hqName, latitude: primaryLocation?.latitude == null ? null : Number(primaryLocation.latitude), longitude: primaryLocation?.longitude == null ? null : Number(primaryLocation.longitude), geoStatus: primaryLocation?.latitude && primaryLocation.longitude ? "resolved" : "unresolved", state: "active", value: sourcedFact(paidRevenue + commercialRevenue, "customer asset projections"), detailPath: "/product/money", sourceReference: primaryLocation ? `dayforge_saas_tenant_locations:${primaryLocation.id}` : `tenant:${input.tenantId}`, customerAsset: null },
    properties, commercialAssets, territorySignals,
    openThreats,
    growthSignals: territorySignals.slice(0, 5).map(point => ({ id: point.id, title: point.name, value: point.value, sourceReference: point.sourceReference })),
    financialSummary: { collectedRevenue: sourcedFact(paidRevenue, "orders + order_payment_projections"), realizedCommercialRevenue: sourcedFact(commercialRevenue, "commercial_pipeline_records.realizedRevenueCents"), receivables: sourcedFact(receivables, "orders + order_payment_projections") },
    capabilities: capabilityEvaluations.filter(item => ["READY", "ACTIVE"].includes(item.status)).map(item => item.capability),
    teamSummary: { activeNonOwnerMembers, ownerIndependentRevenue: unknownValue("Executor attribution is not sufficient to compute owner-independent revenue") },
    recentChanges,
    dataQuality: {
      status: tenant && primaryLocation ? "partial" : "insufficient",
      warnings: [...(!tenant ? ["Tenant profile is missing; using the legacy Laundry Butler label only for the default tenant"] : []), ...(!primaryLocation ? ["HQ location is not configured"] : []), "Residential customer coordinates are unresolved until a verified geocoder writes them"],
      sources: ["dayforge_saas_tenants", "dayforge_saas_tenant_locations", "orders", "order_payment_projections", "commercial_accounts", "commercial_pipeline_records", "territory_scan_results"],
    },
  };
}
