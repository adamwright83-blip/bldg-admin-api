import { describe, expect, it } from "vitest";
import { dedupeLatestSales, saleFromRow } from "./latestSales";
import {
  assertPublicPulse,
  projectOperatingPulse,
  type PulseTenantInput,
} from "./operatingPulse";

function tenant(overrides: Partial<PulseTenantInput> = {}): PulseTenantInput {
  return {
    tenantId: "tenant-a",
    lastAttemptAt: "2026-09-27T01:04:00.000Z",
    lastAttemptOutcome: "imported",
    lastSuccessAt: "2026-09-27T01:04:00.000Z",
    customerTruth: "refreshed",
    map: "pending",
    book: "fresh",
    expectedThrough: "2026-09-26",
    coveredThrough: "2026-09-26",
    lastImportRows: 40,
    ...overrides,
  };
}

describe("operating pulse", () => {
  it("says the export was never captured when nothing is paired", () => {
    const pulse = projectOperatingPulse({
      now: new Date("2026-09-28T05:00:00.000Z"),
      tenants: [],
    });
    expect(pulse.functioning).toBe(false);
    expect(pulse.jawbreaker).toBe("never");
    expect(pulse.summary).toBe("No Gumball binding. Export never captured.");
    expect(() => assertPublicPulse(pulse)).not.toThrow();
  });

  it("is functioning only when capture, Jawbreaker, and the book all succeeded", () => {
    const pulse = projectOperatingPulse({ tenants: [tenant()] });
    expect(pulse.functioning).toBe(true);
    expect(pulse.jawbreaker).toBe("refreshed");
    expect(pulse.summary).toBe("Jawbreaker refreshed. Book fresh through 2026-09-26.");
    expect(pulse.tenants[0]?.map).toBe("pending");
  });

  it("does not call a Gumball import success a Jawbreaker success", () => {
    const pulse = projectOperatingPulse({
      tenants: [tenant({ customerTruth: "failed", book: "partial" })],
    });
    expect(pulse.functioning).toBe(false);
    expect(pulse.jawbreaker).toBe("failed");
    expect(pulse.summary).toBe(
      "Gumball imported. Jawbreaker did not refresh customer truth."
    );
  });

  it("says the book is not current when Jawbreaker refreshed a stale span", () => {
    const pulse = projectOperatingPulse({
      tenants: [tenant({ book: "stale", expectedThrough: "2026-09-27" })],
    });
    expect(pulse.functioning).toBe(false);
    expect(pulse.summary).toBe(
      "Jawbreaker refreshed, but the CleanCloud book is not current through 2026-09-27."
    );
  });

  it("does not call the book fresh when the latest capture failed", () => {
    const pulse = projectOperatingPulse({
      tenants: [tenant({ lastAttemptOutcome: "failed" })],
    });
    expect(pulse.functioning).toBe(false);
    expect(pulse.jawbreaker).toBe("refreshed");
    expect(pulse.summary).toBe(
      "Last Gumball capture failed. An older refresh is not a current capture."
    );
    expect(pulse.summary).not.toMatch(/Book fresh/);
  });

  it("does not invent a capture when a store is paired and nothing has run", () => {
    const pulse = projectOperatingPulse({
      tenants: [
        tenant({
          lastAttemptAt: null,
          lastAttemptOutcome: null,
          lastSuccessAt: null,
          customerTruth: null,
          book: "unavailable",
        }),
      ],
    });
    expect(pulse.functioning).toBe(false);
    expect(pulse.summary).toBe("Gumball has not recorded a capture.");
  });

  it("drops private fields before anything is published", () => {
    const pulse = projectOperatingPulse({
      tenants: [tenant({ tenantId: "tenant-a" })],
    });
    expect(() =>
      assertPublicPulse({
        ...pulse,
        customerName: "Hidden Person",
      })
    ).toThrow(/customerName/);
    expect(() => assertPublicPulse(pulse)).not.toThrow();
    expect(JSON.stringify(pulse)).not.toMatch(/Hidden|@|storeLabel|amountCents/);
  });
});

describe("latest CleanCloud sales", () => {
  it("keeps date, time, name, and amount, and collapses duplicate report rows", () => {
    const sales = dedupeLatestSales(
      [
        {
          orderId: "100",
          customerName: "Ada Lovelace",
          amountCents: 5100,
          placedAt: new Date("2026-09-27T17:00:00.000Z"),
          paymentAt: new Date("2026-09-27T18:30:00.000Z"),
          paidAt: null,
          ingestedAt: new Date("2026-09-27T19:00:00.000Z"),
        },
        {
          orderId: "100",
          customerName: "Ada Lovelace",
          amountCents: 5100,
          placedAt: new Date("2026-09-27T17:00:00.000Z"),
          paymentAt: null,
          paidAt: new Date("2026-09-27T18:30:00.000Z"),
          ingestedAt: new Date("2026-09-06T19:00:00.000Z"),
        },
      ],
      20
    );
    expect(sales).toEqual([
      {
        at: "2026-09-27T18:30:00.000Z",
        placedAt: "2026-09-27T17:00:00.000Z",
        paidAt: "2026-09-27T18:30:00.000Z",
        ingestedAt: "2026-09-06T19:00:00.000Z",
        customerName: "Ada Lovelace",
        amountCents: 5100,
      },
    ]);
    const view = saleFromRow({
      orderId: "200",
      customerName: "Grace Hopper",
      amountCents: 2500,
      placedAt: new Date("2026-09-27T16:00:00.000Z"),
      paymentAt: null,
      paidAt: null,
      ingestedAt: new Date("2026-09-27T16:05:00.000Z"),
    });
    expect(view.at).toBe("2026-09-27T16:00:00.000Z");
    expect(view.paidAt).toBeNull();
    expect(view.ingestedAt).toBe("2026-09-27T16:05:00.000Z");
    expect(Object.keys(view).sort()).toEqual([
      "amountCents",
      "at",
      "customerName",
      "ingestedAt",
      "paidAt",
      "placedAt",
    ]);
  });
});
