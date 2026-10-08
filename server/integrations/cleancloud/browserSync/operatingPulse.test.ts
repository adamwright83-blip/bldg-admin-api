import { describe, expect, it } from "vitest";
import { cleancloudBrowserSyncRouter } from "./router";
import {
  assertNoPrivateFields,
  assertPulseTenant,
  projectTenantPulse,
} from "./operatingPulse";
import { dedupeLatestSales, saleFromRow } from "./latestSales";

const base = {
  tenantId: "tenant-a",
  paired: true,
  lastAttemptAt: "2026-09-27T18:00:00.000Z",
  lastAttemptOutcome: "imported",
  lastSuccessAt: "2026-09-27T18:00:00.000Z",
  customerTruth: "refreshed" as const,
  map: "refreshed" as const,
  book: "fresh" as const,
  expectedThrough: "2026-09-27",
  coveredThrough: "2026-09-27",
  paymentEventsProven: false,
  lastImportRows: 12,
};

describe("tenant operating pulse", () => {
  it("is functioning only when capture, Jawbreaker, and the book all succeeded", () => {
    const pulse = projectTenantPulse(base);
    expect(pulse.functioning).toBe(true);
    expect(pulse.summary).toContain("Payment completeness is not proven");
    expect(pulse.summary).not.toMatch(/customer|@/);
  });

  it("does not call the book fresh when the latest capture failed", () => {
    const pulse = projectTenantPulse({ ...base, lastAttemptOutcome: "failed" });
    expect(pulse.functioning).toBe(false);
    expect(pulse.jawbreaker).toBe("refreshed");
    expect(pulse.summary).toBe(
      "Last Gumball capture failed. An older refresh is not a current capture."
    );
    expect(pulse.summary).not.toMatch(/Book fresh/);
  });

  it("does not invent a capture when nothing has run", () => {
    const pulse = projectTenantPulse({
      ...base,
      lastAttemptAt: null,
      lastAttemptOutcome: null,
      lastSuccessAt: null,
      customerTruth: null,
      book: "unavailable",
    });
    expect(pulse.summary).toBe("Gumball has not recorded a capture.");
  });

  it("refuses another tenant and publishes no private fields", () => {
    expect(assertPulseTenant("tenant-a")).toBe("tenant-a");
    expect(() => assertPulseTenant("tenant-a", "tenant-b")).toThrow(/signed-in tenant/);
    const pulse = projectTenantPulse(base);
    expect(() => assertNoPrivateFields({ ...pulse, customerName: "Ada" })).toThrow(/customerName/);
    expect(JSON.stringify(pulse)).not.toMatch(/amountCents|customerPhone|address/);
  });
});

describe("latest CleanCloud sales", () => {
  it("keeps the earliest ingest time when the same order is seen twice", () => {
    const sales = dedupeLatestSales(
      [
        {
          orderId: "100",
          customerName: "Ada Lovelace",
          amountCents: 5100,
          placedAt: new Date("2026-08-01T17:00:00.000Z"),
          paymentAt: new Date("2026-09-27T18:30:00.000Z"),
          paidAt: null,
          ingestedAt: new Date("2026-09-27T19:00:00.000Z"),
        },
        {
          orderId: "100",
          customerName: "Ada Lovelace",
          amountCents: 5100,
          placedAt: new Date("2026-08-01T17:00:00.000Z"),
          paymentAt: null,
          paidAt: new Date("2026-09-27T18:30:00.000Z"),
          ingestedAt: new Date("2026-09-06T19:00:00.000Z"),
        },
      ],
      20
    );
    expect(sales[0]?.ingestedAt).toBe("2026-09-06T19:00:00.000Z");
    expect(sales[0]?.paidAt).toBe("2026-09-27T18:30:00.000Z");
    expect(sales).toHaveLength(1);
    const placedOnly = saleFromRow({
      orderId: "200",
      customerName: "Grace Hopper",
      amountCents: 2500,
      placedAt: new Date("2026-09-27T16:00:00.000Z"),
      paymentAt: null,
      paidAt: null,
      ingestedAt: new Date("2026-09-27T16:05:00.000Z"),
    });
    expect(placedOnly.at).toBe(placedOnly.placedAt);
    expect(placedOnly.paidAt).toBeNull();
  });
});

describe("gumball pulse authorization", () => {
  it("rejects an anonymous caller before any tenant read", async () => {
    const caller = cleancloudBrowserSyncRouter.createCaller({
      req: { method: "POST", headers: {} },
      res: {},
      user: null,
      vendorSession: null,
      tenantId: "tenant-b",
    } as never);
    await expect(caller.operatingPulse()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.latestSales()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
