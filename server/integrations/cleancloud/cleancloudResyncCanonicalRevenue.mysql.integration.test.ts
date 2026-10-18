import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import { cleancloudBrowserSyncRouter } from "./browserSync/router";
import { grantGumballProofMembership, provisionGumballCustomerTruthSchema } from "./browserSync/gumballCustomerTruthDbProof";
import { importCleanCloudPaidOrders } from "./cleancloudPaidOrders";

/**
 * P0: a CleanCloud paid order must stay in canonical revenue when a later
 * import changes nothing about its money.
 *
 * A CleanCloud paid observation is admitted (an authority receipt) only when
 * the order's economics change, and the receipt names the import batch that
 * observed it: `cleancloud-import:<batch>:<order>`. A later import that
 * changes only non-economic fields (a customer id filled in, an address
 * cleaned up) or simply re-imports the same file moves the row to a new batch
 * and admits nothing, correctly. But the paid-order ledger then expects a
 * receipt naming the new batch, finds none, and drops a verified payment from
 * canonical revenue as `missing_or_invalid_receipt`.
 *
 * Real MySQL, the real browser-sync router and the real file import. Never
 * production.
 */
const databaseUrl = process.env.DATABASE_URL ?? "";
const skip = !databaseUrl || /railway\.app|rlwy\.net/i.test(databaseUrl);
const HEADER = "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total";
const csv = (row: { customerId: string; placed?: string; paymentDate?: string; total?: string }) =>
  `${HEADER}\n1,${row.placed ?? "08/20/2026"},Example,${row.customerId},2170 Century Park East,Yes,${row.paymentDate ?? "09/02/2026"},${row.total ?? "51.00"}`;

describe.skipIf(skip)("CleanCloud re-sync and canonical revenue (real MySQL)", () => {
  let connection: mysql.Connection;
  const tenants: string[] = [];

  beforeAll(async () => {
    connection = await mysql.createConnection(databaseUrl);
    await provisionGumballCustomerTruthSchema(connection);
  });
  afterAll(async () => {
    for (const tenantId of tenants)
      for (const table of [
        "cleancloud_paid_orders",
        "cleancloud_import_batches",
        "cleancloud_browser_sync_receipts",
        "cleancloud_browser_sync_attempts",
        "cleancloud_browser_sync_bindings",
        "goldline_world_events",
        "entity_locations",
        "authority_receipts",
      ])
        await connection.query(`DELETE FROM ${table} WHERE tenantId = ?`, [tenantId]).catch(() => undefined);
    await connection?.end();
  });

  async function tenant() {
    const tenantId = `p0_resync_${randomUUID().slice(0, 8)}`;
    tenants.push(tenantId);
    await grantGumballProofMembership(connection, tenantId, "sync-proof");
    return tenantId;
  }
  const ledgerOf = (tenantId: string) =>
    loadPaidOrderLedger({
      tenantId,
      startUtc: new Date("2026-08-01T00:00:00.000Z"),
      endExclusiveUtc: new Date("2026-09-10T00:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    });
  const receiptsFor = async (tenantId: string, orderId: string) =>
    Number(
      (
        await connection.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM authority_receipts WHERE tenantId = ? AND claimType = 'cleancloud_paid_observed' AND subjectId = ?",
          [tenantId, orderId]
        )
      )[0][0]!.n
    );
  const counted = (ledger: Awaited<ReturnType<typeof ledgerOf>>) => ledger.events.map(e => [e.eventKey, e.cents]);
  const unverified = (ledger: Awaited<ReturnType<typeof ledgerOf>>) => ledger.unverifiedPaymentAuthority.map(u => [u.eventKey, u.reason]);

  function browserSync(tenantId: string) {
    const caller = cleancloudBrowserSyncRouter.createCaller({
      tenantId,
      user: { id: 1, openId: "sync-proof", role: "admin", name: "P0 proof operator" },
      req: undefined,
      res: undefined,
      vendorSession: null,
    } as never);
    const account = { tenantId, actorId: "sync-proof", storeId: "123", storeLabel: "Example store" };
    return {
      async import(csvText: string) {
        const binding = await caller.pair(account);
        return caller.import({
          ...account,
          bindingId: binding.id,
          requestId: randomUUID(),
          from: "2026-08-15",
          to: "2026-09-03",
          exportUrl:
            "https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=15&m1=08&y1=2026&d2=03&m2=09&y2=2026&stores=[123]&group=",
          csv: csvText,
        });
      },
    };
  }

  it("browser sync: a customer id filled in by a later export keeps the paid order counted", async () => {
    const tenantId = await tenant();
    const sync = browserSync(tenantId);
    const first = await sync.import(csv({ customerId: "" }));
    expect(first).toMatchObject({ importCommitted: true, inserted: 1 });
    expect(counted(await ledgerOf(tenantId))).toEqual([["cleancloud:1", 5100]]);
    expect(await receiptsFor(tenantId, "1")).toBe(1);

    // CleanCloud later reports the same order with its customer id. Nothing about the money changed.
    const second = await sync.import(csv({ customerId: "7" }));
    expect(second).toMatchObject({ importCommitted: true, updated: 1 });
    // No new receipt is due: the economics did not change.
    expect(await receiptsFor(tenantId, "1")).toBe(1);

    const after = await ledgerOf(tenantId);
    expect(counted(after)).toEqual([["cleancloud:1", 5100]]);
    expect(unverified(after)).toEqual([]);
  });

  it("file import: importing the same file twice keeps the paid order counted", async () => {
    const tenantId = await tenant();
    // The file report carries times, as CleanCloud's file export does.
    const file = {
      csvText: csv({ customerId: "7", placed: "08/20/2026 09:00 AM", paymentDate: "09/02/2026 10:15 AM" }),
      sourceReportType: "orders_sales" as const,
      tenantId,
    };
    await importCleanCloudPaidOrders(file);
    expect(counted(await ledgerOf(tenantId))).toEqual([["cleancloud:1", 5100]]);
    await importCleanCloudPaidOrders(file);
    expect(await receiptsFor(tenantId, "1")).toBe(1);
    const after = await ledgerOf(tenantId);
    expect(counted(after)).toEqual([["cleancloud:1", 5100]]);
    expect(unverified(after)).toEqual([]);
  });

  it("an amount correction is receipted again and counted at its new amount", async () => {
    const tenantId = await tenant();
    const sync = browserSync(tenantId);
    await sync.import(csv({ customerId: "7" }));
    await sync.import(csv({ customerId: "7", total: "55.00" }));
    expect(await receiptsFor(tenantId, "1")).toBe(2);
    expect(counted(await ledgerOf(tenantId))).toEqual([["cleancloud:1", 5500]]);
  });

  it("a receipt is never applied to a payment it did not observe", async () => {
    const tenantId = await tenant();
    await browserSync(tenantId).import(csv({ customerId: "7" }));
    // A write that bypassed admission moves the payment time; no receipt observed this payment.
    await connection.query(
      "UPDATE cleancloud_paid_orders SET paymentDateUtc = DATE_ADD(paymentDateUtc, INTERVAL 1 DAY) WHERE tenantId = ? AND cleancloudOrderId = '1'",
      [tenantId]
    );
    const after = await ledgerOf(tenantId);
    expect(counted(after)).toEqual([]);
    expect(unverified(after)).toEqual([["cleancloud:1", "missing_or_invalid_receipt"]]);
  });
});
