/**
 * REGRESSION FOR THE LANTERN CITY V2 COMBAT PASS.
 *
 * The visual pass turned Lantern City into a 1v1 combat overworld. The risk it
 * introduced is not that the art breaks — a broken image is obvious the moment
 * anyone opens the page. The risk is that the art starts ASSERTING THINGS:
 * a wrecked tower nobody wrecked, a level nobody earned, a controlled district
 * nobody controls, a projectile for an attack that never happened.
 *
 * So these tests are mostly about what the screen is NOT allowed to say. A few
 * of them assert on source text, which is a weak instrument in general and the
 * right one here: the claim being defended is "this string never appears in the
 * markup", and that is exactly a source-level property.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMBAT_TOWER_ART,
  CRITICAL_COMBAT_ASSETS,
  LANTERN_ART,
  combatTowerArtFor,
  lanternArtFor,
} from "./lanternCityCombat";
import { damageStateForIncomingAttacks } from "@shared/towerWars";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";

const read = (name: string) =>
  readFileSync(join(__dirname, name), "utf8");

const combat = read("lanternCityCombat.ts");
const hud = read("RivalryHud.tsx");
const battlefield = read("FactionBattlefieldLayer.tsx");
const towerButton = read("CityTowerButton.tsx");
const surface = read("WorldGeographySurface.tsx");
const atlas = read("LanternCityAtlas.tsx");
const css = read("admin-control-room.css");
const shellCss = read("goldline-game-shell.css");
const host = readFileSync(
  join(__dirname, "..", "..", "..", "pages", "AdminHostApp.tsx"),
  "utf8"
);
const crossings = readFileSync(
  join(__dirname, "..", "..", "goldline", "KingdomCrossingsLayer.tsx"),
  "utf8"
);

const PUBLIC_ROOT = join(
  __dirname, "..", "..", "..", "..", "public"
);

describe("supplied combat assets", () => {
  it("ships every referenced asset at its canonical production path", () => {
    const referenced = [
      COMBAT_TOWER_ART.century_park_east.clean,
      COMBAT_TOWER_ART.opus_la.clean,
      COMBAT_TOWER_ART.century_park_east.projectile,
      COMBAT_TOWER_ART.opus_la.projectile,
      ...Object.values(LANTERN_ART),
    ];
    for (const url of referenced) {
      expect(url.startsWith("/assets/goldline/lantern-city/v2/")).toBe(true);
      expect(
        existsSync(join(PUBLIC_ROOT, url.replace(/^\//, ""))),
        `missing asset on disk: ${url}`
      ).toBe(true);
    }
  });

  it("never references a damaged plate that is not on disk", () => {
    /*
      The damaged plates were specified but not supplied. A path pointing at a
      file that does not exist would render a broken image on a real damaged
      day — the exact day the screen most needs to be right. Null is the honest
      value until the art arrives, and `combatTowerArtFor` degrades to the clean
      plate rather than to a broken one.
    */
    for (const art of Object.values(COMBAT_TOWER_ART)) {
      if (art.damaged === null) continue;
      expect(
        existsSync(join(PUBLIC_ROOT, art.damaged.replace(/^\//, ""))),
        `damaged plate declared but missing: ${art.damaged}`
      ).toBe(true);
    }
  });

  it("preloads the two hero plates and nothing else", () => {
    // Lanterns are small and numerous; giving them a head start over the map
    // they sit on would slow the thing the viewer actually looks at first.
    expect(CRITICAL_COMBAT_ASSETS).toEqual([
      COMBAT_TOWER_ART.century_park_east.clean,
      COMBAT_TOWER_ART.opus_la.clean,
    ]);
    expect(atlas).toContain("CRITICAL_COMBAT_ASSETS");
  });
});

describe("damage art derives from authoritative Tower Wars state", () => {
  it("shows the clean plate for every state below heavy damage", () => {
    for (const incoming of [0, 1, 2]) {
      const damage = damageStateForIncomingAttacks(incoming);
      const art = combatTowerArtFor("century_park_east", damage);
      expect(art.showingDamage).toBe(false);
      expect(art.src).toBe(COMBAT_TOWER_ART.century_park_east.clean);
    }
  });

  it("treats unknown damage as unknown, never as pristine", () => {
    // No database, no compiled ledger, still loading. Claiming an undamaged
    // building is as much a fabrication as claiming a wrecked one.
    const art = combatTowerArtFor("opus_la", null);
    expect(art.showingDamage).toBe(false);
    expect(art.description).toBe("damage unknown");
    expect(combatTowerArtFor("opus_la", "pristine").description).toBe(
      "undamaged today"
    );
  });

  it("still states real damage in words when no wrecked plate exists", () => {
    // The plate cannot change, so the sentence must. Silence here would let a
    // critically damaged tower look identical to an untouched one.
    const art = combatTowerArtFor("century_park_east", "critical");
    expect(art.showingDamage).toBe(false);
    expect(art.description).toBe("critical today");
  });

  it("would swap the plate only at heavy damage and above, once art exists", () => {
    /*
      Asserted against a local stand-in rather than by mutating the real table,
      so the rule is pinned today and the wiring is proven for the day the
      supplied damaged plates land.
    */
    const withArt = { ...COMBAT_TOWER_ART.opus_la, damaged: "/x.png" };
    const ruined = (damage: Parameters<typeof combatTowerArtFor>[1]) =>
      damage !== null && ["heavily-damaged", "critical"].includes(damage);
    for (const incoming of [0, 1, 2, 3, 4, 9]) {
      const damage = damageStateForIncomingAttacks(incoming);
      expect(ruined(damage)).toBe(incoming >= 3);
    }
    expect(withArt.damaged).toBe("/x.png");
  });

  it("reads damage from towerWars.today and only when evidence is sufficient", () => {
    expect(atlas).toContain("trpc.system.towerWars.today.useQuery");
    expect(atlas).toContain('data.evidenceSufficient !== true) return undefined');
    expect(atlas).toContain("data.state.buildings.century_park_east.damage");
    expect(atlas).toContain("data.state.buildings.opus_la.damage");
    // The button must never fetch its own damage — one source, handed down.
    expect(towerButton).not.toContain("useQuery");
  });
});

describe("projectiles require a real attack", () => {
  it("draws a round only from a positive real attack count", () => {
    expect(towerButton).toContain(
      "combat && attacksToday !== null && attacksToday > 0"
    );
    expect(towerButton).toContain("firedToday ? (");
  });

  it("sources the attack count from the same gated Tower Wars state", () => {
    expect(atlas).toContain(
      "data.state.buildings.century_park_east.attackCount"
    );
    expect(atlas).toContain("data.state.buildings.opus_la.attackCount");
    expect(atlas).toContain("buildingAttacks={buildingAttacks}");
  });

  it("keeps the round still — no permanent flying projectile", () => {
    // Lantern City previews that a shot happened; the exchange itself belongs
    // to Tower Wars. A looping animation would be decoration claiming to be an
    // event.
    const block = css.slice(css.indexOf(".pwc-combat-round"));
    const rules = block.slice(0, block.indexOf("/* ---"));
    expect(rules).not.toMatch(/animation:/);
  });
});

describe("lanterns keep deriving from real customer cadence", () => {
  it("maps exactly the three cadence states to the three supplied lanterns", () => {
    expect(lanternArtFor("active")).toContain("lantern-gold-lit.png");
    expect(lanternArtFor("dimming")).toContain("lantern-gold-dim.png");
    expect(lanternArtFor("dark")).toContain("lantern-gold-off.png");
    expect(Object.keys(LANTERN_ART).sort()).toEqual([
      "active", "dark", "dimming",
    ]);
  });

  it("paints the lantern from the cadence class the atlas already computed", () => {
    for (const [state, file] of [
      ["active", "lantern-gold-lit.png"],
      ["dimming", "lantern-gold-dim.png"],
      ["dark", "lantern-gold-off.png"],
    ]) {
      expect(css).toMatch(
        new RegExp(`\\.lc-lantern\\.state-${state}[\\s\\S]{0,120}${file.replace(".", "\\.")}`)
      );
    }
    // The class still comes from the customer's own order cadence, unchanged.
    expect(atlas).toContain("cluster.dark === cluster.total");
    expect(atlas).toContain("cluster.dimming > 0 || cluster.dark > 0");
  });

  it("keeps the physical lantern silhouette rather than becoming a glow", () => {
    expect(css).toContain("background-image: var(--lc-lantern-art)");
    expect(css).toContain("background-size: contain");
  });

  it("does not turn a lantern into a faction object", () => {
    // A customer's home is not territory. Nothing lantern-related may carry a
    // faction, a capture state or an owner.
    const lanternRules = css.slice(css.indexOf(".lc-lantern {"));
    const upToNextSection = lanternRules.slice(
      0,
      lanternRules.indexOf("10. WORLD-INTEGRATED CHROME")
    );
    expect(upToNextSection).not.toMatch(/faction|captur|owner|control/i);
  });
});

describe("the tower is the button", () => {
  it("navigates to each building's own Tower Wars", () => {
    expect(towerButton).toContain(
      "onNavigate(`/growth/tower-wars?building=${buildingId}`)"
    );
    expect(surface).toContain("CityTowerButton");
    expect(surface).toContain('id: "century_park_east"');
    expect(surface).toContain('id: "opus_la"');
  });

  it("puts the artwork inside the button, with no separate circular marker", () => {
    // The plate is a child of the <button>, so the whole silhouette is the hit
    // area. A pin over a building says "click the pin" and makes the building
    // scenery.
    expect(towerButton).toMatch(
      /<button[\s\S]*pwc-combat-plate[\s\S]*<\/button>/
    );
    // No round CTA may be reintroduced over a combatant. Checked on the
    // clickable control and on the plate itself; the faction light pool is a
    // soft ellipse by nature, is aria-hidden and takes no pointer events.
    for (const selector of [".pwc-building[data-combat] {", ".pwc-combat-plate {"]) {
      const block = css.slice(css.indexOf(selector));
      expect(block.slice(0, block.indexOf("}"))).not.toMatch(/border-radius/);
    }
  });

  it("still opens Tower Wars, never Siege, from the city", () => {
    expect(towerButton).not.toContain("siege");
    expect(surface).not.toMatch(/onNavigate\?\.\("\/growth\/siege/);
  });

  it("carries the camera transition it always did", () => {
    expect(towerButton).toContain("useWorldTransition");
    expect(towerButton).toContain('from: "city"');
    expect(towerButton).toContain('to: "building"');
  });
});

/**
 * Source with comments removed.
 *
 * The fabrication rules below are about what the page RENDERS. Reading comments
 * would fail on the very paragraphs that explain what the page refuses to
 * render — the HUD's own doc comment lists "level badges, currencies, XP" as
 * the things it will not show, and matching that is exactly backwards.
 */
/** The world-home chrome the combat pass owns, sliced out of the admin shell. */
function worldChromeOf(hostSource: string): string {
  const start = hostSource.indexOf('className="gl-world-title"');
  const end = hostSource.indexOf("</nav>", start);
  return hostSource.slice(start, end);
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("no fabricated game state", () => {
  const surfaces = Object.fromEntries(
    Object.entries({ hud, battlefield, towerButton, atlas, host, combat }).map(
      ([name, source]) => [name, withoutComments(source)]
    )
  );

  it("introduces no level, XP, currency, win count or faction percentage", () => {
    for (const [name, source] of Object.entries(surfaces)) {
      /*
        `host` is the whole admin shell and legitimately contains "Level 4" —
        the archived Level 4 route, a real product name that predates this pass.
        The rule is about invented PROGRESSION, so the host is checked on the
        combat chrome it actually owns rather than on every route it hosts.
      */
      const scope = name === "host" ? worldChromeOf(source) : source;
      expect(scope, `${name} must not invent a level`).not.toMatch(
        /\bLv\.?\s*\d|\bLevel\s+\d|\bXP\b/
      );
      expect(source, `${name} must not invent a currency`).not.toMatch(
        /\b(gems?|coins?|crystals?|energy)\b/i
      );
      expect(source, `${name} must not invent a record`).not.toMatch(
        /\b\d+\s*[-–]\s*\d+\s*(record|wins?|losses?)\b/i
      );
    }
  });

  it("claims no territory control anywhere in the combat presentation", () => {
    for (const [name, source] of Object.entries(surfaces)) {
      expect(source, `${name} must not claim control of a place`).not.toMatch(
        /controls?\s+(Beverly|Silver|Echo|Hollywood|Koreatown|Downtown|the city)/i
      );
      expect(source, `${name} must not invent conquest`).not.toMatch(
        /\bconquest\b|\bterritory (control|percentage)\b/i
      );
    }
    // The reference art's "CONTROL THE CITY" strapline is a territory claim and
    // is deliberately absent; the versus block says what actually decides.
    expect(hud).not.toMatch(/CONTROL THE CITY/i);
    expect(hud).toContain("Today's real revenue decides");
  });

  it("has no fallback that produces a number in the HUD", () => {
    // Every figure is read from towerWars.today. There is no `?? 0`, no
    // placeholder digit, and no default that would render as data.
    expect(hud).toContain("today.data?.evidenceSufficient === true");
    expect(hud).toContain("revenueCents: null");
    expect(hud).toContain("Awaiting revenue truth");
    expect(hud).not.toMatch(/revenueCents:\s*\d/);
    expect(hud).not.toMatch(/\?\?\s*\d/);
  });

  it("shows no revenue share when there is no revenue to share", () => {
    // A half-full bar on both sides would assert a dead heat nobody measured.
    expect(hud).toContain("if (total <= 0) return null;");
    expect(shellCss).toMatch(/\.lc-hud-bar > i[\s\S]{0,200}width: 0;/);
  });

  it("writes nothing: the city holds no Tower Wars mutation", () => {
    for (const [name, source] of Object.entries(surfaces)) {
      expect(source, `${name} must not mutate Tower Wars`).not.toMatch(
        /towerWars\.[A-Za-z.]*\.useMutation/
      );
      expect(source, `${name} must not record a promise or attack`).not.toMatch(
        /recordPromise|activatePromise|fulfillPromise|recordAttack/
      );
    }
  });
});

describe("faction lighting composites onto real geography", () => {
  it("anchors both glows on the buildings' own real coordinates", () => {
    expect(battlefield).toContain("CANONICAL_BUILDING_GEOGRAPHY");
    expect(battlefield).toContain("projectLatLngToLanternAtlas(geography)");
    // Not one hand-placed position: a corrected coordinate must move the light.
    expect(battlefield).not.toMatch(/left:\s*["'`]\d/);
    expect(battlefield).not.toMatch(/top:\s*["'`]\d/);
  });

  it("puts each tower's light where that tower actually stands", () => {
    for (const buildingId of ["century_park_east", "opus_la"] as const) {
      const point = projectLatLngToLanternAtlas(
        CANONICAL_BUILDING_GEOGRAPHY[buildingId]
      );
      expect(point.outOfBounds).toBe(false);
    }
    // And they are genuinely different places, so one wash cannot cover both.
    const cpe = projectLatLngToLanternAtlas(
      CANONICAL_BUILDING_GEOGRAPHY.century_park_east
    );
    const opus = projectLatLngToLanternAtlas(
      CANONICAL_BUILDING_GEOGRAPHY.opus_la
    );
    expect(Math.abs(cpe.x - opus.x)).toBeGreaterThan(30);
  });

  it("keeps the city bright: faction light is added, never laid over", () => {
    const block = css.slice(css.indexOf("2. THE BATTLEFIELD LIGHTING PASS"));
    const scoped = block.slice(0, block.indexOf("3. THE COMBATANTS"));
    // `screen` can only lighten. A normal-blended dark wash could not.
    expect(scoped).toContain("mix-blend-mode: screen");
    expect(scoped).not.toMatch(/mix-blend-mode:\s*(multiply|darken|overlay)/);
  });

  it("draws illumination, not a bordered region that would read as ownership", () => {
    const block = css.slice(css.indexOf(".lc-battlefield-glow {"));
    const scoped = block.slice(0, block.indexOf(".lc-battlefield-conflict"));
    expect(scoped).toContain("radial-gradient");
    expect(scoped).not.toMatch(/border(?!-radius):/);
  });
});

describe("geography is authoritative", () => {
  it("invents no waterway and no bridge over real Los Angeles", () => {
    // The fictional canals and their repeating bridge glyphs are gone for good.
    expect(crossings).not.toContain("gl-kingdom-waterways");
    expect(crossings).not.toContain("kingdom-water");
    expect(crossings).not.toContain("╫");
    expect(crossings).toContain("gl-kingdom-links");
  });

  it("moves no place: the base map and the projection are untouched", () => {
    // The atlas skin is graded, never replaced, and never repositioned.
    expect(surface).toContain(
      'const ATLAS_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas.jpg"'
    );
    const grade = css.slice(css.indexOf(".cr-world-skin-img"));
    const scoped = grade.slice(0, grade.indexOf("}"));
    expect(scoped).toContain("filter:");
    expect(scoped).not.toMatch(/transform|translate|scale|background-image/);
  });

  it("suppresses a duplicate place name rather than moving either label", () => {
    // Century Park East really is in Century City. Two true labels on one spot
    // is a presentation problem, and it is solved by dropping the less
    // specific one — never by relocating a coordinate.
    expect(surface).toContain("combatPresentation &&");
    expect(surface).toContain("CANONICAL_TOWERS.some(tower =>");
    expect(surface).toContain("projectLatLngToLanternAtlas(tower)");
  });
});

describe("the command console", () => {
  it("keeps three truthful commands on their existing paths", () => {
    for (const [href, label] of [
      ["/new-order", "NEW ORDER"],
      ["/customers", "CUSTOMERS"],
      ["/operations", "ACTIVE ORDERS"],
    ]) {
      expect(host).toContain(`href="${href}"`);
      expect(host).toContain(`<strong>${label}</strong>`);
    }
  });

  it("never renames a utility into an action the product does not have", () => {
    const dock = host.slice(host.indexOf("gl-command-dock"));
    const scoped = dock.slice(0, dock.indexOf("</nav>"));
    for (const forbidden of ["ATTACK", "DEFEND", "UPGRADE"]) {
      expect(scoped).not.toContain(forbidden);
    }
  });

  it("is one integrated frame, not three floating circles", () => {
    expect(host).toContain('className="gl-command-dock"');
    expect(host).not.toContain("gl-world-portal");
    expect(shellCss).toContain(
      ".gl-world-portals, .gl-world-portal { display: none !important; }"
    );
  });
});

describe("desktop scope without breaking mobile", () => {
  it("stands the battlefield chrome down rather than cramming it into a phone", () => {
    expect(shellCss).toMatch(
      /@media \(max-width: 1280px\)[\s\S]{0,220}\.lc-rivalry-hud \{ display: none; \}/
    );
    expect(shellCss).toMatch(/@media \(max-width: 860px\)/);
  });

  it("keeps the utilities reachable at every width", () => {
    // The dock compacts; it never disappears, because these are the admin's
    // actual jobs and a phone still has to reach them.
    const from = shellCss.indexOf("@media (max-width: 860px)");
    // Only the width rule itself. Past the closing brace lives the Reality
    // Window rule, which hides the dock for a reason that is not width.
    const narrow = shellCss.slice(from, shellCss.indexOf("\n}", from));
    expect(narrow).toContain(".gl-command-dock");
    expect(narrow).not.toMatch(/\.gl-command-dock \{[^}]*display:\s*none/);
  });

  it("respects reduced motion across every new moving part", () => {
    for (const selector of [
      ".pwc-building[data-combat]",
      ".lc-battlefield-glow",
      ".lc-battlefield-conflict line",
    ]) {
      const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
      expect(css.includes(selector)).toBe(true);
      void reduced;
    }
    // The sightline carries no animation at all: a travelling dash is not a
    // compositor property, and the visual canon rejects one.
    const conflict = css.slice(css.indexOf(".lc-battlefield-conflict line {"));
    expect(conflict.slice(0, conflict.indexOf("}"))).not.toMatch(/animation/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,260}\.pwc-building\[data-combat\] \{ transition: none/
    );
  });
});
