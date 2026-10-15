/**
 * Fixture-only path from an approved-view answer to an operator-approved Day Line item.
 * The database is a local disposable schema created by this file. DATABASE_URL stays unset.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { resetDbForTesting, setDbForTesting } from "../db";
import { analyzeBusinessData } from "../analytics/analysis/analyzeBusinessData";
import { buildApprovedDataset } from "../analytics/analysis/approvedViews";
import { executeAnalysisQuery } from "../analytics/analysis/sandbox";
import type { CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { prepareStrategicProposal } from "./strategicPreparation";
import {
  readVerifiedStrategicApprovalItemIds,
  respondToStrategicProposal,
} from "./strategicApproval";
import { loadStrategicProposal, strategicResponses } from "./strategicStore";

const HOST = "127.0.0.1";
const PORT = 3399;
const NOW = new Date("2026-10-14T17:00:00.000Z");
const ZONE = "America/Los_Angeles";
const FIXTURE_CENTS = 4200;
const FIXTURE_DOLLARS = "$42.00";
const FIXTURE_NAME = "Fixture Buyer";
const BANNED =
  /sms (?:message )?(?:was )?sent|text (?:message )?(?:was )?sent|charge was made|was charged|customer was recovered|recovered the customer/i;

const hoisted = vi.hoisted(() => ({
  mode: "rows" as "rows" | "withheld",
  ownerTenant: "",
  sql: "SELECT name, lifetime_cents, paid_orders FROM customers",
  now: new Date("2026-10-14T17:00:00.000Z"),
}));

vi.mock("../_core/llm", async () => {
  const actual = await vi.importActual<typeof import("../_core/llm")>("../_core/llm");
  return {
    ...actual,
    invokeLLM: async (params: { messages?: Array<{ role?: string }> }) => {
      const asked = params.messages?.filter(message => message.role === "assistant").length ?? 0;
      const decision =
        asked === 0
          ? { kind: "query", sql: hoisted.sql, answer: "" }
          : {
              kind: "final",
              sql: "",
              answer: "Invented profit was $999.00 across 999 customers.",
            };
      return { choices: [{ message: { content: JSON.stringify(decision) } }] };
    },
  };
});

vi.mock("../analytics/paidOrderLedger", async () => {
  const actual = await vi.importActual<typeof import("../analytics/paidOrderLedger")>(
    "../analytics/paidOrderLedger"
  );
  return {
    ...actual,
    loadPaidOrderLedger: async (input: { tenantId: string }) => {
      const withheld = hoisted.mode === "withheld" || input.tenantId !== hoisted.ownerTenant;
      return {
        startUtc: new Date("2023-10-15T00:00:00.000Z"),
        endExclusiveUtc: hoisted.now,
        timeZone: ZONE,
        events: withheld
          ? []
          : [
              {
                source: "cleancloud",
                eventKey: "fixture-order-1",
                cents: FIXTURE_CENTS,
                occurredAt: new Date("2026-09-01T19:00:00.000Z"),
                businessDate: "2026-09-01",
                serviceType: "wash_fold",
                customerName: FIXTURE_NAME,
                identity: { phone: "3105550199" },
                authorityReceiptId: "receipt:fixture-order-1",
                businessLine: "laundry_farm",
                summary: "Wash and fold",
              },
            ],
        unverifiedNative: [],
        provenDuplicateExclusions: [],
        loadedSources: withheld ? [] : ["cleancloud"],
        failedSources: withheld ? ["cleancloud"] : [],
        completeness: withheld ? "unavailable" : "complete",
      };
    },
  };
});

vi.mock("./strategicEvidenceReaders", async () => {
  const actual = await vi.importActual<typeof import("./strategicEvidenceReaders")>(
    "./strategicEvidenceReaders"
  );
  return {
    ...actual,
    readStrategicDiagnosisInputs: async (input: {
      identity: { tenantId: string; canonicalOperatorId: string };
      now: Date;
      businessDate: string;
    }) => ({
      tenantId: input.identity.tenantId,
      canonicalOperatorId: input.identity.canonicalOperatorId,
      verticalKey: "laundry_fluff_fold",
      businessDate: input.businessDate,
      now: input.now,
      goal: {
        statement: "See recorded sales from connected rows",
        metricKey: "active_customers",
        target: 10,
        current: null,
        evidenceRef: "goal",
      },
      evidence: [
        {
          id: "goal",
          tenantId: input.identity.tenantId,
          source: "operator_goal",
          capturedAt: input.now.toISOString(),
          classification: "operator_input" as const,
          value: "See recorded sales from connected rows",
          unit: "goal",
          quality: "complete" as const,
          description: "Operator-declared goal, not measured sales",
        },
      ],
      metrics: {},
      market: {
        tenantId: input.identity.tenantId,
        mode: "physical" as const,
        territories: [],
        observations: [],
        limitations: ["Fixture market only"],
      },
      outcomes: [],
      commitments: [],
    }),
  };
});

vi.mock("../claire/weeklyMission/productionReaders", async () => {
  const actual = await vi.importActual<typeof import("../claire/weeklyMission/productionReaders")>(
    "../claire/weeklyMission/productionReaders"
  );
  return { ...actual, readWeeklyDossierFacts: async () => [] };
});

vi.mock("../planning/missionDirector/missionDirectorService", async () => {
  const actual = await vi.importActual<typeof import("../planning/missionDirector/missionDirectorService")>(
    "../planning/missionDirector/missionDirectorService"
  );
  return {
    ...actual,
    planForDate: async () => ({ outcome: { workPlan: { status: "ranking unavailable" } } }),
  };
});

function identity(tenantId: string, operator: string): CanonicalOperatorIdentity {
  return {
    tenantId,
    canonicalOperatorId: operator,
    canonicalOpenId: `${operator}-open`,
    canonicalUserId: 1,
    sourceOpenId: `${operator}-open`,
    sourceUserId: 1,
    sourceRole: "admin",
    dayDirectorActorId: `${operator}-actor`,
    dayDirectorActorIds: [`${operator}-actor`],
    weeklyOperatorId: operator,
    campaignOperatorUserId: operator,
    communicationOperatorUserId: operator,
    membership: { source: "owner", canonical: "owner" },
    aliases: [],
  };
}

describe("source-backed analysis becomes an approved Day Line item", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const databaseName = `claire_src_${suffix}_disposable`;
  const tenantA = `tenant-a-${suffix}`;
  const tenantB = `tenant-b-${suffix}`;
  const operatorA = `operator-a-${suffix}`;
  const operatorB = `operator-b-${suffix}`;
  let admin: mysql.Connection;
  let pool: mysql.Pool;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousQualityFlag = process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED;

  beforeAll(async () => {
    if (!databaseName.endsWith("_disposable"))
      throw new Error("Disposable database name required");
    if (HOST !== "127.0.0.1") throw new Error("Local database host required");
    delete process.env.DATABASE_URL;
    delete process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED;
    if (previousDatabaseUrl) {
      const prior = new URL(previousDatabaseUrl);
      if (prior.pathname.replace(/^\//, "") === databaseName)
        throw new Error("Refusing to reuse an existing DATABASE_URL database");
    }
    hoisted.ownerTenant = tenantA;
    hoisted.now = NOW;
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: "root", password: "root" });
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    pool = mysql.createPool({
      host: HOST,
      port: PORT,
      user: "root",
      password: "root",
      database: databaseName,
      connectionLimit: 4,
    });
    const statements = [
      `CREATE TABLE dayforge_saas_tenants (
        id varchar(64) NOT NULL,
        slug varchar(64) NOT NULL,
        businessName varchar(255) NOT NULL,
        brandName varchar(255) NOT NULL,
        logoUrl varchar(1024) NULL,
        primaryColor varchar(16) NOT NULL,
        contactName varchar(255) NOT NULL,
        contactEmail varchar(320) NOT NULL,
        contactPhone varchar(64) NULL,
        website varchar(512) NULL,
        timeZone varchar(64) NOT NULL,
        proposalTemplateKey varchar(128) NULL,
        status enum('provisioning','configuring','active','delinquent','suspended','canceled') NOT NULL DEFAULT 'provisioning',
        strategyVerticalKey varchar(64) NULL,
        onboardingStep varchar(64) NOT NULL DEFAULT 'business',
        onboardingCompletedAt timestamp NULL,
        billingStateUpdatedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_dayforge_saas_tenants_slug (slug)
      )`,
      `CREATE TABLE strategic_diagnoses (
        id varchar(64) PRIMARY KEY, tenantId varchar(64) NOT NULL, canonicalOperatorId varchar(191) NOT NULL,
        businessDate varchar(10) NOT NULL, payloadJson json NOT NULL, createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY idx_strategic_diagnosis_owner (tenantId, canonicalOperatorId, businessDate, createdAt)
      )`,
      `CREATE TABLE strategic_planning_proposals (
        id varchar(64) PRIMARY KEY, tenantId varchar(64) NOT NULL, canonicalOperatorId varchar(191) NOT NULL,
        weekStart varchar(10) NOT NULL, revision varchar(64) NOT NULL, payloadJson json NOT NULL,
        createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY idx_strategic_proposal_owner (tenantId, canonicalOperatorId, weekStart, createdAt)
      )`,
      `CREATE TABLE strategic_proposal_responses (
        id varchar(64) PRIMARY KEY, proposalId varchar(64) NOT NULL, tenantId varchar(64) NOT NULL,
        canonicalOperatorId varchar(191) NOT NULL, responseJson json NOT NULL, createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY idx_strategic_response_proposal (tenantId, proposalId)
      )`,
      `CREATE TABLE day_director_commitments (
        id varchar(36) PRIMARY KEY,
        tenantId varchar(64) NOT NULL DEFAULT 'default',
        actorId varchar(128) NOT NULL,
        businessDate varchar(10) NOT NULL,
        idempotencyKey varchar(191) NOT NULL,
        title varchar(255) NOT NULL,
        kind enum('growth','prep','operations') NOT NULL,
        quantity int,
        provenance enum('user_reported','manual') NOT NULL,
        status enum('open','completed') NOT NULL DEFAULT 'open',
        sourceText text,
        metadataJson json,
        completedAt timestamp NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_day_director_commitment_key (tenantId, actorId, businessDate, idempotencyKey)
      )`,
      `CREATE TABLE day_director_prompt_states (
        id int AUTO_INCREMENT PRIMARY KEY,
        tenantId varchar(64) NOT NULL DEFAULT 'default',
        actorId varchar(128) NOT NULL,
        businessDate varchar(10) NOT NULL,
        promptKey varchar(191) NOT NULL,
        state enum('accepted','dismissed') NOT NULL,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_day_director_prompt_state (tenantId, actorId, businessDate, promptKey)
      )`,
      `CREATE TABLE strategy_plays (
        id varchar(64) NOT NULL PRIMARY KEY,
        tenantId varchar(64) NOT NULL,
        businessName varchar(191) NOT NULL,
        worldName varchar(191) NOT NULL,
        hypothesis text NOT NULL,
        primaryMetric varchar(64) NOT NULL,
        geography varchar(128) NOT NULL,
        stopsCount int NOT NULL DEFAULT 1,
        isClustered boolean NOT NULL DEFAULT false,
        estimatedInitiationCost int NOT NULL DEFAULT 0,
        estimatedSpendCents int NOT NULL DEFAULT 0,
        spendCategory varchar(64) NOT NULL DEFAULT 'other',
        confidence varchar(32) NOT NULL DEFAULT 'medium',
        evidenceReferencesJson json NULL,
        scoreBreakdownJson json NOT NULL,
        totalScore int NOT NULL DEFAULT 0,
        status enum('candidate','offered','chosen','active','paused','retired') NOT NULL DEFAULT 'candidate',
        needsApprovalToRun boolean NOT NULL DEFAULT false,
        minimumEvidenceThresholdJson json NULL,
        verticalKey varchar(64) NOT NULL DEFAULT 'generic',
        templateKey varchar(64) NOT NULL,
        provenanceJson json NOT NULL,
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE goal_cycle_objectives (
        id varchar(36) NOT NULL,
        tenantId varchar(64) NOT NULL,
        goalRunId varchar(36) NOT NULL,
        cycleId varchar(36) NOT NULL,
        decisionId varchar(36) NOT NULL,
        canonicalOperatorId varchar(191) NOT NULL,
        operatorUserId varchar(128) NOT NULL,
        selectionKind varchar(32) NOT NULL,
        selectedRef varchar(191) NOT NULL,
        title varchar(255) NOT NULL,
        description text NOT NULL,
        executionType varchar(32) NULL,
        authority varchar(32) NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'presented',
        statusReason text NULL,
        actionTargetType varchar(64) NULL,
        actionTargetId varchar(128) NULL,
        actionTargetDisplayName varchar(255) NULL,
        businessDate varchar(10) NOT NULL,
        windowStart varchar(32) NULL,
        windowEnd varchar(32) NULL,
        loadoutJson json NOT NULL,
        evidenceRefsJson json NOT NULL,
        completedAt timestamp(3) NULL,
        createdAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updatedAt timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id)
      )`,
    ];
    for (const statement of statements) await pool.query(statement);
    for (const [id, slug] of [
      [tenantA, `fixture-a-${suffix}`],
      [tenantB, `fixture-b-${suffix}`],
    ] as const) {
      await pool.query(
        `INSERT INTO dayforge_saas_tenants
          (id, slug, businessName, brandName, primaryColor, contactName, contactEmail, timeZone, status)
         VALUES (?, ?, 'Fixture Laundry', 'Fixture', '#111111', 'Fixture Operator', 'fixture@fixture.test', ?, 'active')`,
        [id, slug, ZONE]
      );
    }
    setDbForTesting(drizzle(pool));
  }, 30000);

  afterAll(async () => {
    resetDbForTesting();
    await pool?.end();
    if (admin && databaseName.endsWith("_disposable")) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
      await admin.end();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousQualityFlag === undefined) delete process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED;
    else process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED = previousQualityFlag;
  });

  it("answers from fixture rows, withholds a missing book, and approves one Day Line item", async () => {
    expect(process.env.DATABASE_URL).toBeUndefined();
    hoisted.mode = "rows";
    hoisted.sql = "SELECT name, lifetime_cents, paid_orders FROM customers";
    const owner = identity(tenantA, operatorA);
    const other = identity(tenantB, operatorB);

    const analysis = await analyzeBusinessData({
      tenantId: tenantA,
      question: "What did the recorded customer spend, and how many paid orders are on file?",
      now: NOW,
      timeZone: ZONE,
    });
    expect(analysis.kind).toBe("evidence");
    expect(analysis.answer).toContain(FIXTURE_NAME);
    expect(analysis.answer).toContain(FIXTURE_DOLLARS);
    expect(analysis.answer).toContain("paid orders: 1");
    expect(analysis.answer.match(/\$\d+(?:\.\d+)?/g)).toEqual([FIXTURE_DOLLARS]);
    expect(analysis.answer).not.toMatch(/999/);
    expect(analysis.citedReceiptIds.length).toBeGreaterThan(0);
    expect(analysis.results[0]?.receipt).toMatchObject({
      id: analysis.citedReceiptIds[0],
      tenantId: tenantA,
      status: "ok",
    });
    expect(analysis.results[0]?.rows).toEqual([[FIXTURE_NAME, FIXTURE_CENTS, 1]]);

    hoisted.mode = "withheld";
    hoisted.sql =
      "SELECT COUNT(*) AS customers, COALESCE(SUM(amount_cents), 0) AS recorded_cents FROM orders";
    const withheld = await analyzeBusinessData({
      tenantId: tenantA,
      question: "How many customers and how much in sales are recorded?",
      now: NOW,
      timeZone: ZONE,
    });
    expect(withheld.kind).toBe("evidence");
    expect(withheld.answer).toMatch(/not zero customers/i);
    expect(withheld.answer).toMatch(/not zero sales/i);
    expect(withheld.answer).not.toMatch(/\$0(?:\.00)?/);
    expect(withheld.answer).not.toMatch(/\bcustomers:\s*0\b/i);
    expect(withheld.answer).not.toContain(FIXTURE_NAME);
    expect(withheld.answer).not.toContain(String(FIXTURE_CENTS));
    expect(withheld.citedReceiptIds.length).toBeGreaterThan(0);

    hoisted.mode = "rows";
    hoisted.sql = "SELECT name, lifetime_cents, paid_orders FROM customers";
    const proposal = await prepareStrategicProposal({
      identity: owner,
      timeZone: ZONE,
      now: NOW,
    });
    expect(proposal.approvalState).toBe("pending");
    expect(proposal.tenantId).toBe(tenantA);
    const attached = proposal.diagnosis.evidence.find(item => item.source === "analyzeBusinessData");
    expect(attached?.tenantId).toBe(tenantA);
    expect(String(attached?.value)).toContain(FIXTURE_DOLLARS);
    expect(String(attached?.value)).toContain(FIXTURE_NAME);
    expect(String(attached?.value)).not.toMatch(/999/);
    expect(attached?.id.startsWith("business_analysis:")).toBe(true);
    expect(attached?.classification).toBe("hypothesis");
    expect(proposal.items.length).toBeGreaterThan(0);
    expect(proposal.opening).toMatch(/pending/i);
    expect(await strategicResponses(owner, proposal.id)).toEqual([]);
    const [before] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM day_director_commitments"
    );
    expect(Number(before[0]?.n)).toBe(0);

    const approved = await respondToStrategicProposal({
      identity: owner,
      proposalId: proposal.id,
      revision: proposal.revision,
      action: "approve",
      itemIds: [proposal.items[0]!.id],
      source: "authenticated_app",
      now: NOW,
    });
    expect(approved.failedItems).toEqual([]);
    expect(approved.actionIds).toHaveLength(1);
    expect(approved.speech).not.toMatch(BANNED);
    expect(approved.speech).toMatch(/Day Line/i);
    const responses = await strategicResponses(owner, proposal.id);
    expect(responses.map(response => response.action)).toEqual(["approve"]);
    expect(await readVerifiedStrategicApprovalItemIds(owner, proposal)).toEqual([
      proposal.items[0]!.id,
    ]);
    const [stored] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id, tenantId, status, title, sourceText FROM day_director_commitments WHERE id = ?",
      [approved.actionIds[0]]
    );
    expect(stored[0]).toMatchObject({
      id: approved.actionIds[0],
      tenantId: tenantA,
      status: "open",
    });
    expect(`${stored[0]?.title} ${stored[0]?.sourceText} ${approved.speech}`).not.toMatch(BANNED);

    expect(await loadStrategicProposal(other, proposal.id)).toBeNull();
    await expect(readVerifiedStrategicApprovalItemIds(other, proposal)).rejects.toThrow(
      /owner mismatch/i
    );
    const [hidden] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM day_director_commitments WHERE tenantId = ?",
      [tenantB]
    );
    expect(hidden).toEqual([]);

    const ownedDataset = await buildApprovedDataset({
      tenantId: tenantA,
      now: NOW,
      timeZone: ZONE,
    });
    expect(JSON.stringify(ownedDataset.tables)).toContain(FIXTURE_NAME);
    await expect(
      executeAnalysisQuery({
        tenantId: tenantB,
        dataset: ownedDataset,
        sql: "SELECT name, lifetime_cents FROM customers",
      })
    ).rejects.toThrow(/Tenant/);
    const otherAnalysis = await analyzeBusinessData({
      tenantId: tenantB,
      question: "What did the recorded customer spend?",
      now: NOW,
      timeZone: ZONE,
      previous: analysis.session,
    });
    expect(otherAnalysis.answer).not.toContain(FIXTURE_NAME);
    expect(otherAnalysis.answer).not.toContain(FIXTURE_DOLLARS);
    expect(otherAnalysis.answer).not.toContain(String(FIXTURE_CENTS));
    expect(otherAnalysis.session?.tenantId).not.toBe(tenantA);
  }, 60000);
});
