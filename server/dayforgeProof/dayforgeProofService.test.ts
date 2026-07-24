import { describe, expect, it } from "vitest";
import { percentage } from "./dayforgeProofService";
describe("DayForge proof metrics", () => {
  it("reports honest zero and bounded percentages", () => {
    expect(percentage(0, 0)).toBe(0);
    expect(percentage(3, 4)).toBe(75);
  });
});
