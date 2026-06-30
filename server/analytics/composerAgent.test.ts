import { describe, expect, it, vi } from "vitest";
import { runComposerTurn, normalizeRange } from "./composerAgent";
import type { ComposerDeps } from "./composerAgent";
import { buildQueryMeta } from "./metricRegistry";
import type { RevenueSummary, OrderStats, OpenOrderStats, RepeatCustomerStats, CustomerRevenueStats, MetricComparison, DataCompleteness } from "./analyticsQueries";

// ── Fixture data with KNOWN values (used in golden tests) ────────────────────

const mockRevenue: RevenueSummary = {
  totalRevenue: 420.0,
  orderCount: 8,
  avgOrderValue: 52.5,
  series: [
    { bucket: "2025-06-22", revenue: 135.0, orderCount: 3 },
    { bucket: "2025-06-23", revenue: 285.0, orderCount: 5 },
  ],
};

const mockStats: OrderStats = {
  totalOrders: 8,
  byStatus: { delivered: 6, processing: 2 },
  byServiceType: { wash_fold: 6, dry_cleaning: 2 },
  totalWeightLbs: 42.5,
  avgOrderValue: 52.5,
};

const mockOpenOrders: OpenOrderStats = {
  openTotal: 4,
  byStatus: { collected: 2, processing: 2 },
  awaitingPayment: 3,
};

const mockRepeat: RepeatCustomerStats = {
  totalCustomers: 20,
  repeatCustomers: 7,
  oneTimeCustomers: 13,
  repeatRate: 0.35,
};

const mockCustomerRevenue: CustomerRevenueStats = {
  customers: [
    { customerName: "Karen Bernstein", phone: "(323) 555-0184", revenue: 684.5, orderCount: 9, avgOrderValue: 76.06 },
    { customerName: "John Olajuwon", phone: "(323) 555-0137", revenue: 612.25, orderCount: 8, avgOrderValue: 76.53 },
  ],
};

const mockComparison: MetricComparison = {
  unit: "currency",
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

const mockCompleteness: DataCompleteness = {
  connected: [{ source: "Stripe-paid orders", description: "Revenue and order volume" }],
  missing: [{ source: "Payroll / labor", prevents: "cannot calculate labor margin" }],
};

// ── Mock invokeLLM helper ────────────────────────────────────────────────────

function makePlannerResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "plan-1",
    created: Date.now(),
    model: "claude-test",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({
          metricIds: ["revenue_paid_stripe"],
          range: { start: "2025-06-22", end: "2025-06-29" },
          groupBy: "day",
          compareToPrevious: false,
          intent: "single",
          ...overrides,
        }),
      },
      finish_reason: "stop",
    }],
  };
}

function makeAnswererResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "answer-1",
    created: Date.now(),
    model: "claude-test",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: JSON.stringify({
          answer: "You made $420.00 from 8 orders over the last 7 days.",
          chartType: "bar",
          actionIds: [],
          headlineLabel: "Revenue last 7 days",
          ...overrides,
        }),
      },
      finish_reason: "stop",
    }],
  };
}

// Shared live source mock (returns zeros — isolating the LLM path)
const mockLiveSource = {
  getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue),
  getOrderStats: vi.fn().mockResolvedValue(mockStats),
  getOpenOrderStats: vi.fn().mockResolvedValue(mockOpenOrders),
  getRepeatCustomerStats: vi.fn().mockResolvedValue(mockRepeat),
  getTopCustomersByRevenue: vi.fn().mockResolvedValue(mockCustomerRevenue),
  getMetricComparison: vi.fn().mockResolvedValue(mockComparison),
  getDataCompleteness: vi.fn().mockResolvedValue(mockCompleteness),
};

const mockDemoSource = {
  getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue),
  getOrderStats: vi.fn().mockResolvedValue(mockStats),
  getOpenOrderStats: vi.fn().mockResolvedValue(mockOpenOrders),
  getRepeatCustomerStats: vi.fn().mockResolvedValue(mockRepeat),
  getTopCustomersByRevenue: vi.fn().mockResolvedValue(mockCustomerRevenue),
  getMetricComparison: vi.fn().mockResolvedValue(mockComparison),
  getDataCompleteness: vi.fn().mockResolvedValue(mockCompleteness),
};

function makeDeps(llmResponses: unknown[] = [], sourceOverrides: Partial<typeof mockLiveSource> = {}): ComposerDeps {
  let callIndex = 0;
  const mockInvokeLLM = vi.fn().mockImplementation(() => {
    const res = llmResponses[callIndex] ?? makeAnswererResponse();
    callIndex++;
    return Promise.resolve(res);
  });

  return {
    invokeLLM: mockInvokeLLM as any,
    liveSource: { ...mockLiveSource, ...sourceOverrides } as any,
    demoSource: { ...mockDemoSource } as any,
  };
}

// ── Step 1: History bug fix ───────────────────────────────────────────────────

describe("history bug fix", () => {
  it("with assistant history, invokeLLM receives only system and user roles", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const history = [
      { role: "user" as const, content: "Revenue last week?" },
      { role: "assistant" as const, content: "You made $350 last week." },
    ];

    await runComposerTurn({ tenantId: "tenant_a", question: "What about this week?", history }, deps);

    for (const call of (deps.invokeLLM as ReturnType<typeof vi.fn>).mock.calls) {
      const messages: Array<{ role: string }> = call[0].messages;
      for (const msg of messages) {
        expect(["system", "user"]).toContain(msg.role);
      }
    }
  });

  it("invokeLLM is called twice per turn (plan + answer)", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(deps.invokeLLM).toHaveBeenCalledTimes(2);
  });

  it("empty history does not inject a transcript block", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);

    const planCall = (deps.invokeLLM as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMessages: Array<{ role: string; content: string }> = planCall.messages.filter(
      (m: { role: string }) => m.role === "user"
    );
    const hasTranscript = userMessages.some((m) => m.content.startsWith("Previous conversation:"));
    expect(hasTranscript).toBe(false);
  });
});

// ── tenantId invariant ────────────────────────────────────────────────────────

describe("tenantId invariant", () => {
  it("query fn receives tenantId from ctx, never from LLM output", async () => {
    const liveSpy = { ...mockLiveSource, getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue) };
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()], liveSpy);
    await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);

    const callArg = (liveSpy.getRevenueSummary as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArg).toBe("tenant_a");
  });

  it("cross-tenant: two tenantIds produce separate query calls", async () => {
    const spyA = { ...mockLiveSource, getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue) };
    const spyB = { ...mockLiveSource, getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue) };

    const depsA = makeDeps([makePlannerResponse(), makeAnswererResponse()], spyA);
    const depsB = makeDeps([makePlannerResponse(), makeAnswererResponse()], spyB);

    await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, depsA);
    await runComposerTurn({ tenantId: "tenant_b", question: "Revenue?", history: [] }, depsB);

    expect((spyA.getRevenueSummary as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("tenant_a");
    expect((spyB.getRevenueSummary as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("tenant_b");
  });
});

// ── Backend-built answer fields ───────────────────────────────────────────────

describe("backend-built answer", () => {
  it("meta.tenantId is always the ctx tenantId", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.meta.tenantId).toBe("tenant_a");
  });

  it("meta.demoMode is false when demoMode not set", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.meta.demoMode).toBe(false);
  });

  it("meta has dateRange with valid ISO dates", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.meta.dateRange.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.meta.dateRange.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("meta.includedSources and excludedSources are non-empty arrays", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.meta.includedSources.length).toBeGreaterThan(0);
    expect(result.meta.excludedSources.length).toBeGreaterThan(0);
  });

  it("chart data comes from backend (revenue series), not LLM", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    // Chart data should match the mock revenue series buckets
    expect(result.chart?.data[0]?.bucket).toBe("2025-06-22");
    expect(result.chart?.data[0]?.revenue).toBe(135.0);
  });

  it("table rows come from backend, not LLM", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.table).not.toBeNull();
    expect(result.table?.columns).toContain("Revenue");
  });

  it("headline value is backend-formatted currency", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);
    expect(result.headline?.value).toBe("$420.00");
  });
});

// ── Demo mode isolation ───────────────────────────────────────────────────────

describe("demo mode", () => {
  it("demoMode=true calls demoSource and NOT liveSource", async () => {
    const liveSpy = { ...mockLiveSource, getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue) };
    const demoSpy = { ...mockDemoSource, getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue) };

    let callIndex = 0;
    const responses = [makePlannerResponse(), makeAnswererResponse()];
    const deps: ComposerDeps = {
      invokeLLM: vi.fn().mockImplementation(() => Promise.resolve(responses[callIndex++])) as any,
      liveSource: liveSpy as any,
      demoSource: demoSpy as any,
    };

    await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [], demoMode: true }, deps);

    expect(demoSpy.getRevenueSummary).toHaveBeenCalled();
    expect(liveSpy.getRevenueSummary).not.toHaveBeenCalled();
  });

  it("demoMode=true sets meta.demoMode to true", async () => {
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse()]);
    // Override demoSource with same data
    deps.demoSource.getRevenueSummary = vi.fn().mockResolvedValue(mockRevenue) as any;

    const result = await runComposerTurn(
      { tenantId: "tenant_a", question: "Revenue?", history: [], demoMode: true },
      deps
    );
    expect(result.meta.demoMode).toBe(true);
  });
});

describe("customer revenue ranking", () => {
  it("answers top grossing customer questions with a customer name and ranking table", async () => {
    const deps = makeDeps([
      makePlannerResponse({ metricIds: ["top_customer_revenue"] }),
      makeAnswererResponse({
        answer: "The data does not include a customer-level breakdown.",
        headlineLabel: "Top grossing customer",
      }),
    ]);

    const result = await runComposerTurn({
      tenantId: "tenant_a",
      question: "Who is my top grossing customer?",
      history: [],
      demoMode: true,
    }, deps);

    expect(result.answer).toContain("Karen Bernstein");
    expect(result.answer).toContain("$684.50");
    expect(result.headline?.value).toBe("Karen Bernstein");
    expect(result.table?.columns).toEqual(["Customer", "Revenue", "Orders", "Avg order"]);
    expect(result.table?.rows[0]).toEqual(["Karen Bernstein", "$684.50", 9, "$76.06"]);
    expect(result.chart?.title).toBe("Top customers by paid revenue");
    expect(result.meta.source).toBe("Top customers by paid revenue");
  });
});

// ── Unknown metricIds fallback ────────────────────────────────────────────────

describe("metric ID validation", () => {
  it("falls back to revenue_paid_stripe when LLM returns unknown metric IDs", async () => {
    const planWithBadIds = makePlannerResponse({ metricIds: ["nonexistent_metric", "another_fake"] });
    const liveSpy = { ...mockLiveSource, getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue) };
    const deps = makeDeps([planWithBadIds, makeAnswererResponse()], liveSpy);

    await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, deps);

    // Should call getRevenueSummary (the fallback) rather than throwing
    expect(liveSpy.getRevenueSummary).toHaveBeenCalled();
  });
});

// ── Patch 1: Multi-basis receipt (buildQueryMeta) ────────────────────────────

describe("Patch 1: multi-basis receipt", () => {
  it("single paidAt metric: basis is 'paidAt'", () => {
    const meta = buildQueryMeta(["revenue_paid_stripe"], "tenant_a", false);
    expect(meta.basis).toBe("paidAt");
  });

  it("single createdAt metric: basis is 'createdAt'", () => {
    const meta = buildQueryMeta(["orders_created"], "tenant_a", false);
    expect(meta.basis).toBe("createdAt");
  });

  it("mixed paidAt + createdAt metrics: basis contains both", () => {
    const meta = buildQueryMeta(["revenue_paid_stripe", "service_mix"], "tenant_a", false);
    expect(meta.basis).toContain("paidAt");
    expect(meta.basis).toContain("createdAt");
    expect(meta.basis).toContain("+");
  });

  it("includes snapshot basis label for open_orders", () => {
    const meta = buildQueryMeta(["revenue_paid_stripe", "service_mix", "open_orders"], "tenant_a", false);
    expect(meta.basis).toContain("current open-order snapshot");
  });

  it("board-summary metrics produce a composite basis with all three types", () => {
    const boardMetrics = ["revenue_paid_stripe", "orders_paid", "avg_order_value", "open_orders", "awaiting_payment", "service_mix"];
    const meta = buildQueryMeta(boardMetrics, "tenant_a", false);
    expect(meta.basis).toContain("paidAt");
    expect(meta.basis).toContain("createdAt");
    expect(meta.basis).toContain("current open-order snapshot");
  });
});

// ── Patch 3: Chart-type backend clamp ────────────────────────────────────────

describe("Patch 3: chart-type clamp", () => {
  it("LLM returning 'pie' for a metric that only allows bar/line is clamped to 'bar'", async () => {
    // orders_created only allows ["bar", "line"]
    const planWithOrders = makePlannerResponse({ metricIds: ["orders_created"] });
    const deps = makeDeps([planWithOrders, makeAnswererResponse({ chartType: "pie" })]);

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Order count?", history: [] }, deps);

    // Chart type must be bar (first allowed) NOT pie (LLM suggestion)
    if (result.chart) {
      expect(result.chart.type).not.toBe("pie");
      expect(["bar", "line"]).toContain(result.chart.type);
    }
  });

  it("LLM returning a valid chartType within allowedChartTypes is preserved", async () => {
    // revenue_paid_stripe allows ["bar", "line", "area"]
    const deps = makeDeps([makePlannerResponse(), makeAnswererResponse({ chartType: "line" })]);
    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue trend?", history: [] }, deps);
    // "line" is in allowedChartTypes for revenue, so should pass through
    if (result.chart) {
      expect(result.chart.type).toBe("line");
    }
  });
});

// ── Patch 7: Strict date round-trip validation ───────────────────────────────

describe("Patch 7: impossible date rejection", () => {
  it("rejects 2026-02-31 (impossible date) and falls back to last 7 days", () => {
    const result = normalizeRange({ start: "2026-02-31", end: "2026-03-10" });
    // 2026-02-31 is impossible; start should NOT be "2026-02-31"
    expect(result.start).not.toBe("2026-02-31");
  });

  it("rejects 2026-04-31 (April has no 31st)", () => {
    const result = normalizeRange({ start: "2026-04-31", end: "2026-05-15" });
    expect(result.start).not.toBe("2026-04-31");
  });

  it("accepts valid dates like 2026-02-28", () => {
    const result = normalizeRange({ start: "2026-02-01", end: "2026-02-28" });
    expect(result.start).toBe("2026-02-01");
    expect(result.end).toBe("2026-02-28");
  });
});

// ── Comparison chart priority + unit-aware labels ─────────────────────────

describe("comparison chart correctness", () => {
  function makeComparisonPlan(metricIds: string[]) {
    return makePlannerResponse({ metricIds, compareToPrevious: true, intent: "comparison" });
  }

  function makeComparisonWithUnit(unit: "currency" | "count" | "weight_lbs", current = 420, previous = 350) {
    return {
      unit,
      current,
      previous,
      absChange: current - previous,
      pctChange: Math.round(((current - previous) / previous) * 10000) / 100,
      currentOrders: unit === "currency" ? 8 : 0,
      previousOrders: unit === "currency" ? 7 : 0,
      currentAov: unit === "currency" ? 52.5 : 0,
      previousAov: unit === "currency" ? 50 : 0,
      volumeEffect: unit === "currency" ? 50 : 0,
      aovEffect: unit === "currency" ? 20 : 0,
      driversByServiceType: [],
    };
  }

  it("revenue comparison renders current-vs-previous chart, not revenue time series", async () => {
    const compResult = makeComparisonWithUnit("currency");
    const compSpy = { ...mockLiveSource, getMetricComparison: vi.fn().mockResolvedValue(compResult) };
    const deps = makeDeps([makeComparisonPlan(["revenue_paid_stripe"]), makeAnswererResponse({ chartType: "bar" })], compSpy);

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Compare this week to last week?", history: [] }, deps);

    // Chart must be comparison (period-based), not revenue time series (bucket-based)
    expect(result.chart).not.toBeNull();
    expect(result.chart?.xKey).toBe("period");
    expect(result.chart?.data[0]).toHaveProperty("value");
    expect(result.chart?.data[0]).not.toHaveProperty("bucket");
    expect(result.chart?.data[0]).not.toHaveProperty("revenue");
  });

  it("revenue comparison chart uses label 'Revenue ($)' (currency unit)", async () => {
    const compResult = makeComparisonWithUnit("currency");
    const compSpy = { ...mockLiveSource, getMetricComparison: vi.fn().mockResolvedValue(compResult) };
    const deps = makeDeps([makeComparisonPlan(["revenue_paid_stripe"]), makeAnswererResponse({ chartType: "bar" })], compSpy);

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Revenue comparison?", history: [] }, deps);
    expect(result.chart?.series[0]?.label).toBe("Revenue ($)");
  });

  it("orders_created comparison chart uses label 'Count', not 'Revenue ($)'", async () => {
    const compResult = makeComparisonWithUnit("count", 87, 82);
    const compSpy = { ...mockLiveSource, getMetricComparison: vi.fn().mockResolvedValue(compResult) };
    const deps = makeDeps([makeComparisonPlan(["orders_created"]), makeAnswererResponse({ chartType: "bar" })], compSpy);

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Order count this week vs last?", history: [] }, deps);
    expect(result.chart?.series[0]?.label).toBe("Count");
    expect(result.chart?.series[0]?.label).not.toBe("Revenue ($)");
  });

  it("orders_paid comparison chart uses label 'Count'", async () => {
    const compResult = makeComparisonWithUnit("count", 83, 79);
    const compSpy = { ...mockLiveSource, getMetricComparison: vi.fn().mockResolvedValue(compResult) };
    const deps = makeDeps([makeComparisonPlan(["orders_paid"]), makeAnswererResponse({ chartType: "bar" })], compSpy);

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Paid orders this vs last week?", history: [] }, deps);
    expect(result.chart?.series[0]?.label).toBe("Count");
  });

  it("wash_fold_weight comparison chart uses label 'Lbs'", async () => {
    const compResult = makeComparisonWithUnit("weight_lbs", 1214, 1150);
    const compSpy = { ...mockLiveSource, getMetricComparison: vi.fn().mockResolvedValue(compResult) };
    const deps = makeDeps([makeComparisonPlan(["wash_fold_weight"]), makeAnswererResponse({ chartType: "bar" })], compSpy);

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Weight this week vs last?", history: [] }, deps);
    expect(result.chart?.series[0]?.label).toBe("Lbs");
  });

  it("comparison data uses neutral key 'value', not 'revenue'", async () => {
    const compResult = makeComparisonWithUnit("count", 87, 82);
    const compSpy = { ...mockLiveSource, getMetricComparison: vi.fn().mockResolvedValue(compResult) };
    const deps = makeDeps([makeComparisonPlan(["orders_created"]), makeAnswererResponse({ chartType: "bar" })], compSpy);

    const result = await runComposerTurn({ tenantId: "tenant_a", question: "Orders comparison?", history: [] }, deps);
    // data rows use key "value", not "revenue"
    expect(result.chart?.data[0]).toHaveProperty("value");
    expect(result.chart?.data[0]).not.toHaveProperty("revenue");
    expect(result.chart?.series[0]?.key).toBe("value");
  });
});
