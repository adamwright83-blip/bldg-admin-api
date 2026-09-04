/** Explicit local-only integration proof. Never uses an inherited DATABASE_URL. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";

async function main() {
  if (!process.argv.includes("--run-local-db"))
    throw new Error(
      "Pass --run-local-db to create a disposable local MySQL test database."
    );
  const password = execFileSync(
    "docker",
    ["exec", "goldline-mysql", "printenv", "MYSQL_ROOT_PASSWORD"],
    { encoding: "utf8" }
  ).trim();
  const database = `goldline_browser_sync_test_${Date.now()}`;
  const connection = await mysql.createConnection({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password,
    multipleStatements: true,
  });
  await connection.query(`CREATE DATABASE \`${database}\``);
  process.env.DATABASE_URL = `mysql://root:${encodeURIComponent(password)}@127.0.0.1:3306/${database}`;
  process.env.DAYFORGE_LEGACY_TENANT_IDS = "default,other";
  try {
    await connection.query(`USE \`${database}\``);
    for (const table of [
      "cleancloud_paid_orders",
      "cleancloud_import_batches",
      "dayforge_saas_memberships",
    ]) {
      await connection.query(
        `CREATE TABLE \`${table}\` LIKE goldline_daylight.\`${table}\``
      );
    }
    await connection.query(
      readFileSync(new URL("./schema.sql", import.meta.url), "utf8")
    );
    const { cleancloudBrowserSyncRouter } = await import("./router");
    const { compileAuthoritativeEvents } = await import(
      "../towerWars/towerWarsService"
    );
    const { compileTowerWarsState } = await import("../../shared/towerWars");
    const ctx = (tenantId = "default", openId = "sync-proof") =>
      ({
        tenantId,
        user: { id: 1, openId, role: "admin", name: "Local test operator" },
        req: undefined,
        res: undefined,
        vendorSession: null,
      }) as any;
    const caller = cleancloudBrowserSyncRouter.createCaller(ctx());
    const account = {
      tenantId: "default",
      actorId: "sync-proof",
      storeId: "123",
      storeLabel: "Example store",
    };
    const binding = await caller.pair(account);
    const input = {
      ...account,
      bindingId: binding.id,
      requestId: randomUUID(),
      from: "2026-08-15",
      to: "2026-09-03",
      exportUrl:
        "https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=15&m1=08&y1=2026&d2=03&m2=09&y2=2026&stores=[123]&group=",
      csv: "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total\n1,08/20/2026,Example,7,2170 Century Park East,Yes,09/02/2026,51.00",
    };
    const first: any = await caller.import(input);
    assert.equal(first.inserted, 1);
    const retry: any = await caller.import(input);
    assert.deepEqual(retry, first);
    const repeat: any = await caller.import({
      ...input,
      requestId: randomUUID(),
    });
    assert.equal(repeat.inserted, 0);
    assert.equal(repeat.updated, 0);
    assert.equal(repeat.unchanged, 1);
    const [counts]: any = await connection.query(
      "SELECT COUNT(*) n,SUM(totalCents) cents FROM cleancloud_paid_orders"
    );
    assert.equal(counts[0].n, 1);
    assert.equal(Number(counts[0].cents), 5100);
    await assert.rejects(() =>
      caller.import({ ...input, csv: input.csv.replace("51.00", "52.00") })
    );
    await assert.rejects(() => caller.import({ ...input, tenantId: "other" }));
    await assert.rejects(() =>
      caller.import({ ...input, actorId: "different" })
    );
    await assert.rejects(() => caller.pair({ ...account, storeId: "999" }));
    const other = cleancloudBrowserSyncRouter.createCaller(ctx("other"));
    assert.equal(
      (
        await other.receipt({
          tenantId: "other",
          actorId: "sync-proof",
          requestId: input.requestId,
        })
      ).receipt,
      null
    );
    await assert.rejects(() =>
      caller.import({
        ...input,
        requestId: randomUUID(),
        csv: input.csv + "\n2,08/20/2026,Other,8,Unknown,Yes,,10.00",
      })
    );
    const [afterBad]: any = await connection.query(
      "SELECT COUNT(*) n FROM cleancloud_paid_orders"
    );
    assert.equal(afterBad[0].n, 1);
    const cancelledId = randomUUID();
    const cancelled: any = await caller.resolve({
      tenantId: "default",
      actorId: "sync-proof",
      requestId: cancelledId,
    });
    assert.equal(cancelled.receipt.status, "cancelled");
    await assert.rejects(() =>
      caller.import({ ...input, requestId: cancelledId })
    );
    const recovered: any = await caller.resolve({
      tenantId: "default",
      actorId: "sync-proof",
      requestId: input.requestId,
    });
    assert.deepEqual(recovered.receipt, first);
    await connection.query(
      "CREATE TRIGGER fail_test_order BEFORE INSERT ON cleancloud_paid_orders FOR EACH ROW BEGIN IF NEW.cleancloudOrderId = '2' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test rollback'; END IF; END"
    );
    await assert.rejects(() =>
      caller.import({
        ...input,
        requestId: randomUUID(),
        csv:
          input.csv.replace("51.00", "52.00") +
          "\n2,08/20/2026,Second,8,3545 Wilshire Blvd,Yes,09/02/2026,10.00",
      })
    );
    const [rolledBack]: any = await connection.query(
      "SELECT totalCents FROM cleancloud_paid_orders"
    );
    assert.equal(rolledBack[0].totalCents, 5100);
    await connection.query("DROP TRIGGER fail_test_order");
    const concurrent: any[] = await Promise.all([
      caller.import({ ...input, requestId: randomUUID() }),
      caller.import({ ...input, requestId: randomUUID() }),
    ]);
    assert.ok(concurrent.every(r => r.inserted === 0 && r.unchanged === 1));
    const [rows]: any = await connection.query(
      "SELECT * FROM cleancloud_paid_orders"
    );
    const compiled = compileAuthoritativeEvents({
      tenantId: "default",
      businessDate: "2026-09-02",
      candidates: rows.map((row: any) => ({
        sourceKey: `cleancloud:${row.cleancloudOrderId}`,
        occurredAt: row.paymentDateUtc,
        orderId: row.cleancloudOrderId,
        address: row.address,
        buildingSlug: row.buildingSlug,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        customerIdentity: null,
        cents: row.totalCents,
        source: "cleancloud",
        authoritative: true,
        exclusionReason: null,
        sourceEvidence: {
          economicEventKey: `cleancloud:${row.cleancloudOrderId}`,
        },
      })),
    });
    const state = compileTowerWarsState(compiled.events);
    assert.equal(state.buildings.century_park_east.revenueCents, 5100);
    assert.equal(state.attacks[0].weapon, "century_valet_bazooka");
    console.log(
      "PASS: local DB atomic import + forced mid-transaction rollback; same-request retry; repeated/concurrent reports no duplicates; conflicting retry rejected; actor/tenant/store isolation; cancellation tombstone blocks delayed imports; receipt recovers committed import; invalid-batch no writes; Tower Wars compiler consumes imported row and earns one bazooka attack."
    );
  } finally {
    await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
  process.exit(0);
}
void main().catch(error => {
  console.error(error);
  process.exit(1);
});
