import { and, eq, inArray } from "drizzle-orm";
import { commercialAccountContacts, commercialAccountLocations, commercialAccounts, commercialMissions, commercialOpportunities, dayforgeSaasTenantLocations } from "../../drizzle/schema";
import { deterministicEstimate } from "../../shared/businessGame";
import { getDb } from "../db";
import { distanceMiles } from "../territory/territoryDiscovery";
import type { FieldMoveCandidate, FieldMovesResult } from "./types";

export function rankFieldMoves(input: {
  now: Date;
  nextCommitmentAt: Date | null;
  capacityFull: boolean;
  currentLocationAvailable: boolean;
  candidates: FieldMoveCandidate[];
}): FieldMovesResult {
  const availableMinutes = input.nextCommitmentAt
    ? Math.max(0, Math.floor((input.nextCommitmentAt.getTime() - input.now.getTime()) / 60_000))
    : null;
  const eligible = input.candidates.filter(candidate => {
    if (!candidate.contactAllowed) return false;
    if (candidate.withinServiceRadius === false) return false;
    if (candidate.expiresAt && Date.parse(candidate.expiresAt) <= input.now.getTime()) return false;
    if (input.capacityFull && candidate.moveType === "nearby_commercial_visit") return false;
    // A visit is only a *nearby* move when current geography proves that claim.
    // Without a current position, keep the real prospect in the system but do
    // not turn it into an immediate field recommendation. Calls remain eligible
    // because they do not depend on spatial certainty.
    if (candidate.moveType === "nearby_commercial_visit" && !input.currentLocationAvailable) return false;
    const burden = candidate.expectedDurationMinutes + (candidate.travelMinutes ?? 0);
    return availableMinutes === null || burden <= availableMinutes;
  });
  eligible.sort((a, b) => {
    const valueA = a.expectedValue.value?.highCents ?? 0;
    const valueB = b.expectedValue.value?.highCents ?? 0;
    const costA = Math.max(1, a.expectedDurationMinutes + (a.travelMinutes ?? 0));
    const costB = Math.max(1, b.expectedDurationMinutes + (b.travelMinutes ?? 0));
    return valueB / costB - valueA / costA || a.id.localeCompare(b.id);
  });
  let reason: FieldMovesResult["reason"] = "MOVES_AVAILABLE";
  if (!eligible.length) {
    if (input.capacityFull && input.candidates.some(item => item.moveType === "nearby_commercial_visit")) reason = "CAPACITY_FULL";
    else if (availableMinutes !== null && input.candidates.some(item => item.expectedDurationMinutes + (item.travelMinutes ?? 0) > availableMinutes)) reason = "ROUTE_TOO_TIGHT";
    else if (!input.currentLocationAvailable && input.candidates.some(item => item.moveType === "nearby_commercial_visit")) reason = "DATA_INSUFFICIENT";
    else reason = input.candidates.length ? "NO_WORTHWHILE_MOVE" : "NO_ELIGIBLE_TARGET";
  }
  return {
    generatedAt: input.now.toISOString(), recommendedMoves: eligible.slice(0, 3), reason,
    constraints: { availableMinutes, capacityFull: input.capacityFull, currentLocationAvailable: input.currentLocationAvailable },
    dataQuality: { status: input.currentLocationAvailable ? "trusted" : "partial", warnings: input.currentLocationAvailable ? [] : ["Current location unavailable; nearby visits are not recommended"], sources: ["commercial_missions", "commercial_opportunities", "commercial_account_locations"] },
  };
}

export async function getFieldMoves(input: {
  tenantId: string;
  userId: string;
  now?: Date;
  currentLocation?: { latitude: number; longitude: number } | null;
  nextCommitmentAt?: Date | null;
  capacityFull?: boolean;
}): Promise<FieldMovesResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ mission: commercialMissions, account: commercialAccounts, opportunity: commercialOpportunities, location: commercialAccountLocations, contact: commercialAccountContacts })
    .from(commercialMissions)
    .innerJoin(commercialOpportunities, and(eq(commercialOpportunities.tenantId, input.tenantId), eq(commercialOpportunities.id, commercialMissions.opportunityId)))
    .innerJoin(commercialAccounts, and(eq(commercialAccounts.tenantId, input.tenantId), eq(commercialAccounts.id, commercialOpportunities.accountId)))
    .leftJoin(commercialAccountLocations, and(eq(commercialAccountLocations.tenantId, input.tenantId), eq(commercialAccountLocations.accountId, commercialAccounts.id), eq(commercialAccountLocations.isPrimary, true)))
    .leftJoin(commercialAccountContacts, and(eq(commercialAccountContacts.tenantId, input.tenantId), eq(commercialAccountContacts.accountId, commercialAccounts.id)))
    .where(and(eq(commercialMissions.tenantId, input.tenantId), inArray(commercialMissions.status, ["candidate", "selected", "game_ready"])));
  const [tenantLocation] = await db.select().from(dayforgeSaasTenantLocations).where(and(eq(dayforgeSaasTenantLocations.tenantId, input.tenantId), eq(dayforgeSaasTenantLocations.isPrimary, true))).limit(1);
  const candidates: FieldMoveCandidate[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.mission.id) || (row.mission.assignedTo && row.mission.assignedTo !== input.userId)) continue;
    seen.add(row.mission.id);
    const hasGeo = Boolean(input.currentLocation && row.location?.latitude && row.location?.longitude);
    const distance = hasGeo ? distanceMiles(
      { lat: input.currentLocation!.latitude, lng: input.currentLocation!.longitude },
      { lat: Number(row.location!.latitude), lng: Number(row.location!.longitude) }
    ) : null;
    const radius = Number(tenantLocation?.serviceRadiusMiles ?? 0) || null;
    const travelMinutes = distance == null ? null : Math.max(5, Math.ceil((distance / 20) * 60));
    const value = row.opportunity.estimatedAnnualValueCents;
    candidates.push({
      id: `mission:${row.mission.id}:visit`, moveType: "nearby_commercial_visit", title: `Visit ${row.account.name}`,
      target: { entityType: "commercial_account", entityId: String(row.account.id), name: row.account.name }, expectedDurationMinutes: 25,
      travelMinutes, expectedValue: deterministicEstimate({ lowCents: value == null ? 0 : Math.round(value * 0.25), highCents: value ?? 0 }, `commercial_opportunities:${row.opportunity.id}`, row.opportunity.estimateConfidence),
      confidence: row.opportunity.estimateConfidence, relevance: distance == null ? "Eligible prospect; location is insufficient for a nearby recommendation" : `${distance.toFixed(1)} miles away with open field time`,
      evidence: [`Opportunity score ${row.opportunity.score}`, row.opportunity.primarySignal], expiresAt: row.mission.expiresAt?.toISOString() ?? null,
      contactAllowed: Boolean(row.location?.address), withinServiceRadius: distance == null || radius == null ? null : distance <= radius,
      missionId: row.mission.id, missionVersion: row.mission.version, destinationPath: `/driver/sales-mission/${row.mission.id}`,
    });
    if (row.contact?.phone) candidates.push({
      id: `mission:${row.mission.id}:call`, moveType: "commercial_call", title: `Call ${row.account.name}`,
      target: { entityType: "commercial_account", entityId: String(row.account.id), name: row.account.name }, expectedDurationMinutes: 15,
      travelMinutes: 0, expectedValue: deterministicEstimate({ lowCents: value == null ? 0 : Math.round(value * 0.1), highCents: value ?? 0 }, `commercial_opportunities:${row.opportunity.id}`, row.opportunity.estimateConfidence),
      confidence: row.opportunity.estimateConfidence, relevance: "A sourced business contact is available", evidence: [`Contact source: ${row.contact.source}`, row.opportunity.primarySignal],
      expiresAt: row.mission.expiresAt?.toISOString() ?? null, contactAllowed: true, withinServiceRadius: true, missionId: row.mission.id, missionVersion: row.mission.version,
      destinationPath: `/driver/sales-mission/${row.mission.id}`,
    });
  }
  return rankFieldMoves({ now: input.now ?? new Date(), nextCommitmentAt: input.nextCommitmentAt ?? null, capacityFull: input.capacityFull ?? false, currentLocationAvailable: Boolean(input.currentLocation), candidates });
}
