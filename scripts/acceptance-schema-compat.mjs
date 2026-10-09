/* LEGACY DAYFORGE COMPATIBILITY: existing historical DDL filenames only; canonical product is JOYSTICK. */
import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';

// Existing historical DDL only. This cannot run against a production database.
const databaseUrl = process.env.JOYSTICK_ACCEPTANCE_DATABASE_URL;
if (!databaseUrl) throw new Error('JOYSTICK_ACCEPTANCE_DATABASE_URL required');
const destination = new URL(databaseUrl);
if (!['localhost', '127.0.0.1'].includes(destination.hostname) ||
    destination.pathname !== '/joystick_real_acceptance') {
  throw new Error('Schema compatibility requires localhost /joystick_real_acceptance');
}
const db = await mysql.createConnection(databaseUrl);
try {
  const [[actual]] = await db.query('SELECT DATABASE() AS name');
  if (actual.name !== 'joystick_real_acceptance') throw new Error('Unexpected database');
  const fieldSource = await readFile(new URL('../drizzle/0038_commercial_mission_field.sql', import.meta.url), 'utf8');
  const fieldColumns = fieldSource.match(/ALTER TABLE `commercial_visit_outcomes`\s+([\s\S]*?);/)[1].split(/,\s*ADD COLUMN /).map((value, index) => index === 0 ? value.trim() : `ADD COLUMN ${value.trim()}`);
  for (const definition of fieldColumns) {
    const name = definition.match(/^ADD COLUMN `([^`]+)`/)[1];
    const [rows] = await db.execute('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', ['commercial_visit_outcomes', name]);
    if (!rows.length) await db.execute(`ALTER TABLE commercial_visit_outcomes ${definition}`);
  }
  for (const file of ['0027_operations_events.sql', '0036_territory_intelligence.sql', '0038_commercial_mission_field.sql', '0055_sales_intel_source_registry.sql', '0056_sales_intel_teachings.sql']) {
    const source = await readFile(new URL(`../drizzle/${file}`, import.meta.url), 'utf8');
    const statements = source.replace(/^\s*--.*$/gm, '').split(';').map(sql => sql.trim()).filter(Boolean);
    for (const original of statements) {
      if (/^CREATE\s+TABLE\s+/i.test(original)) {
        const sql = /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+/i.test(original)
          ? original : original.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
        await db.execute(sql);
      } else if (/^CREATE INDEX/.test(original)) {
        const match = original.match(/^CREATE INDEX `([^`]+)` ON `([^`]+)`/);
        if (!match) throw new Error(`Unexpected index DDL in ${file}`);
        const [indexes] = await db.execute('SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [match[2], match[1]]);
        if (!indexes.length) await db.execute(original);
      } else if (/ADD COLUMN `sourceRegistryId`/.test(original)) {
        const [columns] = await db.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_intel_source_artifacts' AND COLUMN_NAME = 'sourceRegistryId'");
        if (!columns.length) await db.execute(original);
      } else if (/ADD INDEX `idx_sales_intel_source_registry`/.test(original)) {
        const [indexes] = await db.execute("SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales_intel_source_artifacts' AND INDEX_NAME = 'idx_sales_intel_source_registry'");
        if (!indexes.length) await db.execute(original);
      } else if (file === '0038_commercial_mission_field.sql') {
        // Additive visit columns already applied above; no role mutation or data backfill.
        continue;
      } else {
        throw new Error(`Unexpected historical DDL in ${file}`);
      }
    }
    console.log(`Acceptance historical schema applied: ${file}`);
  }
} finally {
  await db.end();
}
