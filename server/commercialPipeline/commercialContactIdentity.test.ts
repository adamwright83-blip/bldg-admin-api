import { describe, expect, it } from "vitest";
import {
  commercialContactIdentityCandidates,
  commercialContactIdentityKey,
  normalizeCommercialContactEmail,
  normalizeCommercialContactPhone,
  commercialLocationIdentityKey,
} from "./commercialPipelineCore";

describe("commercial contact identity", () => {
  it("normalizes email case and whitespace", () => {
    expect(normalizeCommercialContactEmail("  Vincent@Example.COM ")).toBe(
      "vincent@example.com"
    );
    expect(
      commercialContactIdentityKey({ email: "Vincent@example.com" })
    ).toBe(commercialContactIdentityKey({ email: " vincent@EXAMPLE.com " }));
  });

  it("normalizes domestic punctuation and preserves international intent", () => {
    expect(normalizeCommercialContactPhone("(310) 555-0188")).toBe(
      "3105550188"
    );
    expect(normalizeCommercialContactPhone("00 44 20 7946 0958")).toBe(
      "+442079460958"
    );
    expect(normalizeCommercialContactPhone("+44 (0)20 7946 0958")).toBe(
      "+4402079460958"
    );
  });

  it("uses email, phone, then normalized name and title as enrichment candidates", () => {
    const candidates = commercialContactIdentityCandidates({
      email: "vincent@example.com",
      phone: "310-555-0188",
      name: "Vincent",
      title: "Concierge",
    });
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toBe(
      commercialContactIdentityKey({ email: "vincent@example.com" })
    );
    expect(candidates[1]).toBe(
      commercialContactIdentityKey({ phone: "3105550188" })
    );
    expect(candidates[2]).toBe(
      commercialContactIdentityKey({ name: "vincent", title: "concierge" })
    );
  });

  it("does not collapse unnamed people who share a generic title", () => {
    const first = commercialContactIdentityKey({
      title: "Concierge",
      fallbackIdentity: "walk-in-request-a",
    });
    const second = commercialContactIdentityKey({
      title: "Concierge",
      fallbackIdentity: "walk-in-request-b",
    });
    expect(first).not.toBe(second);
  });

  it("requires an idempotent fallback for a truly unnamed contact", () => {
    expect(() => commercialContactIdentityKey({ title: "Front desk" })).toThrow(
      /fallback identity/
    );
  });

  it("keeps a location identity stable while unknown coordinates are enriched", () => {
    expect(
      commercialLocationIdentityKey({
        address: "1200 Harbor Avenue, Long Beach, CA",
        latitude: null,
        longitude: null,
      }),
    ).toBe(
      commercialLocationIdentityKey({
        address: " 1200 HARBOR avenue, Long Beach, CA ",
        latitude: 33.7701,
        longitude: -118.1937,
      }),
    );
  });
});
