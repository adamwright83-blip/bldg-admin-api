/* LEGACY DAYFORGE COMPATIBILITY: test-only fixture table literals. */
/**
 * The Goldline presentation decision point against a real (disposable) MySQL:
 * Daphne's MRT assignment is recorded where it is made, real ops-task
 * transitions are joined back to it, joined skips throttle the next occasion,
 * and an operator without safe_experimentation consent gets nothing recorded.
 *
 *   docker run -d --name daphne-mrt-mysql -e MYSQL_ROOT_PASSWORD=test-only -e MYSQL_DATABASE=daphne_mrt_test -p 3308:3306 mysql:8.0
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3308/daphne_mrt_test node scripts/migrate.mjs
 *   DATABASE_URL=mysql://root:test-only@127.0.0.1:3308/daphne_mrt_test \
 *     pnpm vitest run --config vitest.integration.config.ts server/behavioralExperiment/presentationDecision.mysql.integration.test.ts
 *
 * Real: consent (daphne_meta_preferences), declared presentation (daphne_observations),
 * policy (GOLDLINE_BEHAVIORAL_MRT), ledger writes and reads, ops-task transitions.
 * Injected: the canonical campaign grammar (it needs a whole campaign world) and
 * the arm index, so the test can choose which arm the draw lands on.
 */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ActionGrammar } from "../../shared/actionGrammar";
import { STANDARD_PRESENTATION } from "../../shared/behavioralInterventionMapping";
import { resolveCanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { setDaphneMetaPreference } from "../agents/daphne/goalsPreferences";
import { recordMissionExplanation } from "../agents/daphne/missionFollowUp";
import { completeOpsTask, createOpsTask, updateOpsTaskStatus } from "../opsTasks";
import {
  assignAuthorizedPresentation,
  loadDeclaredPlainPresentation,
  loadPresentationConsent,
  type PresentationRuntimePorts,
} from "./presentationRuntime";
import { loadPresentationAssignmentOutcomes } from "./presentationOutcomes";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;

describeMysql("Daphne presentation MRT at the real decision point — disposable MySQL", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `daphne-mrt-${suffix}`;
  const consenting = `mrt-consent-${suffix}`;
  const unconsented = `mrt-no-consent-${suffix}`;
  const plainSpoken = `mrt-plain-${suffix}`;
  let db: mysql.Connection;
  const grammars = new Map<string, ActionGrammar>();
  let arm = 1;
  const ports: PresentationRuntimePorts = {
    loadConsent: loadPresentationConsent,
    loadDeclaredPlainPresentation,
    loadGrammar: async scope => grammars.get(scope.operatorUserId) ?? null,
    randomInt: () => arm,
  };
  const priorPolicyFlag = process.env.GOLDLINE_BEHAVIORAL_MRT;

  async function operator(openId: string, preferences: { safeExperimentation: boolean }) {
    await db.execute(
      "INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?, 'user','password')",
      [tenantId, openId, openId, `${openId}@example.invalid`]
    );
    await db.execute(
      "INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)",
      [tenantId, openId]
    );
    const resolved = await resolveCanonicalOperatorIdentity({
      tenantId, source: { type: "open_id", value: openId }, subsystem: "daphne_mrt_acceptance",
    });
    if (!resolved.ok) throw new Error(`Canonical operator unresolved: ${resolved.reason}`);
    const canonicalOperatorId = resolved.identity.canonicalOperatorId;
    await setDaphneMetaPreference({ tenantId, canonicalOperatorId, preferenceKey: "adaptation_enabled",
      value: true, sourceObservationId: `consent-adapt-${suffix}` });
    if (preferences.safeExperimentation)
      await setDaphneMetaPreference({ tenantId, canonicalOperatorId, preferenceKey: "safe_experimentation",
        value: true, sourceObservationId: `consent-exp-${suffix}` });
    return canonicalOperatorId;
  }

  /** One real ops task, presented as a VISIT_LOCATION chapter. */
  async function mission(openId: string) {
    const task = await createOpsTask({ tenantId, lane: "lane_1", level: "1", taskType: "stale_customer",
      title: "Visit the Wilshire lobby", assignedTo: openId, createdBy: openId });
    grammars.set(openId, { kind: "VISIT_LOCATION", businessActionId: String(task.id), occurrenceId: task.id,
      sourceType: "recovery", count: 1, locations: ["100 Wilshire"], channel: "in_person",
      requiresTravel: true, requiresDriving: false, timerSafe: true, sensitiveConversation: false });
    return { taskId: task.id, correlationId: `ops_task:${task.id}` };
  }

  async function ledgerRows(openId: string) {
    const [rows] = await db.query<mysql.RowDataPacket[]>(
      "SELECT * FROM behavioral_ledger_events WHERE tenantId = ? AND operatorUserId = ? ORDER BY id",
      [tenantId, openId]
    );
    return rows.map(row => ({
      ...row,
      eligibleOptionsJson: typeof row.eligibleOptionsJson === "string" ? JSON.parse(row.eligibleOptionsJson) : row.eligibleOptionsJson,
    }));
  }

  // MySQL TIMESTAMP rounds to the second; let a just-written outcome fall behind "now".
  const settle = () => new Promise(resolve => setTimeout(resolve, 1100));

  beforeAll(async () => {
    const host = new URL(DATABASE_URL!).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) throw new Error(`Refusing to write to non-local MySQL host ${host}`);
    process.env.GOLDLINE_BEHAVIORAL_MRT = "1";
    db = await mysql.createConnection(DATABASE_URL!);
    await db.execute(
      `INSERT INTO dayforge_saas_tenants
        (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
       VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [tenantId, tenantId, tenantId, tenantId, "#111111", tenantId, `${tenantId}@example.invalid`, "America/Los_Angeles"]
    );
  }, 120_000);

  afterAll(async () => {
    if (priorPolicyFlag === undefined) delete process.env.GOLDLINE_BEHAVIORAL_MRT;
    else process.env.GOLDLINE_BEHAVIORAL_MRT = priorPolicyFlag;
    await db?.end();
  });

  it("records each assignment where it is made, joins real outcomes to it, and throttles after joined skips", async () => {
    await operator(consenting, { safeExperimentation: true });

    // Occasion 1: randomized onto a story arm, then started and dismissed.
    const first = await mission(consenting);
    arm = 1;
    const chosen = await assignAuthorizedPresentation({ tenantId, operatorUserId: consenting,
      correlationId: first.correlationId, occasionId: "chapter-1" }, ports);
    expect(chosen.usedExperiment).toBe(true);
    if (!chosen.usedExperiment) throw new Error(chosen.skipReason);
    const decisionPointId = `${first.correlationId}:offer:chapter-1`;
    let rows = await ledgerRows(consenting);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: "ASSIGNED", correlationId: first.correlationId, decisionPointId, availability: 1,
      assignedOption: chosen.assignment.assignedOption, interventionPolicyVersion: 1, interventionDefinitionVersion: 1,
      proximalOutcomeWindowMinutes: 120, idempotencyKey: `mrt_assignment:${decisionPointId}`,
    });
    expect(rows[0].eligibleOptionsJson).toContain(STANDARD_PRESENTATION);
    expect(rows[0].eligibleOptionsJson.length).toBeGreaterThanOrEqual(2);
    expect(Number(rows[0].assignmentProbability)).toBeCloseTo(1 / rows[0].eligibleOptionsJson.length, 4);
    expect(rows[0].assignedOption).not.toBe(STANDARD_PRESENTATION);
    expect(String(rows[0].provenance)).toMatch(/^daphne_mrt_randomized_assignment:presentation_mrt_v1:1$/);

    // A replay of the same occasion (the client polls) reuses the durable row.
    arm = 0;
    const replay = await assignAuthorizedPresentation({ tenantId, operatorUserId: consenting,
      correlationId: first.correlationId, occasionId: "chapter-1" }, ports);
    expect(replay.assignment).toEqual(chosen.assignment);

    await updateOpsTaskStatus({ tenantId, taskId: first.taskId, status: "in_progress", actorId: consenting });
    await updateOpsTaskStatus({ tenantId, taskId: first.taskId, status: "dismissed", actorId: consenting });

    // Occasion 2: randomized onto a story arm, then completed.
    const second = await mission(consenting);
    arm = 2;
    await assignAuthorizedPresentation({ tenantId, operatorUserId: consenting,
      correlationId: second.correlationId, occasionId: "chapter-2" }, ports);
    await completeOpsTask({ tenantId, taskId: second.taskId, completedBy: consenting, outcome: "Visited" });

    await settle();
    const outcomes = await loadPresentationAssignmentOutcomes({ tenantId, operatorUserId: consenting });
    const skipped = outcomes.find(o => o.decisionPointId === decisionPointId)!;
    expect(skipped).toMatchObject({ outcome: "skipped", availability: true, assignedOption: chosen.assignment.assignedOption });
    expect(skipped.assignmentEventId).toBe(rows[0].id);
    expect(skipped.outcomeEvents.map(e => e.eventType)).toEqual(["STARTED", "DISMISSED"]);
    expect(skipped.proximal.startedWithinWindow).toBe(true);
    const completed = outcomes.find(o => o.correlationId === second.correlationId)!;
    expect(completed).toMatchObject({ outcome: "completed", decisiveEvent: { eventType: "COMPLETED", verificationClass: "CLAIMED" } });

    // Occasion 3: another story arm, dismissed. Two joined skips of story arms now sit in the fatigue window.
    const third = await mission(consenting);
    arm = 1;
    await assignAuthorizedPresentation({ tenantId, operatorUserId: consenting,
      correlationId: third.correlationId, occasionId: "chapter-3" }, ports);
    await updateOpsTaskStatus({ tenantId, taskId: third.taskId, status: "dismissed", actorId: consenting });
    await settle();

    // Occasion 4: Daphne throttles to the baseline, and that decision is recorded too.
    const fourth = await mission(consenting);
    const throttled = await assignAuthorizedPresentation({ tenantId, operatorUserId: consenting,
      correlationId: fourth.correlationId, occasionId: "chapter-4" }, ports);
    expect(throttled).toMatchObject({ usedExperiment: true, assignment: {
      availability: false, assignmentMechanism: "fatigue_throttle", assignedOption: STANDARD_PRESENTATION,
      assignmentProbability: null, preferredTemplateId: null } });
    rows = await ledgerRows(consenting);
    const throttleRow = rows.find(row => row.decisionPointId === `${fourth.correlationId}:offer:chapter-4`)!;
    expect(throttleRow).toMatchObject({ eventType: "ASSIGNED", availability: 0, assignedOption: STANDARD_PRESENTATION,
      assignmentProbability: null, interventionPolicyVersion: 1, interventionDefinitionVersion: 1, proximalOutcomeWindowMinutes: 120 });
    expect(throttleRow.eligibleOptionsJson).toContain(STANDARD_PRESENTATION);
    expect(String(throttleRow.provenance)).toContain("daphne_fatigue_throttle:burden_skip_threshold_exceeded");
    expect(String(throttleRow.evidenceSource)).toMatch(/^daphne_evidence:behavioral_ledger_events:\d+,behavioral_ledger_events:\d+$/);
    expect(rows.filter(row => row.eventType === "ASSIGNED")).toHaveLength(4);
  }, 120_000);

  it("gives an operator without safe_experimentation consent no arm and records nothing", async () => {
    await operator(unconsented, { safeExperimentation: false });
    const work = await mission(unconsented);
    arm = 1;
    const result = await assignAuthorizedPresentation({ tenantId, operatorUserId: unconsented,
      correlationId: work.correlationId, occasionId: "chapter-1" }, ports);
    expect(result).toMatchObject({ usedExperiment: false, assignment: null,
      skipReason: "fresh_operator_experimentation_consent_required" });
    expect(result.consent).toMatchObject({ adaptationAllowed: true, experimentationAllowed: false });
    expect(await ledgerRows(unconsented)).toHaveLength(0);
  }, 120_000);

  it("honours the operator's own request for plain presentation as a recorded baseline", async () => {
    const canonicalOperatorId = await operator(plainSpoken, { safeExperimentation: true });
    const explained = await recordMissionExplanation({ tenantId, canonicalOperatorId, operatorUserId: plainSpoken,
      missionType: "growth", answer: "Too much story. Just tell me what to do.",
      sourceType: "day_line_unresolved_explanation", sourceReference: `acceptance:${suffix}`,
      idempotencyKey: `mrt-plain:${suffix}` });
    expect(explained.adjustmentObservationId).toBeTruthy();
    const work = await mission(plainSpoken);
    arm = 1;
    const result = await assignAuthorizedPresentation({ tenantId, operatorUserId: plainSpoken,
      correlationId: work.correlationId, occasionId: "chapter-1" }, ports);
    expect(result).toMatchObject({ usedExperiment: true, assignment: { availability: false, preferredTemplateId: null } });
    const [row] = await ledgerRows(plainSpoken);
    expect(row).toMatchObject({ availability: 0, assignedOption: STANDARD_PRESENTATION,
      evidenceSource: `daphne_evidence:daphne_observations:${explained.adjustmentObservationId}` });
    expect(String(row.provenance)).toContain("daphne_fatigue_throttle:explicit_dislike_reported");
  }, 120_000);
});
