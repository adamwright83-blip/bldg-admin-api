/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only; canonical product is JOYSTICK. */
// The existing Daphne MySQL CI gate is the production-acceptance anchor for both
// the narrow Stage 3B causal canary and the broader Daphne V2 correction loop.
import "../../claire/turn/daphneV2RuntimeCorrection.mysql.integration.test";
import "../daphne/learnedPolicy.mysql.integration.test";

import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { systemRouter } from "../../_core/systemRouter";
import { loadOperatorAdaptationDecisionForUser } from "./adaptation";
import {
  DAPHNE_STAGE3B_BEHAVIOR_CLASS,
  DAPHNE_STAGE3B_TARGET_KEY,
} from "./adaptationContract";
import {
  listDaphneAdaptationReceipts,
  recordDaphneAdaptationUse,
} from "./adaptationReceipts";
import {
  deleteTenantData,
  planTenantDeletion,
} from "../../saas/tenantLifecycle";
import { listDaphneInterventions } from "../daphne/interventionLedger";
import { recordDaphneObservation } from "../daphne/observationStore";
import {
  ingestVerifiedDaphneStage3bOutcome,
  loadDaphneStage3bRecommendation,
} from "../daphne/stage3bLearning";
import { startDaphneConsolidationWorker } from "../daphne/consolidationWorker";
import { listDaphneOutcomes } from "../daphne/outcomeLedger";

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
    const caller = systemRouter.createCaller(
      ctx(tenantA, operatorA, operatorAId)
    );

    // Baseline uses the production Claire desk path and creates the same
    // pre-existing pending state that the adapted turn will later exercise.
    const baselineConversation = `baseline-${suffix}`;
    await caller.claire.talk({
      utterance: "add a task to call Dana",
      conversationId: baselineConversation,
    });
    const baselineTurn = await caller.claire.talk({
      utterance: "maybe",
      conversationId: baselineConversation,
    });
    expect(baselineTurn.operatorAdaptation).toBeNull();
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

    process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED = "false";
    const disabled = await caller.operatorRepresentative.adaptationStatus();
    expect(
      disabled.lifecycle.find(item => item.directiveId === savedDirective.id)
        ?.lifecycle
    ).toBe("disabled");

    const flagOffConversation = `flag-off-${suffix}`;
    await caller.claire.talk({
      utterance: "add a task to call Dana",
      conversationId: flagOffConversation,
    });
    const flagOffTurn = await caller.claire.talk({
      utterance: "maybe",
      conversationId: flagOffConversation,
    });
    expect(flagOffTurn.operatorAdaptation).toBeNull();
    expect(await receiptRows()).toHaveLength(0);

    process.env.CLAIRE_OPERATOR_CONTEXT_ADAPTATION_ENABLED = "*";
    const beforeUse = await caller.operatorRepresentative.adaptationStatus();
    expect(
      beforeUse.lifecycle.find(item => item.directiveId === savedDirective.id)
        ?.lifecycle
    ).toBe("wired_unused");

    // Production Claire turn entry: first establish the real pending proposal,
    // then send the parent-main ambiguous reply.
    const adaptedConversation = `adapted-${suffix}`;
    await caller.claire.talk({
      utterance: "add a task to call Dana",
      conversationId: adaptedConversation,
    });
    const adaptedTurn = await caller.claire.talk({
      utterance: "maybe",
      conversationId: adaptedConversation,
    });
    expect(adaptedTurn.operatorAdaptation).toEqual({
      directiveId: savedDirective.id,
      targetKey: DAPHNE_STAGE3B_TARGET_KEY,
      behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
      structuralOutcome: "clarification_branch_selected",
      branch: "clarify",
      businessTruthMutation: false,
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
    const usedTalk = await caller.operatorRepresentative.ask({
      question: "Are you using this?",
      focusedItemId: target!.id,
    });
    expect(usedTalk.reply).toMatch(
      /durable receipt proves Claire used this 1 time/i
    );

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
    const revokedTalk = await caller.operatorRepresentative.ask({
      question: "Are you using this?",
      focusedItemId: target!.id,
    });
    expect(revokedTalk.reply).toMatch(/revoked now/i);
    expect(revokedTalk.reply).toMatch(/1 past use/i);

    const afterRevokeConversation = `after-revoke-${suffix}`;
    await caller.claire.talk({
      utterance: "add a task to call Dana",
      conversationId: afterRevokeConversation,
    });
    const afterRevokeTurn = await caller.claire.talk({
      utterance: "maybe",
      conversationId: afterRevokeConversation,
    });
    expect(afterRevokeTurn.operatorAdaptation).toBeNull();
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
    const callerB = systemRouter.createCaller(
      ctx(tenantB, operatorB, operatorBId)
    );
    expect(
      (await callerA2.operatorRepresentative.adaptationStatus()).lifecycle
    ).toEqual([]);
    expect(
      (await callerB.operatorRepresentative.adaptationStatus()).lifecycle
    ).toEqual([]);
  });
  it("links actual Claire execution to independently verified outcomes and later receipt evidence without inventing authority", async () => {
    const oldDaphne = process.env.DAPHNE_V2_CLAIRE_ENABLED;
    process.env.DAPHNE_V2_CLAIRE_ENABLED = "true";
    try {
      const caller = systemRouter.createCaller(
        ctx(tenantA, operatorA, operatorAId)
      );
      const home = await caller.operatorRepresentative.home();
      const target = home.learning.find(
        i => i.targetKey === DAPHNE_STAGE3B_TARGET_KEY
      )!;
      const directive = await caller.operatorRepresentative.directive({
        itemId: target.id,
        kind: "ask_instead",
      });
      const decision = await loadOperatorAdaptationDecisionForUser({
        tenantId: tenantA,
        operatorUserId: operatorA,
      });
      expect(decision).not.toBeNull();
      const scope = {
        tenantId: tenantA,
        canonicalOperatorId: decision!.canonicalOperatorId,
      };
      let previousScore: number | null = null;
      for (let index = 0; index < 3; index++) {
        const conversationId = `learning-${suffix}-${index}`;
        await caller.claire.talk({
          utterance: "add a task to call Dana",
          conversationId,
        });
        const turn = await caller.claire.talk({
          utterance: "maybe",
          conversationId,
        });
        expect(turn.operatorAdaptation?.branch).toBe("clarify");
        const interventions = await listDaphneInterventions({
          ...scope,
          limit: 500,
        });
        const intervention = interventions.find(i =>
          i.decisionPointId.includes(conversationId)
        )!;
        expect(intervention.policyReceipt).toMatchObject({
          executionStatus: "branch_selected",
          targetKey: DAPHNE_STAGE3B_TARGET_KEY,
          expandedBehaviorEnabled: false,
          evidenceDecisionPhase: "before_authorized_branch",
          appliedAuthority: "explicit_ask_instead_directive",
        });
        if (index === 2)
          expect(intervention.policyReceipt?.recommendation).toMatchObject({
            status: "evaluated",
            sampleCounts: { ask_instead: 2 },
          });
        for (const measureKey of ["started", "burden"]) {
          const evidence = await recordDaphneObservation({
            ...scope,
            agentId: "claire",
            actorType: "system",
            observationKind: "verified_operational_outcome",
            evidenceChannel: "system_record",
            verificationStatus: "verified",
            sourceType: "independent_acceptance_measurement",
            sourceReference: `measure-${index}-${measureKey}`,
            occurredAt: new Date(),
            payload: {
              interventionId: intervention.id,
              measureKey,
              value:
                measureKey === "started"
                  ? index < 2
                    ? 1
                    : 0
                  : index < 2
                    ? 0
                    : 1,
            },
            idempotencyKey: `verified-${index}-${measureKey}`,
          });
          if (index === 0 && measureKey === "started") {
            const trigger = `daphne_outcome_failure_${suffix}`;
            await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON daphne_outcomes FOR EACH ROW
              BEGIN IF NEW.tenantId='${tenantA}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='outcome failure'; END IF; END`);
            try {
              await expect(
                ingestVerifiedDaphneStage3bOutcome({
                  ...scope,
                  observationId: evidence.id,
                })
              ).rejects.toThrow();
              expect(
                (await listDaphneOutcomes(scope)).some(
                  o => o.sourceReference === evidence.id
                )
              ).toBe(false);
            } finally {
              await db.query(`DROP TRIGGER IF EXISTS ${trigger}`);
            }
            const stop = startDaphneConsolidationWorker();
            try {
              const deadline = Date.now() + 10_000;
              while (
                !(await listDaphneOutcomes(scope)).some(
                  o => o.sourceReference === evidence.id
                )
              ) {
                if (Date.now() > deadline)
                  throw new Error("Scheduled outcome ingestion did not finish");
                await new Promise(resolve => setTimeout(resolve, 50));
              }
            } finally {
              await stop();
            }
          }
          const learned = await ingestVerifiedDaphneStage3bOutcome({
            ...scope,
            observationId: evidence.id,
          });
          const duplicate = await ingestVerifiedDaphneStage3bOutcome({
            ...scope,
            observationId: evidence.id,
          });
          expect(duplicate.outcome.id).toBe(learned.outcome.id);
          await expect(
            ingestVerifiedDaphneStage3bOutcome({
              ...scope,
              canonicalOperatorId: "foreign",
              observationId: evidence.id,
            })
          ).rejects.toThrow();
          await expect(
            ingestVerifiedDaphneStage3bOutcome({
              ...scope,
              tenantId: tenantB,
              observationId: evidence.id,
            })
          ).rejects.toThrow();
          if (index === 0 && measureKey === "started") {
            for (const [key, override] of Object.entries({
              agent: { actorType: "agent" as const },
              unverified: { verificationStatus: "unverified" as const },
              wrongAgent: { agentId: "other" },
              expired: { occurredAt: new Date(Date.now() + 31 * 60_000) },
              invented: {
                payload: {
                  interventionId: intervention.id,
                  measureKey: "engagement",
                  value: 1,
                },
              },
            })) {
              const invalid = await recordDaphneObservation({
                ...scope,
                agentId: "claire",
                actorType: "system",
                observationKind: "verified_operational_outcome",
                evidenceChannel: "system_record",
                verificationStatus: "verified",
                sourceType: "negative_fixture",
                sourceReference: key,
                occurredAt: new Date(),
                payload: {
                  interventionId: intervention.id,
                  measureKey: "started",
                  value: 1,
                },
                idempotencyKey: `invalid:${key}`,
                ...override,
              });
              await expect(
                ingestVerifiedDaphneStage3bOutcome({
                  ...scope,
                  observationId: invalid.id,
                })
              ).rejects.toThrow();
            }
          }
        }
        const recommendation = await loadDaphneStage3bRecommendation(scope);
        if (index === 1) {
          expect(recommendation.status).toBe("evaluated");
          if (recommendation.status === "evaluated")
            previousScore = recommendation.decision.score;
        }
        if (index === 2) {
          expect(recommendation.status).toBe("evaluated");
          if (recommendation.status === "evaluated")
            expect(recommendation.decision.score!).toBeLessThan(previousScore!);
        }
      }
      await caller.operatorRepresentative.revokeDirective({
        directiveId: directive.id,
      });
      expect(
        await loadOperatorAdaptationDecisionForUser({
          tenantId: tenantA,
          operatorUserId: operatorA,
        })
      ).toBeNull();
    } finally {
      if (oldDaphne === undefined) delete process.env.DAPHNE_V2_CLAIRE_ENABLED;
      else process.env.DAPHNE_V2_CLAIRE_ENABLED = oldDaphne;
    }
  }, 60_000);
});
