/**
 * Verifies that drizzle migrations 0035-0044 have been applied by
 * introspecting information_schema for the tables/columns each migration
 * is expected to have created. Exits nonzero if anything required is missing.
 *
 * Usage:
 *   DATABASE_URL=... pnpm dayforge:migrations:verify
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

type RequiredTable = {
  migration: string;
  table: string;
  columns: string[];
};

const REQUIRED: RequiredTable[] = [
  { migration: "0035_commercial_mission_spine", table: "commercial_missions", columns: ["id", "tenantId", "status", "code"] },
  { migration: "0035_commercial_mission_spine", table: "commercial_accounts", columns: ["id", "tenantId", "identityKey"] },
  { migration: "0036_territory_intelligence", table: "territory_scan_sessions", columns: ["id", "tenantId"] },
  { migration: "0037_commercial_mission_game_results", table: "commercial_mission_game_results", columns: ["id", "tenantId", "missionId"] },
  { migration: "0038_commercial_mission_field", table: "commercial_mission_field_states", columns: ["id", "tenantId", "missionId"] },
  { migration: "0039_commercial_proposals", table: "commercial_proposals", columns: ["id", "tenantId"] },
  { migration: "0040_customer_churn_recovery", table: "customer_churn_scans", columns: ["id", "tenantId"] },
  { migration: "0041_commercial_pipeline_conversion", table: "commercial_pipeline_records", columns: ["id", "tenantId", "missionId", "stage"] },
  { migration: "0042_dayforge_saas_onboarding_billing", table: "dayforge_saas_tenants", columns: ["id", "slug", "status"] },
  { migration: "0043_dayforge_analytics_release", table: "dayforge_audit_events", columns: ["id", "tenantId", "eventName"] },
  { migration: "0044_dayforge_release_order_compatibility", table: "orders", columns: ["residentClientRequestId"] },
];

function rowsFrom(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first)) return first as readonly Record<string, unknown>[];
    if (result.every(item => item && typeof item === "object")) {
      return result as readonly Record<string, unknown>[];
    }
  }
  const rows = (result as { rows?: readonly unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as readonly Record<string, unknown>[]) : [];
}

async function main() {
  const db = await getDb();
  if (!db) {
    console.error("[dayforge-migrations-verify] Database not available");
    process.exit(1);
  }

  let ok = true;
  for (const requirement of REQUIRED) {
    const tableResult = await db.execute(sql`
      SELECT COUNT(*) AS count
        FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = ${requirement.table}
    `);
    const tableCount = Number(rowsFrom(tableResult)[0]?.count ?? 0);
    if (tableCount === 0) {
      console.log(`  [FAIL] ${requirement.migration}: table '${requirement.table}' is missing`);
      ok = false;
      continue;
    }

    const columnResult = await db.execute(sql`
      SELECT column_name AS name
        FROM information_schema.columns
       WHERE table_schema = DATABASE()
         AND table_name = ${requirement.table}
    `);
    const existingColumns = new Set(
      rowsFrom(columnResult).map(row => String(row.name).toLowerCase())
    );
    const missingColumns = requirement.columns.filter(
      column => !existingColumns.has(column.toLowerCase())
    );
    if (missingColumns.length > 0) {
      console.log(
        `  [FAIL] ${requirement.migration}: table '${requirement.table}' missing columns: ${missingColumns.join(", ")}`
      );
      ok = false;
      continue;
    }

    console.log(`  [PASS] ${requirement.migration}: '${requirement.table}' present with required columns`);
  }

  console.log("");
  console.log(ok ? "[dayforge-migrations-verify] OK" : "[dayforge-migrations-verify] FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch(error => {
  console.error("[dayforge-migrations-verify] Failed:", error);
  process.exit(1);
});
