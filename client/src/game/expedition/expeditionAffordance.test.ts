import { describe, expect, it } from "vitest";
import {
  AFFORDANCE_STATES,
  LINE_TARGET_INTENSITY,
  climaxSealAffordanceState,
  forkBranchAffordanceState,
  lineTargetAffordanceState,
  relicAffordanceState,
} from "./expeditionAffordance";

describe("interactable-affordance contract (§PR77 Part 5 / 21D)", () => {
  it("exposes exactly the four canonical states, nothing else", () => {
    expect(AFFORDANCE_STATES).toEqual(["at-rest", "relevant", "locked", "resolved"]);
  });

  describe("line target props (grapple rings, hazards)", () => {
    it("is at-rest outside of aiming", () => {
      expect(
        lineTargetAffordanceState({ id: "ring_1", lockedTargetId: null, aiming: false })
      ).toBe("at-rest");
    });

    it("is relevant while aiming without a lock on this id", () => {
      expect(
        lineTargetAffordanceState({ id: "ring_1", lockedTargetId: null, aiming: true })
      ).toBe("relevant");
      expect(
        lineTargetAffordanceState({ id: "ring_1", lockedTargetId: "ring_2", aiming: true })
      ).toBe("relevant");
    });

    it("is locked once this id is the one locked, even if aiming somehow reads false", () => {
      expect(
        lineTargetAffordanceState({ id: "ring_1", lockedTargetId: "ring_1", aiming: true })
      ).toBe("locked");
      expect(
        lineTargetAffordanceState({ id: "ring_1", lockedTargetId: "ring_1", aiming: false })
      ).toBe("locked");
    });

    it("every state maps to a defined intensity", () => {
      for (const state of AFFORDANCE_STATES) {
        expect(typeof LINE_TARGET_INTENSITY[state]).toBe("number");
      }
      expect(LINE_TARGET_INTENSITY.locked).toBeGreaterThan(LINE_TARGET_INTENSITY.relevant);
      expect(LINE_TARGET_INTENSITY.relevant).toBeGreaterThan(LINE_TARGET_INTENSITY["at-rest"]);
    });
  });

  describe("relic plinths", () => {
    it("is relevant before any relic is chosen", () => {
      expect(relicAffordanceState({ taken: false, decided: false })).toBe("relevant");
    });

    it("is locked for the plinth that was taken", () => {
      expect(relicAffordanceState({ taken: true, decided: true })).toBe("locked");
    });

    it("is resolved for a plinth that was not the one taken", () => {
      expect(relicAffordanceState({ taken: false, decided: true })).toBe("resolved");
    });
  });

  describe("fork branches", () => {
    it("is at-rest for the branch not taken once a choice is made", () => {
      expect(
        forkBranchAffordanceState({ branchTaken: false, undecided: false, scarred: false })
      ).toBe("at-rest");
    });

    it("is relevant while the choice is undecided", () => {
      expect(
        forkBranchAffordanceState({ branchTaken: false, undecided: true, scarred: false })
      ).toBe("relevant");
    });

    it("is locked for the branch actually taken", () => {
      expect(
        forkBranchAffordanceState({ branchTaken: true, undecided: false, scarred: false })
      ).toBe("locked");
    });

    it("is resolved on the Scarred Route regardless of the other flags", () => {
      expect(
        forkBranchAffordanceState({ branchTaken: true, undecided: true, scarred: true })
      ).toBe("resolved");
    });
  });

  describe("climax seal", () => {
    it("is locked while the barrier is up", () => {
      expect(climaxSealAffordanceState({ up: true })).toBe("locked");
    });

    it("is resolved once the barrier has come down", () => {
      expect(climaxSealAffordanceState({ up: false })).toBe("resolved");
    });
  });
});
