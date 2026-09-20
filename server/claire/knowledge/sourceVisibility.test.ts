import { describe, expect, it } from "vitest";
import {
  isOperatorVisibleAccount,
  isOperatorVisibleFollowUp,
  isOperatorVisibleMissionSnapshot,
  sourceVisibilityForAccount,
} from "./sourceVisibility";

describe("operator-visible business provenance", () => {
  it("keeps real commercial accounts", () => {
    expect(
      isOperatorVisibleAccount({
        name: "The Louise",
        accountType: "luxury_hotel",
        providerName: "greystar",
        identityKey: "acct:louise",
      })
    ).toBe(true);
  });

  it("hides verification-writer accounts by provider, type, identity, and write-path label", () => {
    expect(sourceVisibilityForAccount({ providerName: "production-verifier", name: "Anything" })).toBe("test");
    expect(sourceVisibilityForAccount({ accountType: "property_management_test", name: "Anything" })).toBe("test");
    expect(sourceVisibilityForAccount({ identityKey: "sandbox:run", name: "Anything" })).toBe("test");
    expect(
      sourceVisibilityForAccount({
        name: "CODEX PROPERTY MISSION E2E abcd1234 — SAFE TO ARCHIVE",
        accountType: "hotel",
      })
    ).toBe("test");
  });

  it("does not hide a real account just because a follow-up note mentions verification", () => {
    expect(
      isOperatorVisibleFollowUp({
        account: { name: "The Louise", accountType: "luxury_hotel", providerName: "greystar" },
      })
    ).toBe(true);
  });

  it("hides a mission whose opportunity evidence is stamped fixture:true", () => {
    expect(
      isOperatorVisibleMissionSnapshot({
        name: "CODEX PROPERTY MISSION E2E x — SAFE TO ARCHIVE",
        accountType: "property_management_test",
        providerName: "production-verifier",
        evidence: [{ fixture: true }],
      })
    ).toBe(false);
  });
});
