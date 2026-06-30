import { describe, expect, it, vi } from "vitest";
import { runComposerTurn } from "./composerAgent";
import type { ComposerDeps } from "./composerAgent";
import type { RevenueSummary, OrderStats } from "./analyticsQueries";

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

function makeDeps(overrides: Partial<ComposerDeps> = {}): ComposerDeps {
  const mockInvokeLLM = vi
    .fn()
    .mockResolvedValueOnce({
      // Pass 1: query plan
      id: "plan-1",
      created: Date.now(),
      model: "claude-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              tool: "getRevenueSummary",
              range: { start: "2025-06-22", end: "2025-06-29" },
              groupBy: "day",
              basis: "paidAt",
              reasoning: "Revenue question for last 7 days",
            }),
          },
          finish_reason: "stop",
        },
      ],
    })
    .mockResolvedValueOnce({
      // Pass 2: answer
      id: "answer-1",
      created: Date.now(),
      model: "claude-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: JSON.stringify({
              answer: "You made $420.00 from 8 orders over the last 7 days.",
              chart: {
                type: "bar",
                title: "Daily Revenue",
                xKey: "bucket",
                series: [{ key: "revenue", label: "Revenue ($)" }],
                data: mockRevenue.series,
              },
              table: {
                columns: ["Date", "Revenue", "Orders"],
                rows: mockRevenue.series.map((p) => [p.bucket, `$${p.revenue.toFixed(2)}`, p.orderCount]),
              },
            }),
          },
          finish_reason: "stop",
        },
      ],
    });

  return {
    invokeLLM: mockInvokeLLM as any,
    getRevenueSummary: vi.fn().mockResolvedValue(mockRevenue),
    getOrderStats: vi.fn().mockResolvedValue(mockStats),
    ...overrides,
  };
}

describe("runComposerTurn", () => {
  it("calls invokeLLM twice (plan + answer) and returns structured result", async () => {
    const deps = makeDeps();
    const result = await runComposerTurn(
      { tenantId: "tenant_a", question: "How much did I make last 7 days?", history: [] },
      deps
    );

    expect(deps.invokeLLM).toHaveBeenCalledTimes(2);
    expect(result.answer).toContain("$420.00");
    expect(result.chart?.type).toBe("bar");
    expect(result.table?.columns).toContain("Revenue");
  });

  it("passes tenantId from ctx — never from LLM output — to query functions", async () => {
    const deps = makeDeps();
    await runComposerTurn(
      { tenantId: "tenant_a", question: "Revenue this week?", history: [] },
      deps
    );

    // The query function must be called with the ctx tenantId, not whatever the LLM returned.
    const callArgs = (deps.getRevenueSummary as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toBe("tenant_a");
  });

  it("cross-tenant: separate tenantIds produce separate query calls", async () => {
    const depsA = makeDeps();
    const depsB = makeDeps();

    await runComposerTurn({ tenantId: "tenant_a", question: "Revenue?", history: [] }, depsA);
    await runComposerTurn({ tenantId: "tenant_b", question: "Revenue?", history: [] }, depsB);

    const callA = (depsA.getRevenueSummary as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const callB = (depsB.getRevenueSummary as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callA).toBe("tenant_a");
    expect(callB).toBe("tenant_b");
  });

  it("does not call getOrderStats when tool plan is getRevenueSummary", async () => {
    const deps = makeDeps();
    await runComposerTurn(
      { tenantId: "tenant_a", question: "How much revenue last week?", history: [] },
      deps
    );
    expect(deps.getOrderStats).not.toHaveBeenCalled();
  });
});
