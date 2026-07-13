import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  territoryOperatorProfiles,
  territoryScanResults,
  territoryScanSessions,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { LaundryTerritoryOperatorContext, RankedTerritoryOpportunity, TerritoryDiscoveryResult } from "./territoryDiscovery";

export async function getTerritoryOperatorProfile(tenantId: string): Promise<LaundryTerritoryOperatorContext | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(territoryOperatorProfiles).where(eq(territoryOperatorProfiles.tenantId, tenantId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    tenantId,
    serviceRadiusMiles: Number(row.serviceRadiusMiles),
    commercialWashFoldEnabled: row.commercialWashFoldEnabled,
    averagePricePerPoundCents: row.averagePricePerPoundCents,
    availableWeeklyCapacityPounds: row.availableWeeklyCapacityPounds,
    routePoints: row.routePointsJson as Array<{ lat: number; lng: number }>,
    turnaroundCompatibleByDefault: row.turnaroundCompatibleByDefault,
    pickupDaysCompatibleByDefault: row.pickupDaysCompatibleByDefault,
  };
}

export async function saveTerritoryOperatorProfile(input: LaundryTerritoryOperatorContext & { storeName: string; storeAddress: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(territoryOperatorProfiles).values({
    tenantId: input.tenantId,
    storeName: input.storeName,
    storeAddress: input.storeAddress,
    serviceRadiusMiles: String(input.serviceRadiusMiles),
    commercialWashFoldEnabled: input.commercialWashFoldEnabled,
    averagePricePerPoundCents: input.averagePricePerPoundCents,
    availableWeeklyCapacityPounds: input.availableWeeklyCapacityPounds,
    routePointsJson: input.routePoints,
    turnaroundCompatibleByDefault: input.turnaroundCompatibleByDefault,
    pickupDaysCompatibleByDefault: input.pickupDaysCompatibleByDefault,
  }).onDuplicateKeyUpdate({ set: {
    storeName: input.storeName,
    storeAddress: input.storeAddress,
    serviceRadiusMiles: String(input.serviceRadiusMiles),
    commercialWashFoldEnabled: input.commercialWashFoldEnabled,
    averagePricePerPoundCents: input.averagePricePerPoundCents,
    availableWeeklyCapacityPounds: input.availableWeeklyCapacityPounds,
    routePointsJson: input.routePoints,
    turnaroundCompatibleByDefault: input.turnaroundCompatibleByDefault,
    pickupDaysCompatibleByDefault: input.pickupDaysCompatibleByDefault,
  }});
}

export async function persistTerritoryScan(input: {
  tenantId: string | null;
  mode: "public_preview" | "tenant";
  addressQuery: string;
  createdBy: string | null;
  result: TerritoryDiscoveryResult;
}): Promise<{ scanId: string; expiresAt: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const scanId = nanoid(24);
  const expiresAt = new Date(Date.now() + (input.mode === "public_preview" ? 60 : 24 * 60) * 60 * 1000);
  await db.transaction(async tx => {
    await tx.insert(territoryScanSessions).values({
      id: scanId,
      tenantId: input.tenantId,
      mode: input.mode,
      addressQuery: input.addressQuery,
      centerJson: input.result.center,
      providerName: input.result.providerName,
      resultCount: input.result.opportunities.length,
      expiresAt,
      createdBy: input.createdBy,
    });
    if (input.result.opportunities.length > 0) {
      await tx.insert(territoryScanResults).values(input.result.opportunities.map(opportunity => ({
        scanSessionId: scanId,
        tenantId: input.tenantId,
        candidateKey: opportunity.candidateKey,
        providerName: opportunity.providerName,
        providerAccountId: opportunity.providerAccountId,
        accountSnapshotJson: opportunity.account,
        scoreSnapshotJson: { ...opportunity.score, primarySignal: opportunity.primarySignal, distanceMiles: opportunity.distanceMiles },
        evidenceJson: opportunity.evidence,
        sourceCapturedAt: new Date(opportunity.evidence[0]?.capturedAt ?? Date.now()),
      })));
    }
  });
  return { scanId, expiresAt: expiresAt.toISOString() };
}

export async function getPersistedTerritoryResult(input: {
  tenantId: string;
  scanId: string;
  candidateKey: string;
}): Promise<RankedTerritoryOpportunity | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(territoryScanResults).where(and(
    eq(territoryScanResults.tenantId, input.tenantId),
    eq(territoryScanResults.scanSessionId, input.scanId),
    eq(territoryScanResults.candidateKey, input.candidateKey),
  )).limit(1);
  const row = rows[0];
  if (!row) return null;
  const score = row.scoreSnapshotJson as RankedTerritoryOpportunity["score"] & { primarySignal: string; distanceMiles: number };
  return {
    candidateKey: row.candidateKey,
    providerName: row.providerName,
    providerAccountId: row.providerAccountId,
    account: row.accountSnapshotJson as RankedTerritoryOpportunity["account"],
    score,
    primarySignal: score.primarySignal,
    distanceMiles: score.distanceMiles,
    evidence: row.evidenceJson as RankedTerritoryOpportunity["evidence"],
  };
}
