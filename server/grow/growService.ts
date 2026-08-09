import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  businessGameMoveDecisions,
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAccounts,
  commercialFollowUps,
  commercialMissions,
  commercialOpportunities,
  commercialPipelineRecords,
  customerChurnSnapshots,
  customerRecoveryInterventions,
  dayforgeSaasTenantLocations,
} from "../../drizzle/schema";
import { deterministicEstimate, sourcedFact, unknownValue } from "../../shared/businessGame";
import { getDb } from "../db";
import { rankGrowMoves } from "./growScoring";
import type { GrowMove, GrowProjection } from "./growTypes";

export async function getGrowProjection(input: { tenantId: string; now?: Date }): Promise<GrowProjection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = input.now ?? new Date();
  const [commercial, churn, locations, decisions] = await Promise.all([
    db.select({ pipeline: commercialPipelineRecords, mission: commercialMissions, account: commercialAccounts, opportunity: commercialOpportunities, location: commercialAccountLocations, contact: commercialAccountContacts })
      .from(commercialPipelineRecords)
      .innerJoin(commercialMissions, and(eq(commercialMissions.tenantId, input.tenantId), eq(commercialMissions.id, commercialPipelineRecords.missionId)))
      .innerJoin(commercialAccounts, and(eq(commercialAccounts.tenantId, input.tenantId), eq(commercialAccounts.id, commercialPipelineRecords.accountId)))
      .innerJoin(commercialOpportunities, and(eq(commercialOpportunities.tenantId, input.tenantId), eq(commercialOpportunities.id, commercialPipelineRecords.opportunityId)))
      .leftJoin(commercialAccountLocations, and(eq(commercialAccountLocations.tenantId, input.tenantId), eq(commercialAccountLocations.accountId, commercialAccounts.id), eq(commercialAccountLocations.isPrimary, true)))
      .leftJoin(commercialAccountContacts, and(eq(commercialAccountContacts.tenantId, input.tenantId), eq(commercialAccountContacts.accountId, commercialAccounts.id)))
      .where(and(eq(commercialPipelineRecords.tenantId, input.tenantId), inArray(commercialPipelineRecords.stage, ["discovered", "qualified", "mission_created", "game_ready", "field_ready", "visit_planned", "visited", "follow_up", "proposal_sent", "pilot_requested", "verbal_yes"]))),
    db.select({ snapshot: customerChurnSnapshots, intervention: customerRecoveryInterventions })
      .from(customerChurnSnapshots)
      .leftJoin(customerRecoveryInterventions, and(eq(customerRecoveryInterventions.tenantId, input.tenantId), eq(customerRecoveryInterventions.customerKeyHash, customerChurnSnapshots.customerKeyHash)))
      .where(and(eq(customerChurnSnapshots.tenantId, input.tenantId), inArray(customerChurnSnapshots.grade, ["medium", "high"])))
      .orderBy(desc(customerChurnSnapshots.createdAt)).limit(100),
    db.select().from(dayforgeSaasTenantLocations).where(eq(dayforgeSaasTenantLocations.tenantId, input.tenantId)),
    db.select().from(businessGameMoveDecisions).where(eq(businessGameMoveDecisions.tenantId, input.tenantId)).orderBy(desc(businessGameMoveDecisions.createdAt)),
  ]);
  const latestDecision = new Map<string, string>();
  for (const decision of decisions) if (!latestDecision.has(decision.moveId)) latestDecision.set(decision.moveId, decision.decision);
  const followUps = commercial.length ? await db.select().from(commercialFollowUps).where(and(eq(commercialFollowUps.tenantId, input.tenantId), inArray(commercialFollowUps.pipelineId, commercial.map(row => row.pipeline.id)))) : [];
  const moves: GrowMove[] = [];
  const seenPipelines = new Set<number>();
  for (const row of commercial) {
    if (seenPipelines.has(row.pipeline.id)) continue;
    seenPipelines.add(row.pipeline.id);
    const due = followUps.find(item => item.pipelineId === row.pipeline.id && item.status === "open");
    const moveId = due ? `commercial-follow-up:${due.id}` : `commercial-prospect:${row.pipeline.id}`;
    if (["dismissed", "completed"].includes(latestDecision.get(moveId) ?? "")) continue;
    const value = row.pipeline.estimatedContractValueCents ?? row.opportunity.estimatedAnnualValueCents;
    moves.push({
      id: moveId, moveType: due ? "follow_up_commercial_account" : row.contact?.phone ? "call_prospect" : "visit_nearby_prospect",
      title: due ? `Follow up with ${row.account.name}` : `${row.contact?.phone ? "Call" : "Visit"} ${row.account.name}`,
      source: { type: due ? "commercial_follow_up" : "commercial_pipeline", id: String(due?.id ?? row.pipeline.id), reference: due ? `commercial_follow_ups:${due.id}` : `commercial_pipeline_records:${row.pipeline.id}` },
      expectedTimeMinutes: due ? 15 : row.contact?.phone ? 15 : 35, cashCost: sourcedFact(0, "No configured cash spend"), capacityCost: deterministicEstimate(0, "Pre-sale action; production capacity applied after conversion", "high"),
      expectedValue: value == null ? unknownValue("No commercial value estimate") : deterministicEstimate({ lowCents: Math.round(value * 0.2), highCents: value }, `commercial_opportunities:${row.opportunity.id}`, row.opportunity.estimateConfidence),
      confidence: value == null ? "unknown" : row.opportunity.estimateConfidence,
      evidence: [row.opportunity.primarySignal, `Pipeline stage: ${row.pipeline.stage}`, ...(due ? [`Due ${due.dueAt.toISOString()}`] : [])],
      expiresAt: due ? new Date(due.dueAt.getTime() + 14 * 86_400_000).toISOString() : row.mission.expiresAt?.toISOString() ?? null,
      whyNow: due ? (due.dueAt < now ? "The persisted follow-up is overdue" : "A persisted follow-up is scheduled") : "This is an active, non-terminal commercial relationship",
      destinationPath: `/commercial-pipeline?pipeline=${row.pipeline.id}`,
    });
  }
  const seenCustomers = new Set<string>();
  for (const row of churn) {
    if (seenCustomers.has(row.snapshot.customerKeyHash)) continue;
    seenCustomers.add(row.snapshot.customerKeyHash);
    const moveId = `recover-customer:${row.intervention?.id ?? row.snapshot.id}`;
    if (["dismissed", "completed"].includes(latestDecision.get(moveId) ?? "")) continue;
    moves.push({
      id: moveId, moveType: "recover_customer", title: `Recover ${row.snapshot.customerName}`,
      source: { type: row.intervention ? "customer_recovery_intervention" : "customer_churn_snapshot", id: row.intervention?.id ?? row.snapshot.id, reference: row.intervention ? `customer_recovery_interventions:${row.intervention.id}` : `customer_churn_snapshots:${row.snapshot.id}` },
      expectedTimeMinutes: 12, cashCost: sourcedFact(0, "No configured incentive or campaign spend"), capacityCost: unknownValue("Capacity cost depends on whether the customer returns"),
      expectedValue: deterministicEstimate({ lowCents: 0, highCents: row.snapshot.estimatedMonthlyImpactCents }, `customer_churn_snapshots:${row.snapshot.id}`, row.snapshot.confidence), confidence: row.snapshot.confidence,
      evidence: Array.isArray(row.snapshot.reasonsJson) ? row.snapshot.reasonsJson.map(String) : [`Churn score ${row.snapshot.score}`], expiresAt: null,
      whyNow: `${row.snapshot.daysLate} days beyond expected cadence`, destinationPath: "/churn-radar",
    });
  }
  const primary = locations.find(location => location.isPrimary) ?? locations[0];
  const capacityUnits = primary?.openCapacityPoundsPerWeek ?? null;
  const capacityFull = capacityUnits === 0;
  return {
    generatedAt: now.toISOString(), moves: rankGrowMoves({ moves, now, capacityFull }),
    scarcity: {
      ownerTimeMinutes: unknownValue("No authoritative owner growth-time budget is configured"),
      growthSpendCents: unknownValue("No authoritative safe growth-spend budget is configured"),
      openCapacityUnits: capacityUnits == null ? unknownValue("Service capacity is not configured") : sourcedFact(capacityUnits, `dayforge_saas_tenant_locations:${primary!.id}`),
      capacityFull,
    },
    dataQuality: { status: primary ? "partial" : "insufficient", warnings: ["Owner time and growth-spend budgets remain unknown until configured"], sources: ["commercial_pipeline_records", "commercial_follow_ups", "commercial_opportunities", "customer_churn_snapshots", "customer_recovery_interventions", "dayforge_saas_tenant_locations"] },
  };
}

export async function recordGrowMoveDecision(input: { tenantId: string; actorId: string; moveId: string; sourceType: string; sourceId: string; decision: "accepted" | "dismissed" | "completed"; requestId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [replay] = await db.select().from(businessGameMoveDecisions).where(and(eq(businessGameMoveDecisions.tenantId, input.tenantId), eq(businessGameMoveDecisions.requestId, input.requestId))).limit(1);
  if (replay) return replay;
  const row = { id: randomUUID(), ...input, metadataJson: null };
  await db.insert(businessGameMoveDecisions).values(row);
  return row;
}
