/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { describe, expect, it } from "vitest";
import { percentage } from "./legacyLegacyDayforgeProofService";
describe("DayForge proof metrics", () => {
  it("reports honest zero and bounded percentages", () => {
    expect(percentage(0, 0)).toBe(0);
    expect(percentage(3, 4)).toBe(75);
  });
});
