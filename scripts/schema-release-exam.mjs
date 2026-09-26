/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const conn = await mysql.createConnection(databaseUrl);

const requiredTables = [
  "dayforge_saas_tenants",
  "dayforge_saas_memberships",
  "dayforge_saas_onboarding_sessions",
  "dayforge_saas_billing_plans",
  "dayforge_saas_subscriptions",
  "dayforge_saas_entitlements",
  "dayforge_saas_import_connections",
  "dayforge_saas_external_customers",
  "dayforge_saas_external_orders",
  "cleancloud_import_batches",
  "cleancloud_paid_orders",
  "impact_signals",
  "tracked_signal_definitions",
  "driver_sales_journals",
  "commercial_mission_irl_step_details",
];

for (const tableName of requiredTables) {
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS count
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  if (Number(rows[0]?.count ?? 0) !== 1) {
    throw new Error(`Required SaaS release table is missing: ${tableName}`);
  }
}

const assertIndex = async (tableName, indexName, expectedColumns) => {
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND INDEX_NAME = ?
      ORDER BY SEQ_IN_INDEX`,
    [tableName, indexName]
  );
  const actual = rows.map(row => row.COLUMN_NAME);
  if (actual.join(",") !== expectedColumns.join(",")) {
    throw new Error(
      `Required index ${tableName}.${indexName} is wrong: ${actual.join(",") || "<missing>"}; expected: ${expectedColumns.join(",")}`
    );
  }
};

const [auditEnumRows] = await conn.execute(
  `SELECT COLUMN_TYPE
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'dayforge_audit_events'
      AND COLUMN_NAME = 'actorType'`
);
const auditEnum = String(auditEnumRows[0]?.COLUMN_TYPE ?? "");
for (const value of ["public", "owner", "admin", "operator", "field", "game", "stripe", "system"]) {
  if (!auditEnum.includes(`'${value}'`)) {
    throw new Error(
      `dayforge_audit_events.actorType is missing enum value ${value}: ${auditEnum || "<missing>"}`
    );
  }
}

await assertIndex("cleancloud_legacy_orders", "idx_cleancloud_legacy_orders_batch", [
  "importBatchId",
]);
await assertIndex(
  "cleancloud_legacy_orders",
  "idx_cleancloud_legacy_orders_customer_order",
  ["customerName", "orderDateUtc", "orderTotalCents"]
);
await assertIndex("cleancloud_legacy_orders", "idx_cleancloud_legacy_orders_building", [
  "buildingName",
  "tower",
]);
await assertIndex("cleancloud_paid_orders", "idx_cleancloud_paid_orders_batch", [
  "importBatchId",
]);
await assertIndex("cleancloud_paid_orders", "idx_cleancloud_paid_orders_payment_date", [
  "paymentDateUtc",
]);
await assertIndex("cleancloud_paid_orders", "idx_cleancloud_paid_orders_paid_date", [
  "paidDateUtc",
]);
await assertIndex("cleancloud_paid_orders", "idx_cleancloud_paid_orders_customer", [
  "cleancloudCustomerId",
  "customerName",
]);
await assertIndex("cleancloud_paid_orders", "idx_cleancloud_paid_orders_building", [
  "buildingSlug",
  "tower",
]);
await assertIndex(
  "payment_reconciliation_matches",
  "idx_payment_reconciliation_source_date",
  ["processor", "processorSourceType", "processorSourceId", "localBusinessDate"]
);
await assertIndex(
  "payment_reconciliation_matches",
  "idx_payment_reconciliation_status",
  ["matchStatus"]
);
await assertIndex(
  "payment_reconciliation_matches",
  "idx_payment_reconciliation_customer",
  ["cleancloudCustomerId", "customerName"]
);
await assertIndex(
  "payment_reconciliation_matches",
  "idx_payment_reconciliation_building",
  ["buildingSlug", "tower"]
);

await assertIndex(
  "commercial_mission_irl_step_details",
  "uq_commercial_irl_step_details_tenant_step",
  ["tenantId", "missionStepId"]
);
await assertIndex(
  "commercial_mission_irl_step_details",
  "idx_commercial_irl_step_details_tenant_mission",
  ["tenantId", "missionId", "missionStepId"]
);

const [debriefColumns] = await conn.execute(
  `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'driver_sales_journals'
      AND COLUMN_NAME = 'debriefMissionId'`
);
if (debriefColumns.length !== 1) {
  throw new Error("driver_sales_journals.debriefMissionId is missing");
}

const [missionIndex] = await conn.execute(
  `SELECT COLUMN_NAME
     FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'driver_sales_journals'
      AND INDEX_NAME = 'idx_driver_sales_journal_tenant_mission'
    ORDER BY SEQ_IN_INDEX`
);
const missionIndexColumns = missionIndex.map(row => row.COLUMN_NAME);
if (
  missionIndexColumns.join(",") !== "tenantId,debriefMissionId,createdAt"
) {
  throw new Error(
    `driver journal mission index is wrong: ${missionIndexColumns.join(",")}`
  );
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const tenantId = `schema-exam-${suffix}`;
const openId = `schema-exam-user-${suffix}`;
const planKey = `schema-exam-plan-${suffix}`;
const importRunId = randomUUID();
const now = new Date();

await conn.beginTransaction();
try {
  await conn.execute(
    `INSERT INTO dayforge_saas_onboarding_sessions
      (id,resumeTokenHash,businessName,slug,ownerEmail,startRequestId,expiresAt)
     VALUES (?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      suffix.padEnd(64, "0"),
      "Schema Release Laundry",
      tenantId,
      `owner-${suffix}@example.invalid`,
      randomUUID(),
      new Date(Date.now() + 60_000),
    ]
  );

  await conn.execute(
    `INSERT INTO dayforge_saas_tenants
      (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      tenantId,
      tenantId,
      "Schema Release Laundry",
      "Schema Release Laundry",
      "#000000",
      "Schema Owner",
      `owner-${suffix}@example.invalid`,
      "America/Los_Angeles",
      "active",
    ]
  );

  await conn.execute(
    `INSERT INTO users (tenantId,openId,name,email,role)
     VALUES (?,?,?,?,?)`,
    [
      tenantId,
      openId,
      "Schema Owner",
      `owner-${suffix}@example.invalid`,
      "user",
    ]
  );

  await conn.execute(
    `INSERT INTO dayforge_saas_memberships
      (tenantId,userOpenId,role,active)
     VALUES (?,?,?,true)`,
    [tenantId, openId, "owner"]
  );

  await conn.execute(
    `INSERT INTO dayforge_saas_billing_plans
      (planKey,displayName,stripePriceId,rulesJson,entitlementsJson,active)
     VALUES (?,?,?,?,?,true)`,
    [planKey, "Schema Exam", `price_${suffix}`, "{}", "[]"]
  );

  await conn.execute(
    `INSERT INTO dayforge_saas_subscriptions
      (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,lastStripeEventId,lastStripeEventCreatedAt)
     VALUES (?,?,?,?,?,?,?)`,
    [
      tenantId,
      planKey,
      `cus_${suffix}`,
      `sub_${suffix}`,
      "active",
      `evt_${suffix}`,
      now,
    ]
  );

  await conn.execute(
    `INSERT INTO dayforge_saas_entitlements
      (tenantId,entitlementKey,source,enabled)
     VALUES (?,?,?,true)`,
    [tenantId, "schema.release.exam", "plan"]
  );

  const [connectionResult] = await conn.execute(
    `INSERT INTO dayforge_saas_import_connections
      (tenantId,providerKey,status,configurationJson)
     VALUES (?,?,?,?)`,
    [tenantId, "schema_exam", "connected", "{}"]
  );
  const connectionId = connectionResult.insertId;

  await conn.execute(
    `INSERT INTO dayforge_saas_external_customers
      (tenantId,connectionId,providerKey,externalId,name,factsJson,sourceCapturedAt,importRunId)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      tenantId,
      connectionId,
      "schema_exam",
      `customer-${suffix}`,
      "Synthetic Customer",
      "{}",
      now,
      importRunId,
    ]
  );

  await conn.execute(
    `INSERT INTO dayforge_saas_external_orders
      (tenantId,connectionId,providerKey,externalId,externalCustomerId,totalCents,paid,factsJson,sourceCapturedAt,importRunId)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      tenantId,
      connectionId,
      "schema_exam",
      `order-${suffix}`,
      `customer-${suffix}`,
      1234,
      true,
      "{}",
      now,
      importRunId,
    ]
  );

  await conn.execute(
    `INSERT INTO impact_signals
      (id,tenantId,businessDate,signalKey,label,value,confirmedAt)
     VALUES (?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      tenantId,
      "2099-01-01",
      "schema_release_exam",
      "Schema release exam",
      "ok",
      now,
    ]
  );

  await conn.execute(
    `INSERT INTO driver_sales_journals
      (id,tenantId,driverId,journalDate,debriefMissionId,transcript,insightsJson,processingStatus)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      tenantId,
      openId,
      "2099-01-01",
      424242,
      "schema release exam",
      "{}",
      "processed",
    ]
  );

  const [rows] = await conn.execute(
    `SELECT
       (SELECT COUNT(*) FROM dayforge_saas_memberships WHERE tenantId = ?) AS memberships,
       (SELECT COUNT(*) FROM dayforge_saas_external_customers WHERE tenantId = ?) AS customers,
       (SELECT COUNT(*) FROM dayforge_saas_external_orders WHERE tenantId = ?) AS orders,
       (SELECT COUNT(*) FROM impact_signals WHERE tenantId = ?) AS signals,
       (SELECT COUNT(*) FROM driver_sales_journals WHERE tenantId = ?) AS journals`,
    [tenantId, tenantId, tenantId, tenantId, tenantId]
  );
  const row = rows[0];
  for (const key of ["memberships", "customers", "orders", "signals", "journals"]) {
    if (Number(row?.[key] ?? 0) !== 1) {
      throw new Error(`Synthetic SaaS persistence failed for ${key}`);
    }
  }
} finally {
  await conn.rollback();
}

const [rolledBack] = await conn.execute(
  "SELECT COUNT(*) AS count FROM dayforge_saas_tenants WHERE id = ?",
  [tenantId]
);
if (Number(rolledBack[0]?.count ?? 0) !== 0) {
  throw new Error("Schema release exam did not roll back its synthetic tenant");
}

await conn.end();
console.log("SaaS schema release exam passed.");