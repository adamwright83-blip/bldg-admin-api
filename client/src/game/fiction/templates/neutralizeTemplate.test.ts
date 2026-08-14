import { describe, expect, it } from "vitest";
import { NEUTRALIZE_TEMPLATE } from "./neutralizeTemplate";
import type { ActionGrammar } from "../../../../../shared/actionGrammar";

const GRAMMAR: ActionGrammar = {
  kind: "PLACE_ITEM_AT_LOCATIONS",
  businessActionId: "route:1..25",
  occurrenceId: null,
  sourceType: "field_move",
  count: 25,
  locations: Array.from({ length: 25 }, (_, i) => `Stop ${i}`),
  channel: "in_person",
  requiresTravel: true,
  requiresDriving: false,
  timerSafe: true,
  sensitiveConversation: false,
};

/** Fiction Integrity Copy Gate (section 9 of the mission-fiction run). */
describe("NEUTRALIZE fiction integrity", () => {
  it("has a fiction-first title", () => {
    expect(NEUTRALIZE_TEMPLATE.title).toBe("NEUTRALIZE");
  });

  it("briefing establishes fictional stakes with the required device/sector framing", () => {
    const briefing = NEUTRALIZE_TEMPLATE.briefing(GRAMMAR);
    expect(briefing).toContain("device has compromised this sector");
  });

  it("physical instruction is operationally unambiguous about the real count and route", () => {
    const instruction = NEUTRALIZE_TEMPLATE.physicalInstruction(GRAMMAR);
    expect(instruction).toContain("25");
    expect(instruction.toLowerCase()).toContain("commercial locations");
    expect(instruction.toLowerCase()).toContain("record the real visit result");
    for (const fabricated of ["tag", "front-door", "door hanger", "kit"]) {
      expect(instruction.toLowerCase()).not.toContain(fabricated);
    }
  });

  it("physical instruction always states the REAL count from grammar, never a fixed number", () => {
    const smaller = { ...GRAMMAR, count: 3, locations: ["a", "b", "c"] };
    expect(NEUTRALIZE_TEMPLATE.physicalInstruction(smaller)).toContain("3");
    expect(NEUTRALIZE_TEMPLATE.physicalInstruction(smaller)).not.toContain(
      "25"
    );
  });

  it("title and briefing never use dashboard/CRM/business-chore language", () => {
    const briefing = NEUTRALIZE_TEMPLATE.briefing(GRAMMAR);
    const bannedPhrases = [
      "distribute 25 flyers",
      "deliver door hangers",
      "do laundry work",
      "marketing task",
      "pause the mission",
      "pause game",
    ];
    const haystack = `${NEUTRALIZE_TEMPLATE.title} ${briefing}`.toLowerCase();
    for (const phrase of bannedPhrases) {
      expect(haystack).not.toContain(phrase);
    }
  });

  it("failure treatment never claims the real route/business action is lost", () => {
    expect(NEUTRALIZE_TEMPLATE.failureTreatment.detail.toLowerCase()).toContain(
      "does not affect the real route"
    );
  });

  it("can bind to a driving route while its safe-walking countdown pauses at runtime", () => {
    expect(NEUTRALIZE_TEMPLATE.drivingCompatible).toBe(true);
    expect(NEUTRALIZE_TEMPLATE.attentionSafetyClass).toBe("safe_walking");
  });

  it("is not compatible with sensitive human conversation — it never dramatizes a real call", () => {
    expect(NEUTRALIZE_TEMPLATE.humanInteractionCompatible).toBe(false);
  });

  it("is only compatible with PLACE_ITEM_AT_LOCATIONS", () => {
    expect(NEUTRALIZE_TEMPLATE.compatibleGrammarKinds).toEqual([
      "PLACE_ITEM_AT_LOCATIONS",
    ]);
  });
});
