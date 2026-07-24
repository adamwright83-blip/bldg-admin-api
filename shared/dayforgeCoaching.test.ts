import { describe, expect, it } from "vitest";
import {
  claimMayBePresentedAsVerified,
  claimMayDriveDirectInstruction,
  type DayforgeCoachingClaim,
} from "./dayforgeCoaching";

function claim(overrides: Partial<DayforgeCoachingClaim>): DayforgeCoachingClaim {
  return {
    key: "recommended_role",
    displayValue: "Director of Rooms",
    provenance: "general_industry_guidance",
    confidence: "high",
    evidenceReferenceId: null,
    capturedAt: "2026-07-23T00:00:00.000Z",
    safeForDirectInstruction: true,
    grounded: true,
    ...overrides,
  };
}

describe("DayForge coaching claim truth", () => {
  it("allows useful general-industry role guidance as a direct instruction", () => {
    expect(claimMayDriveDirectInstruction(claim({}))).toBe(true);
    expect(claimMayBePresentedAsVerified(claim({}))).toBe(false);
  });

  it("requires evidence before an account-specific fact is called verified", () => {
    expect(
      claimMayBePresentedAsVerified(
        claim({ provenance: "provider_sourced", evidenceReferenceId: null })
      )
    ).toBe(false);
    expect(
      claimMayBePresentedAsVerified(
        claim({
          provenance: "provider_sourced",
          evidenceReferenceId: "provider-result:hotel-42",
        })
      )
    ).toBe(true);
  });

  it("blocks unsupported model inference from direct field instruction", () => {
    expect(
      claimMayDriveDirectInstruction(
        claim({
          key: "decision_maker_name",
          displayValue: "Jane Smith",
          provenance: "model_inference",
          safeForDirectInstruction: true,
        })
      )
    ).toBe(false);
  });

  it("does not trust a forged provenance label before server grounding", () => {
    expect(
      claimMayBePresentedAsVerified(
        claim({
          provenance: "provider_sourced",
          evidenceReferenceId: "made-up-reference",
          grounded: false,
        })
      )
    ).toBe(false);
  });
});
