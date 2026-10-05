import { describe, expect, it } from "vitest";
import { claireIdentityClaimViolation, formatClaireIdentityAuthority, isExplicitClaireIdentityTurn, loadClaireIdentityTruth, renderClaireIdentityAnswer } from "./identityTruth";

describe("Claire identity truth kernel", () => {
  it("loads the configured platform and account identities", async () => {
    const truth = await loadClaireIdentityTruth("default");
    expect(truth.platform.productName).toBe("JOYSTICK");
    expect(truth.platform.gameName).toBe("Goldline");
    expect(truth.platform.claireRole).toContain("game master");
    expect(truth.tenant.businesses.map(item => item.brandName)).toEqual(["Laundry Butler", "Laundry Farm"]);
    expect(renderClaireIdentityAnswer("business_name", truth)).toBe("The businesses on this account are Laundry Butler and Laundry Farm.");
  });

  it("makes identity higher authority than conversation", async () => {
    const truth = await loadClaireIdentityTruth("default");
    const prompt = formatClaireIdentityAuthority(truth);
    expect(prompt).toContain("higher authority than conversation");
    expect(prompt).toContain("JOYSTICK is the playable operating system");
    expect(prompt).toContain("Laundry Butler");
    expect(prompt).toContain("Laundry Farm");
  });

  it("rejects a reserved product name presented as the operating business", async () => {
    const truth = await loadClaireIdentityTruth("default");
    expect(claireIdentityClaimViolation("Your business is Goldline Laundry.", truth)).not.toBeNull();
    expect(claireIdentityClaimViolation("Your business is Seaweed Burgers.", truth)).toBe("unregistered_business_identity_claim");
    expect(claireIdentityClaimViolation("This is Adam with Laundry Butler.", truth)).toBeNull();
  });

  it("renders Goldline from platform authority", async () => {
    const truth = await loadClaireIdentityTruth("default");
    expect(renderClaireIdentityAnswer("goldline", truth)).toContain("Goldline is a game inside JOYSTICK");
  });

  it("lets identity own only explicit identity turns", () => {
    expect(isExplicitClaireIdentityTurn("business_name", "What is my business name?")).toBe(true);
    expect(isExplicitClaireIdentityTurn("business_name", "What businesses are on this account?")).toBe(true);
    expect(isExplicitClaireIdentityTurn("business_name", "My business is Seaweed Burgers.")).toBe(true);
    expect(isExplicitClaireIdentityTurn("business_name", "How much did Laundry Farm make in September?")).toBe(false);
    expect(isExplicitClaireIdentityTurn("claire_role", "What's your job?")).toBe(true);
    expect(isExplicitClaireIdentityTurn("claire_role", "Your job was to walk me through the week.")).toBe(false);
  });
});
