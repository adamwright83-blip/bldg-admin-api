import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveWorldMutation,
  isSettledMissionState,
  type AuthoritativeCompetitorSignal,
} from "./worldMutationDescriptor";

const REAL_COMPETITOR: AuthoritativeCompetitorSignal = {
  source: "verified_loss_reason",
  evidenceReference: "mission:411:loss_reason",
};

describe("deriveWorldMutation", () => {
  it("CAPTURED settles the route and illuminates the destination", () => {
    const mutation = deriveWorldMutation({ missionState: "captured" });
    expect(mutation.routeTreatment).toBe("stable");
    expect(mutation.destinationTreatment).toBe("illuminated");
    expect(mutation.isSettled).toBe(true);
  });

  it("CONTESTED fractures the route and guards the destination", () => {
    const mutation = deriveWorldMutation({ missionState: "contested" });
    expect(mutation.routeTreatment).toBe("fractured");
    expect(mutation.destinationTreatment).toBe("guarded");
    expect(mutation.isSettled).toBe(false);
  });

  it("CLOSED recedes the route and leaves the destination dormant", () => {
    const mutation = deriveWorldMutation({ missionState: "closed" });
    expect(mutation.routeTreatment).toBe("receding");
    expect(mutation.destinationTreatment).toBe("dormant");
    expect(mutation.affordance).toBe("none");
  });

  it("recovery states energize a recovery path with a recover affordance", () => {
    for (const missionState of ["recovery_available", "recovery_active"] as const) {
      const mutation = deriveWorldMutation({ missionState });
      expect(mutation.routeTreatment).toBe("recovery");
      expect(mutation.affordance).toBe("recover");
    }
  });

  it("distinguishes settled resolutions from mid-pursuit states", () => {
    expect(isSettledMissionState("captured")).toBe(true);
    expect(isSettledMissionState("closed")).toBe(true);
    expect(isSettledMissionState("contested")).toBe(false);
    expect(isSettledMissionState("available")).toBe(false);
  });

  describe("a rival is never invented for visual drama", () => {
    it("CONTESTED alone does NOT produce rival presence", () => {
      const mutation = deriveWorldMutation({ missionState: "contested" });
      expect(mutation.showsRivalPresence).toBe(false);
    });

    it("CONTESTED with an explicit authoritative competitor signal does", () => {
      const mutation = deriveWorldMutation({
        missionState: "contested",
        competitorSignal: REAL_COMPETITOR,
      });
      expect(mutation.showsRivalPresence).toBe(true);
    });

    it("treats an explicitly null competitor signal as 'no rival known'", () => {
      const mutation = deriveWorldMutation({
        missionState: "contested",
        competitorSignal: null,
      });
      expect(mutation.showsRivalPresence).toBe(false);
    });

    it("never shows a rival on a captured destination even if evidence is passed", () => {
      const mutation = deriveWorldMutation({
        missionState: "captured",
        competitorSignal: REAL_COMPETITOR,
      });
      expect(mutation.showsRivalPresence).toBe(false);
    });

    it("shows no rival for any ordinary in-progress state", () => {
      for (const missionState of ["available", "approaching", "active", "watching"] as const) {
        expect(
          deriveWorldMutation({ missionState, competitorSignal: REAL_COMPETITOR })
            .showsRivalPresence
        ).toBe(false);
      }
    });
  });

  describe("game performance cannot fabricate business truth", () => {
    it("accepts no arcade/score/timing input at all — structurally, not by convention", () => {
      const source = readFileSync(resolve(__dirname, "./worldMutationDescriptor.ts"), "utf8");
      const inputType = source.slice(
        source.indexOf("export type WorldMutationInput"),
        source.indexOf("export function deriveWorldMutation")
      );
      for (const forbidden of [
        "score",
        "combo",
        "accuracy",
        "timing",
        "weapon",
        "encounterResult",
        "streak",
        "perfect",
      ]) {
        expect(inputType.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    });

    it("produces an identical descriptor no matter what else the caller knows", () => {
      // There is no channel through which a "perfect run" could differ from a
      // failed one: the same authoritative state is the only determinant.
      const a = deriveWorldMutation({ missionState: "available" });
      const b = deriveWorldMutation({ missionState: "available" });
      expect(a).toEqual(b);
      expect(a.state).toBe("available");
      expect(a.isSettled).toBe(false);
    });

    it("never returns a captured/settled world for a non-captured authoritative state", () => {
      for (const missionState of [
        "available",
        "approaching",
        "active",
        "contested",
        "recovery_available",
        "recovery_active",
        "watching",
      ] as const) {
        const mutation = deriveWorldMutation({ missionState });
        expect(mutation.destinationTreatment).not.toBe("illuminated");
      }
    });
  });

  it("keeps corridor-specific rendering out of the semantic layer", () => {
    const source = readFileSync(resolve(__dirname, "./worldMutationDescriptor.ts"), "utf8");
    // No hardcoded colours/tints: each corridor decides how to express the
    // semantics so a future corridor can render CAPTURED differently.
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(source).not.toMatch(/0x[0-9a-fA-F]{6}\b/);
  });
});
