/**
 * LANTERN CITY V2 — THE COMBAT PRESENTATION LAYER.
 *
 * Lantern City is a 1v1 combat overworld whose combatants are luxury high-rises.
 * This module owns the ART that says so, and nothing else: which plate a tower
 * wears, which lantern a place wears, which projectile a faction throws.
 *
 * IT DECIDES NOTHING ABOUT THE BUSINESS.
 *
 * Every function here is a pure lookup from state that already exists and is
 * already authoritative somewhere else:
 *
 *   - damage comes from `TowerDamageState`, compiled by `shared/towerWars.ts`
 *     from real collected orders. Nothing in this file can raise it.
 *   - lantern state comes from the customer's own order cadence, computed by
 *     `inferCustomerCadence`. Nothing in this file can light a lantern.
 *
 * The separation matters because art is exactly where fabrication is cheapest.
 * A scorched tower is dramatic; showing one because it looks good would be a
 * claim that a real building lost real revenue today. So the rule is stated as
 * code rather than as a comment: `combatTowerArtFor` takes the authoritative
 * damage state as an argument and has no other input, which means the only way
 * to draw a wrecked tower is to be handed a wrecked tower.
 */
import type { TowerDamageState } from "@shared/towerWars";
import type { CanonicalBuildingId } from "./buildingArt";

/**
 * Production home of the supplied v2 combat artwork.
 *
 * Versioned in the path rather than in the filename so a future art pass
 * replaces a directory instead of leaving `-v3` suffixes scattered through the
 * stylesheet and the markup.
 */
export const LANTERN_CITY_V2_ASSETS = "/assets/goldline/lantern-city/v2";

/** Which side of the rivalry a building fights for. Presentation only. */
export type CombatFaction = "gold" | "violet";

export type CombatTowerArt = {
  faction: CombatFaction;
  /** The building as it stands. Always present. */
  clean: string;
  /**
   * The building visibly wrecked.
   *
   * `null` means the damaged plate has not been supplied for this building, and
   * a null here is deliberately NOT a reason to invent one: the tower keeps its
   * clean plate and the existing scar/fresh-damage overlays continue to carry
   * the damage, exactly as they did before this module existed. A missing asset
   * must degrade to "less dramatic", never to a broken image and never to a
   * substitute the art director did not approve.
   */
  damaged: string | null;
  /** The weapon this building actually carries, for labels and alt text. */
  weaponDescription: string;
  /** The thing this building throws, when a real attack is being visualised. */
  projectile: string;
};

export const COMBAT_TOWER_ART: Record<CanonicalBuildingId, CombatTowerArt> = {
  century_park_east: {
    faction: "gold",
    clean: `${LANTERN_CITY_V2_ASSETS}/tower-cpe-combat-clean.png`,
    damaged: null,
    weaponDescription: "rooftop valet bazooka",
    projectile: `${LANTERN_CITY_V2_ASSETS}/projectile-valet-car.png`,
  },
  opus_la: {
    faction: "violet",
    clean: `${LANTERN_CITY_V2_ASSETS}/tower-opus-combat-clean.png`,
    damaged: null,
    weaponDescription: "giant architectural golf driver",
    projectile: `${LANTERN_CITY_V2_ASSETS}/projectile-opus-golf-ball.png`,
  },
};

/**
 * Damage states at which the building itself is redrawn as a ruin.
 *
 * Only the top two. `chipped` and `cracked` are real damage and are already
 * drawn by the located-impact and scar layers on the facade; swapping the whole
 * building for a ruin at the first strike would overstate one $50 order into a
 * destroyed tower, which is the same lie as inventing the order.
 */
const RUINED_DAMAGE_STATES: readonly TowerDamageState[] = [
  "heavily-damaged",
  "critical",
];

export type CombatTowerPresentation = {
  src: string;
  /** True only when the wrecked plate is genuinely on screen. */
  showingDamage: boolean;
  faction: CombatFaction;
  /**
   * Why this plate and not the other, in words. Carried into `alt` so the
   * damage state reaches a screen reader instead of being visible-only.
   */
  description: string;
};

/**
 * The plate a tower wears right now.
 *
 * @param damage The authoritative Tower Wars damage state for this building.
 *   `null` means Tower Wars has no answer yet (no database, no compiled ledger,
 *   still loading) — which is NOT the same as "pristine" and is NOT a licence to
 *   guess. Unknown renders the clean plate and says the damage is unknown.
 */
export function combatTowerArtFor(
  buildingId: CanonicalBuildingId,
  damage: TowerDamageState | null
): CombatTowerPresentation {
  const art = COMBAT_TOWER_ART[buildingId];
  const ruined = damage !== null && RUINED_DAMAGE_STATES.includes(damage);
  if (ruined && art.damaged) {
    return {
      src: art.damaged,
      showingDamage: true,
      faction: art.faction,
      description: `wrecked, ${damage!.replace("-", " ")}`,
    };
  }
  return {
    src: art.clean,
    showingDamage: false,
    faction: art.faction,
    // A tower that IS damaged but has no wrecked plate must still say so.
    description:
      damage === null
        ? "damage unknown"
        : damage === "pristine"
          ? "undamaged today"
          : `${damage.replace("-", " ")} today`,
  };
}

/**
 * The lantern artwork for a place, keyed by the cadence state the customer's own
 * order history already produced.
 *
 * These are the only three states because those are the only three the cadence
 * classifier emits. Adding a fourth here would require inventing the evidence
 * that justifies it.
 */
export type LanternCadenceState = "active" | "dimming" | "dark";

export const LANTERN_ART: Record<LanternCadenceState, string> = {
  active: `${LANTERN_CITY_V2_ASSETS}/lantern-gold-lit.png`,
  dimming: `${LANTERN_CITY_V2_ASSETS}/lantern-gold-dim.png`,
  dark: `${LANTERN_CITY_V2_ASSETS}/lantern-gold-off.png`,
};

export function lanternArtFor(state: LanternCadenceState): string {
  return LANTERN_ART[state];
}

/**
 * Assets worth fetching before first paint.
 *
 * Only the two towers. They are the hero of the composition and the largest
 * files, so a late arrival is the one thing a viewer would actually notice.
 * Lanterns are small and numerous and are better left to the normal loader than
 * given a head start over the map they sit on.
 */
export const CRITICAL_COMBAT_ASSETS: readonly string[] = [
  COMBAT_TOWER_ART.century_park_east.clean,
  COMBAT_TOWER_ART.opus_la.clean,
];
