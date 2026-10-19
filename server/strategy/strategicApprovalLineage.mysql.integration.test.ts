/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { addCalendarDays } from "../../shared/weeklyGrowthCandidates";
import { weekStartMonday } from "../../shared/weeklyMissionReadiness";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";
import { appendGoalCycleDecision } from "../agents/persistentOperator/decisionStore";
import { resolveCanonicalOperatorIdentity, type CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { materializeGoalCycleObjective, transitionObjectiveStatus } from "../agents/persistentOperator/objectiveStore";
import { readVerifiedStrategicApprovalItemIds, respondToStrategicProposal } from "./strategicApproval";
import { persistStrategicProposal } from "./strategicStore";

/**
 * Real-MySQL proof for Stage 1 Phase 3 (c): approving a persisted proposal
 * attaches each item to the goal objective its outcomes will bind to, and
 * reports an item with no objective plainly instead of as verified progress.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const zone = "America/Los_Angeles";

describeMysql("strategic approval on MySQL establishes objective lineage", () => {
  let sql: mysql.Connection;
  beforeAll(async () => {
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
  });
  afterAll(async () => {
    await sql?.end();
  });

  async function operator() {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `lineage-${suffix}`;
    const openId = `lineage-owner-${suffix}`;
    await sql.execute(
      "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
      [tenantId, tenantId, "Lineage test", "Lineage test", "#123456", "Op", "op@example.invalid", zone]
    );
    await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')", [tenantId, openId, "Op", "op@example.invalid"]);
    await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)", [tenantId, openId]);
    await sql.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)", [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: openId }, subsystem: "approval_lineage_test" });
    if (!resolved.ok) throw new Error("identity");
    const runId = randomUUID();
    await sql.execute(
      `INSERT INTO macro_goal_runs
        (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
         status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
         baselineCoverage, policyVersion)
       VALUES (?, ?, ?, ?, ?, 'laundry_fluff_fold', 'active', '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
      [runId, tenantId, resolved.identity.canonicalOperatorId, openId, randomUUID()]
    );
    return { identity: resolved.identity, runId };
  }

  /** The goal cycle selecting `candidateId`: a real decision and its presented objective. */
  async function goalCycleObjective(identity: CanonicalOperatorIdentity, runId: string, candidateId: string, businessDate: string) {
    const { decision } = await appendGoalCycleDecision({
      tenantId: identity.tenantId, goalRunId: runId, cycleId: randomUUID(),
      canonicalOperatorId: identity.canonicalOperatorId, operatorUserId: identity.canonicalOpenId, policyVersion: "v1",
      weeklyIntentId: null, weeklyIntentRevision: null, weekStart: null, candidateFingerprint: null,
      candidateIds: [candidateId], candidateReasonCodes: {}, missionDirectorPlanId: null, missionDirectorRevision: null,
      selectionKind: "candidate", selectedRef: candidateId, selectedExecutionType: "challenge",
      selectedReasonCode: "MISSION_DIRECTOR_PRIMARY", evidenceRefs: [], blockedCandidates: [], priorComparableDecisionId: null,
      sourceCoverage: {}, loadout: [], experiment: null,
    });
    return (await materializeGoalCycleObjective({ tenantId: identity.tenantId, decision, businessDate })).objective;
  }

  async function proposal(identity: CanonicalOperatorIdentity, items: Array<{ key: string; candidateId: string; businessDate: string }>, now: Date) {
    const businessDate = formatInTimeZone(now, zone, "yyyy-MM-dd");
    const revision = createHash("sha256").update(randomUUID()).digest("hex");
    const p = {
      id: `proposal_${revision.slice(0, 40)}`,
      schemaVersion: 1,
      revision,
      tenantId: identity.tenantId,
      canonicalOperatorId: identity.canonicalOperatorId,
      operatorUserId: identity.canonicalOpenId,
      dayDirectorActorId: identity.dayDirectorActorId,
      weekStart: weekStartMonday(businessDate),
      businessDate,
      timeZone: zone,
      preparedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 6 * 3_600_000).toISOString(),
      diagnosis: { id: `diagnosis_${revision.slice(0, 12)}`, actions: [], quality: { structuralErrors: [], judgment: "unreviewed", reasons: [] } },
      items: items.map(item => ({
        id: `${item.businessDate}:${item.key}`,
        businessDate: item.businessDate,
        title: `Call ${item.key}`,
        objective: `Call ${item.key} to win back their weekly order`,
        executionType: "challenge" as const,
        candidateId: item.candidateId,
        planId: `mission_director_plan:${item.key}`,
        planRevision: 1,
        evidenceRefs: [],
      })),
      constraints: [],
      uncertainty: [],
      opening: "Approve, revise, reject or defer.",
      approvalState: "pending",
    } as unknown as StrategicPlanningProposal;
    return persistStrategicProposal(p);
  }

  async function commitmentLineage(tenantId: string, commitmentId: string) {
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT metadataJson FROM day_director_commitments WHERE tenantId = ? AND id = ?",
      [tenantId, commitmentId]
    );
    const metadata = typeof rows[0]!.metadataJson === "string" ? JSON.parse(rows[0]!.metadataJson) : rows[0]!.metadataJson;
    return metadata.objectiveLineage;
  }

  it("attaches each approved item to its open goal objective, and names the one that has none", async () => {
    const { identity, runId } = await operator();
    const now = new Date();
    const day = addCalendarDays(formatInTimeZone(now, zone, "yyyy-MM-dd"), 1);
    const presented = await goalCycleObjective(identity, runId, "candidate:alma", day);
    const started = await goalCycleObjective(identity, runId, "candidate:bea", day);
    await transitionObjectiveStatus({ tenantId: identity.tenantId, objectiveId: started.id, toStatus: "in_progress" });
    const p = await proposal(identity, [
      { key: "alma", candidateId: "candidate:alma", businessDate: day },
      { key: "bea", candidateId: "candidate:bea", businessDate: day },
      { key: "cruz", candidateId: "candidate:cruz", businessDate: day },
    ], now);

    const result = await respondToStrategicProposal({
      identity, proposalId: p.id, revision: p.revision, action: "approve",
      itemIds: p.items.map(i => i.id), source: "authenticated_app", now,
    });

    expect(result.failedItems).toEqual([]);
    expect(result.actionIds).toHaveLength(3);
    expect(result.speech).not.toMatch(/added and verified/);
    expect(result.unboundItems).toEqual([`${day}:cruz`]);
    expect(result.speech).toContain("Verified and linked to the goal: Call alma; Call bea.");
    expect(result.speech).toContain("Not linked to a goal objective, so results on it cannot count toward the goal: Call cruz.");

    const [alma, bea, cruz] = result.actionIds;
    expect(await commitmentLineage(identity.tenantId, alma!)).toEqual({ objectiveId: presented.id, objectiveStatus: "accepted" });
    expect(await commitmentLineage(identity.tenantId, bea!)).toEqual({ objectiveId: started.id, objectiveStatus: "in_progress" });
    expect(await commitmentLineage(identity.tenantId, cruz!)).toEqual({ objectiveId: null, reason: "no_open_goal_objective" });

    const [objectives] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id, status, statusReason FROM goal_cycle_objectives WHERE tenantId = ? ORDER BY createdAt",
      [identity.tenantId]
    );
    expect(objectives).toHaveLength(2); // approval never invents an objective
    expect(objectives.find(o => o.id === presented.id)).toMatchObject({ status: "accepted", statusReason: expect.stringContaining(result.responseId) });
    expect(objectives.find(o => o.id === started.id)).toMatchObject({ status: "in_progress" });

    // The commitments themselves are still the verified, approved Day Line work.
    expect((await readVerifiedStrategicApprovalItemIds(identity, p)).sort()).toEqual(p.items.map(i => i.id).sort());
  });

  it("when every item is linked, approval reads exactly as before", async () => {
    const { identity, runId } = await operator();
    const now = new Date();
    const day = addCalendarDays(formatInTimeZone(now, zone, "yyyy-MM-dd"), 1);
    const objective = await goalCycleObjective(identity, runId, "candidate:dana", day);
    const p = await proposal(identity, [{ key: "dana", candidateId: "candidate:dana", businessDate: day }], now);
    const result = await respondToStrategicProposal({
      identity, proposalId: p.id, revision: p.revision, action: "approve",
      itemIds: [p.items[0]!.id], source: "authenticated_app", now,
    });
    expect(result.unboundItems).toEqual([]);
    expect(result.speech).toBe("1 approved item(s) added and verified in the Day Line: Call dana.");
    expect(await commitmentLineage(identity.tenantId, result.actionIds[0]!)).toEqual({ objectiveId: objective.id, objectiveStatus: "accepted" });
  });
});
