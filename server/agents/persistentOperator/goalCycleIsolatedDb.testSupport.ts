import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Pool } from "mysql2/promise";

/**
 * A private database holding only the durable goal-cycle tables, for MySQL
 * tests that run a GoalCycleWorker. A worker claims the next due cycle of any
 * tenant, so on the shared test database it could take another (parallel) test
 * file's cycle. The worker's store points here; everything else (identity,
 * policy, decisions, objectives) stays on the shared DATABASE_URL, keyed by a
 * tenant unique to the test.
 */
export async function createIsolatedGoalCycleDb(databaseUrl: string): Promise<{
  pool: Pool;
  insertRun: (run: { id: string; tenantId: string; canonicalOperatorId: string; operatorUserId: string; verticalKey: string; status?: string }) => Promise<void>;
  drop: () => Promise<void>;
}> {
  const url = new URL(databaseUrl);
  const name = `goal_cycle_iso_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  url.pathname = "/";
  const admin = await mysql.createConnection(url.toString());
  await admin.query(`CREATE DATABASE \`${name}\``);
  url.pathname = `/${name}`;
  const pool = mysql.createPool({ uri: url.toString(), connectionLimit: 12, supportBigNumbers: true, bigNumberStrings: true });
  const sql = await readFile(new URL("../../../drizzle/0103_persistent_growth_goal_cycles.sql", import.meta.url), "utf8");
  for (const statement of sql.replace(/^\s*--.*$/gm, "").split(";").map(value => value.trim()).filter(Boolean)) {
    await pool.query(statement);
  }
  return {
    pool,
    insertRun: async run => {
      await pool.execute(
        `INSERT INTO macro_goal_runs
          (id, tenantId, canonicalOperatorId, operatorUserId, macroGoalId, verticalKey,
           status, goalSnapshotJson, metricKey, targetValue, unit, baselinePrecision,
           baselineCoverage, policyVersion)
         VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 'active_customers', 50, 'customers', 'exact', 'complete', 'v1')`,
        [run.id, run.tenantId, run.canonicalOperatorId, run.operatorUserId, run.id, run.verticalKey, run.status ?? "active"]
      );
    },
    drop: async () => {
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await admin.end();
    },
  };
}
