/**
 * Provision the LAUNDRY FARM design-partner TEST tenant.
 *
 * Usage:
 *   GOLDLINE_DESIGN_PARTNER_TENANT=true \
 *   GOLDLINE_DESIGN_PARTNER_OWNER=<userOpenId> \
 *     pnpm tsx scripts/goldline-design-partner-tenant.ts [--reset]
 *
 * WHY A SEPARATE TENANT ID
 *
 * `laundry_farm` is already a REAL production tenant: `server/saas/tenantAccess.ts`
 * lists it in `DAYFORGE_LEGACY_TENANT_IDS` ("default,laundry_farm"), and
 * `laundry_farm` is a live business unit in payment reconciliation and the
 * revenue sheet sync. Reusing that id to demo onboarding would drop a test
 * onboarding session on top of a real operating business.
 *
 * So the DISPLAY NAME is "LAUNDRY FARM" as requested, while the tenant id is
 * `goldline-dp-laundry-farm` — a distinct tenant whose rows are invisible to
 * every real tenant through the same tenantId scoping the product already
 * enforces. This is the "safe test tenant mechanism": additive, isolated, and
 * incapable of touching an existing world.
 *
 * SAFETY
 *
 * - Requires an explicit opt-in flag.
 * - Refuses any of the legacy/real tenant ids outright.
 * - Refuses to adopt a tenant id that already owns orders or physical entities,
 *   so it can never claim real data that arrived by another route.
 * - Idempotent: re-running updates the fixture rather than duplicating it.
 * - `--reset` clears ONLY this tenant's onboarding session and custody rows, so
 *   the five-question flow can be replayed. It never deletes another tenant.
 * - Contains no secrets; credentials come from the environment.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const TENANT_ID = "goldline-dp-laundry-farm";
const BUSINESS_NAME = "LAUNDRY FARM";
// Every id this script must never write to, whatever the environment says.
const PROTECTED_TENANT_IDS = new Set([
  "default",
  "laundry_farm",
  ...(process.env.DAYFORGE_LEGACY_TENANT_IDS ?? "default,laundry_farm")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean),
]);

async function main() {
  if (process.env.GOLDLINE_DESIGN_PARTNER_TENANT !== "true")
    throw new Error(
      "Refusing to run without GOLDLINE_DESIGN_PARTNER_TENANT=true."
    );
  if (PROTECTED_TENANT_IDS.has(TENANT_ID))
    throw new Error(`Refusing to write to protected tenant ${TENANT_ID}.`);

  const owner = process.env.GOLDLINE_DESIGN_PARTNER_OWNER;
  if (!owner)
    throw new Error(
      "GOLDLINE_DESIGN_PARTNER_OWNER=<userOpenId> is required so the test tenant has a signed-in owner."
    );

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = (result: unknown): any[] => (result as any)[0] ?? [];

  // A tenant id that already owns operating data is not a fixture. Stop.
  for (const table of ["orders", "physical_entities"]) {
    const existing = rows(
      await db.execute(
        sql`SELECT 1 FROM ${sql.raw(table)} WHERE tenantId=${TENANT_ID} LIMIT 1`
      )
    );
    if (existing.length)
      throw new Error(
        `Refusing to reuse ${TENANT_ID}: it already owns rows in ${table}. This script only provisions an empty fixture tenant.`
      );
  }

  const reset = process.argv.includes("--reset");
  if (reset) {
    await db.execute(
      sql`DELETE FROM goldline_onboarding_sessions WHERE tenantId=${TENANT_ID}`
    );
    await db.execute(
      sql`DELETE FROM goldline_vehicle_custody WHERE tenantId=${TENANT_ID}`
    );
    await db.execute(
      sql`DELETE FROM goldline_world_events WHERE tenantId=${TENANT_ID}`
    );
    console.log(`Reset onboarding, custody and world events for ${TENANT_ID}.`);
  }

  await db.execute(sql`
    INSERT INTO dayforge_saas_tenants
      (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,onboardingStep)
    VALUES
      (${TENANT_ID},${TENANT_ID},${BUSINESS_NAME},${BUSINESS_NAME},'#f3cc7e','Design Partner Test',
       'design-partner@example.invalid','America/Los_Angeles','active','complete')
    ON DUPLICATE KEY UPDATE businessName=VALUES(businessName), brandName=VALUES(brandName), status=VALUES(status)`);

  await db.execute(sql`
    INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active)
    VALUES (${TENANT_ID},${owner},'owner',1)
    ON DUPLICATE KEY UPDATE role=VALUES(role), active=VALUES(active)`);

  await db.execute(sql`
    INSERT INTO dayforge_saas_subscriptions
      (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status)
    VALUES (${TENANT_ID},'design_partner','test_customer_not_billable','test_subscription_not_billable','trialing')
    ON DUPLICATE KEY UPDATE status=VALUES(status)`);

  for (const entitlement of [
    "dayforge_core",
    "territory_intelligence",
    "dayforge_field",
  ])
    await db.execute(sql`
      INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled)
      VALUES (${TENANT_ID},${entitlement},'manual',1)
      ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`);

  const session = rows(
    await db.execute(
      sql`SELECT status FROM goldline_onboarding_sessions WHERE tenantId=${TENANT_ID}`
    )
  );
  console.log(
    [
      `Tenant:      ${TENANT_ID} (${BUSINESS_NAME})`,
      `Owner:       ${owner}`,
      `Onboarding:  ${session.length ? `existing session, status ${session[0].status}` : "none — the five questions will run"}`,
      `Protected:   ${[...PROTECTED_TENANT_IDS].join(", ")} untouched`,
      "",
      "Open Admin as this tenant to run the five-question onboarding.",
      "Re-run with --reset to replay onboarding from the first question.",
    ].join("\n")
  );
}

main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
);
