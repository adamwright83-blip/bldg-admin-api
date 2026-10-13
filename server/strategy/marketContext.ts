import { and, desc, eq, gte } from "drizzle-orm";
import {
  legacyDayforgeSaasTenantLocations,
  legacyDayforgeSaasTenants,
  territoryOperatorProfiles,
  territoryScanResults,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { distanceMiles } from "../territory/territoryDiscovery";
import type {
  MarketTerritory,
  StrategyMarketContext,
} from "../../shared/strategicIntelligence";

const coordinate = (value: unknown, limit: number): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
};
export function validTerritory(t: MarketTerritory): boolean {
  return Boolean(
    t.address.trim() &&
      t.latitude != null &&
      Math.abs(t.latitude) <= 90 &&
      t.longitude != null &&
      Math.abs(t.longitude) <= 180 &&
      t.radiusMiles != null &&
      t.radiusMiles > 0 &&
      t.radiusMiles <= 100
  );
}
export function territoryForPoint(
  territories: MarketTerritory[],
  point: { lat: number; lng: number }
): MarketTerritory | null {
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  )
    return null;
  return (
    territories.find(
      t =>
        validTerritory(t) &&
        distanceMiles({ lat: t.latitude!, lng: t.longitude! }, point) <=
          t.radiusMiles!
    ) ?? null
  );
}
export async function resolveTenantVerticalKey(
  tenantId: string
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [tenant] = await db
    .select({ verticalKey: legacyDayforgeSaasTenants.strategyVerticalKey })
    .from(legacyDayforgeSaasTenants)
    .where(eq(legacyDayforgeSaasTenants.id, tenantId))
    .limit(1);
  if (tenant?.verticalKey?.trim()) return tenant.verticalKey.trim();
  const [laundry] = await db
    .select({ tenantId: territoryOperatorProfiles.tenantId })
    .from(territoryOperatorProfiles)
    .where(eq(territoryOperatorProfiles.tenantId, tenantId))
    .limit(1);
  // An actual saved wash/fold operating profile is industry evidence. Array order is not.
  return laundry ? "laundry_fluff_fold" : "generic";
}
export async function loadStrategyMarketContext(
  tenantId: string,
  verticalKey: string,
  now = new Date()
): Promise<StrategyMarketContext> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result: StrategyMarketContext = {
    tenantId,
    mode: verticalKey === "software" ? "online" : "unresolved",
    territories: [],
    observations: [],
    limitations: [],
  };
  if (result.mode === "online") {
    result.limitations.push(
      "Customer regions, online competition, and demand evidence are unobserved."
    );
    return result;
  }
  const locations = await db
    .select()
    .from(legacyDayforgeSaasTenantLocations)
    .where(eq(legacyDayforgeSaasTenantLocations.tenantId, tenantId));
  result.territories = locations.map(row => ({
    id: `tenant-location:${row.id}`,
    label: row.label,
    address: row.address,
    latitude: coordinate(row.latitude, 90),
    longitude: coordinate(row.longitude, 180),
    radiusMiles: Number(row.serviceRadiusMiles),
    sourceRef: `tenant_location:${row.id}`,
    capturedAt: row.updatedAt.toISOString(),
  }));
  if (!locations.length) {
    const [p] = await db
      .select()
      .from(territoryOperatorProfiles)
      .where(eq(territoryOperatorProfiles.tenantId, tenantId))
      .limit(1);
    if (p)
      result.territories = [
        {
          id: `territory-profile:${tenantId}`,
          label: p.storeName,
          address: p.storeAddress,
          latitude: coordinate(p.latitude, 90),
          longitude: coordinate(p.longitude, 180),
          radiusMiles: Number(p.serviceRadiusMiles),
          sourceRef: `territory_operator_profiles:${tenantId}`,
          capturedAt: p.updatedAt.toISOString(),
        },
      ];
  }
  if (result.territories.some(validTerritory)) result.mode = "physical";
  if (!result.territories.length)
    result.limitations.push(
      "No authoritative operating location or service territory is configured."
    );
  if (result.territories.some(t => !validTerritory(t)))
    result.limitations.push(
      "Service territory is incomplete or invalid; local targeting is withheld."
    );
  const scans = await db
    .select()
    .from(territoryScanResults)
    .where(
      and(
        eq(territoryScanResults.tenantId, tenantId),
        gte(
          territoryScanResults.sourceCapturedAt,
          new Date(now.getTime() - 7 * 86400000)
        )
      )
    )
    .orderBy(desc(territoryScanResults.sourceCapturedAt))
    .limit(100);
  const seen = new Set<string>();
  for (const s of scans) {
    const a = s.accountSnapshotJson as {
      name?: string;
      latitude?: number;
      longitude?: number;
    };
    if (
      !a?.name ||
      a.latitude == null ||
      a.longitude == null ||
      s.sourceCapturedAt > now
    )
      continue;
    const territory = territoryForPoint(result.territories, {
      lat: a.latitude,
      lng: a.longitude,
    });
    if (!territory || seen.has(s.candidateKey)) continue;
    seen.add(s.candidateKey);
    const evidence = s.evidenceJson as Array<{
      classification?: string;
      sourceUrl?: string | null;
    }>;
    if (
      !Array.isArray(evidence) ||
      !evidence.some(e => e.classification === "sourced_fact")
    )
      continue;
    result.observations.push({
      id: `territory_scan_results:${s.id}`,
      name: a.name,
      territoryId: territory.id,
      latitude: a.latitude,
      longitude: a.longitude,
      source: `${s.providerName}:${s.providerAccountId}`,
      sourceUrl:
        evidence.find(e => e.classification === "sourced_fact")?.sourceUrl ??
        null,
      capturedAt: s.sourceCapturedAt.toISOString(),
      classification: "sourced_fact",
      demandVerified: false,
    });
  }
  if (!result.observations.length)
    result.limitations.push(
      "No recent in-territory prospect research is available; no demand inferred."
    );
  result.limitations.push(
    "Demographics, local rules, seasonality, competitor differentiation, and route density are unmeasured."
  );
  return result;
}
