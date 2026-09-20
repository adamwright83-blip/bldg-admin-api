import { describe, expect, it } from "vitest";
import {
  isAuthorizedProductionOperator,
  isOperatorVisibleAccount,
  isOperatorVisibleDerivedWork,
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

  it("hides verification-writer accounts by provider, type, and identity — not by display name", () => {
    expect(sourceVisibilityForAccount({ providerName: "production-verifier", name: "Anything" })).toBe("test");
    expect(sourceVisibilityForAccount({ accountType: "property_management_test", name: "Anything" })).toBe("test");
    expect(sourceVisibilityForAccount({ identityKey: "sandbox:run", name: "Anything" })).toBe("test");
    expect(
      sourceVisibilityForAccount({
        name: "CODEX PROPERTY MISSION E2E abcd1234 — SAFE TO ARCHIVE",
        accountType: "hotel",
        providerName: "greystar",
      })
    ).toBe("operator");
  });

  it("does not hide a real account just because a follow-up note mentions verification", () => {
    expect(
      isOperatorVisibleFollowUp({
        account: { name: "The Louise", accountType: "luxury_hotel", providerName: "greystar" },
      })
    ).toBe(true);
  });

  it("hides a mission whose opportunity evidence is stamped fixture:true even when the name looks real", () => {
    expect(
      isOperatorVisibleMissionSnapshot({
        name: "The Louise",
        accountType: "luxury_hotel",
        providerName: "production-verifier",
        evidence: [{ fixture: true }],
      })
    ).toBe(false);
  });

  it("uses isAuthorizedProductionOperator for unstamped sales follow-up derived work", () => {
    expect(isAuthorizedProductionOperator({ tenantId: "default", operatorUserId: "adam-admin" })).toBe(true);
    expect(
      isOperatorVisibleDerivedWork(
        { claireProactive: true, sourceKind: "sales_follow_up" },
        { tenantId: "default", operatorUserId: "adam-admin" }
      )
    ).toBe(false);
    expect(
      isOperatorVisibleDerivedWork(
        { claireProactive: true, sourceKind: "dormant_recovery" },
        { tenantId: "default", operatorUserId: "adam-admin" }
      )
    ).toBe(true);
    expect(
      isOperatorVisibleDerivedWork(
        {
          claireProactive: true,
          sourceKind: "sales_follow_up",
          accountProvenance: { providerName: "greystar", accountType: "luxury_hotel", name: "The Louise" },
        },
        { tenantId: "default", operatorUserId: "adam-admin" }
      )
    ).toBe(true);
    expect(
      isOperatorVisibleDerivedWork(
        {
          claireProactive: true,
          sourceKind: "sales_follow_up",
          accountProvenance: { providerName: "production-verifier", accountType: "property_management_test" },
        },
        { tenantId: "default", operatorUserId: "adam-admin" }
      )
    ).toBe(false);
  });
});
