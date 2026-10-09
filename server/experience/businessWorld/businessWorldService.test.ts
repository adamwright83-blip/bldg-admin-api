import { withFixturePaymentAuthority } from "../../analytics/businessLedgerFixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveBusinessStage, getBusinessWorld } from "./businessWorldService";

describe("business stage", () => {
  it("derives team state from real active non-owner membership", () => {
    expect(deriveBusinessStage({ activeNonOwnerMembers: 1 })).toBe("TEAM");
    expect(deriveBusinessStage({ activeNonOwnerMembers: 0 })).toBe("SOLO");
  });
  it("does not allow motivational state to unlock a hire", () => {
    expect(
      deriveBusinessStage({ activeNonOwnerMembers: 0, sustainableSolo: true })
    ).toBe("SUSTAINABLE_SOLO");
    expect(
      deriveBusinessStage({ activeNonOwnerMembers: 0, firstHireReady: true })
    ).toBe("FIRST_HIRE_READY");
  });
});

// Financial summary integration: existing customer/territory projections are not payment authority.

import * as canonical from "../../analytics/canonicalRevenue";
import { resetDbForTesting, setDbForTesting } from "../../db";
vi.mock("../../customerAssets/customerAssetProjection", () => ({
  listCustomerAssets: async () => [
    {
      id: "commercial-fixture",
      kind: "commercial",
      displayName: "fixture",
      property: {},
      commercial: { realizedRevenue: { value: 999999 } },
      lifetimeValue: { value: 999999 },
      outstandingReceivables: { value: 0 },
      dataQuality: { sources: [] },
    },
  ],
}));
vi.mock("../../capabilities/capabilityEvaluationService", () => ({
  getCapabilityEvaluations: async () => [],
}));
const actualRead = canonical.readCanonicalRevenue;
const now = new Date("2026-10-05T19:00:00Z");
beforeEach(() => {
  const q: any = {
    where: () => q,
    limit: () => q,
    orderBy: () => q,
    then: (resolve: any) => Promise.resolve([]).then(resolve),
  };
  setDbForTesting({ select: () => ({ from: () => q }) });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetDbForTesting();
});
describe("World Treasury canonical payment revenue", () => {
  it("uses the combined all-time canonical book for Treasury and HQ, separate from attributed customer value", async () => {
    const read = vi
      .spyOn(canonical, "readCanonicalRevenue")
      .mockImplementation(input =>
        actualRead({
          ...input,
          coverage: null,
          loaders: withFixturePaymentAuthority({
            laundry_butler: async () => [
              {
                id: 1,
                paid: true,
                total: input.tenantId === "tenant-a" ? "85.80" : "10.00",
                paidAt: now,
                stripePaymentIntentId: "pi_1",
                serviceType: null,
                firstName: null,
                lastName: null,
                phone: null,
                email: null,
                bldgUserId: null,
              },
            ],
            cleancloud: async () =>
              input.tenantId === "tenant-a"
                ? ["orders_sales", "orders_revenue"].map(sourceReportType => ({
                    cleancloudOrderId: "603",
                    cleancloudCustomerId: null,
                    sourceReportType: sourceReportType as any,
                    paid: true,
                    totalCents: 73739,
                    paymentDateUtc: now,
                    paidDateUtc: now,
                    customerName: null,
                    customerPhone: null,
                    customerEmail: null,
                  }))
                : [],
          }),
        })
      );
    const world = await getBusinessWorld({ tenantId: "tenant-a", now });
    expect(read.mock.calls[0][0]).toEqual({
      tenantId: "tenant-a",
      from: "2020-01-01",
      to: "2026-10-05",
      timeZone: "America/Los_Angeles",
      now,
    });
    expect(world.financialSummary.collectedRevenue).toMatchObject({
      value: 82319,
      confidence: "medium",
    });
    expect(world.financialSummary.collectedRevenue.sourceReference).toContain(
      ":recorded_only"
    );
    expect(world.hq.value).toEqual(world.financialSummary.collectedRevenue);
    expect(world.financialSummary.realizedCommercialRevenue.value).toBe(999999);
    expect(world.dataQuality.warnings.join(" ")).toContain("recorded only");
    expect(
      (await getBusinessWorld({ tenantId: "tenant-b", now })).financialSummary
        .collectedRevenue.value
    ).toBe(1000);
  });
  it("keeps unavailable canonical payments unknown instead of falling back to customer LTV or zero", async () => {
    vi.spyOn(canonical, "readCanonicalRevenue").mockImplementation(input =>
      actualRead({
        ...input,
        coverage: null,
        loaders: withFixturePaymentAuthority({
          laundry_butler: async () => {
            throw new Error("down");
          },
          cleancloud: async () => {
            throw new Error("down");
          },
        }),
      })
    );
    const world = await getBusinessWorld({ tenantId: "tenant-a", now });
    expect(world.financialSummary.collectedRevenue).toMatchObject({
      value: null,
      provenance: "UNKNOWN",
    });
    expect(world.hq.value?.value).toBeNull();
    expect(world.dataQuality.warnings.join(" ")).toContain("unavailable");
  });
});
