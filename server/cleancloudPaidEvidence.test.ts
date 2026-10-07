import { describe, expect, it } from "vitest";
import type { AuthorityReceipt } from "./authority/authorityReceipt";
import {
  cleanCloudPaidObservationReceiptMatches,
  cleanCloudPaidOrderBusinessFields,
  requireCleanCloudTenantId,
} from "./cleancloudPaidEvidence";

describe("CleanCloud paid evidence authority", () => {
  it("requires explicit tenant authority instead of manufacturing default", () => {
    expect(() => requireCleanCloudTenantId("")).toThrow(
      "requires explicit tenantId"
    );
    expect(() => requireCleanCloudTenantId("   ")).toThrow(
      "requires explicit tenantId"
    );
    expect(requireCleanCloudTenantId("tenant-a")).toBe("tenant-a");
  });

  it("matches only the CleanCloud-specific external observation claim", () => {
    const expected = {
      tenantId: "tenant-a",
      subjectType: "cleancloud_order" as const,
      subjectId: "603",
      sourceType: "cleancloud_paid_order" as const,
      sourceRef: "cleancloud-import:7:603",
    };
    const receipt: AuthorityReceipt = {
      ...expected,
      id: "auth-cleancloud",
      claimType: "cleancloud_paid_observed",
      actorType: "system",
      actorId: null,
      evidenceClass: "authoritative_external",
      verificationClass: "VERIFIED",
      admissionPolicy: "cleancloud_paid_observation_v1",
      occurredAt: "2026-10-05T19:00:00.000Z",
      admittedAt: "2026-10-05T19:00:01.000Z",
      metadata: null,
      idempotencyKey: "authority:cleancloud",
    };
    expect(
      cleanCloudPaidObservationReceiptMatches(receipt, expected)
    ).toBe(true);
    expect(
      cleanCloudPaidObservationReceiptMatches(
        { ...receipt, claimType: "payment_verified" },
        expected
      )
    ).toBe(false);
  });

  it("does not treat batch/file metadata as business-state differences", () => {
    const base = {
      tenantId: "tenant-a",
      cleancloudOrderId: "603",
      sourceReportType: "orders_sales",
      paid: true,
      totalCents: 73739,
      totalWeightLbs: "10.00",
      importBatchId: 7,
      sourceFileName: "first.csv",
    };
    expect(
      cleanCloudPaidOrderBusinessFields(base)
    ).toBe(
      cleanCloudPaidOrderBusinessFields({
        ...base,
        importBatchId: 8,
        sourceFileName: "retry.csv",
        totalWeightLbs: "10",
      })
    );
  });
});
