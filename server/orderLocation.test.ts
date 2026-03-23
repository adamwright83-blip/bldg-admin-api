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

  it("derives slug from address when no slug", () => {
    const r = resolveOrderLocationForInsert({
      address: "3545 Wilshire Blvd, Los Angeles, CA",
      buildingSlug: null,
    });
    expect(r.address).toBe("3545 wilshire blvd, los angeles, ca");
    expect(r.buildingSlug).toBe("opusla");
  });

  it("uses explicit slug and default address when address omitted", () => {
    const r = resolveOrderLocationForInsert({
      address: "",
      buildingSlug: "opusla",
    });
    expect(r.buildingSlug).toBe("opusla");
    expect(r.address).toContain("3545");
  });

  it("prefers explicit slug when both provided", () => {
    const r = resolveOrderLocationForInsert({
      address: "2170 Century Park E",
      buildingSlug: "opusla",
    });
    expect(r.buildingSlug).toBe("opusla");
    expect(r.address).toBe("2170 century park e");
  });
});
