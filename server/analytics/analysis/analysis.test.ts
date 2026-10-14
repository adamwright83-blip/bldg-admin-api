import { describe, expect, it, vi } from "vitest";
import {
  buildApprovedDataset,
  APPROVED_VIEWS,
  type ApprovedDataset,
} from "./approvedViews";
import { executeAnalysisQuery, assertDatasetBounded } from "./sandbox";
import { validateAnalysisSql } from "./sqlPolicy";
import { analyzeBusinessData } from "./analyzeBusinessData";
import { investigateForPreparation } from "./proactiveInvestigation";
import { loadPaidOrderLedger } from "../paidOrderLedger";
import {
  fixtureLoaders,
  FIXTURE_NOW,
  FIXTURE_TZ,
  provenBusinessCoverageSnapshot,
} from "../businessLedgerFixture";

export function tinyDataset(tenantId = "tenant-a"): ApprovedDataset {
  const tables = Object.fromEntries(APPROVED_VIEWS.map(v => [v.name, []]));
  tables.orders = [
    [
      "o1",
      "cust_a",
      "2026-09-01",
      "2026-09",
      "Tue",
      1000,
      null,
      null,
      "wash_fold",
      "laundry_farm",
      "cleancloud",
      "cleancloud_paid_record",
      "90026",
      "Silver Lake;Echo Park",
      "Laundry",
    ],
    [
      "o2",
      "cust_a",
      "2026-09-08",
      "2026-09",
      "Tue",
      2000,
      null,
      null,
      "wash_fold",
      "laundry_farm",
      "cleancloud",
      "cleancloud_paid_record",
      "90026",
      "Silver Lake;Echo Park",
      "Laundry",
    ],
    [
      "o3",
      "cust_a",
      "2026-09-15",
      "2026-09",
      "Tue",
      3000,
      null,
      null,
      "wash_fold",
      "laundry_farm",
      "cleancloud",
      "cleancloud_paid_record",
      "90026",
      "Silver Lake;Echo Park",
      "Laundry",
    ],
  ] as any;
  tables.customers = [
    [
      "cust_a",
      "Test Customer",
      1,
      "2026-09-01",
      "2026-09-15",
      3,
      6000,
      1,
      "Silver Lake;Echo Park",
    ],
  ] as any;
  return {
    tenantId,
    generatedAt: "2026-10-14T19:00:00Z",
    window: {
      start: "2023-10-15",
      end: "2026-10-14",
      timeZone: "America/Los_Angeles",
    },
    completeness: "partial",
    tables,
    customerRefs: {
      cust_a: {
        displayName: "Test Customer",
        identityKeys: ["cleancloud:test"],
      },
    },
    limitations: [
      "Native open orders only; CleanCloud open orders are unknown",
      "ZIP-based approximate geography",
      "Costs unavailable; profit cannot be calculated",
      "Source coverage partial; missing is not zero",
    ],
  };
}
const envelope = (data: unknown) =>
  ({ choices: [{ message: { content: JSON.stringify(data) } }] }) as any;
const request = (extra: Record<string, unknown>) => ({
  kind: "query",
  sql: "SELECT COUNT(*) AS n FROM orders",
  answer: "",
  receiptIds: [],
  customerIds: [],
  facts: [],
  ...extra,
});

describe("approved materialization", () => {
  it("loads authenticated tenant, reconciles canonical sources and strips contact/address", async () => {
    const ledger = vi.fn(async input =>
      loadPaidOrderLedger(input, fixtureLoaders())
    );
    const openOrders = vi.fn(async () => []);
    const dataset = await buildApprovedDataset({
      tenantId: "tenant-a",
      now: FIXTURE_NOW,
      timeZone: FIXTURE_TZ,
      loaders: {
        ledger,
        openOrders,
        coverage: async () => provenBusinessCoverageSnapshot(),
      },
    });
    expect(ledger.mock.calls[0]![0].tenantId).toBe("tenant-a");
    expect(openOrders).toHaveBeenCalledWith("tenant-a", 20000);
    expect(
      dataset.tables.orders!.reduce((n, r) => n + Number(r[5]), 0)
    ).toBeGreaterThan(0);
    expect(
      dataset.tables.excluded_sales!.some(r => r[0] === "unverified_payment")
    ).toBe(true);
    const serialized = JSON.stringify(dataset.tables);
    expect(serialized).not.toMatch(/@example|phone:|email:|bldg-user:/);
    expect(dataset.limitations.join(" ")).toMatch(/ZIP|costs|Costs/);
    assertDatasetBounded(dataset);
  });
  it("counts overlapping Goldline, CleanCloud and Stripe payment evidence once", async () => {
    const event = (source: "laundry_butler" | "cleancloud", key: string, cents: number, phone: string) => ({ source, eventKey: key, cents, occurredAt: new Date("2026-09-01T19:00:00Z"), businessDate: "2026-09-01", serviceType: null, customerName: "Fixture", identity: { phone }, authorityReceiptId: `receipt:${key}` });
    const ledger: any = { startUtc: new Date("2023-01-01Z"), endExclusiveUtc: FIXTURE_NOW, timeZone: FIXTURE_TZ, events: [event("laundry_butler", "native:1", 1000, "3105550001"), event("cleancloud", "cc:copy", 1000, "3105550001"), event("cleancloud", "cc:other", 3000, "3105550002")], unverifiedNative: [], provenDuplicateExclusions: [{ keptEventKey: "cc:other", excludedEventKey: "cc:twin", cents: 3000, reason: "cleancloud_sales_and_revenue_report" }], loadedSources: ["laundry_butler", "cleancloud"], failedSources: [], completeness: "complete" };
    const data = await buildApprovedDataset({ tenantId: "tenant-a", now: FIXTURE_NOW, timeZone: FIXTURE_TZ, loaders: { ledger: async () => ledger, openOrders: async () => [], coverage: async () => null } });
    const result = await executeAnalysisQuery({ tenantId: "tenant-a", dataset: data, sql: "SELECT SUM(amount_cents) AS recorded_cents FROM orders" });
    expect(result.rows).toEqual([[4000]]);
    expect(data.tables.excluded_sales!.some(r => r[0] === "suspected_duplicate_withheld" && r[2] === 1000)).toBe(true);
    expect(data.tables.excluded_sales!.some(r => r[0] === "proven_duplicate" && r[2] === 3000)).toBe(true);
  });
  it("failed open-order read is unknown and unknown coverage cannot become complete", async () => {
    const dataset = await buildApprovedDataset({
      tenantId: "tenant-a",
      now: FIXTURE_NOW,
      timeZone: FIXTURE_TZ,
      loaders: {
        ledger: async input => loadPaidOrderLedger(input, fixtureLoaders()),
        openOrders: async () => {
          throw new Error("offline");
        },
        coverage: async () => null,
      },
    });
    expect(dataset.completeness).toBe("partial");
    expect(
      dataset.tables.coverage!.find(r => r[0] === "open_orders")![1]
    ).toMatch(/unknown, not zero/);
  });
  it("rejects missing tenant before readers run", async () => {
    const ledger = vi.fn();
    await expect(
      buildApprovedDataset({
        tenantId: "",
        now: FIXTURE_NOW,
        timeZone: FIXTURE_TZ,
        loaders: { ledger },
      })
    ).rejects.toThrow(/tenant/);
    expect(ledger).not.toHaveBeenCalled();
  });
});

describe("SQL structural policy", () => {
  it.each([
    "DELETE FROM orders",
    "SELECT * FROM orders; DROP TABLE customers",
    "ATTACH 'x' AS db",
    "PRAGMA table_info(orders)",
    "SELECT * FROM sqlite_master",
    "SELECT * FROM tenant_b.orders",
    "SELECT * FROM users",
    "SELECT email FROM customers",
    "SELECT load_extension('x')",
    "SELECT randomblob(999999999)",
    "SELECT readfile('/etc/passwd')",
    "SELECT * FROM orders CROSS JOIN customers",
    "SELECT * FROM orders, customers",
    "WITH RECURSIVE x AS (SELECT 1 UNION ALL SELECT 1 FROM x) SELECT * FROM x",
    "WITH x AS (SELECT * FROM x) SELECT * FROM x",
    "SELECT * FROM pragma_table_info('orders')",
  ])("rejects %s", sql => expect(() => validateAnalysisSql(sql)).toThrow());
  it("allows window intervals, safe CTEs and aggregation, preserving literals as data", () => {
    const sql =
      "WITH gaps AS (SELECT customer_id, julianday(business_date)-julianday(lag(business_date) OVER (PARTITION BY customer_id ORDER BY business_date)) AS gap FROM orders) SELECT customer_id, AVG(gap) AS weekly_interval FROM gaps GROUP BY customer_id";
    expect(validateAnalysisSql(sql).views).toEqual(["orders"]);
    expect(
      validateAnalysisSql("SELECT 'DROP TABLE customers' AS note FROM coverage")
        .sql
    ).toContain("'DROP TABLE customers'");
  });
});

describe("real WASM sandbox", () => {
  it("executes unfamiliar interval calculations in a bounded worker", async () => {
    const result = await executeAnalysisQuery({
      tenantId: "tenant-a",
      dataset: tinyDataset(),
      sql: "WITH gaps AS (SELECT julianday(business_date)-julianday(lag(business_date) OVER (PARTITION BY customer_id ORDER BY business_date)) AS gap FROM orders) SELECT AVG(gap) AS mean_interval, SUM(gap*gap)/COUNT(gap)-AVG(gap)*AVG(gap) AS variance FROM gaps",
    });
    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([[7, 0]]);
    expect(result.receipt).toMatchObject({
      tenantId: "tenant-a",
      status: "ok",
      rowCount: 1,
      views: ["orders"],
    });
  });
  it("terminates an expensive allowed query at the hard worker deadline", async () => {
    const data = tinyDataset();
    data.tables.orders = Array.from({ length: 18000 }, () => [
      ...data.tables.orders![0]!,
    ]);
    const result = await executeAnalysisQuery({
      tenantId: "tenant-a",
      dataset: data,
      sql: "SELECT COUNT(*) AS n FROM orders a JOIN orders b ON 1=1 JOIN orders c ON 1=1",
    });
    expect(result.receipt.status).toBe("timeout");
    expect(result.rows).toEqual([]);
    const after = await executeAnalysisQuery({
      tenantId: "tenant-a",
      dataset: tinyDataset(),
      sql: "SELECT COUNT(*) AS n FROM orders",
    });
    expect(after.receipt.status).toBe("ok");
  }, 10000);
  it("blocks tenant mismatch, restricted fields, extra tables and oversized data", async () => {
    await expect(
      executeAnalysisQuery({
        tenantId: "tenant-b",
        dataset: tinyDataset(),
        sql: "SELECT * FROM orders",
      })
    ).rejects.toThrow(/Tenant/);
    await expect(
      executeAnalysisQuery({
        tenantId: "tenant-a",
        dataset: tinyDataset(),
        sql: "SELECT email FROM customers",
      })
    ).rejects.toThrow(/Field/);
    const data = tinyDataset();
    data.tables.secret = [];
    expect(() => assertDatasetBounded(data)).toThrow(/Unapproved/);
    delete data.tables.secret;
    data.tables.coverage = Array.from({ length: 50001 }, () => ["x", "y"]);
    expect(() => assertDatasetBounded(data)).toThrow(/row limit/);
  });
  it("bounds results, returns safe query failures, and cleans up cancellation", async () => {
    const data = tinyDataset();
    data.tables.coverage = Array.from({ length: 102 }, (_, i) => [
      "fact",
      String(i),
    ]);
    const result = await executeAnalysisQuery({
      tenantId: "tenant-a",
      dataset: data,
      sql: "SELECT * FROM coverage",
    });
    expect(result.rows).toHaveLength(100);
    expect(result.receipt.truncated).toBe(true);
    const bad = await executeAnalysisQuery({
      tenantId: "tenant-a",
      dataset: data,
      sql: "SELECT made_up FROM (SELECT 1 AS made_up)",
    });
    expect(bad.rows).toEqual([[1]]);
    const controller = new AbortController();
    const pending = executeAnalysisQuery({
      tenantId: "tenant-a",
      dataset: data,
      sql: "SELECT * FROM orders",
      signal: controller.signal,
    });
    controller.abort();
    expect((await pending).receipt.status).toBe("cancelled");
  });
});

describe("bounded investigation (mocked model; real sandbox)", () => {
  it("renders executed cells and identities even when the model invents final figures and references", async () => {
    let receiptId = "";
    const invoke = vi.fn(async input => {
      if (invoke.mock.calls.length === 1)
        return envelope(
          request({
            sql: "SELECT customer_id, name, lifetime_cents FROM customers",
          })
        );
      const msg = JSON.parse(String(input.messages.at(-1)!.content));
      receiptId = msg.receipt.id;
      return envelope(
        request({
          kind: "final",
          sql: "",
          answer: "Invented Customer made $999 profit.",
          receiptIds: ["invented"],
          customerIds: ["invented"],
          facts: [
            { receiptId, row: 0, column: "name", format: "text" },
            { receiptId, row: 0, column: "lifetime_cents", format: "dollars" },
          ],
        })
      );
    });
    const result = await analyzeBusinessData(
      {
        tenantId: "tenant-a",
        question: "Which weekly customers stopped?",
        now: FIXTURE_NOW,
        timeZone: FIXTURE_TZ,
      },
      { invoke: invoke as any, build: async () => tinyDataset() }
    );
    expect(result.kind).toBe("evidence");
    expect(result.answer).toBe(
      "The recorded evidence shows: Test Customer, lifetime cents: $60.00."
    );
    expect(result.citedReceiptIds).toEqual([receiptId]);
    expect(result.session?.customerIds).toEqual(["cust_a"]);
    expect(result.session?.customers).toEqual([
      { displayName: "Test Customer", identityKeys: ["cleancloud:test"] },
    ]);
    expect(result.limitations.join(" ")).toContain("CleanCloud");
  });
  it("rejects invented receipts and raw financial figures", async () => {
    const result = await analyzeBusinessData(
      {
        tenantId: "tenant-a",
        question: "Who stopped?",
        now: FIXTURE_NOW,
        timeZone: FIXTURE_TZ,
      },
      {
        invoke: async () =>
          envelope(
            request({
              kind: "final",
              sql: "",
              answer: "Profit was $999",
              receiptIds: ["invented"],
            })
          ),
      }
    );
    expect(result.kind).toBe("execution_error");
  });
  it("caps model calls and rejected query refinements", async () => {
    const invoke = vi.fn(async () =>
      envelope(request({ sql: "DELETE FROM orders" }))
    );
    const execute = vi.fn(async () => {
      throw new Error("forbidden");
    });
    const result = await analyzeBusinessData(
      {
        tenantId: "tenant-a",
        question: "Unknown analysis",
        now: FIXTURE_NOW,
        timeZone: FIXTURE_TZ,
      },
      { invoke, build: async () => tinyDataset(), execute }
    );
    expect(result.kind).toBe("execution_error");
    expect(invoke).toHaveBeenCalledTimes(6);
    expect(execute).toHaveBeenCalledTimes(5);
  });
  it("the hard investigation budget cancels a slow materialization without starting SQL", async () => {
    let finish!: (value: ApprovedDataset) => void;
    const build = vi.fn(() => new Promise<ApprovedDataset>(resolve => { finish=resolve; }));
    const invoke = vi.fn(async () => envelope(request({ sql: "SELECT COUNT(*) AS n FROM orders" })));
    const execute = vi.fn();
    const result = await analyzeBusinessData({ tenantId: "tenant-a", question: "Compute intervals", now: FIXTURE_NOW, timeZone: FIXTURE_TZ, budgetMs: 30 }, { invoke, build, execute });
    expect(result.kind).toBe("execution_error"); expect(execute).not.toHaveBeenCalled();
    expect(build.mock.calls[0]![0].signal.aborted).toBe(true);
    finish(tinyDataset());
  });
  it("proactive preparation passes objective through the same evidence-only tool and degrades gracefully", async () => {
    const analyze = vi.fn(async () => ({ kind: "execution_error" }) as any);
    expect(
      await investigateForPreparation(
        {
          tenantId: "tenant-a",
          objective: "Grow repeat purchases",
          now: FIXTURE_NOW,
          timeZone: FIXTURE_TZ,
        },
        analyze
      )
    ).toBeNull();
    expect(analyze.mock.calls[0]![0]).toMatchObject({
      proactive: true,
      tenantId: "tenant-a",
      budgetMs: 25000,
    });
  });
});
