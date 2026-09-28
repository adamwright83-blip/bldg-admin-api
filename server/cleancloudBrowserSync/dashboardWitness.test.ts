import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DASHBOARD_WITNESS_SOURCE,
  projectDashboardWitness,
  sha256Bytes,
  witnessHasNoScreenshotTruth,
  witnessWrite,
  type DashboardWitnessInput,
} from "./dashboardWitness";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ...Array.from({ length: 32 }, (_, index) => index + 1),
]);

function input(over: Partial<DashboardWitnessInput> = {}): DashboardWitnessInput {
  const screenshotBytes = over.screenshotBytes ?? png;
  return {
    expectedStoreLabel: "Goldline Laundry",
    observedStoreLabel: "Goldline Laundry",
    rangeFrom: "2026-09-01",
    rangeTo: "2026-09-27",
    rangeText: "September 1, 2026 – September 27, 2026",
    fields: [
      { label: "Sales", valueText: "$3,126.32" },
      { label: "Revenue", valueText: "$2,984.10" },
      { label: "Orders", valueText: "41" },
    ],
    observedAt: new Date("2026-09-28T06:00:00.000Z"),
    screenshotBytes,
    screenshotSha256: sha256Bytes(screenshotBytes),
    ...over,
  };
}

describe("projectDashboardWitness", () => {
  it("keeps an unambiguous overview and leaves the screenshot out of the record", () => {
    const result = projectDashboardWitness(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.witness).toMatchObject({
      storeLabel: "Goldline Laundry",
      rangeFrom: "2026-09-01",
      rangeTo: "2026-09-27",
      salesCents: 312632,
      revenueCents: 298410,
      orders: 41,
      newCustomers: null,
      comparisonFrom: null,
      comparisonOrders: null,
      source: DASHBOARD_WITNESS_SOURCE,
      extractionVersion: "metrics-overview-v1",
    });
    expect(witnessHasNoScreenshotTruth(result.witness)).toBe(true);
  });

  it("rejects the wrong store", () => {
    const result = projectDashboardWitness(input({ observedStoreLabel: "Other Store" }));
    expect(result).toEqual({ ok: false, reason: "The open store is not the paired store." });
  });

  it("rejects a date range the page does not prove", () => {
    const result = projectDashboardWitness(input({ rangeText: "August 1, 2026 – August 31, 2026" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a range that contains an extra date", () => {
    const result = projectDashboardWitness(input({
      rangeText: "September 1, 2026 – September 27, 2026 (also August 1, 2026)",
    }));
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate Sales", () => {
    const result = projectDashboardWitness(input({
      fields: [
        { label: "Sales", valueText: "$1.00" },
        { label: "Sales", valueText: "$2.00" },
        { label: "Revenue", valueText: "$2.00" },
        { label: "Orders", valueText: "1" },
      ],
    }));
    expect(result).toMatchObject({ ok: false, reason: "Sales appeared more than once." });
  });

  it("rejects abbreviated money and a missing required total", () => {
    expect(projectDashboardWitness(input({
      fields: [
        { label: "Sales", valueText: "3.1k" },
        { label: "Revenue", valueText: "$1.00" },
        { label: "Orders", valueText: "1" },
      ],
    })).ok).toBe(false);
    expect(projectDashboardWitness(input({
      fields: [
        { label: "Revenue", valueText: "$1.00" },
        { label: "Orders", valueText: "1" },
      ],
    }))).toMatchObject({ ok: false, reason: "Sales was not on the page." });
  });

  it("rejects an incomplete comparison and keeps a proven one", () => {
    expect(projectDashboardWitness(input({ comparisonText: "not a period" })).ok).toBe(false);
    const proven = projectDashboardWitness(input({
      comparisonText: "Aug 1, 2026 - Aug 31, 2026",
      fields: [
        { label: "Sales", valueText: "$3,126.32" },
        { label: "Revenue", valueText: "$2,984.10" },
        { label: "Orders", valueText: "41" },
        { label: "Comparison Sales", valueText: "$2,000.00" },
        { label: "Comparison Revenue", valueText: "$1,847.80" },
        { label: "Comparison Orders", valueText: "33" },
        { label: "New Customers", valueText: "4" },
      ],
    }));
    expect(proven.ok).toBe(true);
    if (!proven.ok) return;
    expect(proven.witness.comparisonFrom).toBe("2026-08-01");
    expect(proven.witness.comparisonTo).toBe("2026-08-31");
    expect(proven.witness.comparisonRevenueCents).toBe(184780);
    expect(proven.witness.comparisonOrders).toBe(33);
    expect(proven.witness.newCustomers).toBe(4);
  });

  it("does not attribute comparison orders without a proven comparison period", () => {
    const result = projectDashboardWitness(input({
      fields: [
        { label: "Sales", valueText: "$3,126.32" },
        { label: "Revenue", valueText: "$2,984.10" },
        { label: "Orders", valueText: "41" },
        { label: "Comparison Orders", valueText: "999" },
      ],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.witness.comparisonFrom).toBeNull();
    expect(result.witness.comparisonOrders).toBeNull();
  });

  it("does not invent new customers and rejects a duplicate", () => {
    const missing = projectDashboardWitness(input());
    expect(missing.ok && missing.witness.newCustomers).toBe(null);
    const duplicate = projectDashboardWitness(input({
      fields: [
        { label: "Sales", valueText: "$1.00" },
        { label: "Revenue", valueText: "$1.00" },
        { label: "Orders", valueText: "1" },
        { label: "New Customers", valueText: "2" },
        { label: "New Customers", valueText: "9" },
      ],
    }));
    expect(duplicate).toMatchObject({ ok: false, reason: "New Customers appeared more than once." });
  });

  it("rejects a screenshot whose hash does not match the bytes", () => {
    const result = projectDashboardWitness(input({
      screenshotSha256: "a".repeat(64),
    }));
    expect(result).toMatchObject({ ok: false, reason: "The screenshot does not match its hash." });
  });

  it("stamps the tenant and store from the pairing, not the page", () => {
    const result = witnessWrite({
      tenantId: "tenant-a",
      storeId: "42",
      input: input(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.write.tenantId).toBe("tenant-a");
    expect(result.write.storeId).toBe("42");
    expect(result.write.witness.storeLabel).toBe("Goldline Laundry");
    expect(witnessHasNoScreenshotTruth(result.write.witness)).toBe(true);
    expect("screenshotBytes" in result.write).toBe(false);
  });

  it("the operator response does not select screenshot bytes", () => {
    const router = readFileSync(new URL("./router.ts", import.meta.url), "utf8");
    const fn = router.slice(
      router.indexOf("function publicDashboardWitness"),
      router.indexOf("function sameWitnessTotals")
    );
    expect(fn).not.toContain("pngBase64");
    expect(fn).not.toContain("screenshotBase64");
    expect(fn).toContain("screenshotSha256");
    expect(router).toContain("eq(dashboardWitnesses.tenantId, ctx.tenantId)");
    expect(router).toContain("expectedStoreLabel: binding.storeLabel");
    expect(router).toContain("row.comparisonOrders === witness.comparisonOrders");
    expect(router).toContain("eq(dashboardWitnesses.storeId, binding.storeId)");
    expect(router).toContain("eq(dashboardWitnesses.rangeFrom, witness.rangeFrom)");
    expect(router).toContain("eq(dashboardWitnesses.rangeTo, witness.rangeTo)");
    expect(router).toContain("!sameWitnessTotals(row, witness)");
  });
});
