import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import {
  daphneEpistemicClaims,
  daphneMetricEvents,
} from "../../../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { recordDaphneObservation } from "./observationStore";
import { recordDaphneEpistemicClaim } from "./epistemicStore";
import {
  startDaphneConsolidationWorker,
  runDaphneConsolidationBatch,
} from "./consolidationWorker";
import { buildDaphneV2OperatorCard } from "./engine";
import { classifyDaphneConversation } from "./conversationIngestion";
import { setDaphneMetaPreference } from "./goalsPreferences";
import { deleteDaphneV2UserData } from "./privacy";

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
async function until(check: () => Promise<boolean>, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Durable worker did not reach the expected state");
}
describeMysql("Daphne actual scheduled consolidation executor", () => {
  const scopes: Array<{ tenantId: string; canonicalOperatorId: string }> = [];
  const old = process.env.DAPHNE_V2_CLAIRE_ENABLED;
  function scope() {
    const value = {
      tenantId: `dream-${randomUUID().slice(0, 12)}`,
      canonicalOperatorId: "o",
    };
    scopes.push(value);
    process.env.DAPHNE_V2_CLAIRE_ENABLED = "true";
    return value;
  }
  async function seed(
    s: ReturnType<typeof scope>,
    text: string,
    id: string,
    occurredAt = new Date()
  ) {
    return recordDaphneObservation({
      ...s,
      agentId: "claire",
      sessionId: id,
      actorType: "user",
      observationKind: "user_statement",
      evidenceChannel: "stated",
      verificationStatus: "attested",
      sourceType: "claire_conversation_ingestion",
      sourceReference: id,
      occurredAt,
      payload: { schemaVersion: 1, items: classifyDaphneConversation(text) },
      idempotencyKey: id,
    });
  }
  async function receipts(s: ReturnType<typeof scope>) {
    const db = await getDb();
    if (!db) throw new Error("No disposable DB");
    return db
      .select()
      .from(daphneEpistemicClaims)
      .where(
        and(
          eq(daphneEpistemicClaims.tenantId, s.tenantId),
          sql`${daphneEpistemicClaims.idempotencyKey} like 'consolidated:%'`
        )
      );
  }
  afterAll(async () => {
    for (const s of scopes) await deleteDaphneV2UserData(s);
    if (old === undefined) delete process.env.DAPHNE_V2_CLAIRE_ENABLED;
    else process.env.DAPHNE_V2_CLAIRE_ENABLED = old;
  });
  it("runs longitudinal work, preserves correction/expiry/uncertainty and is idempotent under two workers", async () => {
    const s = scope();
    const first = await seed(
      s,
      "I own a laundromat.",
      "a",
      new Date(Date.now() - 3600_000)
    );
    await seed(s, "Actually I own a bakery.", "b", new Date(Date.now() - 1000));
    await seed(s, "My goal is to get five new customers this month.", "goal");
    await recordDaphneObservation({
      ...s,
      agentId: "claire",
      actorType: "user",
      observationKind: "system_context_event",
      evidenceChannel: "stated",
      verificationStatus: "attested",
      sourceType: "claire_conversation_ingestion",
      sourceReference: "expired",
      occurredAt: new Date(Date.now() - 3 * 3600_000),
      context: { taskMode: "execution", currentGoal: "deliveries today" },
      payload: { schemaVersion: 1, items: [] },
      idempotencyKey: "expired",
    });
    await recordDaphneEpistemicClaim({
      ...s,
      agentId: "claire",
      claimType: "if_then_hypothesis",
      claimKey: "uncertain",
      claim: { maybe: true },
      sourceObservationIds: [first.id],
      uncertainty: { epistemic: 0.95 },
      modelVersion: "fixture",
      idempotencyKey: "uncertain",
    });
    const stopA = startDaphneConsolidationWorker(),
      stopB = startDaphneConsolidationWorker();
    try {
      await until(async () => (await receipts(s)).length === 4);
      const card = await buildDaphneV2OperatorCard({ ...s, agentId: "claire" });
      expect(JSON.stringify(card)).toContain("bakery");
      expect(JSON.stringify(card)).not.toContain("I own laundromat");
      expect(card.state?.currentGoal).toBeNull();
      expect(card.goals[0].statement).toContain("five new customers");
      expect(
        card.hypotheses.find(h => h.claimKey === "uncertain")?.decision
      ).toBe("abstain");
    } finally {
      await stopA();
      await stopB();
    }
    const count = (await receipts(s)).length;
    const stopAgain = startDaphneConsolidationWorker();
    await new Promise(r => setTimeout(r, 100));
    await stopAgain();
    expect(await receipts(s)).toHaveLength(count);
    await setDaphneMetaPreference({
      ...s,
      preferenceKey: "adaptation_enabled",
      value: true,
      status: "revoked",
      sourceObservationId: first.id,
    });
    await seed(s, "I own a secret shop.", "denied");
    const stopDenied = startDaphneConsolidationWorker();
    try {
      await until(async () => (await receipts(s)).length === 5);
    } finally {
      await stopDenied();
    }
    const denied = await buildDaphneV2OperatorCard({ ...s, agentId: "claire" });
    expect(JSON.stringify(denied)).not.toContain("secret shop");
    expect(denied.metaPreferences.adaptation_enabled).toBe(false);
  }, 25_000); // polling allows 10s; exercise both scheduled workers under CI load
  it("recovers pending work after a claimed database connection crashes", async () => {
    const s = scope();
    const observation = await seed(s, "I own a laundromat.", "crash");
    const connection = await mysql.createConnection(process.env.DATABASE_URL!);
    await connection.beginTransaction();
    await connection.execute(
      "SELECT id FROM daphne_observations WHERE id=? FOR UPDATE",
      [observation.id]
    );
    const stop = startDaphneConsolidationWorker();
    try {
      await new Promise(r => setTimeout(r, 100));
      expect(await receipts(s)).toHaveLength(0);
      connection.destroy();
      await until(async () => (await receipts(s)).length === 1);
    } finally {
      connection.destroy();
      await stop();
    }
  }, 15_000);
  it("cannot restore late old evidence over a newer correction", async () => {
    const s = scope();
    const newer = await seed(
      s,
      "Actually I own a bakery.",
      "new",
      new Date(Date.now() - 1000)
    );
    await runDaphneConsolidationBatch({ observationId: newer.id });
    const late = await seed(
      s,
      "I own a laundromat.",
      "late",
      new Date(Date.now() - 3600_000)
    );
    await runDaphneConsolidationBatch({ observationId: late.id });
    const card = await buildDaphneV2OperatorCard({ ...s, agentId: "claire" });
    expect(JSON.stringify(card)).toContain("bakery");
    expect(JSON.stringify(card)).not.toContain("laundromat");
  });
  it("rolls back failed materialization, records failure and retries durable work after backoff", async () => {
    const s = scope();
    await seed(s, "I own a laundromat.", "failure");
    const db = await getDb();
    if (!db) throw new Error("No disposable DB");
    const trigger = `dream_fail_${randomUUID().replaceAll("-", "")}`;
    await db.execute(
      sql.raw(`CREATE TRIGGER ${trigger} BEFORE INSERT ON daphne_epistemic_claims FOR EACH ROW
   BEGIN IF NEW.tenantId='${s.tenantId}' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='dream failure'; END IF; END`)
    );
    let stop = startDaphneConsolidationWorker();
    try {
      await until(
        async () =>
          (
            await db
              .select()
              .from(daphneMetricEvents)
              .where(
                and(
                  eq(daphneMetricEvents.tenantId, s.tenantId),
                  eq(daphneMetricEvents.eventName, "consolidation_failed")
                )
              )
          ).length > 0
      );
      expect(await receipts(s)).toHaveLength(0);
      await stop();
      await db.execute(sql.raw(`DROP TRIGGER ${trigger}`));
      stop = startDaphneConsolidationWorker();
      await until(async () => (await receipts(s)).length === 1, 40_000);
    } finally {
      await stop();
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger}`));
    }
  }, 50_000);
  it("pauses work while the runtime gate is off without consuming durable evidence", async () => {
    const s = scope();
    const observation = await seed(s, "I own a bakery.", "paused");
    const oldTenants = process.env.DAPHNE_V2_CLAIRE_TENANTS;
    process.env.DAPHNE_V2_CLAIRE_ENABLED = "false";
    delete process.env.DAPHNE_V2_CLAIRE_TENANTS;
    try {
      expect(
        await runDaphneConsolidationBatch({ observationId: observation.id })
      ).toEqual({ processed: 0 });
      expect(await receipts(s)).toEqual([]);
    } finally {
      process.env.DAPHNE_V2_CLAIRE_ENABLED = "true";
      if (oldTenants === undefined) delete process.env.DAPHNE_V2_CLAIRE_TENANTS;
      else process.env.DAPHNE_V2_CLAIRE_TENANTS = oldTenants;
    }
    expect(
      await runDaphneConsolidationBatch({ observationId: observation.id })
    ).toEqual({ processed: 1 });
  });
  it("cannot recreate derived memory when erasure overlaps scheduled materialization", async () => {
    const s = scope();
    await seed(s, "I own a bakery.", "erasure");
    const db = await getDb();
    if (!db) throw new Error("No disposable DB");
    const trigger = `dream_slow_${randomUUID().replaceAll("-", "")}`;
    await db.execute(
      sql.raw(`CREATE TRIGGER ${trigger} BEFORE INSERT ON daphne_epistemic_claims FOR EACH ROW
      BEGIN IF NEW.tenantId='${s.tenantId}' THEN DO SLEEP(0.3); END IF; END`)
    );
    const stop = startDaphneConsolidationWorker();
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      await deleteDaphneV2UserData(s);
      await stop();
      expect(await receipts(s)).toEqual([]);
    } finally {
      await stop();
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger}`));
    }
  }, 15_000);
});
