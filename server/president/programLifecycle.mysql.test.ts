import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evidenceHash, MysqlPresidentIntelligenceStore } from "./intelligenceStore";
import { PresidentProgramService } from "./programService";
import { MysqlPresidentProgramStore } from "./programStore";

let pool: Pool;

async function apply(path: string) {
  const sql = await readFile(resolve(import.meta.dirname, "../../drizzle", path), "utf8");
  for (const statement of sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map(value => value.trim())
    .filter(Boolean))
    await pool.query(statement);
}

describe.skipIf(process.env.PRESIDENT_MYSQL_TEST !== "1")(
  "President operating lifecycle real MySQL",
  () => {
    beforeAll(async () => {
      const admin = await mysql.createConnection("mysql://root:root@127.0.0.1:3411/");
      await admin.query("DROP DATABASE IF EXISTS president_operating_lifecycle_test");
      await admin.query("CREATE DATABASE president_operating_lifecycle_test");
      await admin.end();
      pool = mysql.createPool({
        uri: "mysql://root:root@127.0.0.1:3411/president_operating_lifecycle_test",
        timezone: "Z",
        connectionLimit: 8,
      });
      await apply("0109_president_stage1.sql");
      await apply("0113_president_intelligence.sql");
      await apply("0114_president_operating_system.sql");
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("claims once, recovers after adapter restart, independently verifies, measures, learns, and completes", async () => {
      const programs = new MysqlPresidentProgramStore(pool);
      const intelligence = new MysqlPresidentIntelligenceStore(pool, "TEST_FIXTURE");
      const service = new PresidentProgramService(pool, programs, intelligence);
      const now = new Date().toISOString();
      await programs.putAuthorityPolicy({
        policyVersion: "test-policy-v1",
        founderId: "founder-test",
        internalMergeAllowed: false,
        internalDeployAllowed: false,
        maxAutonomousUsdPerDay: 10,
        allowedRepositories: ["adamwright83-blip/bldg-admin-api"],
        allowedEnvironments: ["test"],
        prohibitedDomains: [
          "BILLING",
          "PRODUCTION_DATA",
          "CUSTOMER_IMPACT",
          "CREDENTIALS",
          "DNS",
          "LEGAL",
          "COMMERCIAL_RELEASE",
        ],
        updatedAt: now,
      });

      const programId = randomUUID();
      await programs.createProgram({
        id: programId,
        assessmentId: null,
        candidateId: null,
        objectiveRecordId: null,
        title: "Durable lifecycle witness",
        outcome: "Verified bounded capability",
        state: "READY",
        selectedBy: "founder-test",
        selectedAt: now,
        authorityPolicyVersion: "test-policy-v1",
        maxProgramUsd: 10,
        spentUsd: 0,
        currentStepId: null,
        verifiedArtifactId: null,
        blockReason: null,
        stopReason: null,
        createdAt: now,
        updatedAt: now,
      });

      const stepId = randomUUID();
      await programs.createStep({
        id: stepId,
        programId,
        sequence: 0,
        type: "CODE",
        title: "Implement bounded change",
        outcome: "Exact artifact exists",
        acceptanceCriteria: ["artifact passes exact bounded acceptance"],
        nonGoals: ["no production release"],
        requiredEvidence: ["independent test witness"],
        authorityClass: "AUTO_SANDBOX",
        consequentialDomain: "NONE",
        maxUsd: 1,
        spentUsd: 0,
        executorCapability: "engineering",
        reviewerCapability: "independent-review",
        executorId: null,
        reviewerId: null,
        baseRef: null,
        baseSha: null,
        state: "PENDING",
        attemptCount: 0,
        maxAttempts: 3,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: null,
        exactArtifactId: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      });

      const competing = new MysqlPresidentProgramStore(pool);
      const [first, second] = await Promise.all([
        programs.claimNextStep({ leaseOwner: "executor-a", leaseMs: 60_000 }),
        competing.claimNextStep({ leaseOwner: "executor-b", leaseMs: 60_000 }),
      ]);
      const claimed = first ?? second;
      expect(Boolean(first) !== Boolean(second)).toBe(true);
      expect(claimed?.id).toBe(stepId);
      expect(claimed && (await programs.markRunning(claimed))).toBe(true);

      const eventId = randomUUID();
      const completed = await programs.completeStep(claimed!, {
        eventId,
        stepId,
        executorId: claimed!.leaseOwner,
        exactArtifactId: "artifact:test:1",
        branch: "test/president",
        commitSha: "abcdef1",
        summary: "Implemented only the bounded test artifact.",
        changedFiles: ["test.txt"],
        testsActuallyRun: ["bounded acceptance"],
        testsNotRun: [],
        evidence: { witness: "executor handback is not verification" },
        knownLimitations: [],
        costUsd: 0.1,
        reversible: true,
        rollbackInstructions: "Delete the isolated test artifact.",
        completedAt: new Date().toISOString(),
      });
      expect(completed).toBe(true);
      expect(await programs.completeStep(claimed!, {
        eventId,
        stepId,
        executorId: claimed!.leaseOwner,
        exactArtifactId: "artifact:test:1",
        branch: "test/president",
        commitSha: "abcdef1",
        summary: "duplicate callback",
        changedFiles: [],
        testsActuallyRun: [],
        testsNotRun: [],
        evidence: {},
        knownLimitations: [],
        costUsd: 0.1,
        reversible: true,
        rollbackInstructions: "Delete the isolated test artifact.",
        completedAt: new Date().toISOString(),
      })).toBe(false);

      const recoveredPrograms = new MysqlPresidentProgramStore(pool);
      const recoveredIntelligence = new MysqlPresidentIntelligenceStore(pool, "TEST_FIXTURE");
      const recoveredService = new PresidentProgramService(
        pool,
        recoveredPrograms,
        recoveredIntelligence
      );
      expect((await recoveredPrograms.getStep(stepId))?.state).toBe("REVIEW_PENDING");

      await expect(
        recoveredService.acceptIndependentReview({
          eventId: randomUUID(),
          stepId,
          reviewerId: "reviewer-b",
          exactArtifactId: "wrong-artifact",
          verdict: "PASS",
          acceptanceResults: [
            {
              criterion: "artifact passes exact bounded acceptance",
              passed: true,
              evidence: "reviewed exact isolated artifact",
            },
          ],
          observedRisks: [],
          requiredRevision: null,
          evidence: {},
          reviewedAt: new Date().toISOString(),
        })
      ).rejects.toThrow("artifact identity");

      await recoveredService.acceptIndependentReview({
        eventId: randomUUID(),
        stepId,
        reviewerId: "reviewer-b",
        exactArtifactId: "artifact:test:1",
        verdict: "PASS",
        acceptanceResults: [
          {
            criterion: "artifact passes exact bounded acceptance",
            passed: true,
            evidence: "reviewer independently reproduced the bounded acceptance test",
          },
        ],
        observedRisks: [],
        requiredRevision: null,
        evidence: { independent: true },
        reviewedAt: new Date().toISOString(),
      });
      expect((await recoveredPrograms.getProgram(programId))?.state).toBe("VERIFIED_INTERNAL");

      const statement = "Independent test measurement observed the expected bounded result.";
      await recoveredIntelligence.putEvidence({
        id: "fixture-program-outcome",
        source: "test:independent-measurement",
        capturedAt: new Date().toISOString(),
        sourceAt: null,
        statement,
        sha256: evidenceHash(statement),
        kind: "FACT",
        confidence: 1,
        availability: "AVAILABLE",
        origin: "TEST_FIXTURE",
        expiresAt: null,
      });
      const measured = await recoveredService.recordMeasuredOutcome({
        programId,
        evidenceIds: ["fixture-program-outcome"],
        observedOutcome: "The bounded capability passed its independent measurement.",
        success: true,
        lesson: "Keep independent measurement separate from executor self-attestation.",
        actorId: "measurement-reviewer",
      });
      expect(measured.program.state).toBe("COMPLETED");

      const afterRestart = new MysqlPresidentProgramStore(pool);
      expect((await afterRestart.getProgram(programId))?.state).toBe("COMPLETED");
      expect(await recoveredIntelligence.current("PROGRESS", `program:${programId}:outcome`)).not.toBeNull();
      expect(await recoveredIntelligence.current("LESSON", `program:${programId}:lesson`)).not.toBeNull();
    });

    it("moves a program to capability-blocked when an expired lease exhausts retries", async () => {
      const programs = new MysqlPresidentProgramStore(pool);
      const now = new Date().toISOString();
      const programId = randomUUID();
      const stepId = randomUUID();
      await programs.createProgram({
        id: programId,
        assessmentId: null,
        candidateId: null,
        objectiveRecordId: null,
        title: "Dead-letter witness",
        outcome: "Bounded failure is visible",
        state: "RUNNING",
        selectedBy: "founder-test",
        selectedAt: now,
        authorityPolicyVersion: "test-policy-v1",
        maxProgramUsd: 1,
        spentUsd: 0,
        currentStepId: stepId,
        verifiedArtifactId: null,
        blockReason: null,
        stopReason: null,
        createdAt: now,
        updatedAt: now,
      });
      await programs.createStep({
        id: stepId,
        programId,
        sequence: 0,
        type: "TEST",
        title: "Fail bounded retry",
        outcome: "Dead letter",
        acceptanceCriteria: ["never reached"],
        nonGoals: [],
        requiredEvidence: [],
        authorityClass: "AUTO_SANDBOX",
        consequentialDomain: "NONE",
        maxUsd: 0,
        spentUsd: 0,
        executorCapability: "test",
        reviewerCapability: "review",
        executorId: "executor-dead",
        reviewerId: null,
        baseRef: null,
        baseSha: null,
        state: "RUNNING",
        attemptCount: 1,
        maxAttempts: 1,
        leaseOwner: "executor-dead",
        leaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        nextAttemptAt: null,
        exactArtifactId: null,
        error: null,
        createdAt: now,
        updatedAt: now,
      });
      expect(await programs.deadLetterExpiredSteps()).toBeGreaterThanOrEqual(1);
      expect((await programs.getStep(stepId))?.state).toBe("DEAD_LETTER");
      const program = await programs.getProgram(programId);
      expect(program?.state).toBe("BLOCKED_CAPABILITY");
      expect(program?.blockReason).toContain("bounded retry");
    });
  }
);
