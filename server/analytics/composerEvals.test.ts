/**
 * Golden eval tests — two tiers:
 *
 * TIER A (always runs): Deterministic fixture-based tests with known answers.
 *   tenant_a: $420 revenue / 8 orders
 *   tenant_b: $999 revenue / 2 orders
 *   Asserts structural invariants without hitting the real LLM.
 *
 * TIER B (gated, expensive): Real LLM structural evals.
 *   Only runs when RUN_COMPOSER_EVALS=1.
 *   Runs against demo data so results are deterministic-ish.
 *   Asserts structural properties (not exact text).
 */

import { describe, expect, it, vi } from "vitest";
import { runComposerTurn } from "./composerAgent";
import type { ComposerDeps } from "./composerAgent";
import type { RevenueSummary, OrderStats, OpenOrderStats, MetricComparison, DataCompleteness } from "./analyticsQueries";

// ── Fixture datasets ──────────────────────────────────────────────────────────

const tenantARevenue: RevenueSummary = {
  totalRevenue: 420.0,
  orderCount: 8,
  avgOrderValue: 52.5,
  series: [
    { bucket: "2025-06-22", revenue: 210.0, orderCount: 4 },
    { bucket: "2025-06-23", revenue: 210.0, orderCount: 4 },
  ],
};

const tenantBRevenue: RevenueSummary = {
  totalRevenue: 999.0,
  orderCount: 2,
  avgOrderValue: 499.5,
  series: [{ bucket: "2025-06-23", revenue: 999.0, orderCount: 2 }],
};

const openOrdersA: OpenOrderStats = {
  openTotal: 5,
  byStatus: { collected: 3, processing: 2 },
  awaitingPayment: 3,
};

const comparisonA: MetricComparison = {
  current: 420.0,
  previous: 350.0,
  absChange: 70.0,
  pctChange: 20.0,
  currentOrders: 8,
  previousOrders: 7,
  currentAov: 52.5,
  previousAov: 50.0,
  volumeEffect: 50.0,
  aovEffect: 20.0,
  driversByServiceType: [{ key: "wash_fold", cur: 6, prev: 5, delta: 1 }],
};

const completenessA: DataCompleteness = {
  connected: [{ source: "Stripe-paid orders", description: "Revenue and order volume" }],
  missing: [
    { source: "Payroll / labor", prevents: "cannot calculate labor margin" },
    { source: "Machine revenue (coin-op)", prevents: "cannot calculate full store revenue" },
    { source: "Cash drawer / POS", prevents: "cannot reconcile total daily sales" },
    { source: "Supply costs (detergent, bags, hangers)", prevents: "cannot calculate true gross profit" },
  ],
};

// ── Scripted LLM mock factory ────────────────────────────────────────────────

function makePlan(metricIds: string[], compareToPrevious = false, intent = "single") {
  return {
    id: "p",
    created: Date.now(),
    model: "t",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({
          metricIds,
          range: { start: "2025-06-22", end: "2025-06-29" },
          groupBy: "day",
          compareToPrevious,
          intent,
        }),
      },
      finish_reason: "stop",
    }],
  };
}

function makeAnswer(overrides: Record<string, unknown> = {}) {
  return {
    id: "a",
    created: Date.now(),
    model: "t",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({
          answer: "Test answer.",
          chartType: "bar",
          actionIds: [],
          headlineLabel: "Revenue",
          ...overrides,
        }),
      },
      finish_reason: "stop",
    }],
  };
}

function makeFixtureDeps(revenue: RevenueSummary, extras: {
  openOrders?: OpenOrderStats;
  comparison?: MetricComparison;
  completeness?: DataCompleteness;
} = {}): ComposerDeps {
  let call = 0;
  const responses = [makePlan(["revenue_paid_stripe"]), makeAnswer()];
  return {
    invokeLLM: vi.fn().mockImplementation(() => Promise.resolve(responses[call++] ?? makeAnswer())) as any,
    liveSource: {
      getRevenueSummary: vi.fn().mockResolvedValue(revenue),
      getOrderStats: vi.fn().mockResolvedValue({ totalOrders: 0, byStatus: {}, byServiceType: {}, totalWeightLbs: 0, avgOrderValue: 0 }),
      getOpenOrderStats: vi.fn().mockResolvedValue(extras.openOrders ?? { openTotal: 0, byStatus: {}, awaitingPayment: 0 }),
      getRepeatCustomerStats: vi.fn().mockResolvedValue({ totalCustomers: 0, repeatCustomers: 0, oneTimeCustomers: 0, repeatRate: 0 }),
      getMetricComparison: vi.fn().mockResolvedValue(extras.comparison ?? { current: 0, previous: 0, absChange: 0, pctChange: 0, currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0, volumeEffect: 0, aovEffect: 0, driversByServiceType: [] }),
      getDataCompleteness: vi.fn().mockResolvedValue(extras.completeness ?? { connected: [], missing: [] }),
    } as any,
    demoSource: {
      getRevenueSummary: vi.fn().mockResolvedValue(revenue),
      getOrderStats: vi.fn().mockResolvedValue({ totalOrders: 0, byStatus: {}, byServiceType: {}, totalWeightLbs: 0, avgOrderValue: 0 }),
      getOpenOrderStats: vi.fn().mockResolvedValue({ openTotal: 0, byStatus: {}, awaitingPayment: 0 }),
      getRepeatCustomerStats: vi.fn().mockResolvedValue({ totalCustomers: 0, repeatCustomers: 0, oneTimeCustomers: 0, repeatRate: 0 }),
      getMetricComparison: vi.fn().mockResolvedValue({ current: 0, previous: 0, absChange: 0, pctChange: 0, currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0, volumeEffect: 0, aovEffect: 0, driversByServiceType: [] }),
      getDataCompleteness: vi.fn().mockResolvedValue({ connected: [], missing: [] }),
    } as any,
  };
}

// ── TIER A: Fixture-based golden tests ───────────────────────────────────────

describe("Fixture golden tests — tenant_a ($420 / 8 orders)", () => {
  it("revenue question: headline value is $420.00", async () => {
    const deps = makeFixtureDeps(tenantARevenue);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "How much did I make last week?", history: [] }, deps);
    expect(result.headline?.value).toBe("$420.00");
  });

  it("meta.tenantId is tenant_a", async () => {
    const deps = makeFixtureDeps(tenantARevenue);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.meta.tenantId).toBe("tenant_a");
  });

  it("table is always present for revenue questions", async () => {
    const deps = makeFixtureDeps(tenantARevenue);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.table).not.toBeNull();
    expect(result.table?.rows.length).toBeGreaterThan(0);
  });

  it("meta receipt has includedSources and excludedSources", async () => {
    const deps = makeFixtureDeps(tenantARevenue);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.meta.includedSources.length).toBeGreaterThan(0);
    expect(result.meta.excludedSources.length).toBeGreaterThan(0);
  });

  it("meta has generatedAt timestamp", async () => {
    const deps = makeFixtureDeps(tenantARevenue);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("no unsupported profit claim in headline or table", async () => {
    const deps = makeFixtureDeps(tenantARevenue);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "What is my profit?", history: [] }, deps);
    // Headline shows revenue, not profit (we have no cost data)
    expect(result.headline?.label.toLowerCase()).not.toContain("profit");
    // Cash IS correctly listed as an excluded source for Stripe-paid revenue (honest disclosure)
    expect(result.meta.excludedSources.some((s) => s.toLowerCase().includes("cash"))).toBe(true);
    // Payroll is NOT in Stripe's excluded sources (it belongs in completeness scanner)
    expect(result.meta.excludedSources.some((s) => s.toLowerCase().includes("payroll"))).toBe(false);
  });
});

describe("Fixture golden tests — tenant_b ($999 / 2 orders)", () => {
  it("headline value is $999.00 for tenant_b", async () => {
    const deps = makeFixtureDeps(tenantBRevenue);
    const result = await runComposerTurn({ tenantId: "tenant_b", question: "Revenue?", history: [] }, deps);
    expect(result.headline?.value).toBe("$999.00");
  });

  it("meta.tenantId is tenant_b (not tenant_a)", async () => {
    const deps = makeFixtureDeps(tenantBRevenue);
    const result = await runComposerTurn({ tenantId: "tenant_b", question: "Revenue?", history: [] }, deps);
    expect(result.meta.tenantId).toBe("tenant_b");
    expect(result.meta.tenantId).not.toBe("tenant_a");
  });
});

describe("Fixture golden tests — open orders", () => {
  it("open orders headline shows openTotal", async () => {
    let call = 0;
    const responses = [
      makePlan(["open_orders", "awaiting_payment"]),
      makeAnswer({ headlineLabel: "Open orders" }),
    ];
    const deps: ComposerDeps = {
      invokeLLM: vi.fn().mockImplementation(() => Promise.resolve(responses[call++] ?? makeAnswer())) as any,
      liveSource: {
        getRevenueSummary: vi.fn().mockResolvedValue(tenantARevenue),
        getOrderStats: vi.fn().mockResolvedValue({ totalOrders: 0, byStatus: {}, byServiceType: {}, totalWeightLbs: 0, avgOrderValue: 0 }),
        getOpenOrderStats: vi.fn().mockResolvedValue(openOrdersA),
        getRepeatCustomerStats: vi.fn().mockResolvedValue({ totalCustomers: 0, repeatCustomers: 0, oneTimeCustomers: 0, repeatRate: 0 }),
        getMetricComparison: vi.fn().mockResolvedValue({ current: 0, previous: 0, absChange: 0, pctChange: 0, currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0, volumeEffect: 0, aovEffect: 0, driversByServiceType: [] }),
        getDataCompleteness: vi.fn().mockResolvedValue({ connected: [], missing: [] }),
      } as any,
      demoSource: {} as any,
    };

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "How many open orders?", history: [] }, deps);
    expect(result.headline?.value).toBe("5");
    expect(result.table).not.toBeNull();
  });
});

describe("Fixture golden tests — comparison + why", () => {
  it("comparison headline has delta when comparison data present", async () => {
    let call = 0;
    const responses = [
      makePlan(["revenue_paid_stripe"], true, "comparison"),
      makeAnswer({ headlineLabel: "Revenue vs last week" }),
    ];
    const deps: ComposerDeps = {
      invokeLLM: vi.fn().mockImplementation(() => Promise.resolve(responses[call++] ?? makeAnswer())) as any,
      liveSource: {
        getRevenueSummary: vi.fn().mockResolvedValue(tenantARevenue),
        getOrderStats: vi.fn().mockResolvedValue({ totalOrders: 0, byStatus: {}, byServiceType: {}, totalWeightLbs: 0, avgOrderValue: 0 }),
        getOpenOrderStats: vi.fn().mockResolvedValue({ openTotal: 0, byStatus: {}, awaitingPayment: 0 }),
        getRepeatCustomerStats: vi.fn().mockResolvedValue({ totalCustomers: 0, repeatCustomers: 0, oneTimeCustomers: 0, repeatRate: 0 }),
        getMetricComparison: vi.fn().mockResolvedValue(comparisonA),
        getDataCompleteness: vi.fn().mockResolvedValue({ connected: [], missing: [] }),
      } as any,
      demoSource: {} as any,
    };

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "How did this week compare to last?", history: [] }, deps);
    expect(result.headline?.delta).toBeDefined();
    expect(result.headline?.delta?.direction).toBe("up");
    expect(result.headline?.delta?.pct).toBe(20);
    expect(result.table?.columns).toContain("Change");
  });
});

describe("Fixture golden tests — completeness scanner", () => {
  it("completeness table includes connected and missing sources", async () => {
    let call = 0;
    const responses = [
      makePlan(["revenue_paid_stripe"], false, "completeness"),
      makeAnswer(),
    ];
    const deps: ComposerDeps = {
      invokeLLM: vi.fn().mockImplementation(() => Promise.resolve(responses[call++] ?? makeAnswer())) as any,
      liveSource: {
        getRevenueSummary: vi.fn().mockResolvedValue(tenantARevenue),
        getOrderStats: vi.fn().mockResolvedValue({ totalOrders: 0, byStatus: {}, byServiceType: {}, totalWeightLbs: 0, avgOrderValue: 0 }),
        getOpenOrderStats: vi.fn().mockResolvedValue({ openTotal: 0, byStatus: {}, awaitingPayment: 0 }),
        getRepeatCustomerStats: vi.fn().mockResolvedValue({ totalCustomers: 0, repeatCustomers: 0, oneTimeCustomers: 0, repeatRate: 0 }),
        getMetricComparison: vi.fn().mockResolvedValue({ current: 0, previous: 0, absChange: 0, pctChange: 0, currentOrders: 0, previousOrders: 0, currentAov: 0, previousAov: 0, volumeEffect: 0, aovEffect: 0, driversByServiceType: [] }),
        getDataCompleteness: vi.fn().mockResolvedValue(completenessA),
      } as any,
      demoSource: {} as any,
    };

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "What data do you have?", history: [] }, deps);
    expect(result.table).not.toBeNull();
    // Table should contain both connected and missing sources
    const allRows = result.table?.rows.flat().join(" ") ?? "";
    expect(allRows).toContain("Stripe-paid orders");
    expect(allRows).toContain("Payroll");
  });
});

// ── TIER B: Real LLM gated evals (RUN_COMPOSER_EVALS=1) ─────────────────────

const RUN_EVALS = process.env.RUN_COMPOSER_EVALS === "1";

describe.skipIf(!RUN_EVALS)("Gated LLM structural evals (demoMode)", () => {
  const evalTimeout = 30_000;

  const goldenQuestions: Array<{ q: string; assertFn: (result: Awaited<ReturnType<typeof runComposerTurn>>) => void }> = [
    {
      q: "How much did I make last 7 days?",
      assertFn: (r) => {
        expect(r.headline?.value).toMatch(/^\$/);
        expect(r.table).not.toBeNull();
        expect(r.meta.includedSources.length).toBeGreaterThan(0);
      },
    },
    {
      q: "How many orders are unpaid?",
      assertFn: (r) => {
        expect(r.table).not.toBeNull();
        expect(r.meta.tenantId).toBe("demo_tenant");
      },
    },
    {
      q: "Compare this week to last week",
      assertFn: (r) => {
        expect(r.headline?.delta).toBeDefined();
        expect(r.table?.columns).toContain("Change");
      },
    },
    {
      q: "What service made the most money this month?",
      assertFn: (r) => {
        expect(r.table).not.toBeNull();
        expect(r.meta.demoMode).toBe(true);
      },
    },
    {
      q: "Does this include cash payments?",
      assertFn: (r) => {
        // Should trigger completeness path
        expect(r.table).not.toBeNull();
        expect(r.meta.excludedSources.some((s) => s.toLowerCase().includes("cash"))).toBe(true);
      },
    },
    {
      q: "What changed since last week?",
      assertFn: (r) => {
        // Should have comparison or narrative explaining change
        expect(r.answer.length).toBeGreaterThan(20);
        expect(r.meta.generatedAt).toBeTruthy();
      },
    },
  ];

  for (const { q, assertFn } of goldenQuestions) {
    it(`"${q}" — structural invariants`, { timeout: evalTimeout }, async () => {
      const result = await runComposerTurn({ tenantId: "demo_tenant", question: q, history: [], demoMode: true });
      // Universal invariants
      expect(result.meta.tenantId).toBe("demo_tenant");
      expect(result.meta.demoMode).toBe(true);
      expect(result.meta.dateRange.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.meta.dateRange.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof result.answer).toBe("string");
      expect(result.answer.length).toBeGreaterThan(0);
      // No unsupported profit claim
      expect(result.headline?.label.toLowerCase()).not.toContain("profit");
      // Per-question
      assertFn(result);
    });
  }
});
