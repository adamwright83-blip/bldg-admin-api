import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import express from "express";
import type { Server } from "node:http";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, expect, it, describe } from "vitest";
import {
  evidenceHash,
  MysqlPresidentIntelligenceStore,
} from "./intelligenceStore";
import { MysqlPresidentProgramStore } from "./programStore";
import { PresidentProgramService } from "./programService";
import {
  PresidentAgentRuntimeCoordinator,
  PresidentAgentWakeClient,
  type PresidentWakeEnvelope,
} from "./agentRuntime";
import { registerPresidentAgentRoutes } from "./httpRoutes";
import {
  reasonAboutCompany,
  validateJudgment,
  type PresidentJudgmentProvider,
} from "./reasoning";
import { researchCompanyQuestion } from "./research";
import { planPresidentProgram } from "./programPlanner";
import type {
  PresidentExecutionHandback,
  PresidentIndependentReview,
} from "../../shared/presidentOperatingSystem";

const root = resolve(import.meta.dirname, "../..");
const uri = `mysql://root:root@127.0.0.1:${process.env.PRESIDENT_MYSQL_TEST_PORT ?? "3411"}/`;
let pool: Pool;
let server: Server;
let base: string;
const envelopes: PresidentWakeEnvelope[] = [];
const tokens = {
  executor: "fixture-executor-token-long",
  reviewer: "fixture-reviewer-token-long",
};
class FixtureWake extends PresidentAgentWakeClient {
  fail = true;
  constructor() {
    super(
      {
        engineering: {
          actorId: "executor",
          url: "http://127.0.0.1",
          wakeToken: tokens.executor,
        },
        review: {
          actorId: "reviewer",
          url: "http://127.0.0.1",
          wakeToken: tokens.reviewer,
        },
      },
      "http://127.0.0.1"
    );
  }
  override async wake(_target: unknown, payload: PresidentWakeEnvelope) {
    if (this.fail && payload.kind === "PRESIDENT_EXECUTE") {
      this.fail = false;
      throw new Error("Fixture transport outage");
    }
    envelopes.push(payload);
  }
}
const provider = (value: unknown): PresidentJudgmentProvider => ({
  id: "deterministic:test-fixture",
  async judge() {
    return {
      text: JSON.stringify(value),
      model: "fixture",
      costUsd: 0,
      providerRunId: randomUUID(),
    };
  },
});
async function post(
  kind: string,
  body: unknown,
  actor = "executor",
  token = tokens[actor as keyof typeof tokens]
) {
  return fetch(`${base}/api/president/agent/${kind}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}
describe.skipIf(process.env.PRESIDENT_MYSQL_TEST !== "1")(
  "President reproducible executive cycle",
  () => {
    beforeAll(async () => {
      const admin = await mysql.createConnection(uri);
      await admin.query(
        "DROP DATABASE IF EXISTS president_completion_cycle_test"
      );
      await admin.query("CREATE DATABASE president_completion_cycle_test");
      await admin.end();
      pool = mysql.createPool({
        uri: uri + "president_completion_cycle_test",
        timezone: "Z",
        connectionLimit: 8,
      });
      for (const name of [
        "0109_president_stage1.sql",
        "0113_president_intelligence.sql",
        "0114_president_operating_system.sql",
      ]) {
        const sql = await readFile(resolve(root, "drizzle", name), "utf8");
        for (const statement of sql
          .replace(/^\s*--.*$/gm, "")
          .split(";")
          .map(s => s.trim())
          .filter(Boolean))
          await pool.query(statement);
      }
    });
    afterAll(async () => {
      if (server)
        await new Promise<void>(resolve => server.close(() => resolve()));
      await pool?.end();
    });
    it("grounds, asks, activates, researches, delegates, recovers, authenticates, reviews and briefs", async () => {
      let programs = new MysqlPresidentProgramStore(pool);
      const intelligence = new MysqlPresidentIntelligenceStore(
        pool,
        "TEST_FIXTURE"
      );
      let service = new PresidentProgramService(pool, programs, intelligence);
      const statement =
        "TEST FIXTURE: JOYSTICK needs an independently verified bounded recovery drill before any production change.";
      const evidence = {
        id: "fixture-company",
        source: "fixture:company-brief",
        statement,
        sha256: evidenceHash(statement),
        capturedAt: new Date().toISOString(),
        sourceAt: null,
        kind: "FACT" as const,
        confidence: 1,
        availability: "AVAILABLE" as const,
        origin: "TEST_FIXTURE" as const,
        expiresAt: null,
      };
      await intelligence.putEvidence(evidence);
      const objective = {
        admission: {
          type: "STRATEGIC_EXPERIMENT",
          hypothesis: "An isolated drill establishes recoverability",
          test: "Measure the fixture recovery result",
        },
        outcome: "Verify isolated company recovery drill",
        indicator: "Independent fixture measurement",
        baseline: null,
        target: null,
        source: evidence.source,
        horizon: null,
        owner: "seat.president",
        status: "PROPOSED",
        dependencies: [],
        reason: "Prioritize reversible proof before production authority",
        evidenceIds: [evidence.id],
      };
      const judgment = {
        summary:
          "A bounded drill can establish evidence without touching production.",
        evidenceIds: [evidence.id],
        facts: [{ statement, evidenceIds: [evidence.id] }],
        inferences: ["An isolated drill is a useful next step"],
        unknowns: ["Production recoverability is UNKNOWN"],
        preferredOption: "Isolated recovery drill",
        bestAlternative: "Defer the drill",
        opportunityCost: "One bounded engineering cycle",
        falsification: "The fixture cannot reproduce recovery",
        nextAction: "Request bounded founder authorization",
        founderDecision: "Authorize this bounded drill?",
        skills: ["company-strategy"],
        thesisUpdates: [
          {
            topic: "RISK",
            claim: "A recovery drill reduces uncertainty",
            kind: "HYPOTHESIS",
            evidenceIds: [evidence.id],
            confidence: 0.5,
            reviewedAt: evidence.capturedAt,
            falsification: "Independent recovery fails",
            status: "CURRENT",
          },
        ],
        objectives: [objective],
      };
      const reasoned = await reasonAboutCompany({
        question: "What bounded company work should proceed?",
        evidence: [evidence],
        provider: provider(judgment),
        store: intelligence,
        maxUsd: 1,
        requestKey: "fixture-cycle-strategy",
      });
      const objectiveRecord = (await intelligence.listCurrent("OBJECTIVE"))[0];
      expect(objectiveRecord.payload.status).toBe("PROPOSED");
      expect(() =>
        validateJudgment(
          {
            ...judgment,
            facts: [
              {
                statement: "Production is verified",
                evidenceIds: [evidence.id],
              },
            ],
          },
          [evidence]
        )
      ).toThrow("source excerpt");
      await programs.putAuthorityPolicy({
        policyVersion: "fixture-cycle-policy",
        founderId: "fixture-founder",
        internalMergeAllowed: false,
        internalDeployAllowed: false,
        maxAutonomousUsdPerDay: 2,
        autonomousProgramSelectionAllowed: false,
        allowedRepositories: ["fixture"],
        allowedEnvironments: ["test"],
        prohibitedDomains: [
          "PRODUCTION_DATA",
          "BILLING",
          "CUSTOMER_IMPACT",
          "COMMERCIAL_RELEASE",
        ],
        updatedAt: evidence.capturedAt,
      });
      const question = await service.requestObjectiveSelectionDecision({
        objectiveRecordId: objectiveRecord.id,
      });
      expect(await programs.openFounderDecisions(3)).toHaveLength(1);
      await expect(
        service.answerObjectiveSelectionDecision({
          decisionId: question.id,
          answer: "Authorize this program",
          founderId: "other-tenant",
          maxProgramUsd: 2,
        })
      ).rejects.toThrow("configured founder");
      const answered = await service.answerObjectiveSelectionDecision({
        decisionId: question.id,
        answer: "Authorize this program",
        founderId: "fixture-founder",
        maxProgramUsd: 2,
      });
      const program = answered.selection!.program;
      expect(answered.selection!.objective.payload.status).toBe("ACTIVE");
      expect(
        (
          await service.createProgramFromObjective({
            objectiveRecordId: objectiveRecord.id,
            actorId: "fixture-founder",
            maxProgramUsd: 2,
          })
        ).program.id
      ).toBe(program.id);
      const plan = {
        question: "What does the approved fixture source say?",
        reason: "Read source material before planning the drill",
        allowedDomains: ["developers.openai.com"],
        recencyDays: 30,
        maxSources: 1,
        maxUsd: 1,
      };
      const researched = await researchCompanyQuestion({
        plan,
        provider: provider({
          sources: [
            {
              url: "https://developers.openai.com/fixture",
              title: "Clearly labeled fixture source",
              relevance: "Source boundary exercise",
              claim: "A fixture describes bounded verification",
              claimType: "SOURCE_STATEMENT",
              sourceAt: null,
            },
          ],
          synthesis: "Fixture guidance only",
          contradictions: [],
          unknowns: ["Production remains unknown"],
          confidence: 0.5,
        }),
        store: intelligence,
        requestKey: "fixture-cycle-research",
        fixtureSnapshot: async () => ({
          content:
            "TEST FIXTURE source text: bounded verification requires independent evidence.",
          hash: evidenceHash(
            "TEST FIXTURE source text: bounded verification requires independent evidence."
          ),
          capturedAt: evidence.capturedAt,
          contentType: "text/plain",
        }),
      });
      expect(researched.record.evidenceIds).toHaveLength(1);
      expect(researched.record.payload.claimsIndependentlyVerified).toBe(false);
      expect(
        (await intelligence.evidence(researched.record.evidenceIds))[0].origin
      ).toBe("TEST_FIXTURE");
      await expect(
        researchCompanyQuestion({
          plan: { ...plan, allowedDomains: ["localhost"] },
          provider: provider({}),
          store: intelligence,
          requestKey: "forbidden",
        })
      ).rejects.toThrow("approved public-domain");
      for (const [key, actor] of [
        ["engineering", "executor"],
        ["review", "reviewer"],
      ])
        await service.registerAgentCapability({
          capability: {
            capabilityKey: key,
            kind: "BUILTIN",
            actorId: actor,
            targetCapability: key,
            seatRoleKey: null,
            programId: null,
            skillNames: ["company-strategy"],
            authorityClasses: ["AUTO_SANDBOX", "AUTO_READ_ONLY"],
            consequentialDomains: ["NONE"],
            maxUsdPerRun: 1,
            evidenceIds: [evidence.id],
            justification: "Fixture-only bounded executor/reviewer",
          },
          requestedBy: "fixture-founder",
          idempotencyKey: `fixture-capability:${key}`,
        });
      const draft = {
        summary: "Execute and independently measure the isolated fixture drill",
        preflight: {
          reversible: true,
          rollbackPlan: "Delete the fixture artifact",
          estimatedUsd: 1,
          licenses: [],
          secretRequirements: [],
          customerImpact: false,
          productionMutation: false,
          billingMutation: false,
          credentialMutation: false,
          dnsMutation: false,
          legalCommitment: false,
          commercialRelease: false,
          externalSpend: false,
          unknowns: [],
        },
        steps: [
          {
            type: "MEASURE",
            title: "Measure isolated recovery",
            outcome: "Fixture drill measured",
            acceptanceCriteria: ["Independent fixture recovery passes"],
            nonGoals: ["No production state mutation"],
            requiredEvidence: ["fixture measurement"],
            authorityClass: "AUTO_SANDBOX",
            consequentialDomain: "NONE",
            maxUsd: 1,
            executorCapability: "engineering",
            reviewerCapability: "review",
            baseRef: null,
            baseSha: null,
          },
        ],
        measurement: {
          question: "Did isolated recovery work?",
          evidenceRequired: ["fixture measurement"],
          successCondition: "Independent fixture recovery passes",
          stopCondition: "Recovery fails",
        },
        founderQuestions: [],
      };
      const planned = await planPresidentProgram({
        program,
        selectedWork: await service.selectedWork(program.id),
        policy: (await programs.getAuthorityPolicy())!,
        provider: provider(draft),
        repositorySha: null,
        capabilities: await programs.listAgentCapabilities(),
        maxUsd: 1,
      });
      await service.applyPlan({
        programId: program.id,
        plan: planned.plan,
        plannerId: "seat.president",
      });
      const wake = new FixtureWake();
      let coordinator = new PresidentAgentRuntimeCoordinator(
        programs,
        service,
        wake
      );
      await expect(coordinator.dispatchNext()).rejects.toThrow(
        "transport outage"
      );
      let step = (await programs.listSteps(program.id))[0];
      expect(step.state).toBe("PENDING");
      expect(step.attemptCount).toBe(1);
      expect(
        (await programs.listEvents(program.id)).some(
          e => e.eventType === "STEP_RETRY_SCHEDULED"
        )
      ).toBe(true);
      await programs.updateStep(step.id, {
        nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
      });
      programs = new MysqlPresidentProgramStore(pool);
      service = new PresidentProgramService(pool, programs, intelligence);
      coordinator = new PresidentAgentRuntimeCoordinator(
        programs,
        service,
        wake
      );
      await coordinator.recover();
      step = (await programs.getStep(step.id))!;
      expect(step.attemptCount).toBe(2);
      expect(
        envelopes.filter(e => e.kind === "PRESIDENT_EXECUTE")
      ).toHaveLength(1);
      const app = express();
      app.use(express.json());
      registerPresidentAgentRoutes(app, {
        config: () => ({
          configured: true,
          callbackBaseUrl: "http://127.0.0.1",
          targets: {},
          callbackTokens: tokens,
          missingCallbackActors: [],
        }),
        runtime: () => ({ programs, intelligence, service, coordinator }),
      });
      await new Promise<void>(resolve => {
        server = app.listen(0, "127.0.0.1", () => resolve());
      });
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const handback: PresidentExecutionHandback = {
        eventId: randomUUID(),
        stepId: step.id,
        executorId: "executor",
        exactArtifactId: "fixture:recovery:attempt-2",
        branch: null,
        commitSha: null,
        summary:
          "Fixture executor returned measurement; not yet independently verified",
        changedFiles: [],
        testsActuallyRun: ["fixture isolated recovery"],
        testsNotRun: ["production recovery"],
        evidence: {
          executionAttempt: step.attemptCount,
          fixtureMeasurement: true,
        },
        knownLimitations: ["Fixture evidence only"],
        costUsd: 0,
        reversible: true,
        rollbackInstructions: "Delete fixture artifact",
        completedAt: new Date().toISOString(),
      };
      expect((await post("execution", {})).status).toBe(400);
      expect(
        (await post("execution", handback, "executor", "wrong-token")).status
      ).toBe(401);
      expect(
        (
          await post("execution", {
            ...handback,
            evidence: { executionAttempt: 1 },
          })
        ).status
      ).toBe(409);
      expect(
        (await post("execution", { ...handback, stepId: randomUUID() })).status
      ).toBe(409);
      expect(
        (
          await post(
            "execution",
            { ...handback, executorId: "reviewer" },
            "reviewer"
          )
        ).status
      ).toBe(409);
      expect(
        (await post("execution", { ...handback, costUsd: null })).status
      ).toBe(409);
      expect(
        (await post("execution", { ...handback, costUsd: 2 })).status
      ).toBe(409);
      const liveLease = step.leaseExpiresAt;
      await programs.updateStep(step.id, {
        leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect((await post("execution", handback)).status).toBe(409);
      await programs.updateStep(step.id, { leaseExpiresAt: liveLease });
      const concurrent = await Promise.all([
        post("execution", handback),
        post("execution", handback),
      ]);
      expect(concurrent.map(r => r.status)).toEqual([200, 200]);
      expect((await programs.getProgram(program.id))!.spentUsd).toBe(0);
      expect((await programs.getStep(step.id))!.state).toBe("REVIEW_PENDING");
      expect(
        (await post("execution", { ...handback, summary: "changed payload" }))
          .status
      ).toBe(409);
      const reviewWakes = envelopes.filter(
        e => e.kind === "PRESIDENT_REVIEW"
      ).length;
      await new PresidentAgentRuntimeCoordinator(
        new MysqlPresidentProgramStore(pool),
        service,
        wake
      ).recover();
      expect(envelopes.filter(e => e.kind === "PRESIDENT_REVIEW")).toHaveLength(
        reviewWakes
      );
      await programs.updateStep(step.id, {
        leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      await coordinator.recover();
      expect(envelopes.filter(e => e.kind === "PRESIDENT_REVIEW")).toHaveLength(
        reviewWakes + 1
      );
      const review: PresidentIndependentReview = {
        eventId: randomUUID(),
        stepId: step.id,
        reviewerId: "reviewer",
        exactArtifactId: handback.exactArtifactId,
        verdict: "PASS",
        acceptanceResults: [
          {
            criterion: "Independent fixture recovery passes",
            passed: true,
            evidence:
              "TEST FIXTURE: independently reproduced isolated recovery",
          },
        ],
        observedRisks: [],
        requiredRevision: null,
        evidence: { executionEventId: handback.eventId },
        reviewedAt: new Date().toISOString(),
      };
      expect(
        (
          await post(
            "review",
            { ...review, exactArtifactId: "wrong-object" },
            "reviewer"
          )
        ).status
      ).toBe(409);
      expect(
        (
          await post(
            "review",
            { ...review, evidence: { executionEventId: randomUUID() } },
            "reviewer"
          )
        ).status
      ).toBe(409);
      expect((await post("review", review, "reviewer")).status).toBe(200);
      expect((await post("review", review, "reviewer")).status).toBe(200);
      expect((await programs.getProgram(program.id))!.state).toBe(
        "VERIFIED_INTERNAL"
      );
      await service.finalizeVerifiedMeasurements();
      const outcome = { program: (await programs.getProgram(program.id))! };
      await service.finalizeVerifiedMeasurements();
      expect(outcome.program.state).toBe("COMPLETED");
      expect(
        (await intelligence.current("OBJECTIVE", objectiveRecord.key))!.payload
          .status
      ).toBe("ACHIEVED");
      const brief = await service.nightlyBrief();
      expect(brief.completed).toContain(program.title);
      expect(brief.questions).toHaveLength(0);
      const report = {
        origin: "TEST_FIXTURE",
        productionTouched: false,
        baseMainSha: execFileSync("git", ["rev-parse", "origin/main"], {
          cwd: root,
          encoding: "utf8",
        }).trim(),
        sourceHead: "62a23a16a17b9b51c9e04b43e8422acb21e76bf4",
        recommendation: reasoned.recommendation,
        objectiveRecordId: objectiveRecord.id,
        programId: program.id,
        researchRecordId: researched.record.id,
        evidenceIds: [evidence.id, ...researched.record.evidenceIds],
        callbackChecks: {
          malformed: 400,
          unauthorized: 401,
          staleRun: 409,
          wrongObject: 409,
          replay: 200,
          changedReplay: 409,
        },
        executionAttempts: step.attemptCount,
        returnedState: "REVIEW_PENDING",
        reviewedState: "VERIFIED_INTERNAL",
        finalState: outcome.program.state,
        brief,
        events: await programs.listEvents(program.id),
      };
      await mkdir(resolve(root, "artifacts/president-intelligence"), {
        recursive: true,
      });
      const surface = {
        runtime: {
          executionState: "CONFIGURED",
          executionCapabilities: ["engineering", "review"],
          actors: ["executor", "reviewer"],
          callbackBaseConfigured: true,
          missingCallbackActors: [],
        },
        brief,
        research: await intelligence.list("RESEARCH", 10),
        objectives: await intelligence.listCurrent("OBJECTIVE", 20),
        thesis: await intelligence.listCurrent("THESIS", 12),
        programs: await programs.listPrograms(20),
        evidence: await intelligence.evidence([
          ...new Set(
            (await intelligence.listCurrent("OBJECTIVE", 20)).flatMap(
              o => o.evidenceIds
            )
          ),
        ]),
        events: await programs.listEvents(program.id),
      };
      await writeFile(
        resolve(
          root,
          "artifacts/president-intelligence/founder-surface-fixture.json"
        ),
        JSON.stringify(surface, null, 2) + "\n"
      );
      await writeFile(
        resolve(root, "artifacts/president-intelligence/witness.json"),
        JSON.stringify(report, null, 2) + "\n"
      );
    }, 30_000);
    it("bounds reviewer wake retries across restart without accepting unreviewed work", async () => {
      const programs = new MysqlPresidentProgramStore(pool);
      const intelligence = new MysqlPresidentIntelligenceStore(
        pool,
        "TEST_FIXTURE"
      );
      const service = new PresidentProgramService(pool, programs, intelligence);
      const original = (await programs.listPrograms(20)).find(
        p => p.state === "COMPLETED"
      )!;
      const originalStep = (await programs.listSteps(original.id))[0];
      const programId = randomUUID();
      const stepId = randomUUID();
      const now = new Date().toISOString();
      await programs.createProgram({
        ...original,
        id: programId,
        objectiveRecordId: null,
        title: "Fixture review transport outage",
        state: "AWAITING_REVIEW",
        currentStepId: stepId,
        verifiedArtifactId: null,
        spentUsd: 0,
        createdAt: now,
        updatedAt: now,
      });
      await programs.createStep({
        ...originalStep,
        id: stepId,
        programId,
        state: "REVIEW_PENDING",
        executorId: "executor",
        reviewerId: null,
        exactArtifactId: "fixture:unreviewed",
        leaseOwner: null,
        leaseExpiresAt: null,
        attemptCount: 1,
        maxAttempts: 2,
        createdAt: now,
        updatedAt: now,
      });
      const priorReturn = (await programs.getHandback(originalStep.id))!;
      await programs.recordHandback({
        ...priorReturn,
        eventId: randomUUID(),
        stepId,
        exactArtifactId: "fixture:unreviewed",
        evidence: { executionAttempt: 1 },
      });
      const wake = new FixtureWake();
      const startingWakes = envelopes.filter(
        e => e.kind === "PRESIDENT_REVIEW"
      ).length;
      for (let i = 0; i < 3; i++) {
        await new PresidentAgentRuntimeCoordinator(
          new MysqlPresidentProgramStore(pool),
          service,
          wake
        ).recover();
        if (i < 2)
          await programs.updateStep(stepId, {
            leaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
          });
      }
      expect(envelopes.filter(e => e.kind === "PRESIDENT_REVIEW")).toHaveLength(
        startingWakes + 2
      );
      expect((await programs.getStep(stepId))!.state).toBe("DEAD_LETTER");
      expect((await programs.getProgram(programId))!.state).toBe(
        "BLOCKED_CAPABILITY"
      );
      expect(
        (await programs.getProgram(programId))!.verifiedArtifactId
      ).toBeNull();
      expect(
        (await service.nightlyBrief()).blocked.some(item =>
          item.includes("bounded wake retries")
        )
      ).toBe(true);
    });
  }
);
