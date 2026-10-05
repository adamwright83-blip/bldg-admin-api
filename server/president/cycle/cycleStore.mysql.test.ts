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
  }
);
