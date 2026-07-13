import { sql, eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { dayforgeSaasTenants, orders } from "../../drizzle/schema";
import { getCommercialMissionByIdempotencyKey } from "../commercialMissions/commercialMissionStore";
import {
  DEMO_MISSION_IDEMPOTENCY_KEY,
  DEMO_MISSION_PUBLIC_CODE,
  demoTenantId,
  demoTenantSlug,
} from "./demoTenantSeed";

export type DemoVerifyCheck = {
  name: string;
  pass: boolean;
  detail?: string;
};

export type DemoVerifyReport = {
  ok: boolean;
  checks: DemoVerifyCheck[];
};

const REQUIRED_TABLES = [
  "dayforge_saas_tenants",
  "dayforge_saas_tenant_locations",
  "commercial_missions",
  "commercial_pipeline_records",
  "commercial_mission_game_attempts",
  "commercial_mission_field_states",
  "customer_churn_scans",
  "dayforge_audit_events",
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

async function tableExists(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  tableName: string
): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS count
      FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ${tableName}
  `);
  const first = rowsFrom(result)[0] as { count?: number } | undefined;
  return Number(first?.count ?? 0) > 0;
}

/**
 * Server-side integrity check for the demo tenant. Runs a sequence of
 * pass/fail checks and never throws for an expected failure state — it
 * reports the failure in the returned report instead, so callers (including
 * the CLI script) can decide how to exit.
 */
export async function verifyDemoTenant(): Promise<DemoVerifyReport> {
  const checks: DemoVerifyCheck[] = [];
  const db = await getDb();
  if (!db) {
    return {
      ok: false,
      checks: [{ name: "database_connection", pass: false, detail: "Database not available" }],
    };
  }

  for (const tableName of REQUIRED_TABLES) {
    const exists = await tableExists(db, tableName);
    checks.push({
      name: `table:${tableName}`,
      pass: exists,
      detail: exists ? undefined : "Table is missing; run drizzle migrations",
    });
  }
  if (checks.some(check => !check.pass)) {
    return { ok: false, checks };
  }

  const tenantId = demoTenantId();
  const tenantRows = await db
    .select({ id: dayforgeSaasTenants.id, status: dayforgeSaasTenants.status })
    .from(dayforgeSaasTenants)
    .where(eq(dayforgeSaasTenants.id, tenantId))
    .limit(1);
  const tenant = tenantRows[0];
  checks.push({
    name: "demo_tenant_exists",
    pass: Boolean(tenant),
    detail: tenant ? undefined : `Expected tenant '${tenantId}' (slug '${demoTenantSlug()}')`,
  });
  if (!tenant) return { ok: false, checks };

  const mission = await getCommercialMissionByIdempotencyKey({
    tenantId,
    idempotencyKey: DEMO_MISSION_IDEMPOTENCY_KEY,
  });
  checks.push({
    name: "canonical_mission_exists",
    pass: Boolean(mission),
    detail: mission ? undefined : "MISSION 042 (Westview Property Management) not found",
  });

  if (mission) {
    checks.push({
      name: "mission_public_code_stable",
      pass: mission.code === DEMO_MISSION_PUBLIC_CODE,
      detail: `code=${mission.code} (internal id=${mission.id})`,
    });
    checks.push({
      name: "mission_account_linked",
      pass: mission.account.name === "Westview Property Management",
      detail: `account.name=${mission.account.name}`,
    });
    checks.push({
      name: "mission_decision_maker",
      pass: mission.account.decisionMaker.name === "Dana R.",
      detail: `decisionMaker.name=${mission.account.decisionMaker.name}`,
    });
    checks.push({
      name: "mission_estimated_value",
      pass: mission.opportunity.estimatedAnnualValueCents === 24_800_00,
      detail: `estimatedAnnualValueCents=${mission.opportunity.estimatedAnnualValueCents}`,
    });
    checks.push({
      name: "mission_steps_present",
      pass: mission.steps.length > 0,
      detail: `steps=${mission.steps.length}`,
    });
  }

  const churnOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.tenantId, tenantId), eq(orders.firstName, "Sarah")))
    .limit(1);
  checks.push({
    name: "churn_customer_orders_exist",
    pass: churnOrders.length > 0,
    detail: churnOrders.length > 0 ? undefined : "Sarah Johnson order history not found",
  });

  return { ok: checks.every(check => check.pass), checks };
}
