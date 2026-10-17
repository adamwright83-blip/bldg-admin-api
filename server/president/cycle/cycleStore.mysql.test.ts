import mysql, { type Pool } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvidenceItem } from "../../../shared/presidentCycle";
import { createCycle, setStatus } from "./cycleService";
import { MysqlCycleStore } from "./cycleStore";

let pool: Pool;
const evidence: EvidenceItem[] = [
  {
    id: "ev_mysql_cycle",
    source: "test",
    kind: "fixture",
    observedAt: "2026-10-05T22:00:00.000Z",
    summary: "explicit MySQL durability fixture",
    ref: "fixture:mysql-cycle",
    basis: "EVIDENCE",
  },
];

describe.skipIf(process.env.PRESIDENT_MYSQL_TEST !== "1")(
  "President autonomous cycle MySQL durability",
  () => {
    beforeAll(async () => {
      const port = process.env.PRESIDENT_MYSQL_TEST_PORT ?? "3411";
      const admin = await mysql.createConnection(
        `mysql://root:root@127.0.0.1:${port}/`
      );
      await admin.query(
        "CREATE DATABASE IF NOT EXISTS president_autonomous_cycle_test"
      );
      await admin.end();
      pool = mysql.createPool({
        uri: `mysql://root:root@127.0.0.1:${port}/president_autonomous_cycle_test`,
        timezone: "Z",
        connectionLimit: 8,
      });
      const sql = await readFile(
        resolve(
          import.meta.dirname,
          "../../../drizzle/0120_president_autonomous_cycles.sql"
        ),
        "utf8"
      );
      for (const statement of sql
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map(x => x.trim())
        .filter(Boolean))
        await pool.query(statement);
      await pool.query("DELETE FROM president_autonomous_cycles");
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("survives a new store instance and serializes state/version updates", async () => {
      const first = new MysqlCycleStore(pool);
      const created = await createCycle(first, {
        tenantId: "tenant-a",
        evidence,
      });
      await first.update(created.cycleId, cycle => {
        setStatus(cycle, "DELIBERATING_PROPOSAL", "mysql witness");
      });

      const reopened = new MysqlCycleStore(pool);
      const loaded = await reopened.get(created.cycleId);
      expect(loaded).not.toBeNull();
      expect(loaded!.status).toBe("DELIBERATING_PROPOSAL");
      expect(loaded!.version).toBe(2);
      expect((await reopened.list("tenant-a")).map(c => c.cycleId)).toContain(
        created.cycleId
      );
      expect(await reopened.list("tenant-b")).toEqual([]);
    });

    it("prevents lost updates across two store instances", async () => {
      const a = new MysqlCycleStore(pool);
      const b = new MysqlCycleStore(pool);
      const c = await createCycle(a, {
        tenantId: "tenant-lock",
        evidence,
      });
      await Promise.all([
        a.update(c.cycleId, x => {
          x.notifications.push({
            at: new Date().toISOString(),
            channel: "test",
            message: "a",
            link: "/a",
          });
        }),
        b.update(c.cycleId, x => {
          x.notifications.push({
            at: new Date().toISOString(),
            channel: "test",
            message: "b",
            link: "/b",
          });
        }),
      ]);
      const loaded = (await a.get(c.cycleId))!;
      expect(loaded.notifications.map(n => n.message).sort()).toEqual(["a", "b"]);
      expect(loaded.version).toBe(3);
    });

    it("lists every tenant newest first even when one payload is larger than the sort buffer", async () => {
      // Production failed every worker tick with ER_OUT_OF_SORTMEMORY (1038):
      // the unscoped list sorted rows that carried payloadJson.
      const store = new MysqlCycleStore(pool);
      const [{ sortBuffer }] = (await pool.query("SELECT @@sort_buffer_size AS sortBuffer"))[0] as Array<{ sortBuffer: number }>;
      const big = await createCycle(store, {
        tenantId: "tenant-big",
        evidence: [{ ...evidence[0], id: "ev_big", summary: "x".repeat(Number(sortBuffer) + 150_000) }],
      });
      await new Promise(done => setTimeout(done, 5));
      const newer = await createCycle(store, { tenantId: "tenant-small", evidence });

      const all = await store.list();
      const order = all.map(c => c.cycleId);
      expect(order).toContain(big.cycleId);
      expect(order.indexOf(newer.cycleId)).toBeLessThan(order.indexOf(big.cycleId));
      expect(all.find(c => c.cycleId === big.cycleId)!.evidence[0].summary.length).toBeGreaterThan(Number(sortBuffer));
      expect((await store.list("tenant-big")).map(c => c.cycleId)).toEqual([big.cycleId]);
    });

    it("a worker tick with model calls off only reads: nothing advances, nothing is attempted", async () => {
      const port = process.env.PRESIDENT_MYSQL_TEST_PORT ?? "3411";
      const saved = { ...process.env };
      process.env.PRESIDENT_DATABASE_URL = `mysql://root:root@127.0.0.1:${port}/president_autonomous_cycle_test`;
      process.env.PRESIDENT_EXECUTION_ENABLED = "1";
      delete process.env.PRESIDENT_WORKER_MODEL_CALLS_ENABLED;
      try {
        const store = new MysqlCycleStore(pool);
        const waiting = await createCycle(store, { tenantId: "tenant-paused", evidence });
        await store.update(waiting.cycleId, cycle => setStatus(cycle, "DELIBERATING_PROPOSAL", "waiting"));
        const before = (await store.list()).map(c => [c.cycleId, c.status, c.version]);

        const { runPresidentCycleWorkerTick } = await import("./runtime");
        const tick = await runPresidentCycleWorkerTick();
        expect(tick).toMatchObject({ attempted: 0, results: [], paused: "model_calls_disabled" });
        expect((tick as { waitingCycles: number }).waitingCycles).toBeGreaterThanOrEqual(1);
        expect((await store.list()).map(c => [c.cycleId, c.status, c.version])).toEqual(before);
      } finally {
        process.env = saved;
      }
    });
  }
);
