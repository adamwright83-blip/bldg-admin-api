import { describe, expect, it } from "vitest";
import type { InsertCleancloudPaidOrder } from "../../drizzle/schema";
import {
  descriptiveCustomerIdentityHash,
  economicRevisionFingerprint,
  economicSnapshot,
} from "./worldOutbox";

function paidRow(
  overrides: Partial<InsertCleancloudPaidOrder> = {}
): InsertCleancloudPaidOrder {
  return {
    tenantId: "tenant-a",
    sourceReportType: "orders_sales",
    sourceFileName: "browser.csv",
    importBatchId: 1,
    cleancloudOrderId: "1",
    cleancloudCustomerId: "7",
    customerName: "Example",
    customerEmail: null,
    customerPhone: null,
    address: "2170 Century Park East",
    paid: true,
    totalCents: 5100,
    paymentDateUtc: new Date("2026-09-02T07:00:00.000Z"),
    buildingResolutionStatus: "resolved",
    buildingSlug: "centuryparkeast",
    ...overrides,
  };
}

describe("CleanCloud economic revision fingerprint", () => {
  it("does not treat a CleanCloud customer ID change as a payment correction", () => {
    const original = paidRow();
    const enriched = paidRow({ cleancloudCustomerId: "99" });
    expect(economicRevisionFingerprint(original)).toBe(
      economicRevisionFingerprint(enriched)
    );
    expect(economicSnapshot(original).customerIdentityHash).not.toBe(
      economicSnapshot(enriched).customerIdentityHash
    );
  });

  it("does not treat phone or email identity enrichment as a payment correction", () => {
    const original = paidRow();
    const phone = paidRow({ customerPhone: "3105550100" });
    const email = paidRow({ customerEmail: "ada@example.com" });
    expect(economicRevisionFingerprint(original)).toBe(
      economicRevisionFingerprint(phone)
    );
    expect(economicRevisionFingerprint(original)).toBe(
      economicRevisionFingerprint(email)
    );
    expect(economicSnapshot(original).customerIdentityHash).not.toBe(
      economicSnapshot(phone).customerIdentityHash
    );
    expect(economicSnapshot(email).customerIdentityHash).not.toBeNull();
  });

  it("still revises when amount, payment date, or paid state change", () => {
    const original = paidRow();
    expect(economicRevisionFingerprint(original)).not.toBe(
      economicRevisionFingerprint(paidRow({ totalCents: 6100 }))
    );
    expect(economicRevisionFingerprint(original)).not.toBe(
      economicRevisionFingerprint(
        paidRow({ paymentDateUtc: new Date("2026-09-03T07:00:00.000Z") })
      )
    );
    expect(economicRevisionFingerprint(original)).not.toBe(
      economicRevisionFingerprint(paidRow({ paid: false }))
    );
  });

  it("does not assign the same identity hash to two unidentified customers", () => {
    const first = paidRow({
      cleancloudOrderId: "11",
      cleancloudCustomerId: null,
      customerName: "Anonymous",
    });
    const second = paidRow({
      cleancloudOrderId: "12",
      cleancloudCustomerId: null,
      customerName: "Also Anonymous",
    });
    expect(descriptiveCustomerIdentityHash("tenant-a", first)).toBeNull();
    expect(descriptiveCustomerIdentityHash("tenant-a", second)).toBeNull();
    expect(economicSnapshot(first).customerIdentityHash).toBeNull();
    expect(economicSnapshot(second).customerIdentityHash).toBeNull();
  });
});
