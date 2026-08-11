/**
 * Slice 45 — proves the real-outcome learning loop through the ACTUAL
 * production APIs, not by calling associateArmoryOutcome directly (that
 * unit is already covered by armoryEvolution.integration.test.ts). This
 * file exercises createCommercialMission -> transitionCommercialMission ->
 * resolveCommercialPipelineMission / scheduleCommercialFollowUp — the real
 * paths wired in Slice 42 — and reads back personal evidence to prove the
 * whole chain, end to end, against real MySQL.
 *
 * Gated the same way as the other DayForge release integration tests:
 *   DAYFORGE_RELEASE_DB=1 DATABASE_URL=<disposable test db> \
 *     pnpm vitest run --config vitest.integration.config.ts server/commercialPipeline
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  armoryWeaponOutcomes,
  armoryWeaponUsages,
  commercialFollowUps,
  commercialMissionEvents,
  commercialMissions,
  commercialPipelineEvents,
  commercialPipelineRecords,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  createCommercialMission,
  transitionCommercialMission,
} from "../commercialMissions/commercialMissionStore";
import {
  listCommercialPipeline,
  resolveCommercialPipelineMission,
  scheduleCommercialFollowUp,
} from "./commercialPipelineService";
import { recordArmoryWeaponUsage } from "../armory/armoryEvidenceService";
import { listMissionWeaponUsage } from "../armory/armoryEvidenceService";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

// Each real-path test drives 9 sequential authoritative status transitions
// against a real disposable database over the public proxy — each a
// separate round trip. The default 5s test timeout is calibrated for unit
// tests, not this genuinely multi-step production journey.
vi.setConfig({ testTimeout: 30_000 });

const createdMissionIds: number[] = [];
const createdTenants = new Set<string>();

function missionInput(input: {
  tenantId: string;
  assignedTo: string;
  idempotencyKey: string;
}) {
  return {
    tenantId: input.tenantId,
    assignedTo: input.assignedTo,
    account: {
      providerName: null,
      providerAccountId: null,
      name: `Real-Outcome Test Account ${randomUUID()}`,
      accountType: "hotel" as const,
      website: null,
      address: "1200 Harbor Avenue, Long Beach, CA",
      latitude: null,
      longitude: null,
      locationCount: 1,
      decisionMaker: { name: "Dana Ruiz", title: "Operations Director" },
    },
    opportunity: {
      estimatedAnnualValueCents: null,
      estimateConfidence: "medium" as const,
      score: 74,
      primarySignal: "Walk-in conversation",
      reasons: ["Local recurring demand"],
      risks: ["Volume not yet verified"],
      evidence: [],
    },
    brief: {
      laundryOpportunity: "Recurring guest-linen overflow",
      salesAngle: "Local pickup with accountable turnaround",
      openingLine: "How do you cover linen overflow today?",
      discoveryQuestions: [],
      objections: [],
    },
    steps: [],
    actor: { type: "operator" as const, id: "test-operator" },
    idempotencyKey: input.idempotencyKey,
  };
}

async function pipelineIdForMission(tenantId: string, missionId: number): Promise<number> {
  const rows = await listCommercialPipeline(tenantId);
  const row = rows.find(r => r.mission.id === missionId);
  if (!row) throw new Error("Pipeline record not found for mission");
  return row.id;
}

/**
 * Advances a fresh "candidate" mission all the way to "visit_completed" —
 * the real, full status graph (shared/commercialMissionLifecycle.ts), not a
 * shortcut — so pipeline resolution's precondition is met exactly the way
 * production traffic reaches it. Returns the mission's version afterward,
 * for the caller's next real transition call.
 */
async function advanceToVisitCompleted(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
}): Promise<number> {
  let version = 1;
  for (const toStatus of [
    "selected",
    "game_ready",
    "game_active",
    "game_completed",
    "phone_ready",
    "preparing",
    "en_route",
    "arrived",
    "visit_completed",
  ] as const) {
    await transitionCommercialMission({
      tenantId: input.tenantId,
      missionId: input.missionId,
      expectedVersion: version,
      toStatus,
      actor: { type: "operator", id: input.actorId },
      idempotencyKey: `advance:${input.missionId}:${toStatus}`,
    });
    version += 1;
  }
  return version;
}

describe.skipIf(!runDatabaseGate)("Real-outcome learning end-to-end (Slice 45)", () => {
  afterAll(async () => {
    if (!createdMissionIds.length) return;
    const db = await getDb();
    if (!db) return;
    await db.delete(armoryWeaponOutcomes).where(inArray(armoryWeaponOutcomes.missionId, createdMissionIds));
    await db.delete(armoryWeaponUsages).where(inArray(armoryWeaponUsages.missionId, createdMissionIds));
    await db.delete(commercialFollowUps).where(inArray(commercialFollowUps.missionId, createdMissionIds));
    await db.delete(commercialPipelineEvents).where(inArray(commercialPipelineEvents.missionId, createdMissionIds));
    await db.delete(commercialPipelineRecords).where(inArray(commercialPipelineRecords.missionId, createdMissionIds));
    await db.delete(commercialMissionEvents).where(inArray(commercialMissionEvents.missionId, createdMissionIds));
    await db.delete(commercialMissions).where(inArray(commercialMissions.id, createdMissionIds));
    // Cascade cleanup of accounts/opportunities/locations/contacts created for these tenants is best-effort —
    // they're randomly-named per test run and never collide with real data.
    void createdTenants;
  });

  it("real mission-resolution path: framework used -> mission won -> outcome associated -> evidence queryable", async () => {
    const tenantId = `t45-won-${randomUUID().slice(0, 8)}`;
    const actorId = `driver-${randomUUID().slice(0, 8)}`;
    createdTenants.add(tenantId);
    const mission = await createCommercialMission(
      missionInput({ tenantId, assignedTo: actorId, idempotencyKey: `create:${tenantId}` })
    );
    createdMissionIds.push(mission.id);

    const weaponId = `framework:${randomUUID()}`;
    await recordArmoryWeaponUsage({
      tenantId,
      actorId,
      missionId: mission.id,
      weaponId,
      frameworkId: null,
      archetype: "ANCHOR",
      channel: "in_person",
      provenanceKind: "trainer_source",
      requestId: `usage:${mission.id}`,
    });

    const missionVersion = await advanceToVisitCompleted({ tenantId, missionId: mission.id, actorId: "test-operator" });
    const pipelineId = await pipelineIdForMission(tenantId, mission.id);

    // The REAL production resolution API — not associateArmoryOutcome directly.
    await resolveCommercialPipelineMission({
      tenantId,
      pipelineId,
      expectedMissionVersion: missionVersion,
      action: "won",
      actorId: "test-operator",
      requestId: `resolve:${mission.id}`,
    });

    const usage = await listMissionWeaponUsage({ tenantId, actorId, missionId: mission.id });
    expect(usage).toHaveLength(1);

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const outcomes = await db
      .select()
      .from(armoryWeaponOutcomes)
      .where(inArray(armoryWeaponOutcomes.missionId, [mission.id]));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcomeKind).toBe("account_won");
    expect(outcomes[0].weaponId).toBe(weaponId);
    expect(outcomes[0].actorId).toBe(actorId);
  });

  it("real follow-up path: framework used -> mission unresolved -> follow-up scheduled -> outcome updates", async () => {
    const tenantId = `t45-followup-${randomUUID().slice(0, 8)}`;
    const actorId = `driver-${randomUUID().slice(0, 8)}`;
    createdTenants.add(tenantId);
    const mission = await createCommercialMission(
      missionInput({ tenantId, assignedTo: actorId, idempotencyKey: `create:${tenantId}` })
    );
    createdMissionIds.push(mission.id);

    const weaponId = `framework:${randomUUID()}`;
    await recordArmoryWeaponUsage({
      tenantId,
      actorId,
      missionId: mission.id,
      weaponId,
      frameworkId: null,
      archetype: "GATEKEEPER",
      channel: "phone",
      provenanceKind: "trainer_source",
      requestId: `usage:${mission.id}`,
    });

    await advanceToVisitCompleted({ tenantId, missionId: mission.id, actorId: "test-operator" });
    const pipelineId = await pipelineIdForMission(tenantId, mission.id);

    await scheduleCommercialFollowUp({
      tenantId,
      pipelineId,
      actorId: "test-operator",
      requestId: `followup:${mission.id}`,
      dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      note: "Callback requested",
    });

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const outcomes = await db
      .select()
      .from(armoryWeaponOutcomes)
      .where(inArray(armoryWeaponOutcomes.missionId, [mission.id]));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcomeKind).toBe("follow_up_created");
  });

  it("delayed win: usage day 1, follow-up day 2, verified win later — no duplicate usage evidence", async () => {
    const tenantId = `t45-delayed-${randomUUID().slice(0, 8)}`;
    const actorId = `driver-${randomUUID().slice(0, 8)}`;
    createdTenants.add(tenantId);
    const mission = await createCommercialMission(
      missionInput({ tenantId, assignedTo: actorId, idempotencyKey: `create:${tenantId}` })
    );
    createdMissionIds.push(mission.id);

    const weaponId = `framework:${randomUUID()}`;
    await recordArmoryWeaponUsage({
      tenantId,
      actorId,
      missionId: mission.id,
      weaponId,
      frameworkId: null,
      archetype: "ANCHOR",
      channel: "in_person",
      provenanceKind: "trainer_source",
      requestId: `usage:${mission.id}`,
    });

    const missionVersion = await advanceToVisitCompleted({ tenantId, missionId: mission.id, actorId: "test-operator" });
    const pipelineId = await pipelineIdForMission(tenantId, mission.id);

    await scheduleCommercialFollowUp({
      tenantId,
      pipelineId,
      actorId: "test-operator",
      requestId: `followup:${mission.id}`,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      note: "Day 2 callback",
    });
    await resolveCommercialPipelineMission({
      tenantId,
      pipelineId,
      expectedMissionVersion: missionVersion,
      action: "won",
      actorId: "test-operator",
      requestId: `resolve:${mission.id}`,
    });

    const usage = await listMissionWeaponUsage({ tenantId, actorId, missionId: mission.id });
    // The framework was used exactly once — a delayed resolution must never
    // duplicate the usage evidence, only add a second, distinct outcome.
    expect(usage).toHaveLength(1);

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const outcomes = await db
      .select()
      .from(armoryWeaponOutcomes)
      .where(inArray(armoryWeaponOutcomes.missionId, [mission.id]));
    const kinds = outcomes.map(o => o.outcomeKind).sort();
    expect(kinds).toEqual(["account_won", "follow_up_created"]);
  });

  it("negative control: perfect game execution with no business result never produces a won outcome", async () => {
    const tenantId = `t45-negcontrol-${randomUUID().slice(0, 8)}`;
    const actorId = `driver-${randomUUID().slice(0, 8)}`;
    createdTenants.add(tenantId);
    const mission = await createCommercialMission(
      missionInput({ tenantId, assignedTo: actorId, idempotencyKey: `create:${tenantId}` })
    );
    createdMissionIds.push(mission.id);

    // Game execution: the player used a weapon. No authoritative business
    // action follows — the mission is never resolved through the real API.
    await recordArmoryWeaponUsage({
      tenantId,
      actorId,
      missionId: mission.id,
      weaponId: `framework:${randomUUID()}`,
      frameworkId: null,
      archetype: "GHOST",
      channel: "phone",
      provenanceKind: "trainer_source",
      requestId: `usage:${mission.id}`,
    });

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const outcomes = await db
      .select()
      .from(armoryWeaponOutcomes)
      .where(inArray(armoryWeaponOutcomes.missionId, [mission.id]));
    expect(outcomes).toHaveLength(0);
  });

  it("real lost outcome is associated accurately, not classified as a win", async () => {
    const tenantId = `t45-lost-${randomUUID().slice(0, 8)}`;
    const actorId = `driver-${randomUUID().slice(0, 8)}`;
    createdTenants.add(tenantId);
    const mission = await createCommercialMission(
      missionInput({ tenantId, assignedTo: actorId, idempotencyKey: `create:${tenantId}` })
    );
    createdMissionIds.push(mission.id);

    await recordArmoryWeaponUsage({
      tenantId,
      actorId,
      missionId: mission.id,
      weaponId: `framework:${randomUUID()}`,
      frameworkId: null,
      archetype: "STALLER",
      channel: "follow_up",
      provenanceKind: "trainer_source",
      requestId: `usage:${mission.id}`,
    });

    const missionVersion = await advanceToVisitCompleted({ tenantId, missionId: mission.id, actorId: "test-operator" });
    const pipelineId = await pipelineIdForMission(tenantId, mission.id);

    await resolveCommercialPipelineMission({
      tenantId,
      pipelineId,
      expectedMissionVersion: missionVersion,
      action: "lost",
      actorId: "test-operator",
      requestId: `resolve:${mission.id}`,
    });

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const outcomes = await db
      .select()
      .from(armoryWeaponOutcomes)
      .where(inArray(armoryWeaponOutcomes.missionId, [mission.id]));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcomeKind).toBe("account_lost");
  });

  it("tenant isolation: Tenant A's outcome never appears in Tenant B's evidence", async () => {
    const tenantA = `t45-isoA-${randomUUID().slice(0, 8)}`;
    const tenantB = `t45-isoB-${randomUUID().slice(0, 8)}`;
    const actorId = `driver-${randomUUID().slice(0, 8)}`;
    createdTenants.add(tenantA);
    createdTenants.add(tenantB);
    const sharedWeaponId = `framework:${randomUUID()}`;

    const missionA = await createCommercialMission(
      missionInput({ tenantId: tenantA, assignedTo: actorId, idempotencyKey: `create:${tenantA}` })
    );
    createdMissionIds.push(missionA.id);
    await recordArmoryWeaponUsage({
      tenantId: tenantA,
      actorId,
      missionId: missionA.id,
      weaponId: sharedWeaponId,
      frameworkId: null,
      archetype: "ANCHOR",
      channel: "in_person",
      provenanceKind: "trainer_source",
      requestId: `usage:${missionA.id}`,
    });
    const missionVersion = await advanceToVisitCompleted({ tenantId: tenantA, missionId: missionA.id, actorId: "test-operator" });
    const pipelineA = await pipelineIdForMission(tenantA, missionA.id);
    await resolveCommercialPipelineMission({
      tenantId: tenantA,
      pipelineId: pipelineA,
      expectedMissionVersion: missionVersion,
      action: "won",
      actorId: "test-operator",
      requestId: `resolve:${missionA.id}`,
    });

    const usageB = await listMissionWeaponUsage({ tenantId: tenantB, actorId, missionId: missionA.id });
    expect(usageB).toHaveLength(0);

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const outcomesForTenantB = await db
      .select()
      .from(armoryWeaponOutcomes)
      .where(inArray(armoryWeaponOutcomes.tenantId, [tenantB]));
    expect(outcomesForTenantB).toHaveLength(0);
  });
});
