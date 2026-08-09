import { describe, expect, it } from "vitest";
import { deriveBusinessStage } from "./businessWorldService";

describe("business stage", () => {
  it("derives team state from real active non-owner membership", () => {
    expect(deriveBusinessStage({ activeNonOwnerMembers: 1 })).toBe("TEAM");
    expect(deriveBusinessStage({ activeNonOwnerMembers: 0 })).toBe("SOLO");
  });
  it("does not allow motivational state to unlock a hire", () => {
    expect(deriveBusinessStage({ activeNonOwnerMembers: 0, sustainableSolo: true })).toBe("SUSTAINABLE_SOLO");
    expect(deriveBusinessStage({ activeNonOwnerMembers: 0, firstHireReady: true })).toBe("FIRST_HIRE_READY");
  });
});
