import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./revenueIntervention", () => ({
  getActedOnTodayCents: vi.fn(),
  getAwaitingPaymentCents: vi.fn(),
  upsertAwaitingPaymentAdjustmentCents: vi.fn(),
  getCollectedTodayCents: vi.fn(),
  getLevel1ApexCommand: vi.fn(),
  getLevel2TacticalCluster: vi.fn(),
  getRevenueInterventionOrderDebug: vi.fn(),
  sendPaymentReminderForOrder: vi.fn(),
  getRecoveryPipelineState: vi.fn(async () => ({
    bounds: {
      ymd: "2026-04-07",
      timeZone: "America/Los_Angeles",
      startUtc: new Date("2026-04-07T07:00:00.000Z"),
      endUtc: new Date("2026-04-08T07:00:00.000Z"),
    },
    candidateCount: 2,
    isRecoveryEmpty: false,
    apexCandidate: {
      issueLabel: "ready_unpaid_24h",
      score: 12345,
      dollarValueCents: 5400,
      order: {
        id: 101,
        firstName: "A",
        lastName: "B",
        phone: "555",
        status: "ready",
        total: "54.00",
        paid: false,
        paidAt: null,
        updatedAt: new Date("2026-04-06T00:00:00.000Z"),
        buildingSlug: "century-park-east",
        manualRiskFlag: false,
      },
    },
    tacticalCluster: [
      {
        issueLabel: "delivered_unpaid_24h",
        score: 8000,
        dollarValueCents: 2200,
        order: {
          id: 202,
          firstName: "C",
          lastName: "D",
          phone: "777",
          status: "delivered",
          total: "22.00",
          paid: false,
          paidAt: null,
          updatedAt: new Date("2026-04-05T00:00:00.000Z"),
          buildingSlug: "opus-la",
          manualRiskFlag: false,
        },
      },
    ],
    aggregateMutationType: null,
  })),
}));

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TrpcContext["user"],
    vendorSession: null,
    tenantId: "default",
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("admin.getRecoveryPipelineState", () => {
  it("returns required shape and core invariants", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.admin.getRecoveryPipelineState();

    expect(typeof result.candidateCount).toBe("number");
    expect(typeof result.isRecoveryEmpty).toBe("boolean");
    expect(typeof result.businessYmd).toBe("string");
    expect(Array.isArray(result.tacticalCluster)).toBe(true);
    expect(result).toHaveProperty("apexCandidate");

    expect(result.isRecoveryEmpty).toBe(result.candidateCount === 0);

    if (result.candidateCount === 0) {
      expect(result.apexCandidate).toBeNull();
      expect(result.tacticalCluster).toHaveLength(0);
    } else if (result.apexCandidate) {
      expect(
        result.tacticalCluster.some((item) => item.order.id === result.apexCandidate!.order.id)
      ).toBe(false);
    }
  });
});
