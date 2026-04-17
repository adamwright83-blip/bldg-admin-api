/**
 * One-shot: apply drizzle/0013_admin_action_log_entity_building.sql to the configured DB.
 * Expands admin_action_log.entityType ENUM to include 'building'.
 * Idempotent — re-running on an already-expanded enum is a no-op.
 * Run: pnpm node scripts/apply-migration-0013.mjs   (DATABASE_URL must be set)
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL env var required");
  process.exit(1);
}

const conn = await mysql.createConnection(DB_URL);
try {
  console.log("Connected. Inspecting current admin_action_log.entityType definition...");
  const [before] = await conn.execute(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'admin_action_log'
       AND COLUMN_NAME = 'entityType'`
  );
  console.log("  before:", before[0]?.COLUMN_TYPE ?? "(missing)");

  console.log("Applying ALTER TABLE...");
  await conn.execute(
    `ALTER TABLE \`admin_action_log\`
       MODIFY COLUMN \`entityType\` ENUM('order','customer','building') NOT NULL`
  );
  console.log("  ✓ ALTER applied.");

  const [after] = await conn.execute(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'admin_action_log'
       AND COLUMN_NAME = 'entityType'`
  );
  console.log("  after: ", after[0]?.COLUMN_TYPE ?? "(missing)");
} finally {
  await conn.end();
}
