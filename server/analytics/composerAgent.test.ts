import { describe, expect, it, vi } from "vitest";
import { runComposerTurn } from "./composerAgent";
import type { ComposerDeps } from "./composerAgent";
import type { RevenueSummary, OrderStats, OpenOrderStats, RepeatCustomerStats, MetricComparison, DataCompleteness } from "./analyticsQueries";

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

const mockComparison: MetricComparison = {
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
  getMetricComparison: vi.fn().mockResolvedValue(mockComparison),
  getDataCompleteness: vi.fn().mockResolvedValue(mockCompleteness),
};

const mockDemoSource = {
  getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue),
  getOrderStats: vi.fn().mockResolvedValue(mockStats),
  getOpenOrderStats: vi.fn().mockResolvedValue(mockOpenOrders),
  getRepeatCustomerStats: vi.fn().mockResolvedValue(mockRepeat),
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
