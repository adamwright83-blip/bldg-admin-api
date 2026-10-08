#!/usr/bin/env tsx
/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/**
 * Executable Field Proof Witness: Goldline Growth Loop
 *
 * Verifies the full closed-loop lineage of the Persistent Growth Operator through
 * ACTUAL production entry points:
 *
 *   Goal Run -> Real Commercial Mission -> Decision -> Objective ->
 *   Real Day Line (readCurrentDayLine) -> Real Driver Completion (transitionCommercialMission) ->
 *   Real Commercial Event ID -> Action Outcome -> Real CleanCloud Ingestion (importCleanCloudPaidOrders) ->
 *   Deterministic Economic Outcome -> Automatic Learned Delta -> Scoreboard Movement ->
 *   Loadout Delta Re-ranking -> Full Operation Receipt
 *
 * Absolute Truth Rules Enforced:
 *   1. Driver/Day Line -> Action Verification (deterministic lineage, actual persisted
 *      commercial_mission_events.id, zero manufactured revenue from visit completion).
 *   2. CleanCloud -> Economic Outcome (no heuristic matching; explicit customer/account
 *      lineage; fails closed on ambiguity; preserves delayed attribution).
 *   3. Outcome -> Automatic Learning (crash-safe, eventual consistency via pending learning sweeper).
 *   4. Zero manufactured proof: fails immediately with exit code 1 if MySQL database is offline.
 *      Never generates fake outcomes or prints simulated success.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../server/db";
import {
  createCommercialMission,
  transitionCommercialMission,
} from "../server/commercialMissions/commercialMissionStore";
import { readCurrentDayLine } from "../server/planning/dayline/currentDayLineService";
import { businessDateInZone } from "../shared/currentDayLine";
import { getDashboardTimeZone } from "../server/dashboardZoned";
import { importCleanCloudPaidOrders } from "../server/integrations/cleancloud/cleancloudPaidOrders";
import {
  materializeGoalCycleObjective,
  getGoalCycleObjective,
} from "../server/agents/persistentOperator/objectiveStore";
import {
  appendGoalCycleDecision,
  type GoalCycleDecisionDraft,
} from "../server/agents/persistentOperator/decisionStore";
import {
  getAuthoritativeScoreboard,
  getLoadoutDelta,
  getPersistentGrowthHistory,
} from "../server/agents/persistentOperator/proofReadModels";
import { operationReceipt } from "../server/agents/persistentOperator/operationReceipt";
import { processPendingOutcomeLearnings } from "../server/agents/persistentOperator/learningStore";
import {
  macroGoalRuns,
  goalCycleOutcomes,
  goalCycleLearnedDeltas,
  commercialMissionEvents,
} from "../drizzle/schema";
import type { WeeklyGrowthCandidate } from "../shared/weeklyGrowthCandidates";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function logStep(stepNum: number, title: string, details: Record<string, unknown>) {
  console.log(`\n${BOLD}${CYAN}[Step ${stepNum}] ${title}${RESET}`);
  for (const [k, v] of Object.entries(details)) {
    const valStr = typeof v === "object" ? JSON.stringify(v) : String(v);
    console.log(`  ${DIM}•${RESET} ${k}: ${BOLD}${valStr}${RESET}`);
  }
}

async function runWitness() {
  console.log(`${BOLD}================================================================${RESET}`);
  console.log(`${BOLD}   JOYSTICK / Goldline — Persistent Growth Operator Witness   ${RESET}`);
  console.log(`${BOLD}================================================================${RESET}`);

  const db = await getDb();
  if (!db) {
    console.error(`\n${BOLD}${RED}FATAL: Live MySQL database is required to witness real persisted lineage.${RESET}`);
    console.error("The executable witness refuses to manufacture fake proof or simulate success.");
    console.error("Please configure DATABASE_URL to execute the full field proof.\n");
    process.exit(1);
  }

  console.log(`${GREEN}✓ Connected to live MySQL database. Exercising real DB persistence.${RESET}`);

  const runId = randomUUID();
  const cycleId = randomUUID();
  const decisionId = randomUUID();
  const tenantId = `t-witness-${runId.slice(0, 8)}`;
  const operatorUserId = `driver-${runId.slice(0, 6)}`;
  const canonicalOperatorId = `tenant:${tenantId}:operator:${operatorUserId}`;
  const cleancloudCustomerId = 80000 + Math.floor(Math.random() * 10000);
  const now = new Date();
  const businessDate = businessDateInZone(now, getDashboardTimeZone());

  // ==========================================================================
  // SMOKE CHECK 1: Empty Production State
  // ==========================================================================
  console.log(`\n${BOLD}--- Production Read Smoke State 1: Empty Production State ---${RESET}`);
  const emptyTenantId = `t-empty-${randomUUID().slice(0, 8)}`;
  const emptyScoreboard = await getAuthoritativeScoreboard({
    tenantId: emptyTenantId,
    canonicalOperatorId: `tenant:${emptyTenantId}:operator:none`,
  });
  console.log(`  Empty Scoreboard Coverage: ${emptyScoreboard.coverage}, Executed: ${emptyScoreboard.executedWorkCount}, Attributed Revenue: ${emptyScoreboard.attributableEconomicValueCents}`);
  const emptyDelta = await getLoadoutDelta({ tenantId: emptyTenantId });
  console.log(`  Empty Loadout Delta: ${emptyDelta ?? "null (no unbacked deltas)"}`);

  // ==========================================================================
  // STEP 1: Macro Goal Run Persistence
  // ==========================================================================
  const baselineValue = 500;
  const targetValue = 2000;
  const metricKey = "commercial_revenue";

  await db.insert(macroGoalRuns).values({
    id: runId,
    tenantId,
    canonicalOperatorId,
    operatorUserId,
    macroGoalId: `mg-${runId.slice(0, 8)}`,
    verticalKey: "commercial_laundry",
    goalSnapshotJson: { title: "Reach $2,000 weekly commercial revenue" },
    metricKey,
    targetValue: String(targetValue),
    unit: "dollars",
    baselineObservationRef: "baseline:cleancloud:prior_week",
    baselineValue: String(baselineValue),
    baselinePrecision: "exact",
    baselineCoverage: "complete",
    startedAt: new Date(Date.now() - 3600 * 1000 * 12),
    policyVersion: "2026.1",
  });

  logStep(1, "Macro Goal Run Persisted", {
    goalRunId: runId,
    tenantId,
    canonicalOperatorId,
    metricKey,
    baselineValue: `$${baselineValue}.00`,
    targetValue: `$${targetValue}.00`,
    precision: "exact",
  });

  // ==========================================================================
  // STEP 2: Real Commercial Mission Created (Authoritative Pipeline State)
  // ==========================================================================
  const customerEmail = `billing-${runId.slice(0, 6)}@acmeindustrial.com`;
  const realMission = await createCommercialMission({
    tenantId,
    assignedTo: operatorUserId,
    account: {
      name: "Acme Industrial Laundry Partner",
      accountType: "commercial_laundry",
      providerName: "cleancloud",
      providerAccountId: String(cleancloudCustomerId),
    },
    opportunity: {
      title: "Commercial Linens Route",
      estimatedMonthlyCents: 50000,
    },
    brief: {
      salesAngle: "Commercial laundry pickup and delivery service",
    },
    steps: [],
    actor: { type: "system", id: "system", role: "admin" },
    idempotencyKey: `cm-create-${runId}`,
  });

  logStep(2, "Real Commercial Mission Created in Database", {
    missionId: realMission.id,
    accountName: realMission.account.name,
    providerAccountId: realMission.account.providerAccountId,
    assignedTo: realMission.assignedTo,
    status: realMission.status,
    version: realMission.version,
  });

  // ==========================================================================
  // STEP 3: Goal Cycle Decision & Objective Materialized
  // ==========================================================================
  const packedTechnique = "doctrine:field_first";
  const candidateRef: WeeklyGrowthCandidate = {
    id: `cand-${realMission.id}`,
    tenantId,
    sourceRefs: [
      {
        sourceType: "commercial_mission",
        sourceId: String(realMission.id),
      },
    ],
    title: `Visit: ${realMission.account.name}`,
    objective: "In-person commercial acquisition visit",
    executionType: "mission",
    recommendedLoadout: [
      {
        id: `weapon-${runId.slice(0, 6)}`,
        label: "Field-First Commercial Doctrine",
        kind: "doctrine",
        detail: "Execute in-person discovery and qualification",
        sourceRef: `teaching:${packedTechnique}`,
        key: packedTechnique,
      },
    ],
    grounding: "commercial_acquisition",
    motionHint: "account_acquisition",
    rankScore: 0.95,
    scoreFactors: [],
    warnings: [],
  };

  const decisionDraft: GoalCycleDecisionDraft = {
    tenantId,
    goalRunId: runId,
    cycleId,
    canonicalOperatorId,
    operatorUserId,
    policyVersion: "2026.1",
    weeklyIntentId: `intent-${runId.slice(0, 6)}`,
    weeklyIntentRevision: 1,
    weekStart: businessDate,
    candidateFingerprint: `cand-fp-${runId.slice(0, 6)}`,
    candidateIds: [candidateRef.id],
    candidateReasonCodes: { [candidateRef.id]: ["LOCAL_ROUTE_DENSITY"] },
    missionDirectorPlanId: `plan-${runId.slice(0, 6)}`,
    missionDirectorRevision: 1,
    selectionKind: "candidate",
    selectedRef: candidateRef.id,
    selectedExecutionType: "mission",
    selectedReasonCode: "PRIMARY_CANDIDATE",
    evidenceRefs: [`commercial_missions:${realMission.id}`],
    blockedCandidates: [],
    priorComparableDecisionId: null,
    sourceCoverage: { verifiedCount: 1 },
    loadout: candidateRef.recommendedLoadout,
  };

  const decisionResult = await appendGoalCycleDecision(decisionDraft);
  const decision = decisionResult.decision;
  const { objective } = await materializeGoalCycleObjective({
    tenantId,
    decision,
    candidate: candidateRef,
    businessDate,
  });

  logStep(3, "Persistent Growth Objective Materialized", {
    decisionId: decision.id,
    objectiveId: objective.id,
    title: objective.title,
    actionTargetType: objective.actionTargetType,
    actionTargetId: objective.actionTargetId,
    executionType: objective.executionType,
    packedTechnique,
  });

  // ==========================================================================
  // STEP 4: Real Production Day Line Integration Verified
  // ==========================================================================
  const dayLine = await readCurrentDayLine({
    tenantId,
    operatorId: operatorUserId,
    operatorUserId,
    businessDate,
  });

  const dayLineItem = dayLine.items.find(item => item.id === objective.id);
  if (!dayLineItem) {
    throw new Error(`Production Day Line failed to surface Persistent Objective ${objective.id}`);
  }

  logStep(4, "Production Day Line Verified (currentDayLineService)", {
    rankingStatus: dayLine.rankingStatus,
    surfacedObjectiveId: dayLineItem.id,
    title: dayLineItem.title,
    executionType: dayLineItem.executionType,
    fieldRequired: dayLineItem.executionContract.fieldRequired,
  });

  // ==========================================================================
  // STEP 5: Real Driver Completion via transitionCommercialMission
  // ==========================================================================
  const transitionKey = `trans-visit-${runId}`;
  const lifecycleStatuses = [
    "selected",
    "game_ready",
    "game_active",
    "game_completed",
    "phone_ready",
    "preparing",
    "en_route",
    "arrived",
    "visit_completed",
  ] as const;

  let currentVersion = realMission.version;
  let transitionedMission = realMission;
  for (const toStatus of lifecycleStatuses) {
    const isFinal = toStatus === "visit_completed";
    const idempotencyKey = isFinal ? transitionKey : `trans-${toStatus}-${runId}`;
    transitionedMission = await transitionCommercialMission({
      tenantId,
      missionId: realMission.id,
      expectedVersion: currentVersion,
      toStatus,
      actor: { type: "driver", id: operatorUserId, role: "field_operator" },
      idempotencyKey,
    });
    currentVersion = transitionedMission.version;
  }

  // Query the persisted event in MySQL
  const [persistedEvent] = await db
    .select({ id: commercialMissionEvents.id })
    .from(commercialMissionEvents)
    .where(
      and(
        eq(commercialMissionEvents.tenantId, tenantId),
        eq(commercialMissionEvents.idempotencyKey, transitionKey)
      )
    )
    .limit(1);

  if (!persistedEvent) {
    throw new Error("Commercial mission transition event was not persisted to MySQL");
  }

  const expectedEvidenceRef = `commercial_mission_events:${persistedEvent.id}`;

  // Query the resulting action verification outcome
  const [actionOutcome] = await db
    .select()
    .from(goalCycleOutcomes)
    .where(
      and(
        eq(goalCycleOutcomes.tenantId, tenantId),
        eq(goalCycleOutcomes.objectiveId, objective.id),
        eq(goalCycleOutcomes.impactClass, "action_verification")
      )
    )
    .limit(1);

  if (!actionOutcome) {
    throw new Error("Driver action bridge did not record action_verification outcome");
  }
  if (actionOutcome.monetaryValueCents !== null) {
    throw new Error("Truth violation: action_verification manufactured economic revenue!");
  }
  if (actionOutcome.evidenceReference !== expectedEvidenceRef) {
    throw new Error(
      `Evidence ref mismatch: expected ${expectedEvidenceRef}, got ${actionOutcome.evidenceReference}`
    );
  }

  logStep(5, "Real Driver Completion & Action Outcome Verified", {
    transitionedStatus: transitionedMission.status,
    persistedEventId: persistedEvent.id,
    evidenceReference: actionOutcome.evidenceReference,
    impactClass: actionOutcome.impactClass,
    monetaryValueCents: "null (Truth Rule 1: No manufactured revenue)",
    epistemicStatus: actionOutcome.epistemicStatus,
  });

  // ==========================================================================
  // SMOKE CHECK 2: Action-Only State
  // ==========================================================================
  console.log(`\n${BOLD}--- Production Read Smoke State 2: Action-Only State ---${RESET}`);
  const actionScoreboard = await getAuthoritativeScoreboard({
    tenantId,
    canonicalOperatorId,
  });
  console.log(`  Scoreboard Executed Work: ${actionScoreboard.executedWorkCount}, Attributed Economic Value: ${actionScoreboard.attributableEconomicValueCents ?? "$0 (null)"}`);

  // ==========================================================================
  // STEP 6: Real CleanCloud Production Ingestion (importCleanCloudPaidOrders)
  // ==========================================================================
  const cleancloudOrderId = 90000 + Math.floor(Math.random() * 10000);
  const paidCents = 45000; // $450.00
  const orderCsv = [
    "Order ID,Customer,Total,Payment Date,Paid,Email,Phone,Address,Customer ID",
    `${cleancloudOrderId},Acme Industrial Laundry Partner,$450.00,${businessDate} 14:00,TRUE,${customerEmail},555-0199,100 Industrial Parkway,${cleancloudCustomerId}`,
  ].join("\n");

  const importSummary = await importCleanCloudPaidOrders({
    csvText: orderCsv,
    sourceReportType: "orders_sales",
    tenantId,
    sourceFileName: `witness-${runId}.csv`,
  });

  if (importSummary.importedRowCount < 1) {
    throw new Error("CleanCloud paid order import failed to insert row");
  }

  // Query the resulting economic outcome
  const [economicOutcome] = await db
    .select()
    .from(goalCycleOutcomes)
    .where(
      and(
        eq(goalCycleOutcomes.tenantId, tenantId),
        eq(goalCycleOutcomes.objectiveId, objective.id),
        eq(goalCycleOutcomes.impactClass, "commercial_revenue")
      )
    )
    .limit(1);

  if (!economicOutcome) {
    throw new Error("CleanCloud production bridge failed to bind economic outcome");
  }
  if (economicOutcome.monetaryValueCents !== paidCents) {
    throw new Error(
      `Economic value mismatch: expected ${paidCents}, found ${economicOutcome.monetaryValueCents}`
    );
  }

  logStep(6, "Real CleanCloud Production Ingestion & Economic Binding Verified", {
    cleancloudOrderId,
    cleancloudCustomerId,
    importedRowCount: importSummary.importedRowCount,
    economicOutcomeId: economicOutcome.id,
    impactClass: economicOutcome.impactClass,
    monetaryValueCents: `$${(paidCents / 100).toFixed(2)} (${paidCents} cents)`,
    evidenceReference: economicOutcome.evidenceReference,
    sourceSystem: economicOutcome.sourceSystem,
  });

  // ==========================================================================
  // STEP 7: Reconcile Pending Learnings (Eventual Consistency Sweeper)
  // ==========================================================================
  const sweeperResult = await processPendingOutcomeLearnings({ tenantId });
  logStep(7, "Automatic Learning Sweeper Executed (Crash-Safe Outbox)", {
    processedOutcomes: sweeperResult.processedCount,
    errors: sweeperResult.errors.length,
  });

  // Verify learned deltas in database
  const learnedDeltas = await db
    .select()
    .from(goalCycleLearnedDeltas)
    .where(eq(goalCycleLearnedDeltas.tenantId, tenantId));

  if (learnedDeltas.length === 0) {
    throw new Error("Automatic learning failed to produce goal_cycle_learned_deltas row");
  }

  const latestDelta = learnedDeltas[0]!;
  logStep(8, "Learned Delta Verified in MySQL", {
    deltaId: latestDelta.id,
    targetKey: latestDelta.targetKey,
    learningKind: latestDelta.learningKind,
    deltaType: latestDelta.deltaType,
    confidence: latestDelta.confidence,
    appliedCount: latestDelta.appliedCount,
  });

  // ==========================================================================
  // STEP 8: Read Models Verified Purely Against Real Database
  // ==========================================================================
  console.log(`\n${BOLD}--- Production Read Smoke State 3 & 4: Scoreboard & Loadout Proof ---${RESET}`);
  const finalScoreboard = await getAuthoritativeScoreboard({
    tenantId,
    canonicalOperatorId,
  });

  const expectedObservedValue = baselineValue + paidCents / 100; // 500 + 450 = 950
  const expectedRemainingGap = Math.max(0, targetValue - expectedObservedValue); // 2000 - 950 = 1050

  logStep(9, "Authoritative Scoreboard Proven", {
    baselineValue: `$${baselineValue}.00`,
    executedWorkCount: finalScoreboard.executedWorkCount,
    attributableEconomicValueCents: finalScoreboard.attributableEconomicValueCents,
    authoritativeObservedValue: `$${finalScoreboard.authoritativeObservedValue}.00`,
    expectedObservedValue: `$${expectedObservedValue}.00`,
    targetValue: `$${finalScoreboard.targetValue}.00`,
    remainingGap: `$${finalScoreboard.remainingGap}.00 (Expected: $${expectedRemainingGap}.00)`,
    precision: finalScoreboard.precision,
    coverage: finalScoreboard.coverage,
  });

  if (finalScoreboard.authoritativeObservedValue !== expectedObservedValue) {
    throw new Error(
      `Scoreboard value mismatch: expected ${expectedObservedValue}, got ${finalScoreboard.authoritativeObservedValue}`
    );
  }

  const finalLoadoutDelta = await getLoadoutDelta({
    tenantId,
    canonicalOperatorId,
  });

  if (!finalLoadoutDelta) {
    throw new Error("getLoadoutDelta returned null for learned tenant");
  }

  const finalReceipt = await operationReceipt({ tenantId, decisionId: decision.id });
  if (!finalReceipt) {
    throw new Error("operationReceipt returned null for decision");
  }

  logStep(10, "Operation Receipt & Loadout Delta Proven", {
    decisionId: finalReceipt.decisionId,
    verificationStatus: finalReceipt.verification.status,
    businessOutcomeStatus: finalReceipt.businessOutcome.status,
    economicStatus: finalReceipt.economicObservation.status,
    loadoutDeltaTarget: finalLoadoutDelta.targetKey,
    loadoutDeltaType: finalLoadoutDelta.deltaType,
  });

  const history = await getPersistentGrowthHistory({
    tenantId,
    canonicalOperatorId,
  });
  console.log(`  History Items: ${history.length}, Latest Decision: ${history[0]?.decisionId}`);

  console.log(`\n${BOLD}${GREEN}================================================================${RESET}`);
  console.log(`${BOLD}${GREEN}   FULL GOLDLINE GROWTH LOOP VERIFIED WITH DURABLE LINEAGE!   ${RESET}`);
  console.log(`${BOLD}${GREEN}   ALL 8 ARCHITECTURAL REQUIREMENTS PROVEN ON PRODUCTION ENTRY POINTS ${RESET}`);
  console.log(`${BOLD}${GREEN}================================================================${RESET}\n`);
}

runWitness()
  .then(() => {
    process.exit(0);
  })
  .catch(err => {
    console.error(`\n${BOLD}${RED}Witness execution failed with error:${RESET}`, err);
    process.exit(1);
  });
