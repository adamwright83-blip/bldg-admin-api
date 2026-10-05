import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PresidentCandidateList } from "../../../shared/presidentCycle";
import { MysqlPresidentCycleStore } from "./store";

let pool: Pool;

async function apply(path: string) {
  const sql = await readFile(
    resolve(import.meta.dirname, "../../../drizzle", path),
    "utf8"
  );
  for (const statement of sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map(value => value.trim())
    .filter(Boolean))
    await pool.query(statement);
}

function candidates(): PresidentCandidateList {
  return {
    summary: "Ranked ten",
    candidates: Array.from({ length: 10 }, (_, index) => ({
      id: "candidate-" + (index + 1),
      rank: index + 1,
      title: "Candidate " + (index + 1),
      problem: "Bounded problem",
      evidenceIds: ["evidence-1"],
      proposedChange: "Bounded change " + (index + 1),
      expectedOutcome: "Expected outcome",
      risk: "Known risk",
      dependencies: [],
      executionDomain: index === 0 ? "ENGINEERING" : "RESEARCH",
      roughScope: "Small",
      whyNow: "Current evidence",
      successCriteria: ["Criterion " + (index + 1)],
      responseToCritique: "",
      changedAfterCritique: false,
    })),
  };
}

describe.skipIf(process.env.PRESIDENT_MYSQL_TEST !== "1")(
  "President autonomous cycle durable MySQL",
  () => {
    beforeAll(async () => {
      const port = process.env.PRESIDENT_MYSQL_TEST_PORT ?? "3411";
      const admin = await mysql.createConnection(
        `mysql://root:root@127.0.0.1:${port}/`
      );
      await admin.query("DROP DATABASE IF EXISTS president_cycle_test");
      await admin.query("CREATE DATABASE president_cycle_test");
      await admin.end();
      pool = mysql.createPool({
        uri: `mysql://root:root@127.0.0.1:${port}/president_cycle_test`,
        timezone: "Z",
        connectionLimit: 8,
      });
      await apply("0120_president_autonomous_cycles.sql");
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("persists the review gate and creates exactly the approved missions", async () => {
      const firstStore = new MysqlPresidentCycleStore(pool);
      const created = await firstStore.createCycle(["evidence-1"]);
      const finalCandidates = candidates();
      const awaiting = await firstStore.updateCycle(created.id, {
        state: "AWAITING_ADAM_REVIEW",
        initialCandidates: finalCandidates,
        finalCandidates,
        proposedCandidateIds: ["candidate-1", "candidate-2", "candidate-3"],
      });
      expect(awaiting.state).toBe("AWAITING_ADAM_REVIEW");

      // Simulate a worker/process restart by constructing a new adapter.
      const restarted = new MysqlPresidentCycleStore(pool);
      const afterRestart = await restarted.getCycle(created.id);
      expect(afterRestart?.state).toBe("AWAITING_ADAM_REVIEW");
      expect(afterRestart?.approval).toBeNull();

      const approvedAt = new Date().toISOString();
      const approval = {
        cycleId: created.id,
        founderId: "adam-test",
        approvedCandidateIds: ["candidate-1", "candidate-4", "candidate-7"],
        approvedAt,
        receiptSha256: "a".repeat(64),
      };

      await restarted.transaction(async store => {
        const locked = await store.getCycle(created.id, true);
        expect(locked?.state).toBe("AWAITING_ADAM_REVIEW");
        await store.createMissions(
          created.id,
          finalCandidates.candidates,
          approval
        );
        await store.updateCycle(created.id, {
          state: "ADAM_APPROVED",
          approval,
        });
      });

      const durable = await new MysqlPresidentCycleStore(pool).getCycle(
        created.id
      );
      expect(durable?.state).toBe("ADAM_APPROVED");
      expect(durable?.approval?.approvedCandidateIds).toEqual([
        "candidate-1",
        "candidate-4",
        "candidate-7",
      ]);
      const missions = await restarted.listMissions(created.id);
      expect(missions.map(mission => mission.candidateId)).toEqual([
        "candidate-1",
        "candidate-4",
        "candidate-7",
      ]);
      expect(missions.every(mission => mission.state === "QUEUED")).toBe(true);
    });

    it("recovers an expired execution lease without duplicating a mission", async () => {
      const store = new MysqlPresidentCycleStore(pool);
      const cycle = await store.createCycle(["evidence-1"]);
      const finalCandidates = candidates();
      const approval = {
        cycleId: cycle.id,
        founderId: "adam-test",
        approvedCandidateIds: ["candidate-2"],
        approvedAt: new Date().toISOString(),
        receiptSha256: "b".repeat(64),
      };
      await store.updateCycle(cycle.id, {
        state: "ADAM_APPROVED",
        finalCandidates,
        proposedCandidateIds: ["candidate-2"],
        approval,
      });
      await store.createMissions(
        cycle.id,
        finalCandidates.candidates,
        approval
      );
      const claimed = await store.claimNextMission(cycle.id, randomUUID(), 1);
      expect(claimed?.state).toBe("PREPARING");
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.recoverExpiredLeases();
      const missions = await store.listMissions(cycle.id);
      expect(missions).toHaveLength(1);
      expect(missions[0].state).toBe("REPAIR_REQUIRED");
      expect(missions[0].attemptCount).toBe(1);
    });
  }
);
