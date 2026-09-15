import { describe, expect, it } from "vitest";
import { CLAIRE_CANON } from "./characterDefinition";
import { eligibleClaireCanonFacts, retrieveEligibleClaireCanon } from "./canonStore";

describe("I/J/K/L — canon retrieval gating", () => {
  it("I — core canon is retrievable at Tier 0 outside field mode", () => {
    const facts = eligibleClaireCanonFacts({
      disclosureTier: 0,
      mode: "casual",
      fieldOverride: false,
    });
    expect(facts).toContain("Claire is 34.");
  });

  it("K — permanently private fragments never appear regardless of tier or topic request", () => {
    const facts = eligibleClaireCanonFacts({
      disclosureTier: 3,
      mode: "casual",
      fieldOverride: false,
      explicitlyRequestedTopic: "father",
    });
    expect(facts.join(" ")).not.toMatch(/last exchange/i);
    const permanentlyPrivateIds = CLAIRE_CANON.filter(
      fragment => fragment.accessClass === "permanently_private"
    ).map(fragment => fragment.id);
    const retrieved = retrieveEligibleClaireCanon({
      disclosureTier: 3,
      mode: "casual",
      fieldOverride: false,
      explicitlyRequestedTopic: "father",
    }).map(fragment => fragment.id);
    for (const id of permanentlyPrivateIds) {
      expect(retrieved).not.toContain(id);
    }
  });

  it("L — tier gating happens before retrieval: a Tier 0 operator never sees tier_gated canon", () => {
    const facts = eligibleClaireCanonFacts({
      disclosureTier: 0,
      mode: "casual",
      fieldOverride: false,
    });
    expect(facts.join(" ")).not.toMatch(/father/i);
    expect(facts.join(" ")).not.toMatch(/six-year/i);
  });

  it("never_volunteer canon requires an exact explicit topic match", () => {
    const withoutRequest = eligibleClaireCanonFacts({
      disclosureTier: 3,
      mode: "casual",
      fieldOverride: false,
    });
    expect(withoutRequest.join(" ")).not.toMatch(/competence feels measurable/i);

    const withWrongTopic = eligibleClaireCanonFacts({
      disclosureTier: 3,
      mode: "casual",
      fieldOverride: false,
      explicitlyRequestedTopic: "past_relationship",
    });
    expect(withWrongTopic.join(" ")).not.toMatch(/competence feels measurable/i);

    const withRightTopic = eligibleClaireCanonFacts({
      disclosureTier: 3,
      mode: "casual",
      fieldOverride: false,
      explicitlyRequestedTopic: "central_wound",
    });
    expect(withRightTopic.join(" ")).toMatch(/competence feels measurable/i);
  });

  it("P — field override suppresses all personal canon, even at Tier 3", () => {
    const facts = eligibleClaireCanonFacts({
      disclosureTier: 3,
      mode: "pre_drive",
      fieldOverride: true,
    });
    // Only accessClass "core" fragments ever survive field mode, regardless
    // of tier — no tier_gated/never_volunteer personal canon leaks through.
    expect(facts.length).toBe(
      CLAIRE_CANON.filter(fragment => fragment.accessClass === "core").length
    );
    expect(facts).toContain("Claire is 34.");
    expect(facts.join(" ")).not.toMatch(/childhood/i);
    expect(facts.join(" ")).not.toMatch(/six-year/i);
  });

  it("explicit personal question in field mode retrieves only the matching eligible topic", () => {
    const facts = eligibleClaireCanonFacts({
      disclosureTier: 3,
      mode: "pre_drive",
      fieldOverride: true,
      explicitlyRequestedTopic: "father",
    });
    expect(facts.join(" ")).toMatch(/father/i);
    expect(facts.join(" ")).not.toMatch(/six-year/i);
    expect(facts.join(" ")).not.toMatch(/last exchange/i);
  });
});
