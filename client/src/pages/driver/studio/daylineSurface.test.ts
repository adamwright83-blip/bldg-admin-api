import { describe, expect, it } from "vitest";
import { resolveDaylineSurface } from "./daylineSurface";

describe("Day Line surface", () => {
  it("makes Driver Studio the default", () => {
    expect(resolveDaylineSurface("", null)).toBe("studio");
    expect(resolveDaylineSurface("?goldlineFixture=NEUTRALIZE", null)).toBe("studio");
  });
  it("keeps the previous Day Line one reversible switch away", () => {
    expect(resolveDaylineSurface("?dayline=legacy", null)).toBe("legacy");
    expect(resolveDaylineSurface("", "legacy")).toBe("legacy");
    expect(resolveDaylineSurface("?dayline=studio", "legacy")).toBe("studio");
    expect(resolveDaylineSurface("?dayline=classic", null)).toBe("classic");
  });
  it("lets harness fixtures pin a surface without overriding an explicit choice", () => {
    expect(resolveDaylineSurface("", null, "legacy")).toBe("legacy");
    expect(resolveDaylineSurface("?dayline=studio", null, "legacy")).toBe("studio");
    expect(resolveDaylineSurface("", "studio", "legacy")).toBe("studio");
  });
});
