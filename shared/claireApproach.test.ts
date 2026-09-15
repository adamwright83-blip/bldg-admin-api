import { describe, expect, it } from "vitest";
import {
  OPTIONAL_PLAY_CANNOT,
  approachReachedDestination,
  endOfAuthoredApproachCopy,
  nextApproachCorridor,
  resolveApproachRoute,
} from "./claireApproach";

describe("approach corridors", () => {
  it("does not invent an approach without an authoritative destination", () => {
    expect(resolveApproachRoute({})).toBeNull();
    expect(nextApproachCorridor(null, "corridor_01")).toBeNull();
  });

  it("sequences authored corridors toward a real campaign host", () => {
    const route = resolveApproachRoute({
      campaignHost: "guardian_encounter",
      chapterId: "colosseum-1",
    });
    expect(route?.corridorSequence).toEqual(["corridor_01", "corridor_02"]);
    expect(nextApproachCorridor(route, "corridor_01")).toBe("corridor_02");
    expect(
      approachReachedDestination({
        route,
        currentCorridorId: "corridor_02",
        atExitBand: true,
      })
    ).toBe(true);
  });

  it("does not tell the player the world is unwritten when there is simply no destination", () => {
    const copy = endOfAuthoredApproachCopy({
      route: null,
      atExitBand: true,
      currentCorridorId: "corridor_01",
    });
    expect(copy).toMatch(/optional play/i);
    expect(copy).not.toMatch(/unwritten/i);
  });

  it("keeps optional play from manufacturing business truth", () => {
    expect(OPTIONAL_PLAY_CANNOT).toContain("create_revenue");
    expect(OPTIONAL_PLAY_CANNOT).toContain("mark_visits_complete");
  });
});
