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
