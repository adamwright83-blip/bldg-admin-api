import { describe, expect, it } from "vitest";
import { deriveRecoverySafety } from "./recoveryEvidence";
import { identityKeysFor } from "../../analytics/customerIdentityResolution";
import type { BusinessSourceCoverageSnapshot } from "../../analytics/sourceCoverage";
import { isDormantEligible, DEFAULT_DOCTRINE } from "../../../shared/claireProactive";

describe("deriveRecoverySafety", () => {
  const baseCoverage: BusinessSourceCoverageSnapshot = {
    tenantId: "tenant-1",
    sources: [
      {
        sourceId: "laundry_butler",
        availability: "connected",
        supportsExhaustiveCurrentClaim: true,
        freshnessSeconds: 10,
        unadmittedRecords: 0,
      },
      {
        sourceId: "cleancloud",
        availability: "not_held",
        supportsExhaustiveCurrentClaim: false,
        freshnessSeconds: 0,
        unadmittedRecords: 0,
      },
    ],
  };

  const testPhone = "555-123-4567";
  const testKeys = identityKeysFor({ phone: testPhone });

  it("identifies active native orders by phone identity key", () => {
    const safety = deriveRecoverySafety({
      tenantId: "tenant-1",
      identityKeys: testKeys,
      nativeOrders: [
        {
          tenantId: "tenant-1",
          id: 1,
          status: "in_progress",
          createdAt: new Date(),
          firstName: "Alice",
          lastName: "Smith",
          phone: testPhone,
          email: "alice@example.com",
          address: "123 Main St",
          unit: null,
          buildingSlug: null,
          bldgUserId: null,
          paid: true,
          stripePaymentIntentId: null,
          total: 2500,
        },
      ],
      coverage: baseCoverage,
      recoveries: [],
      communications: [],
    });

    expect(safety.openOrderCount).toBe(1);
    expect(safety.unavailableReason).toBeNull();
  });

  it("returns zero open orders when native is exhausted and no active external job source held", () => {
    const safety = deriveRecoverySafety({
      tenantId: "tenant-1",
      identityKeys: testKeys,
      nativeOrders: [
        {
          tenantId: "tenant-1",
          id: 1,
          status: "delivered",
          createdAt: new Date(),
          firstName: "Alice",
          lastName: "Smith",
          phone: testPhone,
          email: "alice@example.com",
          address: "123 Main St",
          unit: null,
          buildingSlug: null,
          bldgUserId: null,
          paid: true,
          stripePaymentIntentId: null,
          total: 2500,
        },
      ],
      coverage: baseCoverage,
      recoveries: [],
      communications: [],
    });

    expect(safety.openOrderCount).toBe(0);
    expect(safety.unavailableReason).toBeNull();
  });

  it("fails open order check when external coverage could hold active jobs", () => {
    const externalCoverage: BusinessSourceCoverageSnapshot = {
      tenantId: "tenant-1",
      sources: [
        {
          sourceId: "laundry_butler",
          availability: "connected",
          supportsExhaustiveCurrentClaim: true,
          freshnessSeconds: 10,
          unadmittedRecords: 0,
        },
        {
          sourceId: "cleancloud",
          availability: "connected",
          supportsExhaustiveCurrentClaim: false,
          freshnessSeconds: 60,
          unadmittedRecords: 0,
        },
      ],
    };

    const safety = deriveRecoverySafety({
      tenantId: "tenant-1",
      identityKeys: testKeys,
      nativeOrders: [],
      coverage: externalCoverage,
      recoveries: [],
      communications: [],
    });

    expect(safety.openOrderCount).toBeNull();
    expect(safety.unavailableReason).toContain("CleanCloud");
  });

  it("detects unresolved recovery interventions and prior outreach timestamps", () => {
    const contactedAt = new Date("2026-10-01T12:00:00Z");
    const commTime = new Date("2026-10-05T14:30:00Z");

    const safety = deriveRecoverySafety({
      tenantId: "tenant-1",
      identityKeys: testKeys,
      nativeOrders: [],
      coverage: baseCoverage,
      recoveries: [
        {
          customerKeyHash: "some-hash",
          status: "approved",
          contactedAt,
        },
      ],
      communications: [
        {
          toNumber: testPhone,
          direction: "outbound",
          status: "delivered",
          createdAt: commTime,
        },
      ],
    });

    expect(safety.lastOutreachOn).toBe(commTime.toISOString());
  });

  it("disallows dormant recovery outreach when active job exists or CleanCloud jobs are unverified", () => {
    const safety = deriveRecoverySafety({
      tenantId: "tenant-1",
      identityKeys: testKeys,
      nativeOrders: [
        {
          tenantId: "tenant-1",
          id: 2,
          status: "in_progress",
          paid: true,
          firstName: "Alice",
          lastName: "Smith",
          phone: testPhone,
          total: 3000,
        } as any,
      ],
      coverage: baseCoverage,
      recoveries: [],
      communications: [],
    });

    const customer = {
      identityKey: testKeys[0]!,
      displayName: "Alice Smith",
      paidOrderCount: 5,
      lastPaidOn: "2026-08-01",
      daysSinceLastPaid: 45,
      expectedCadenceDays: 14,
      openOrderCount: safety.openOrderCount ?? 1,
      lastOutreachOn: safety.lastOutreachOn,
      attestedOutreachOn: safety.attestedOutreachOn,
    };

    const eligibility = isDormantEligible(customer, DEFAULT_DOCTRINE, "2026-09-15", []);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.why).toContain("open order");
  });
});

