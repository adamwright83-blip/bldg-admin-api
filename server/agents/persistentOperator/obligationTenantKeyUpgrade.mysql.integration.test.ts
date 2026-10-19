import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Upgrading a database that already holds obligations under the old key
 * (`id` alone) to the tenant-scoped key, through the real production boot
 * migration. Every row survives byte for byte, the second boot changes
 * nothing, and afterwards another tenant can hold the same id.
 * Uses a disposable database of its own; never production.
 */
const databaseUrl = process.env.DATABASE_URL ?? "";
const describeMysql = databaseUrl && !/railway\.app|rlwy\.net/i.test(databaseUrl) ? describe : describe.skip;
const run = promisify(execFile);
const ROOT = resolve(__dirname, "../../..");

describeMysql("claire_proactive_obligations upgrade to the tenant-scoped key (real MySQL)", () => {
  const scratch = `obligation_upgrade_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const scratchUrl = (() => {
    const url = new URL(databaseUrl);
    url.pathname = `/${scratch}`;
    return url.toString();
  })();
  let admin: mysql.Connection;
  let db: mysql.Connection;

  beforeAll(async () => {
    admin = await mysql.createConnection(databaseUrl);
    const [[current]] = await admin.query<mysql.RowDataPacket[]>("SELECT DATABASE() AS name");
    await admin.query(`CREATE DATABASE \`${scratch}\``);
    // The table as production holds it before the upgrade: every column, keyed by id alone.
    await admin.query(`CREATE TABLE \`${scratch}\`.claire_proactive_obligations LIKE \`${current!.name}\`.claire_proactive_obligations`);
    await admin.query(`ALTER TABLE \`${scratch}\`.claire_proactive_obligations DROP PRIMARY KEY, ADD PRIMARY KEY (id)`);
    db = await mysql.createConnection(scratchUrl);
  });
  afterAll(async () => {
    await db?.end();
    await admin?.query(`DROP DATABASE IF EXISTS \`${scratch}\``);
    await admin?.end();
  });

  const primaryKey = async () =>
    (
      await db.query<mysql.RowDataPacket[]>(
        "SELECT COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'claire_proactive_obligations' AND INDEX_NAME = 'PRIMARY' ORDER BY SEQ_IN_INDEX"
      )
    )[0].map(r => r.COLUMN_NAME);
  const snapshot = async () =>
    JSON.stringify((await db.query<mysql.RowDataPacket[]>("SELECT * FROM claire_proactive_obligations ORDER BY tenantId, id"))[0]);
  const boot = () =>
    run(process.execPath, ["scripts/migrate.mjs"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: scratchUrl }, maxBuffer: 64 * 1024 * 1024 });

  it("keeps every existing row and reference, is idempotent, and then isolates tenants", async () => {
    const payload = (id: string, title: string) => JSON.stringify({ id, kind: "dormant_recovery", subjectKey: id, subjectName: title, status: "scheduled", dueDate: "2026-10-01", title, why: "x", draft: null, historyIntact: true, moveCount: 0 });
    // Legacy rows, including lineage columns other tables refer to by (tenant, id).
    await db.query(
      `INSERT INTO claire_proactive_obligations
        (id, tenantId, operatorUserId, canonicalOperatorId, kind, subjectKey, payloadJson, status, dueDate, goalRunId, cycleId, decisionId, executionType, commercialFollowUpRef, objectiveRef, createdAt, updatedAt)
       VALUES
        ('recovery:phone:3105550199', 'default', 'adam', 'op:default:adam', 'dormant_recovery', 'phone:3105550199', ?, 'scheduled', '2026-10-01', 'run-1', 'cycle-1', 'decision-1', 'challenge', NULL, 'objective-1', '2026-09-01 10:00:00', '2026-09-02 11:00:00'),
        ('sales:6:2026-08-07', 'default', 'adam', NULL, 'sales_follow_up', 'account:6', ?, 'scheduled', '2026-08-07', NULL, NULL, NULL, NULL, 'follow-up:6', NULL, '2026-08-01 09:00:00', '2026-08-01 09:00:00'),
        ('recovery:phone:2135550142', 'tenant-two', 'owner-two', NULL, 'dormant_recovery', 'phone:2135550142', ?, 'draft_prepared', '2026-10-03', NULL, NULL, NULL, NULL, NULL, NULL, '2026-09-05 08:00:00', '2026-09-05 08:00:00')`,
      [payload("recovery:phone:3105550199", "Win back Ines"), payload("sales:6:2026-08-07", "Follow up: OPUS"), payload("recovery:phone:2135550142", "Win back Cruz")]
    );
    const before = await snapshot();
    expect(await primaryKey()).toEqual(["id"]);

    const first = await boot();
    expect(first.stdout).toContain("✓ claire_proactive_obligations primary key (tenantId, id)");
    expect(await primaryKey()).toEqual(["tenantId", "id"]);
    expect(await snapshot()).toBe(before);

    const second = await boot();
    expect(second.stdout).toContain("→ already exists, skipping: claire_proactive_obligations primary key (tenantId, id)");
    expect(await primaryKey()).toEqual(["tenantId", "id"]);
    expect(await snapshot()).toBe(before);

    // After the upgrade, a second business can hold the same id without touching the first.
    await db.query(
      "INSERT INTO claire_proactive_obligations (id, tenantId, operatorUserId, kind, subjectKey, payloadJson, status, dueDate) VALUES ('recovery:phone:3105550199', 'tenant-three', 'owner-three', 'dormant_recovery', 'phone:3105550199', ?, 'scheduled', '2026-10-04')",
      [payload("recovery:phone:3105550199", "Win back tenant three's customer")]
    );
    const [same] = await db.query<mysql.RowDataPacket[]>(
      "SELECT tenantId, JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.title')) AS title FROM claire_proactive_obligations WHERE id = 'recovery:phone:3105550199' ORDER BY tenantId"
    );
    expect(same.map(r => [r.tenantId, r.title])).toEqual([
      ["default", "Win back Ines"],
      ["tenant-three", "Win back tenant three's customer"],
    ]);
  }, 180_000);
});
