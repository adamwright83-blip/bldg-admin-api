import { describe, expect, it } from "vitest";
import { applyFrontierCap, FRONTIER_VISIBLE_CAP } from "./lanternFrontierCap";
import { frontierKindForTerritory, lostGroundKindForTerritory } from "./lanternFrontierPresentation";

const c = (territoryId: string, kind: "lost_ground" | "opportunity", authoredRank: number, activeCampaign = false) => ({
  territoryId,
  kind,
  authoredRank,
  activeCampaign,
});

describe("applyFrontierCap", () => {
  it("shows at most five objects and quiets the rest", () => {
    const out = applyFrontierCap([
      c("a", "opportunity", 0),
      c("b", "opportunity", 1),
      c("c", "opportunity", 2),
      c("d", "opportunity", 3),
      c("e", "opportunity", 4),
      c("f", "opportunity", 5),
      c("g", "opportunity", 6),
    ]);
    expect(out.filter(o => o.visibility === "object")).toHaveLength(FRONTIER_VISIBLE_CAP);
    expect(out.find(o => o.territoryId === "g")?.visibility).toBe("quiet");
  });

  it("an active campaign always keeps its object, then lost ground, then authored order", () => {
    const out = applyFrontierCap(
      [
        c("opp-early", "opportunity", 0),
        c("opp-late", "opportunity", 9),
        c("lost", "lost_ground", 5),
        c("campaign", "opportunity", 8, true),
      ],
      2
    );
    const visible = out.filter(o => o.visibility === "object").map(o => o.territoryId);
    expect([...visible].sort()).toEqual(["campaign", "lost"]);
    expect(visible).not.toContain("opp-late");
    expect(visible).not.toContain("opp-early");
  });

  it("preserves input order and never drops a territory", () => {
    const input = [c("z", "opportunity", 2), c("y", "lost_ground", 1), c("x", "opportunity", 0)];
    expect(applyFrontierCap(input, 1).map(o => o.territoryId)).toEqual(["z", "y", "x"]);
  });
});

describe("lost ground has its own object", () => {
  it("never recycles the prize that already left", () => {
    for (const id of ["west-hollywood", "east-hollywood", "echo-park", "arts-district", "silver-lake"]) {
      expect(lostGroundKindForTerritory(id)).not.toBe(frontierKindForTerritory(id));
    }
  });
});
