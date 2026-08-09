import { describe, expect, it } from "vitest";
import {
  anchorIsInsideRegion,
  GOLDLINE_ROUTE_ANCHORS,
  goldlineAnchorStyle,
  LARA_EXCLUSION_REGION,
} from "./goldlineRouteAnchors";

describe("Goldline semantic route anchors", () => {
  it("supports all four visible route stops with named artwork landmarks", () => {
    expect(GOLDLINE_ROUTE_ANCHORS).toHaveLength(4);
    expect(GOLDLINE_ROUTE_ANCHORS.map(anchor => anchor.id)).toEqual([
      "lower-gold-reliquary",
      "central-cyan-reliquary",
      "mid-river-gold-temple",
      "upper-river-landing",
    ]);
  });

  it("keeps the first destination anchor outside Lara's exclusion region", () => {
    expect(
      anchorIsInsideRegion(GOLDLINE_ROUTE_ANCHORS[0], LARA_EXCLUSION_REGION)
    ).toBe(false);
    expect(GOLDLINE_ROUTE_ANCHORS[0].labelPlacement).toBe("above-right");
  });

  it("provides one shared coordinate style for the route node and card", () => {
    const anchor = GOLDLINE_ROUTE_ANCHORS[0];
    expect(goldlineAnchorStyle(anchor)).toEqual({
      "--goldline-anchor-x": "68.5%",
      "--goldline-anchor-y": "71%",
    });
  });
});
