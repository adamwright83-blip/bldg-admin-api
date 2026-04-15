import { describe, expect, it } from "vitest";
import { normalizeOrderAddress, resolveOrderLocationForInsert } from "./orderLocation";

describe("normalizeOrderAddress", () => {
  it("lowercases and trims", () => {
    expect(normalizeOrderAddress("  3545 Wilshire Blvd  ")).toBe("3545 wilshire blvd");
  });
});

describe("resolveOrderLocationForInsert", () => {
  it("throws when both empty", () => {
    expect(() =>
      resolveOrderLocationForInsert({ address: "", buildingSlug: null })
    ).toThrow(/both were empty/);
    expect(() =>
      resolveOrderLocationForInsert({ address: "   ", buildingSlug: "   " })
    ).toThrow(/both were empty/);
  });

  it("derives canonical tower id from address when no slug", () => {
    const r = resolveOrderLocationForInsert({
      address: "3545 Wilshire Blvd, Los Angeles, CA",
      buildingSlug: null,
    });
    expect(r.address).toBe("3545 wilshire blvd, los angeles, ca");
    expect(r.buildingSlug).toBe("3545");
  });

  it("uses explicit tower id and default address when address omitted", () => {
    const r = resolveOrderLocationForInsert({
      address: "",
      buildingSlug: "3545",
    });
    expect(r.buildingSlug).toBe("3545");
    expect(r.address).toContain("3545");
  });

  it("prefers explicit tower id when both provided", () => {
    const r = resolveOrderLocationForInsert({
      address: "2170 Century Park E",
      buildingSlug: "3545",
    });
    expect(r.buildingSlug).toBe("3545");
    expect(r.address).toBe("2170 century park e");
  });

  it("resolves legacy opusla using address to correct tower", () => {
    const r = resolveOrderLocationForInsert({
      address: "2170 Century Park E, Los Angeles, CA 90067",
      buildingSlug: "opusla",
    });
    expect(r.buildingSlug).toBe("2170");
  });

  it("throws when legacy slug cannot be resolved from address", () => {
    expect(() =>
      resolveOrderLocationForInsert({
        address: "Somewhere vague, CA",
        buildingSlug: "opusla",
      })
    ).toThrow(/Cannot place order with legacy building/);
  });
});
