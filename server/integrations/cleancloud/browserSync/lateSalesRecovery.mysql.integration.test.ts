import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleancloudBrowserSyncRouter } from "./router";
import { runCleanCloudDirectSync } from "./cleancloudDirectSync";
import { loadPaidOrderLedger } from "../../../analytics/paidOrderLedger";
import { loadCustomerOrderTruth } from "../../../geography/customerOrderTruth";
import { loadBusinessSourceCoverage } from "../../../analytics/sourceCoverage";
import { resetSourceBindingCacheForTests } from "../../../analytics/sourceBindings";
import { grantGumballProofMembership } from "./gumballCustomerTruthDbProof";

// This suite writes only to an explicitly named, local disposable database.
// The production migration runner provisions its schema before the suite runs.
const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^\/cleancloud_late_sales_[a-z0-9_]*disposable$/.test(url.pathname)) {
    throw new Error("Late-sale proof requires a local cleancloud_late_sales_*disposable database.");
  }
}

const SALES = "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total";
const REVENUE = "Order ID,Placed,Customer,Customer ID,Address,Paid,Paid Date,Total";
const credentials = { username: "fixture@example.invalid", password: "fixture-only" };
const actorId = "late-sale-proof";
const beforeCutoff = "2026-09-03T01:30:00Z"; // Sep 2, 6:30 p.m. Pacific
const nextRun = "2026-09-04T02:05:00Z"; // Sep 3, 7:05 p.m. Pacific

describe.skipIf(!databaseUrl)("late CleanCloud sales and overlapping exports (real MySQL)", () => {
  let connection: mysql.Connection;
  let salesRows: string[];
  let revenueRows: string[];
  let failRevenue: boolean;
  let requested: URL[];

  beforeAll(async () => {
    connection = await mysql.createConnection(databaseUrl!);
  });
  afterAll(async () => { await connection?.end(); });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(beforeCutoff));
    salesRows = [];
    revenueRows = [];
    requested = [];
    failRevenue = false;
    // Only the external report transport is a fixture. Pairing, default range
    // selection, ingestion, receipts, customer truth and ledger reads are real.
    vi.stubGlobal("fetch", vi.fn(async (raw: string | URL | Request) => {
      const url = new URL(typeof raw === "string" ? raw : raw instanceof URL ? raw.href : raw.url);
      if (url.origin !== "https://cleancloudapp.com") throw new Error("Unexpected external request");
      if (url.pathname === "/include/process_login_new.php") {
        return new Response(JSON.stringify({ login: "1" }), {
          headers: { "Content-Type": "application/json", "Set-Cookie": "fixture_session=local; Secure" },
        });
      }
      if (url.pathname !== "/include/data-export-endpoint.php") throw new Error("Unexpected report endpoint");
      requested.push(url);
      // Model the source's date filtering: a today-only Revenue request must
      // NOT accidentally receive yesterday's late payment from the fixture.
      const boundary = (n: number) => ["y", "m", "d"].map(key => url.searchParams.get(`${key}${n}`)).join("-");
      const within = (rows: string[], column: number) => rows.filter(row => {
        const [month, day, year] = row.split(",")[column].split(" ")[0].split("/");
        const date = `${year}-${month}-${day}`;
        return date >= boundary(1) && date <= boundary(2);
      });
      if (url.searchParams.get("type") === "1") return new Response([SALES, ...within(salesRows, 1)].join("\n"));
      if (url.searchParams.get("type") !== "2") throw new Error("Unexpected report type");
      return failRevenue
        ? new Response("fixture outage", { status: 503 })
        : new Response([REVENUE, ...within(revenueRows, 6)].join("\n"));
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function pairedTenant() {
    const tenantId = `late_sale_${randomUUID().slice(0, 8)}`;
    await grantGumballProofMembership(connection, tenantId, actorId);
    const caller = cleancloudBrowserSyncRouter.createCaller({
      tenantId,
      user: { id: 1, openId: actorId, role: "admin", name: "Disposable operator" },
      req: undefined, res: undefined, vendorSession: null,
    } as never);
    await caller.pair({ tenantId, actorId, storeId: "123", storeLabel: "Disposable CleanCloud store" });
    return tenantId;
  }

  const sync = (tenantId: string, range?: { from: string; to: string }) => {
    // Exercise persisted checkpoints, including a server restart after a
    // partially committed run, rather than reusing a warm in-memory snapshot.
    resetSourceBindingCacheForTests();
    return runCleanCloudDirectSync({ tenantId, actorId, credentials, ...range });
  };
  const ledger = (tenantId: string) => loadPaidOrderLedger({
    tenantId,
    startUtc: new Date("2026-09-02T07:00:00Z"),
    endExclusiveUtc: new Date("2026-09-04T07:00:00Z"),
    timeZone: "America/Los_Angeles",
  });
  const money = async (tenantId: string) => {
    const read = await ledger(tenantId);
    expect(read.failedSources).toEqual([]);
    expect(read.unverifiedPaymentAuthority).toEqual([]);
    return read.events.map(e => ({ id: e.eventKey, cents: e.cents, day: e.businessDate }))
      .sort((a, b) => a.id.localeCompare(b.id));
  };
  const lateSale = (amount = "51.00", paid = true) =>
    `501,09/02/2026 07:30 PM,Late fixture,7,2170 Century Park East,${paid ? "Yes" : "No"},${paid ? "09/02/2026 07:30 PM" : ""},${amount}`;
  const oldOrderPaidLate = "502,08/20/2026 10:00 AM,Old order fixture,8,2170 Century Park East,Yes,09/02/2026 07:30 PM,23.00";

  async function emptyDailyCheckpoint(tenantId: string) {
    const first = await sync(tenantId, { from: "2026-09-02", to: "2026-09-02" });
    expect(first.salesReceipt).toMatchObject({ importCommitted: true, totalRows: 0, customerTruth: "refreshed" });
    expect(first.revenueReceipt).toMatchObject({ importCommitted: true, totalRows: 0 });
    expect(await money(tenantId)).toEqual([]);
    requested = [];
    vi.setSystemTime(new Date(nextRun));
  }

  it("recovers a 7:30 p.m. sale the next day after an empty 6:30 p.m. export, and counts repeat exports once", async () => {
    const tenantId = await pairedTenant();
    await emptyDailyCheckpoint(tenantId);
    salesRows = [lateSale()];
    revenueRows = [lateSale()];

    // No explicit dates: exercise the actual live runner's checkpoint overlap.
    const recovered = await sync(tenantId);
    expect(recovered.range).toEqual({ from: "2026-09-02", to: "2026-09-03" });
    expect(requested).toHaveLength(2);
    for (const url of requested) {
      expect(url.searchParams.get("d1")).toBe("02");
      expect(url.searchParams.get("d2")).toBe("03");
      expect(url.searchParams.get("stores")).toBe("[123]");
    }
    expect(await money(tenantId)).toEqual([{ id: "cleancloud:501", cents: 5100, day: "2026-09-02" }]);

    const repeat = await sync(tenantId);
    expect(repeat.salesReceipt).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(repeat.revenueReceipt).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(await money(tenantId)).toEqual([{ id: "cleancloud:501", cents: 5100, day: "2026-09-02" }]);
    const history = (await loadCustomerOrderTruth(tenantId)).filter(r => r.source === "cleancloud");
    expect(history.map(r => [r.sourceOrderId, r.paid, r.totalCents])).toEqual([["501", true, 5100]]);
  });

  it("recovers payment for an older order through Revenue even when the order is absent from the Sales window", async () => {
    const tenantId = await pairedTenant();
    await emptyDailyCheckpoint(tenantId);
    revenueRows = [oldOrderPaidLate];
    const result = await sync(tenantId);
    expect(result.salesReceipt).toMatchObject({ totalRows: 0 });
    expect(result.revenueReceipt).toMatchObject({ inserted: 1 });
    expect(await money(tenantId)).toEqual([{ id: "cleancloud:502", cents: 2300, day: "2026-09-02" }]);
  });

  it("keeps explicit today-only dates exact; an operator must select overlap to recover yesterday's sale", async () => {
    const tenantId = await pairedTenant();
    await emptyDailyCheckpoint(tenantId);
    salesRows = [lateSale()]; revenueRows = [lateSale()];
    const todayOnly = await sync(tenantId, { from: "2026-09-03", to: "2026-09-03" });
    expect(todayOnly.range).toEqual({ from: "2026-09-03", to: "2026-09-03" });
    expect(todayOnly.salesReceipt).toMatchObject({ totalRows: 0 });
    expect(todayOnly.revenueReceipt).toMatchObject({ totalRows: 0 });
    expect(await money(tenantId)).toEqual([]);
    await sync(tenantId, { from: "2026-09-02", to: "2026-09-03" });
    expect(await money(tenantId)).toEqual([{ id: "cleancloud:501", cents: 5100, day: "2026-09-02" }]);
  });

  it("updates an unpaid order to paid, then reconciles a corrected amount without adding another sale", async () => {
    const tenantId = await pairedTenant();
    salesRows = [lateSale("51.00", false).replace("07:30 PM", "05:00 PM")];
    await sync(tenantId, { from: "2026-09-02", to: "2026-09-02" });
    expect(await money(tenantId)).toEqual([]);
    vi.setSystemTime(new Date(nextRun));
    salesRows = [lateSale()];
    revenueRows = [lateSale()];
    const paid = await sync(tenantId);
    expect(paid.salesReceipt).toMatchObject({ updated: 1 });
    expect(await money(tenantId)).toEqual([{ id: "cleancloud:501", cents: 5100, day: "2026-09-02" }]);
    salesRows = [lateSale("55.00")];
    revenueRows = [lateSale("55.00")];
    await sync(tenantId, paid.range);
    expect(await money(tenantId)).toEqual([{ id: "cleancloud:501", cents: 5500, day: "2026-09-02" }]);
  });

  it("retains committed Sales after Revenue fails and safely recovers the missing pass", async () => {
    const tenantId = await pairedTenant();
    await emptyDailyCheckpoint(tenantId);
    // Several missed days: a yesterday-only floor alone would still lose the
    // Sep 2 Revenue payment after Sales advances to Sep 5.
    vi.setSystemTime(new Date("2026-09-06T02:05:00Z"));
    salesRows = [lateSale()];
    revenueRows = [lateSale(), oldOrderPaidLate];
    failRevenue = true;
    await expect(sync(tenantId)).rejects.toThrow("503");
    expect(await money(tenantId)).toEqual([{ id: "cleancloud:501", cents: 5100, day: "2026-09-02" }]);
    const coverage = await loadBusinessSourceCoverage({ tenantId });
    expect(coverage.book.paymentEventsProven).toBe(false);
    failRevenue = false;
    const recovered = await sync(tenantId);
    expect(recovered.range).toEqual({ from: "2026-09-02", to: "2026-09-05" });
    expect(recovered.salesReceipt).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(await money(tenantId)).toEqual([
      { id: "cleancloud:501", cents: 5100, day: "2026-09-02" },
      { id: "cleancloud:502", cents: 2300, day: "2026-09-02" },
    ]);
  });

  it("keeps identical source order IDs in different tenants independent", async () => {
    const first = await pairedTenant();
    const second = await pairedTenant();
    salesRows = [lateSale()]; revenueRows = [lateSale()];
    await sync(first, { from: "2026-09-02", to: "2026-09-02" });
    expect(await money(second)).toEqual([]);
    salesRows = [lateSale("73.00")]; revenueRows = [lateSale("73.00")];
    await sync(second, { from: "2026-09-02", to: "2026-09-02" });
    expect(await money(first)).toEqual([{ id: "cleancloud:501", cents: 5100, day: "2026-09-02" }]);
    expect(await money(second)).toEqual([{ id: "cleancloud:501", cents: 7300, day: "2026-09-02" }]);
  });
});
