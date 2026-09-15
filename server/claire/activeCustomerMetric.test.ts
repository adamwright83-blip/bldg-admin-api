import { describe, expect, it } from "vitest";
import {
  activeCustomerWindow,
  countDistinctActiveCustomers,
  getActiveCustomerMetric,
  qualifiesActiveCustomerOrder,
  type ActiveCustomerLoaders,
} from "./activeCustomerMetric";
import type { CleanCloudOrderRow, NativeOrderRow } from "../analytics/paidOrderLedger";

const now = new Date("2026-09-15T02:00:00.000Z");
const observation = (source: "laundry_butler" | "cleancloud", phone: string | null, email: string | null) => ({ source, phone, email });

function nativeRow(id: number, phone: string, paidAt = new Date("2026-09-10T18:00:00Z")): NativeOrderRow {
  return {
    id,
    paid: true,
    paidAt,
    total: "30.00",
    stripePaymentIntentId: `pi_${id}`,
    serviceType: "wash_fold",
    firstName: "Ava",
    lastName: "Stone",
    phone,
    email: null,
    bldgUserId: null,
  };
}

function cleanCloudRow(id: string, phone: string | null): CleanCloudOrderRow {
  return {
    cleancloudOrderId: id,
    cleancloudCustomerId: null,
    sourceReportType: "orders_sales",
    paymentDateUtc: new Date("2026-09-11T18:00:00Z"),
    paidDateUtc: null,
    paid: true,
    totalCents: 2000,
    customerName: "Ava Stone",
    customerPhone: phone,
    customerEmail: null,
  };
}

function loaders(lb: NativeOrderRow[] | Error, cc: CleanCloudOrderRow[] | Error): ActiveCustomerLoaders {
  return {
    laundry_butler: async () => {
      if (lb instanceof Error) throw lb;
      return lb;
    },
    cleancloud: async () => {
      if (cc instanceof Error) throw cc;
      return cc;
    },
  };
}

describe("active customer metric", () => {
  it("computes the exact 30-calendar-day business-local window", () => {
    expect(activeCustomerWindow(now, "America/Los_Angeles")).toEqual({
      start: new Date("2026-08-16T07:00:00.000Z"),
      end: now,
    });
  });

  it("honors DST at the business-local boundary", () => {
    expect(activeCustomerWindow(new Date("2026-11-20T20:00:00.000Z"), "America/Los_Angeles").start.toISOString()).toBe("2026-10-22T07:00:00.000Z");
  });

  it("includes the exact boundary and excludes unpaid orders", () => {
    const start = new Date("2026-08-16T07:00:00.000Z");
    const end = now;
    const base = { source: "laundry_butler" as const, phone: "3105550100", email: null };
    expect(qualifiesActiveCustomerOrder({ ...base, paid: true, orderDate: start }, start, end)).toBe(true);
    expect(qualifiesActiveCustomerOrder({ ...base, paid: true, orderDate: new Date(start.getTime() - 1) }, start, end)).toBe(false);
    expect(qualifiesActiveCustomerOrder({ ...base, paid: false, orderDate: start }, start, end)).toBe(false);
  });

  it("dedupes across sources by normalized phone then email", () => {
    expect(countDistinctActiveCustomers([
      observation("laundry_butler", "+1 (310) 555-0100", "A@EXAMPLE.COM"),
      observation("cleancloud", "3105550100", "other@example.com"),
      observation("cleancloud", null, "a@example.com"),
      observation("cleancloud", null, null),
    ])).toEqual({ value: 2, unmatchedCount: 1 });
  });

  it("does not count a duplicate customer twice across sources", async () => {
    const metric = await getActiveCustomerMetric(
      { tenantId: "tenant-1", now, timeZone: "America/Los_Angeles" },
      loaders([nativeRow(1, "3105550100")], [cleanCloudRow("cc-1", "310-555-0100")])
    );
    expect(metric).toMatchObject({ value: 1, completeness: "complete", unmatchedCount: 0, sources: ["laundry_butler", "cleancloud"] });
  });

  it("marks one available source as partial, never an approximate total", async () => {
    expect(await getActiveCustomerMetric(
      { tenantId: "tenant-1", now, timeZone: "America/Los_Angeles" },
      loaders([nativeRow(1, "3105550100")], new Error("missing"))
    )).toMatchObject({ value: 1, completeness: "partial", sources: ["laundry_butler"] });
  });

  it("returns unavailable without a count when both sources fail", async () => {
    expect(await getActiveCustomerMetric(
      { tenantId: "tenant-1", now, timeZone: "America/Los_Angeles" },
      loaders(new Error("missing"), new Error("missing"))
    )).toMatchObject({ value: null, completeness: "unavailable", sources: [] });
  });
});
