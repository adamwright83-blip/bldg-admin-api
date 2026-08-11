import { describe, expect, it } from "vitest";
import { landmarkForMission } from "./worldSemantics";

describe("landmarkForMission", () => {
  it("gives captured missions a distinct landmark from active ones", () => {
    const captured = landmarkForMission({ visualState: "captured", archetype: "ANCHOR" });
    const active = landmarkForMission({ visualState: "active", archetype: "ANCHOR" });
    expect(captured.family).not.toBe(active.family);
    expect(captured.cssClass).not.toBe(active.cssClass);
  });

  it("gives recovery a landmark distinct from the normal contested path", () => {
    const recovery = landmarkForMission({ visualState: "recovery_active", archetype: "GHOST" });
    const contested = landmarkForMission({ visualState: "contested", archetype: "GHOST" });
    expect(recovery.family).toBe("recovery_path");
    expect(contested.family).not.toBe("recovery_path");
  });

  it("maps each archetype to a mechanically-distinct landmark family", () => {
    const families = new Set(
      (["ANCHOR", "GATEKEEPER", "GHOST", "STALLER"] as const).map(
        archetype => landmarkForMission({ visualState: "active", archetype }).family
      )
    );
    expect(families.size).toBe(4);
  });

  it("marks a Scout-sourced mission distinctly when not otherwise terminal", () => {
    const scout = landmarkForMission({ visualState: "available", isScoutSourced: true });
    expect(scout.family).toBe("scout_chamber");
  });

  it("prioritizes terminal state over Scout sourcing", () => {
    const captured = landmarkForMission({
      visualState: "captured",
      isScoutSourced: true,
      archetype: "ANCHOR",
    });
    expect(captured.family).toBe("captured_banner");
  });

  it("closed is visually distinct from captured", () => {
    const closed = landmarkForMission({ visualState: "closed", archetype: "ANCHOR" });
    const captured = landmarkForMission({ visualState: "captured", archetype: "ANCHOR" });
    expect(closed.cssClass).not.toBe(captured.cssClass);
    expect(closed.label).toBe("CLOSED");
  });

  it("defaults to the stronghold family when archetype is unknown", () => {
    expect(landmarkForMission({ visualState: "available" }).family).toBe("stronghold");
  });
});
