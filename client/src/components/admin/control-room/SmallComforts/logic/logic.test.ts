import { describe, it, expect } from "vitest";
import { COLS, ROWS, DOOR, Layout, Item, ItemKind, Rot, emptyLayout, canPlace, footprint, blockedSet, findPath, key, prune } from "./grid";
import { planGuest, GUEST_ORDER, NOTES } from "./guests";
import { ITEM_DEFINITIONS, GUEST_PROFILES } from "./content";
import { suitcaseAnatomy } from "./container";

let nid = 1;
function build(spec: { kind: ItemKind; x: number; z: number; rot?: Rot }[], windowCut = false, windowCol = 3): Layout {
  const l = emptyLayout();
  l.windowCut = windowCut; l.windowCol = windowCol;
  for (const s of spec) {
    const rot = (s.rot ?? 0) as Rot;
    if (canPlace(l, s.kind, s.x, s.z, rot).ok) l.items.push({ id: nid++, kind: s.kind, x: s.x, z: s.z, rot });
  }
  return l;
}
function validate(l: Layout) {
  const blocked = blockedSet(l);
  for (const g of GUEST_ORDER) {
    const p = planGuest(g, l);
    expect(p.branch).toBeTruthy();
    expect(p.note).toBe(p.happy ? NOTES[g].happy : NOTES[g].workaround);
    expect(p.actions.length).toBeGreaterThan(0);
    for (const a of p.actions) {
      if (a.t === "walk") {
        for (let i = 0; i < a.path.length; i++) {
          const c = a.path[i];
          expect(c.x >= 0 && c.z >= 0 && c.x < COLS && c.z < ROWS).toBe(true);
          if (i > 0) expect(Math.abs(c.x - a.path[i - 1].x) + Math.abs(c.z - a.path[i - 1].z)).toBe(1);
        }
      }
    }
    // determinism
    expect(planGuest(g, l).branch).toBe(p.branch);
  }
  void blocked;
}

describe("placement", () => {
  it("rejects door, overlap, out of bounds, blanket without bed", () => {
    const l = emptyLayout();
    expect(canPlace(l, "lamp", DOOR.x, DOOR.z, 0).ok).toBe(false);
    expect(canPlace(l, "bed", 5, 3, 0).ok).toBe(false);
    expect(canPlace(l, "blanket", 2, 2, 0).ok).toBe(false);
    l.items.push({ id: 1, kind: "bed", x: 2, z: 1, rot: 0 });
    expect(canPlace(l, "lamp", 2, 2, 0).ok).toBe(false);
    expect(canPlace(l, "blanket", 2, 2, 0).ok).toBe(true);
  });
  it("pruning drops blankets without beds", () => {
    const l = build([{ kind: "bed", x: 2, z: 1 }, { kind: "blanket", x: 2, z: 1 }]);
    expect(l.items.length).toBe(2);
    l.items = l.items.filter(i => i.kind !== "bed");
    expect(prune(l).items.length).toBe(0);
  });
});

describe("pathing", () => {
  it("finds path around furniture; null when sealed", () => {
    const l = build([{ kind: "table", x: 1, z: 3 }, { kind: "table", x: 0, z: 2 }]);
    expect(findPath(blockedSet(l), DOOR, [{ x: 4, z: 0 }])).toBeNull();
    expect(findPath(blockedSet(emptyLayout()), DOOR, [{ x: 4, z: 0 }])!.length).toBe(1 + 4 + 3);
  });
});

describe("guest plans", () => {
  it("empty room still gives every guest a plan", () => validate(emptyLayout()));
  it("conductor happy path: window + bed + adjacent lamp", () => {
    const l = build([{ kind: "bed", x: 0, z: 1, rot: 1 }, { kind: "lamp", x: 1, z: 2 }], true, 3);
    const p = planGuest("conductor", l);
    expect(p.pre).toBe("window"); expect(p.lamp.method).toBe("adjacent"); expect(p.happy).toBe(true);
  });
  it("lamp 2 cells away: conductor flicks, others get up", () => {
    const l = build([{ kind: "bed", x: 0, z: 0, rot: 1 }, { kind: "lamp", x: 3, z: 0 }], true);
    expect(planGuest("conductor", l).lamp.method).toBe("flick");
    expect(planGuest("baker", l).lamp.method).toBe("stretch-then-walk");
  });
  it("far lamp: walks over", () => {
    const l = build([{ kind: "bed", x: 0, z: 0, rot: 1 }, { kind: "lamp", x: 5, z: 3 }]);
    expect(planGuest("reader", l).lamp.method).toBe("walk");
  });
  it("sealed-off door: stranded guest sleeps on the doormat with a plan", () => {
    const l = build([{ kind: "table", x: 1, z: 3 }, { kind: "table", x: 0, z: 2 }, { kind: "bed", x: 3, z: 0 }]);
    const p = planGuest("baker", l);
    expect(p.sleep.kind).toBe("floor");
    validate(l);
  });
  it("fuzz: 3000 random layouts never throw and always produce one valid plan", () => {
    let seed = 12345;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const kinds: ItemKind[] = ["bed", "blanket", "armchair", "lamp", "table", "rug"];
    const branches = new Set<string>();
    for (let n = 0; n < 3000; n++) {
      const spec = Array.from({ length: Math.floor(r() * 12) }, () => ({
        kind: kinds[Math.floor(r() * kinds.length)], x: Math.floor(r() * COLS), z: Math.floor(r() * ROWS), rot: Math.floor(r() * 4) as Rot,
      }));
      const l = build(spec, r() < 0.5, Math.floor(r() * (COLS - 1)));
      validate(l);
      for (const g of GUEST_ORDER) branches.add(planGuest(g, l).guest + ":" + planGuest(g, l).branch);
    }
    expect(branches.size).toBeGreaterThan(20);
  });
  it("footprint of beds rotates", () => {
    expect(footprint("bed", 1, 1, 0).map(key)).toEqual([7, 13]);
    expect(footprint("bed", 1, 1, 1).map(key)).toEqual([7, 8]);
  });
});


describe("vertical-slice systems", () => {
  it("describes every current furniture kind with gameplay tags", () => {
    const kinds: ItemKind[] = ["bed", "blanket", "armchair", "lamp", "table", "rug"];
    for (const kind of kinds) {
      expect(ITEM_DEFINITIONS[kind].kind).toBe(kind);
      expect(ITEM_DEFINITIONS[kind].tags.length).toBeGreaterThan(0);
    }
    expect(ITEM_DEFINITIONS.lamp.tags).toContain("operable");
    expect(ITEM_DEFINITIONS.blanket.tags).toContain("thermal_cover");
    expect(ITEM_DEFINITIONS.armchair.tags).toContain("reading_seat");
  });

  it("models the suitcase as anatomy rather than a blank room", () => {
    const l = emptyLayout();
    const closed = suitcaseAnatomy(l);
    expect(closed.kind).toBe("vintage_suitcase");
    expect(closed.features.map(f => f.id)).toEqual(expect.arrayContaining([
      "brass_latch",
      "lid_pocket",
      "elastic_straps",
      "fabric_lining",
      "brass_corners",
      "lining_window",
    ]));
    expect(closed.features.find(f => f.id === "lining_window")?.active).toBe(false);

    l.windowCut = true;
    const opened = suitcaseAnatomy(l);
    const window = opened.features.find(f => f.id === "lining_window");
    expect(window?.active).toBe(true);
    expect(window?.tags).toEqual(expect.arrayContaining(["view_outside", "draft_source", "opening"]));
  });

  it("gives the Conductor extended reach as data and uses it for an out-of-reach lamp", () => {
    expect(GUEST_PROFILES.conductor.capabilities).toContainEqual(
      expect.objectContaining({ id: "umbrella", kind: "extended_reach", maxDistance: 2 })
    );
    const l = build([{ kind: "bed", x: 0, z: 0, rot: 1 }, { kind: "lamp", x: 3, z: 0 }], true);
    const p = planGuest("conductor", l);
    expect(p.lamp.method).toBe("flick");
    expect(p.interactions).toContainEqual(
      expect.objectContaining({
        need: "darkness",
        outcome: "use_capability",
        capabilityId: "umbrella",
        distance: 2,
      })
    );
  });

  it("makes the Night Baker react to a draft from the suitcase opening", () => {
    const l = build([{ kind: "bed", x: 0, z: 1, rot: 1 }], true, 3);
    const p = planGuest("baker", l);
    expect(p.pre).toBe("scarf");
    expect(p.interactions).toContainEqual(
      expect.objectContaining({
        need: "stay_warm",
        outcome: "use_capability",
        source: { kind: "container", id: "lining_window" },
        capabilityId: "scarf",
        reason: "draft_exposure",
      })
    );
  });

  it("lets a blanket solve the Baker's draft problem", () => {
    const l = build([
      { kind: "bed", x: 0, z: 1, rot: 1 },
      { kind: "blanket", x: 0, z: 1 },
    ], true, 3);
    const p = planGuest("baker", l);
    expect(p.pre).toBe("wrap-up");
    expect(p.interactions).toContainEqual(
      expect.objectContaining({
        need: "stay_warm",
        outcome: "use_item",
        reason: "insulates_against_lining_window",
      })
    );
  });

  it("has the Conductor use suitcase anatomy for the train-view need", () => {
    const l = build([{ kind: "bed", x: 0, z: 1, rot: 1 }], true, 3);
    const p = planGuest("conductor", l);
    expect(p.interactions).toContainEqual(
      expect.objectContaining({
        need: "observe_trains",
        outcome: "use_container_feature",
        source: { kind: "container", id: "lining_window" },
      })
    );
  });
});
