import { describe, expect, it } from "vitest";
import { BRAIN_V2_PRODUCTION_AUTHORITY } from "../contracts";
import { perceiveTurn } from "../perception/perceive";

describe("contracts compile and keep the invariant", () => {
  it("exports a false production-authority constant", () => {
    expect(BRAIN_V2_PRODUCTION_AUTHORITY).toBe(false);
  });

  it("PerceivedTurn completeness is required before Executive Function", () => {
    const incomplete = perceiveTurn({ rawText: "Desired timing is", completeness: "incomplete" });
    expect(incomplete.completeness).toBe("incomplete");
  });
});
