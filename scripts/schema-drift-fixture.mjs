/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import mysql from "mysql2/promise";

if (process.env.SCHEMA_DRIFT_FIXTURE_OK !== "1") {
  throw new Error("SCHEMA_DRIFT_FIXTURE_OK=1 is required");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const conn = await mysql.createConnection(databaseUrl);
const [[databaseRow]] = await conn.query("SELECT DATABASE() AS name");
const databaseName = String(databaseRow?.name ?? "");
if (!databaseName.includes("schema_release")) {
  throw new Error(
    `Refusing drift fixture outside disposable schema-release database: ${databaseName}`
  );
}

const [indexRows] = await conn.execute(
  `SELECT COUNT(*) AS count FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'driver_sales_journals'
      AND INDEX_NAME = 'idx_driver_sales_journal_tenant_mission'`
);
if (Number(indexRows[0]?.count ?? 0) > 0) {
  await conn.execute(
    "ALTER TABLE driver_sales_journals DROP INDEX idx_driver_sales_journal_tenant_mission"
  );
}

const [columnRows] = await conn.execute(
  `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'driver_sales_journals'
      AND COLUMN_NAME = 'debriefMissionId'`
);
if (Number(columnRows[0]?.count ?? 0) > 0) {
  await conn.execute(
    "ALTER TABLE driver_sales_journals DROP COLUMN debriefMissionId"
  );
}
await conn.execute("DROP TABLE IF EXISTS impact_signals");
await conn.execute("DROP TABLE IF EXISTS tracked_signal_definitions");
await conn.execute("DROP TABLE IF EXISTS dayforge_saas_entitlements");

const [tenantColumnRows] = await conn.execute(
  `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'cleancloud_import_batches'
      AND COLUMN_NAME = 'tenantId'`
);
if (Number(tenantColumnRows[0]?.count ?? 0) > 0) {
  await conn.execute(
    "ALTER TABLE cleancloud_import_batches DROP COLUMN tenantId"
  );
}

await conn.end();
console.log("Disposable production-drift fixture applied.");