import { describe, expect, it } from "vitest";
import type { AuthorityReceipt } from "../../platform/authority/authorityReceipt";
import {
  cleanCloudPaidObservationReceiptMatches,
  cleanCloudPaidOrderBusinessFields,
  currentCleanCloudPaidObservationReceipt,
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

  describe("the receipt for an order's current economic revision", () => {
    const paymentAt = "2026-09-02T17:15:00.000Z";
    const observed = (id: string, batch: number, admittedAt: string, extra: Partial<AuthorityReceipt> = {}): AuthorityReceipt => ({
      id,
      tenantId: "tenant-a",
      claimType: "cleancloud_paid_observed",
      subjectType: "cleancloud_order",
      subjectId: "603",
      sourceType: "cleancloud_paid_order",
      sourceRef: `cleancloud-import:${batch}:603`,
      actorType: "system",
      actorId: null,
      evidenceClass: "authoritative_external",
      verificationClass: "VERIFIED",
      admissionPolicy: "cleancloud_paid_observation_v1",
      occurredAt: paymentAt,
      admittedAt,
      metadata: null,
      idempotencyKey: `authority:${id}`,
      ...extra,
    });
    const order = {
      tenantId: "tenant-a",
      subjectType: "cleancloud_order" as const,
      subjectId: "603",
      sourceType: "cleancloud_paid_order" as const,
      sourceRef: "cleancloud-import:9:603",
      importBatchId: 9,
      paymentAt,
    };

    it("is the receipt for the payment, whichever later import re-observed the row", () => {
      expect(currentCleanCloudPaidObservationReceipt([observed("a", 7, "2026-09-02T18:00:00.000Z")], order)?.id).toBe("a");
    });
    it("is the newest receipt: an amount correction supersedes the first observation", () => {
      const receipts = [observed("first", 7, "2026-09-02T18:00:00.000Z"), observed("corrected", 8, "2026-09-03T18:00:00.000Z")];
      expect(currentCleanCloudPaidObservationReceipt(receipts, order)?.id).toBe("corrected");
    });
    it("is chosen by payment time: the other report's newer receipt does not hide this row's payment", () => {
      // The Sales row was observed at its Payment Date; the Revenue row, imported later, at its own Paid Date.
      const receipts = [
        observed("sales", 7, "2026-09-02T18:00:00.000Z"),
        observed("revenue", 8, "2026-09-03T18:00:00.000Z", { occurredAt: "2026-09-03T01:40:00.000Z" }),
      ];
      expect(currentCleanCloudPaidObservationReceipt(receipts, order)?.id).toBe("sales");
      expect(currentCleanCloudPaidObservationReceipt(receipts, { ...order, paymentAt: "2026-09-03T01:40:00.000Z" })?.id).toBe("revenue");
    });
    it("fails closed: another payment time, no import batch, another tenant, an invalid newest receipt", () => {
      expect(currentCleanCloudPaidObservationReceipt([observed("a", 7, "2026-09-02T18:00:00.000Z", { occurredAt: "2026-09-03T17:15:00.000Z" })], order)).toBeNull();
      expect(currentCleanCloudPaidObservationReceipt([observed("a", 7, "2026-09-02T18:00:00.000Z")], { ...order, importBatchId: null })).toBeNull();
      expect(currentCleanCloudPaidObservationReceipt([observed("a", 7, "2026-09-02T18:00:00.000Z", { tenantId: "tenant-b" })], order)).toBeNull();
      const newestInvalid = [
        observed("old", 7, "2026-09-02T18:00:00.000Z"),
        observed("new", 8, "2026-09-03T18:00:00.000Z", { verificationClass: "ATTESTED" as never }),
      ];
      expect(currentCleanCloudPaidObservationReceipt(newestInvalid, order)).toBeNull();
    });
  });
});
