import { describe, it, expect } from "vitest";
import {
  restoredPlots,
  validateReview,
  outreachSubmission,
  apartmentProspect,
  addressKey,
} from "./beverlyHillsOutreach";
describe("Beverly Hills evidence boundary", () => {
  it("only verified unique activities grow the fictional ranch", () =>
    expect(
      restoredPlots([
        { id: "a", status: "submitted" },
        { id: "b", status: "rejected" },
        { id: "c", status: "verified" },
        { id: "c", status: "verified" },
      ])
    ).toBe(1));
  it("does not allow self verification or reviewing a completed decision", () => {
    expect(() =>
      validateReview({ operatorId: "a", status: "submitted" }, "a")
    ).toThrow();
    expect(() =>
      validateReview({ operatorId: "a", status: "verified" }, "b")
    ).toThrow();
    expect(() =>
      validateReview({ operatorId: "a", status: "submitted" }, "b")
    ).not.toThrow();
  });
  it("requires permission, count, date and safe evidence links", () => {
    const p = {
      requestId: "b0d364e4-781e-4b6f-b277-b53c69c53fee",
      prospectId: "acct:1",
      performedOn: "2026-10-24",
      count: 35,
      permission: "Manager approved the lobby",
      evidenceUrl: "https://example.com/receipt",
      notes: "Distributed in the permitted lobby.",
    };
    expect(outreachSubmission.safeParse(p).success).toBe(true);
    expect(
      outreachSubmission.safeParse({ ...p, evidenceUrl: "javascript:alert(1)" })
        .success
    ).toBe(false);
    expect(outreachSubmission.safeParse({ ...p, count: 0 }).success).toBe(
      false
    );
  });
  it("selects apartment records with real addresses and matches addresses conservatively", () => {
    expect(apartmentProspect({ kind: "hotel", address: "123 Main" })).toBe(
      false
    );
    expect(
      apartmentProspect({ kind: "apartment building", address: null })
    ).toBe(false);
    expect(addressKey(" 123 N. Main, Street ")).toBe("123 n main street");
  });
});

import { laDate, plotsFromOrders } from "./beverlyHillsOutreach";
describe("ranch plots grow from orders placed after a drop", () => {
  const rec = (id: string, address: string, performedOn: string, status: "submitted" | "verified" | "rejected" = "submitted") => ({ id, address, performedOn, status });
  it("counts a building once its address has an order placed on or after the drop date, by exact address", () => {
    const records = [rec("a", "100 Example St", "2026-10-01"), rec("b", "200 Example St", "2026-10-01"), rec("c", "300 Example St", "2026-10-01", "rejected")];
    const orders = [
      { address: "100 example st.", placedOn: "2026-10-04" },
      { address: "200 Example St", placedOn: "2026-09-20" },
      { address: "300 Example St", placedOn: "2026-10-05" },
    ];
    expect(plotsFromOrders(records, orders)).toBe(1);
  });
  it("one order grows one plot, however many reports share its address", () => {
    const records = [rec("a", "100 Example St", "2026-10-01"), rec("b", "100 Example St", "2026-10-02"), rec("c", "100 Example St.", "2026-10-03")];
    expect(plotsFromOrders(records, [{ address: "100 Example St", placedOn: "2026-10-04" }])).toBe(1);
  });
  it("an order placed before the first drop never counts, whatever its pickup date", () => {
    const records = [rec("a", "100 Example St", "2026-10-01")];
    expect(plotsFromOrders(records, [{ address: "100 Example St", placedOn: "2026-09-28T23:30:00.000Z" }])).toBe(0);
  });
  it("never more than six", () => {
    const records = Array.from({ length: 9 }, (_, i) => rec(String(i), `${i} Example St`, "2026-10-01"));
    const orders = records.map(r => ({ address: r.address, placedOn: "2026-10-02" }));
    expect(plotsFromOrders(records, orders)).toBe(6);
  });
  it("reads an order's placement as a Los Angeles calendar date", () => {
    expect(laDate(new Date("2026-10-02T05:30:00.000Z"))).toBe("2026-10-01");
    expect(laDate("not a date")).toBe("");
  });
});
