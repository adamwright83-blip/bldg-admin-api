import { describe, expect, it } from "vitest";
import {
  anchorDistance,
  parseCorridorAnchors,
  parseOcclusionZones,
  pointInZone,
} from "./corridorAnchors";

describe("parseCorridorAnchors", () => {
  it("parses a well-formed anchor list", () => {
    const anchors = parseCorridorAnchors({
      anchors: [
        {
          id: "cold_call_portal",
          type: "comms_portal",
          position: { progress: 0.52, lateral: 0.3 },
          labelRadius: 0.22,
          interactionRadius: 0.09,
          missionBinding: "cold_call_burst",
        },
      ],
    });
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.id).toBe("cold_call_portal");
  });

  it("drops malformed entries instead of throwing", () => {
    const anchors = parseCorridorAnchors({
      anchors: [{ id: "broken" }, null, "not-an-object"],
    });
    expect(anchors).toHaveLength(0);
  });

  it("degrades to an empty list for missing/corrupt payloads", () => {
    expect(parseCorridorAnchors(null)).toEqual([]);
    expect(parseCorridorAnchors({})).toEqual([]);
    expect(parseCorridorAnchors({ anchors: "nope" })).toEqual([]);
  });
});

describe("parseOcclusionZones", () => {
  it("parses well-formed zones", () => {
    const zones = parseOcclusionZones({
      zones: [
        {
          id: "fortress_gate_pillar_left",
          bounds: { progressMin: 0.74, progressMax: 0.82, lateralMin: -0.5, lateralMax: -0.14 },
          occluderZIndex: 5,
        },
      ],
    });
    expect(zones).toHaveLength(1);
  });
});

describe("anchorDistance", () => {
  it("is zero at the anchor's own position", () => {
    const anchor = {
      id: "a",
      type: "comms_portal" as const,
      position: { progress: 0.5, lateral: 0.2 },
      labelRadius: 0.2,
      interactionRadius: 0.05,
      missionBinding: "x",
    };
    expect(anchorDistance(anchor, 0.5, 0.2)).toBe(0);
    expect(anchorDistance(anchor, 0, 0)).toBeGreaterThan(0);
  });
});

describe("pointInZone", () => {
  const zone = {
    id: "z",
    bounds: { progressMin: 0.74, progressMax: 0.82, lateralMin: -0.5, lateralMax: -0.14 },
    occluderZIndex: 5,
  };

  it("is true inside the bounds and false outside", () => {
    expect(pointInZone(zone, 0.78, -0.3)).toBe(true);
    expect(pointInZone(zone, 0.5, -0.3)).toBe(false);
    expect(pointInZone(zone, 0.78, 0.3)).toBe(false);
  });
});
