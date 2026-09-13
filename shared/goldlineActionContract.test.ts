import { describe, expect, it } from "vitest";
import {
  assertNoSilentAuthorityEscalation,
  canRestrictAuthorityWithoutApproval,
  defaultAuthorityForGoldlineAction,
} from "./goldlineActionContract";

describe("Goldline action authority contract", () => {
  it("assigns conservative defaults to consequential actions", () => {
    expect(defaultAuthorityForGoldlineAction("VISIT")).toBe("HUMAN_EXECUTION");
    expect(defaultAuthorityForGoldlineAction("CALL")).toBe("HUMAN_EXECUTION");
    expect(defaultAuthorityForGoldlineAction("RECOVER")).toBe("APPROVAL_REQUIRED");
    expect(defaultAuthorityForGoldlineAction("FOLLOW_UP")).toBe("APPROVAL_REQUIRED");
    expect(defaultAuthorityForGoldlineAction("WAIT")).toBe("AUTO");
  });

  it("may become more restrictive without approval", () => {
    expect(
      canRestrictAuthorityWithoutApproval("AUTO", "APPROVAL_REQUIRED")
    ).toBe(true);
    expect(
      canRestrictAuthorityWithoutApproval(
        "APPROVAL_REQUIRED",
        "HUMAN_EXECUTION"
      )
    ).toBe(true);
  });

  it("never silently increases autonomy", () => {
    expect(() =>
      assertNoSilentAuthorityEscalation("APPROVAL_REQUIRED", "AUTO_INFORM")
    ).toThrow(/cannot silently escalate/);
    expect(() =>
      assertNoSilentAuthorityEscalation("HUMAN_EXECUTION", "AUTO")
    ).toThrow(/cannot silently escalate/);
  });
});
