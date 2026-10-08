import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("CleanCloud external evidence architecture", () => {
  it("never mints native payment_verified authority from CleanCloud", () => {
    const world = source("./browserSync/worldOutbox.ts");
    const evidence = source("./cleancloudPaidEvidence.ts");
    expect(world).toContain("admitCleanCloudPaidObservationWith");
    expect(world).not.toContain('claimType: "payment_verified"');
    expect(world).not.toContain("admitNativeStripePayment");
    expect(evidence).toContain('claimType: "cleancloud_paid_observed"');
  });

  it("routes both active paid-order ingestion paths through one CleanCloud writer", () => {
    const csv = source("./cleancloudPaidOrders.ts");
    const browser = source("./browserSync/ingestion.ts");
    for (const text of [csv, browser]) {
      expect(text).toContain("upsertCleanCloudPaidOrderWith");
      expect(text).not.toContain("insert(cleancloudPaidOrders)");
      expect(text).not.toContain("update(cleancloudPaidOrders)");
    }
  });

  it("keeps native payment and Commercial conversion out of CleanCloud ingestion", () => {
    const files = [
      source("./cleancloudPaidOrders.ts"),
      source("./browserSync/ingestion.ts"),
      source("./browserSync/worldOutbox.ts"),
      source("./cleancloudPaidEvidence.ts"),
    ].join("\n");
    expect(files).not.toContain("admitNativeStripePayment");
    expect(files).not.toContain("stripePaymentIntentId");
    expect(files).not.toContain("convertWonAccountWith");
    expect(files).not.toContain('orders.paid');
  });

  it("uses source-aware analytics evidence without changing customer identity logic", () => {
    const ledger = source("../../analytics/paidOrderLedger.ts");
    expect(ledger).toContain("cleancloudEvidence");
    expect(ledger).toContain("readCleanCloudPaidObservationReceipts");
    expect(ledger).toContain("paymentEvidence");
    expect(ledger).toContain("identityKeysFor");
  });
});
