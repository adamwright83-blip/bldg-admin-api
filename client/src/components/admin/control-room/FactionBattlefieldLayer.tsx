/**
 * THE BATTLEFIELD LIGHTING PASS.
 *
 * Gold light around Century Park East, violet light around OPUS LA, and a line
 * of conflict between them. This is what makes the city read as a 1v1 at a
 * glance, before any label is read.
 *
 * GEOGRAPHY IS AUTHORITATIVE AND THIS LAYER OBEYS IT
 *
 * Every position below comes from `projectLatLngToLanternAtlas()` applied to the
 * same `CANONICAL_BUILDING_GEOGRAPHY` latitude/longitude the towers themselves
 * are placed with. There is not one hand-tuned coordinate in this file. That is
 * the whole point: the glow has to sit on the real building, so if a building's
 * real coordinate is corrected tomorrow its light moves with it, and no one has
 * to remember that a second copy of the position exists here.
 *
 * The concept art shows these glows in particular places on a fictional map.
 * Those places are not inputs. If the reference and Los Angeles disagree about
 * where Koreatown is, Koreatown wins.
 *
 * WHAT THIS LAYER IS CAREFUL NOT TO SAY
 *
 * A coloured region over a city reads as OWNERSHIP, and Goldline has no
 * authoritative claim that either building controls any neighbourhood. So the
 * light is deliberately shaped as ILLUMINATION FROM A BUILDING — brightest at
 * the tower, falling off with distance, no edges, no borders, no enclosed
 * areas, no percentages. It says "something powerful is standing here", which is
 * true, rather than "this district belongs to them", which is not.
 *
 * It is also strictly decorative: `aria-hidden`, no pointer events, and nothing
 * it renders is clickable. The facts it dramatises are all stated in words
 * elsewhere on the page.
 */
import { useMemo } from "react";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import { COMBAT_TOWER_ART } from "./lanternCityCombat";
import type { CanonicalBuildingId } from "./buildingArt";

const FACTION_BUILDINGS: readonly CanonicalBuildingId[] = [
  "century_park_east",
  "opus_la",
];

/**
 * How far a tower's light reaches, as a percentage of the atlas width.
 *
 * Chosen so the two pools stay clearly separate at every supported viewport —
 * overlapping them would blend gold and violet into a single wash and destroy
 * the rivalry the layer exists to state. It is a falloff radius, not a claimed
 * service area.
 */
const GLOW_RADIUS_PERCENT = 19;

export function FactionBattlefieldLayer({
  /**
   * The building the operator is currently hovering or has selected, if any.
   * Its light intensifies. Presentation state passed in from the surface —
   * this layer holds none of its own.
   */
  emphasised = null,
  reducedMotion = false,
}: {
  emphasised?: CanonicalBuildingId | null;
  reducedMotion?: boolean;
}) {
  const anchors = useMemo(
    () =>
      FACTION_BUILDINGS.map(buildingId => {
        const geography = CANONICAL_BUILDING_GEOGRAPHY[buildingId];
        const point = projectLatLngToLanternAtlas(geography);
        return { buildingId, point, faction: COMBAT_TOWER_ART[buildingId].faction };
      })
        // A building whose real coordinate falls outside the atlas frame is not
        // dragged to the edge so it can still be lit. It simply has no light
        // here, the same way it has no tower here.
        .filter(anchor => !anchor.point.outOfBounds),
    []
  );

  /*
    The conflict line is drawn only when BOTH towers are actually on the map.
    A line to a building that is not being rendered would be a line to nowhere.
  */
  const conflict =
    anchors.length === 2
      ? { from: anchors[0].point, to: anchors[1].point }
      : null;

  return (
    <div
      className={`lc-battlefield${reducedMotion ? " is-still" : ""}`}
      aria-hidden
    >
      {anchors.map(anchor => (
        <span
          key={anchor.buildingId}
          className={`lc-battlefield-glow faction-${anchor.faction}${
            emphasised === anchor.buildingId ? " is-emphasised" : ""
          }`}
          style={{
            left: `${anchor.point.x}%`,
            top: `${anchor.point.y}%`,
            // Sized in viewport width so the pool keeps the same geographic
            // footprint as the map is scaled, rather than the same pixel size.
            width: `${GLOW_RADIUS_PERCENT * 2}%`,
            height: `${GLOW_RADIUS_PERCENT * 2}%`,
          }}
        />
      ))}

      {conflict ? (
        <svg
          className="lc-battlefield-conflict"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient
              id="lc-conflict-gradient"
              x1={`${conflict.from.x}%`}
              y1={`${conflict.from.y}%`}
              x2={`${conflict.to.x}%`}
              y2={`${conflict.to.y}%`}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#ffcf5e" stopOpacity="0.85" />
              <stop offset="50%" stopColor="#fff6d8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#b566ff" stopOpacity="0.85" />
            </linearGradient>
          </defs>
          {/*
            One straight line between two real coordinates. Not a route, not a
            road, not a river — the sightline between two combatants, which is
            the only geographic claim it makes and one that is trivially true.
          */}
          <line
            x1={conflict.from.x}
            y1={conflict.from.y}
            x2={conflict.to.x}
            y2={conflict.to.y}
            stroke="url(#lc-conflict-gradient)"
            /* CSS pixels, because vectorEffect takes the stroke out of the
               viewBox scale. A viewBox-relative 0.28 here painted nothing. */
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  );
}
