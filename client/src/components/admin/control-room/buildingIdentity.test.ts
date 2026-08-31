import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  BUILDING_ART,
  RETIRED_BUILDING_ART,
  weaponPivotPercent,
} from "./buildingArt";
import {
  freshDamageAtStrike,
  projectFreshDamage,
  woundKindFor,
} from "./freshDamage";

const read = (f: string) =>
  readFileSync(new URL(f, import.meta.url), "utf8");
const css = read("./admin-control-room.css");
const tower = read("./TowerWars.tsx");
const home = read("../../../pages/AdminHome.tsx");

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("identity owns geometry; roles do not", () => {
  it("renders the arena in a fixed identity order", () => {
    expect(tower).toContain(
      'const ARENA_ORDER: TowerWarsBuildingId[] = ["opus_la", "century_park_east"]'
    );
    // The old code mapped [youId, rivalId], so the left slot was whichever
    // building was LOSING.
    expect(tower).not.toContain("[youId, rivalId].map");
  });

  it("gives the role classes no position, size or height", () => {
    for (const m of css.matchAll(/\.tw-piece-(?:you|rival)\{([^}]*)\}/g)) {
      for (const prop of ["left:", "right:", "width:", "height:"]) {
        expect(m[1]).not.toContain(prop);
      }
    }
  });

  it("puts position and size on the building itself, desktop and mobile", () => {
    const opus = [...css.matchAll(/\.tw-piece\.is-opus\{([^}]*)\}/g)];
    const cpe = [...css.matchAll(/\.tw-piece\.is-century\{([^}]*)\}/g)];
    // one desktop rule + one mobile rule for each building
    expect(opus.length).toBeGreaterThanOrEqual(2);
    expect(cpe.length).toBeGreaterThanOrEqual(2);
    for (const m of opus) {
      expect(m[1]).toContain("left:");
      expect(m[1]).toContain("height:");
    }
    for (const m of cpe) {
      expect(m[1]).toContain("right:");
      expect(m[1]).toContain("height:");
    }
  });

  it("makes projectile direction follow the building, not the role", () => {
    expect(css).toContain(
      '.tw-piece.is-century.is-firing .tw-projectile{animation-name:tw-projectile-flight-reverse}'
    );
    expect(css).not.toContain(".tw-piece-rival.is-firing .tw-projectile");
  });

  it("keeps the two weapons pointed at each other", () => {
    expect(BUILDING_ART.opus_la.weaponGeometry.strikeDirection).toBe(
      "left_to_right"
    );
    expect(BUILDING_ART.century_park_east.weaponGeometry.strikeDirection).toBe(
      "right_to_left"
    );
  });
});

describe("one building, one composition, everywhere", () => {
  it("renders both surfaces through the shared component", () => {
    expect(tower).toContain("CanonicalBuildingArt");
    // Home composes via CityTowerButton, which renders the same component and also
    // carries the building's identity into the traversal.
    expect(home).toContain("CityTowerButton");
    const cityButton = read("./CityTowerButton.tsx");
    expect(cityButton).toContain("CanonicalBuildingArt");
    expect(cityButton).toContain("begin({");
  });

  it("never references a retired asset from live code", () => {
    const registry = stripComments(read("./buildingArt.ts"));
    const live = registry.split("RETIRED_BUILDING_ART")[0];
    for (const retired of RETIRED_BUILDING_ART) {
      expect(live).not.toContain(retired);
      expect(stripComments(tower)).not.toContain(retired);
      expect(stripComments(home)).not.toContain(retired);
      expect(stripComments(css)).not.toContain(retired);
    }
  });

  it("gives each building exactly one weapon, and they differ", () => {
    const weapons = Object.values(BUILDING_ART).map(b => b.weapon);
    expect(new Set(weapons).size).toBe(weapons.length);
    for (const b of Object.values(BUILDING_ART)) {
      expect(b.weapon).toMatch(/\.png$/);
      expect(b.plate).not.toBe(b.weapon);
    }
  });

  it("ships every canonical asset that the registry promises", () => {
    const dir = new URL(
      "../../../../public/assets/admin/control-room/tower-wars/",
      import.meta.url
    );
    const present = new Set(readdirSync(dir));
    for (const b of Object.values(BUILDING_ART)) {
      for (const asset of [b.plate, b.weapon, b.projectile]) {
        if (!asset) continue;
        expect(present).toContain(asset.split("/").pop());
      }
    }
  });

  it("scale-locks every layer through one container", () => {
    expect(css).toContain(".cb-art.is-opus_la{transform:scale(1.12)}");
    expect(css).toContain(".cb-art.is-century_park_east{transform:scale(.96)}");
  });

  it("pivots each weapon at its own mount", () => {
    const opus = weaponPivotPercent("opus_la");
    const cpe = weaponPivotPercent("century_park_east");
    expect(css).toContain(`transform-origin:${opus.x}% ${opus.y}%`);
    expect(cpe.y).toBeLessThan(opus.y); // CPE's turret sits on the roof
  });
});

describe("fresh damage is today's truth only", () => {
  const wounds = (n: number) =>
    projectFreshDamage({
      buildingId: "century_park_east",
      businessDate: "2026-08-30",
      incomingToday: n,
    });

  it("draws one wound per real strike and not one more", () => {
    expect(wounds(0)).toHaveLength(0);
    expect(wounds(1)).toHaveLength(1);
    expect(wounds(4)).toHaveLength(4);
  });

  it("worsens as the day compounds", () => {
    expect(woundKindFor(0, 1)).toBe("scorch");
    expect(woundKindFor(1, 2)).toBe("breach");
    expect(woundKindFor(2, 3)).toBe("rupture");
    expect(woundKindFor(3, 4)).toBe("collapse");
  });

  it("is deterministic and distinct per day", () => {
    expect(wounds(3)).toEqual(wounds(3));
    const other = projectFreshDamage({
      buildingId: "century_park_east",
      businessDate: "2026-08-29",
      incomingToday: 3,
    });
    expect(other[0]!.xPercent).not.toBe(wounds(3)[0]!.xPercent);
  });

  it("shows only the prefix during replay", () => {
    const all = wounds(4);
    expect(freshDamageAtStrike(all, 0)).toHaveLength(0);
    expect(freshDamageAtStrike(all, 2)).toEqual(all.slice(0, 2));
    expect(freshDamageAtStrike(all, 99)).toHaveLength(4);
  });

  it("keeps wounds inside the building silhouette", () => {
    for (const w of wounds(4)) {
      expect(w.xPercent).toBeGreaterThanOrEqual(20);
      expect(w.xPercent).toBeLessThanOrEqual(58);
    }
  });
});
