import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemRouter } from "../_core/systemRouter";
import {
  loadOperatorAdaptationDecisionForUser,
} from "./adaptation";
import {
  DAPHNE_STAGE3B_BEHAVIOR_CLASS,
  DAPHNE_STAGE3B_TARGET_KEY,
} from "./adaptationContract";
import {
  listDaphneAdaptationReceipts,
  recordDaphneAdaptationUse,
} from "./adaptationReceipts";
import { deleteTenantData, planTenantDeletion } from "../saas/tenantLifecycle";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;

describeMysql("Daphne Stage 3B authenticated causal chain", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantA = `daphne-a-${suffix}`;
  const tenantB = `daphne-b-${suffix}`;
  const operatorA = `daphne-owner-a-${suffix}`;
  const operatorA2 = `daphne-owner-a2-${suffix}`;
  const operatorB = `daphne-owner-b-${suffix}`;
  let operatorAId = 0;
  let operatorA2Id = 0;
  let operatorBId = 0;
  let db: mysql.Connection;
  const oldFlag = process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED;

  const ctx = (tenantId: string, openId: string, id: number) =>
    ({
      req: { headers: { host: "admin.bldg.chat" }, protocol: "https" },
      res: {},
      user: {
        id,
        openId,
        role: "user",
        tenantId,
        name: openId,
        email: `${openId}@example.invalid`,
        loginMethod: "password",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      vendorSession: null,
      tenantId,
    }) as never;

  async function createTenant(
    tenantId: string,
    users: string[]
  ): Promise<number[]> {
    await db.execute(
      `INSERT INTO dayforge_saas_tenants
        (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
       VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [
        tenantId,
        tenantId,
        tenantId,
        tenantId,
        "#111111",
        tenantId,
        `${tenantId}@example.invalid`,
        "America/Los_Angeles",
      ]
    );
    const ids: number[] = [];
    for (const openId of users) {
      const [insert] = await db.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (tenantId,openId,name,email,role,loginMethod)
         VALUES (?,?,?,?, 'user','password')`,
        [tenantId, openId, openId, `${openId}@example.invalid`]
      );
      ids.push(insert.insertId);
      await db.execute(
        `INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active)
         VALUES (?,?,'owner',true)`,
        [tenantId, openId]
      );
    }
    return ids;
  }

  async function seedDeferralPattern(
    tenantId: string,
    operatorNumericId: number
  ): Promise<void> {
    for (let index = 1; index <= 3; index += 1) {
      await db.execute(
        `INSERT INTO behavioral_ledger_events
          (tenantId,operatorUserId,correlationId,sourceSystem,sourceEntityType,
           sourceEntityId,eventType,occurredAt,verificationClass,provenance,
           decisionPointId,idempotencyKey)
         VALUES (?,?,?,'ops_task','daphne_fixture',?,'DEFERRED',CURRENT_TIMESTAMP,
                 'ATTESTED','daphne_stage3b_test',?,?)`,
        [
          tenantId,
          String(operatorNumericId),
          `corr-${index}-${suffix}`,
          `fixture-${index}-${suffix}`,
          `decision-${index}-${suffix}`,
          `daphne-ledger-${index}-${suffix}`,
        ]
      );
    }
  }

  async function receiptRows() {
    const [rows] = await db.execute<mysql.RowDataPacket[]>(
      `SELECT *
       FROM operator_representative_adaptation_receipts
       WHERE tenantId = ?
       ORDER BY createdAt ASC`,
      [tenantA]
    );
    return rows;
  }

  beforeAll(async () => {
    db = await mysql.createConnection(DATABASE_URL!);
    [operatorAId, operatorA2Id] = await createTenant(tenantA, [
      operatorA,
      operatorA2,
    ]);
    [operatorBId] = await createTenant(tenantB, [operatorB]);
    await seedDeferralPattern(tenantA, operatorAId);
    process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED = "*";
  }, 120_000);

  afterAll(async () => {
    if (oldFlag === undefined) {
      delete process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED;
    } else {
      process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED = oldFlag;
    }
    await db?.end();
    for (const tenantId of [tenantA, tenantB]) {
      const plan = await planTenantDeletion(tenantId);
      if (plan.totalRows > 0) {
        await deleteTenantData({
          tenantId,
          expectedTotalRows: plan.totalRows,
          confirmation: tenantId,
        });
      }
    }
  }, 120_000);

  it("proves baseline -> production directive -> Claire use receipt -> revoke -> future non-use", async () => {
    const caller = systemRouter.createCaller(ctx(tenantA, operatorA, operatorAId));

    // Baseline uses the production Claire desk path and creates the same
    // pre-existing pending state that the adapted turn will later exercise.
    const baselineConversation = `baseline-${suffix}`;
    await caller.claire.talk({
      utterance: "add a task to call Dana",
      conversationId: baselineConversation,
    });
    await caller.claire.talk({
      utterance: "maybe",
      conversationId: baselineConversation,
    });
    expect(await receiptRows()).toHaveLength(0);

    // Production Operator Representative read + authenticated directive write.
    const home = await caller.operatorRepresentative.home();
    const target = home.learning.find(
      item => item.targetKey === DAPHNE_STAGE3B_TARGET_KEY
    );
    expect(target).toBeDefined();

    const savedDirective = await caller.operatorRepresentative.directive({
      itemId: target!.id,
      kind: "ask_instead",
    });
    expect(savedDirective).toMatchObject({
      directiveKind: "ask_instead",
      targetKey: DAPHNE_STAGE3B_TARGET_KEY,
      status: "active",
    });

    const beforeUse = await caller.operatorRepresentative.adaptationStatus();
    expect(
      beforeUse.lifecycle.find(
        item => item.directiveId === savedDirective.id
      )?.lifecycle
    ).toBe("wired_unused");

    // Production Claire turn entry: first establish the real pending proposal,
    // then send the parent-main ambiguous reply.
    const adaptedConversation = `adapted-${suffix}`;
    await caller.claire.talk({
      utterance: "add a task to call Dana",
      conversationId: adaptedConversation,
    });
    await caller.claire.talk({
      utterance: "maybe",
      conversationId: adaptedConversation,
    });

    const rows = await receiptRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      directiveId: savedDirective.id,
      targetKey: DAPHNE_STAGE3B_TARGET_KEY,
      behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
      receiptClass: "non_business_claire_behavior",
      structuralOutcome: "clarification_branch_selected",
      firewallResult: "non_business_behavior_only",
    });
    expect(String(rows[0].executingSha || "")).not.toBe("");

    const used = await caller.operatorRepresentative.adaptationStatus();
    expect(
      used.lifecycle.find(item => item.directiveId === savedDirective.id)
    ).toMatchObject({
      lifecycle: "used",
      useCount: 1,
    });

    // Replay proof reuses the exact durable conversation + turn identity.
    const decision = await loadOperatorAdaptationDecisionForUser({
      tenantId: tenantA,
      operatorUserId: operatorA,
    });
    expect(decision).not.toBeNull();
    const persistedConversationId = String(rows[0].conversationId);
    const persistedTurnId = String(rows[0].turnId);
    const replay1 = await recordDaphneAdaptationUse({
      decision: decision!,
      conversationId: persistedConversationId,
      turnId: persistedTurnId,
      executingSha: "replay-test",
    });
    const replay2 = await recordDaphneAdaptationUse({
      decision: decision!,
      conversationId: persistedConversationId,
      turnId: persistedTurnId,
      executingSha: "replay-test",
    });
    expect(replay2.id).toBe(replay1.id);
    expect(await receiptRows()).toHaveLength(1);

    // Snapshot semantics: Turn A's already-loaded decision is immutable history;
    // revoke prevents a newly loaded Turn B decision.
    const loadedBeforeRevoke = decision!;
    await caller.operatorRepresentative.revokeDirective({
      directiveId: savedDirective.id,
    });
    expect(loadedBeforeRevoke).toMatchObject({
      directiveId: savedDirective.id,
      status: "applicable",
    });
    expect(
      await loadOperatorAdaptationDecisionForUser({
        tenantId: tenantA,
        operatorUserId: operatorA,
      })
    ).toBeNull();

    const revoked = await caller.operatorRepresentative.adaptationStatus();
    expect(
      revoked.lifecycle.find(item => item.directiveId === savedDirective.id)
    ).toMatchObject({
      lifecycle: "revoked_historical",
      useCount: 1,
    });

    const afterRevokeConversation = `after-revoke-${suffix}`;
    await caller.claire.talk({
      utterance: "add a task to call Dana",
      conversationId: afterRevokeConversation,
    });
    await caller.claire.talk({
      utterance: "maybe",
      conversationId: afterRevokeConversation,
    });
    expect(await receiptRows()).toHaveLength(1);
  }, 120_000);

  it("fails closed across same-tenant operators and across tenants", async () => {
    expect(
      await loadOperatorAdaptationDecisionForUser({
        tenantId: tenantA,
        operatorUserId: operatorA2,
      })
    ).toBeNull();
    expect(
      await loadOperatorAdaptationDecisionForUser({
        tenantId: tenantB,
        operatorUserId: operatorB,
      })
    ).toBeNull();

    const canonicalA2 = `tenant:${tenantA}:operator:${operatorA2}`;
    const canonicalB = `tenant:${tenantB}:operator:${operatorB}`;
    expect(
      await listDaphneAdaptationReceipts({
        tenantId: tenantA,
        canonicalOperatorId: canonicalA2,
      })
    ).toEqual([]);
    expect(
      await listDaphneAdaptationReceipts({
        tenantId: tenantB,
        canonicalOperatorId: canonicalB,
      })
    ).toEqual([]);

    const callerA2 = systemRouter.createCaller(
      ctx(tenantA, operatorA2, operatorA2Id)
    );
    const callerB = systemRouter.createCaller(ctx(tenantB, operatorB, operatorBId));
    expect((await callerA2.operatorRepresentative.adaptationStatus()).lifecycle).toEqual([]);
    expect((await callerB.operatorRepresentative.adaptationStatus()).lifecycle).toEqual([]);
  });
});
