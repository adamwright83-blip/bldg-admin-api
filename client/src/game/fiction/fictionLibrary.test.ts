import { describe, expect, it } from "vitest";
import { FICTION_TEMPLATE_REGISTRY } from "./templateRegistry";
import { WORLD_HOLDS_BREATH_TEMPLATE } from "./templates/worldHoldsBreathTemplate";
import { HELD_BREATH_TEMPLATE } from "./templates/heldBreathTemplate";
import { GHOST_ECHO_TEMPLATE } from "./templates/ghostEchoTemplate";
import { NEUTRALIZE_TEMPLATE } from "./templates/neutralizeTemplate";

describe("expanded fiction template library", () => {
  it("ships neutralize plus at least six additional action treatments", () => {
    expect(FICTION_TEMPLATE_REGISTRY.some(item => item.id === "neutralize-v1")).toBe(true);
    expect(FICTION_TEMPLATE_REGISTRY.length).toBeGreaterThanOrEqual(7);
    const ids = FICTION_TEMPLATE_REGISTRY.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps neutralize as the only PLACE_ITEM_AT_LOCATIONS treatment", () => {
    const place = FICTION_TEMPLATE_REGISTRY.filter(item =>
      item.compatibleGrammarKinds.includes("PLACE_ITEM_AT_LOCATIONS")
    );
    expect(place.map(item => item.id)).toEqual(["neutralize-v1"]);
  });

  it("never puts a timer on a human conversation", () => {
    for (const template of [
      WORLD_HOLDS_BREATH_TEMPLATE,
      HELD_BREATH_TEMPLATE,
      GHOST_ECHO_TEMPLATE,
    ]) {
      expect(template.timerEligible).toBe(false);
      expect(template.humanInteractionCompatible).toBe(true);
    }
    expect(NEUTRALIZE_TEMPLATE.humanInteractionCompatible).toBe(false);
  });
});
