/**
 * THE UNKNOWN, DRAWN AS WEATHER.
 *
 * Lantern City opens under cloud. The city shows through only where there is
 * genuine real-world presence, and everywhere else is weather you have not
 * cleared yet. That is the single visual that makes the world read as a place
 * you are progressively taking rather than a map you are looking at.
 *
 * WHAT OPENS A HOLE IS ALWAYS A REAL FACT
 *
 * Three things, and nothing else:
 *
 *   a mapped customer      someone real orders here, at a real geocoded
 *                          address, so their own light clears the air around
 *                          them. A denser cluster clears more.
 *   a cleared territory     you beat its guardian; the ground stays open
 *                          permanently, because the kingdom remembers.
 *   a canonical stronghold  Century Park East and OPUS LA are real buildings
 *                          at real coordinates and are never hidden.
 *
 * There is no "explored" flag, no reveal percentage and no stored fog state.
 * The veil is recomputed from evidence every render, which means it cannot
 * drift from the truth and cannot be cheated: the only way to clear the sky
 * over a neighbourhood is to actually have customers there or to actually
 * clear its territory.
 *
 * WHY THE HOLES ARE SOFT
 *
 * A hard edge would draw a border, and a border around a customer is a claim
 * about catchment or coverage that nothing supports. A soft falloff says
 * "it is clearer here", which is exactly as much as the evidence supports.
 *
 * Rendered entirely inside one SVG — pattern, mask and fill — rather than as a
 * CSS-masked element, because SVG masks applied to HTML boxes are not reliable
 * across browsers while a mask inside SVG is.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { buildVeilGeometry } from "@shared/goldlineTerritoryGeometry";
import { projectLatLngToLanternAtlas } from "@shared/lanternCity";
import { CANONICAL_BUILDING_GEOGRAPHY } from "@shared/canonicalGeography";
import { BOARD_OVERLAYS } from "@shared/goldlineBoardKit";
import type { CityWorldEntity } from "../../../../../server/goldlineWorld/cityWorldService";

/**
 * The overlapping cloud fields.
 *
 * Tile sizes are deliberately coprime so their seams never coincide; the
 * combined pattern does not visibly repeat inside any supported viewport.
 */
const CLOUD_LAYERS = [
  { id: "gl-veil-clouds-a", width: 37, height: 21, dx: 0, dy: 0, opacity: 0.95, flip: false },
  { id: "gl-veil-clouds-b", width: 53, height: 29, dx: 11, dy: 7, opacity: 0.7, flip: true },
  { id: "gl-veil-clouds-c", width: 71, height: 43, dx: 23, dy: 17, opacity: 0.5, flip: false },
] as const;

/** A place the sky is clear, in atlas percentage space. */
export type VeilOpening = { x: number; y: number; radius: number };

/** How far one mapped customer location clears the air, in atlas percent. */
const CUSTOMER_CLEAR_RADIUS = 7;
/** Extra reach per additional real customer at the same physical place. */
const CUSTOMER_CLEAR_PER_EXTRA = 1.6;
/** A stronghold is a landmark; it clears more than a single household. */
const STRONGHOLD_CLEAR_RADIUS = 15;
/** A territory you have cleared stays open. */
const CLEARED_TERRITORY_RADIUS = 16;

export function buildVeilOpenings(input: {
  clusters: readonly { x: number; y: number; total: number; outsideAtlas: boolean }[];
  territories: readonly {
    definition: { geometryMode: string; members: { physicalEntityId: string }[] };
    state: { cleared: boolean };
  }[];
  entities: readonly CityWorldEntity[];
}): VeilOpening[] {
  const openings: VeilOpening[] = [];

  // 1. Real customers. Their own light is what clears the sky.
  for (const cluster of input.clusters) {
    if (cluster.outsideAtlas) continue;
    openings.push({
      x: cluster.x,
      y: cluster.y,
      radius:
        CUSTOMER_CLEAR_RADIUS +
        Math.max(0, cluster.total - 1) * CUSTOMER_CLEAR_PER_EXTRA,
    });
  }

  // 2. Territories whose guardian has actually been beaten.
  for (const territory of input.territories) {
    if (!territory.state.cleared) continue;
    const members = territory.definition.members.flatMap(member => {
      const entity = input.entities.find(row => row.id === member.physicalEntityId);
      const latitude = entity?.location?.latitude;
      const longitude = entity?.location?.longitude;
      if (typeof latitude !== "number" || typeof longitude !== "number") return [];
      const atlas = projectLatLngToLanternAtlas({ latitude, longitude });
      if (atlas.outOfBounds) return [];
      return [{ physicalEntityId: member.physicalEntityId, atlas: { x: atlas.x, y: atlas.y } }];
    });
    if (!members.length) continue;
    const geometry = buildVeilGeometry({
      mode: territory.definition.geometryMode as never,
      members,
    });
    openings.push({
      x: geometry.centroid.x,
      y: geometry.centroid.y,
      radius: CLEARED_TERRITORY_RADIUS,
    });
  }

  // 3. The two canonical strongholds. Real buildings, never hidden.
  for (const geography of Object.values(CANONICAL_BUILDING_GEOGRAPHY)) {
    const atlas = projectLatLngToLanternAtlas(geography);
    if (atlas.outOfBounds) continue;
    openings.push({ x: atlas.x, y: atlas.y, radius: STRONGHOLD_CLEAR_RADIUS });
  }

  return openings;
}

export function WorldVeilLayer({
  clusters,
  entities,
}: {
  clusters: readonly { x: number; y: number; total: number; outsideAtlas: boolean }[];
  entities: readonly CityWorldEntity[];
}) {
  const territories = trpc.system.goldlineWorld.territories.useQuery(undefined, {
    staleTime: 10_000,
  });

  const openings = useMemo(
    () =>
      buildVeilOpenings({
        clusters,
        territories: territories.data ?? [],
        entities,
      }),
    [clusters, territories.data, entities]
  );

  return (
    <svg
      className="gl-world-veil"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <defs>
        {/*
          THE CLOUD FIELD, AND WHY IT IS THREE LAYERS.

          One tiled pattern reads as exactly what it is: a grid of repeated
          rectangles marching across the sky. Three layers at coprime tile sizes
          and different offsets have a combined repeat period far larger than
          the viewport, so no seam ever lines up with another and the eye finds
          no grid to lock onto.
        */}
        {CLOUD_LAYERS.map(layer => (
          <pattern
            key={layer.id}
            id={layer.id}
            width={layer.width}
            height={layer.height}
            patternUnits="userSpaceOnUse"
            patternTransform={`translate(${layer.dx} ${layer.dy})`}
          >
            <image
              href={BOARD_OVERLAYS.fog}
              width={layer.width}
              height={layer.height}
              preserveAspectRatio="none"
              opacity={layer.opacity}
              transform={layer.flip ? `scale(-1,1) translate(${-layer.width} 0)` : undefined}
            />
          </pattern>
        ))}

        {/* Soft-edged hole. Black hides the cloud, white keeps it. */}
        <radialGradient id="gl-veil-hole">
          <stop offset="0%" stopColor="#000000" />
          <stop offset="48%" stopColor="#000000" />
          <stop offset="100%" stopColor="#ffffff" />
        </radialGradient>

        <mask id="gl-veil-mask" maskUnits="userSpaceOnUse">
          {/* Cloud everywhere by default. The world starts unknown. */}
          <rect x="0" y="0" width="100" height="100" fill="#ffffff" />
          {openings.map((opening, index) => (
            <circle
              key={index}
              cx={opening.x}
              cy={opening.y}
              r={opening.radius}
              fill="url(#gl-veil-hole)"
            />
          ))}
        </mask>
      </defs>

      <g mask="url(#gl-veil-mask)">
        {/*
          A warm daylight body under the cloud art. Without it the tiled fog
          reads as grey smoke over a sunlit city; with it the veil looks like
          bright weather you have not flown through yet, which is the tone the
          whole world is held to.
        */}
        <rect x="0" y="0" width="100" height="100" fill="#fdfaf2" opacity="0.9" />
        {CLOUD_LAYERS.map(layer => (
          <rect
            key={layer.id}
            x="0"
            y="0"
            width="100"
            height="100"
            fill={`url(#${layer.id})`}
          />
        ))}
        {/* A faint warm cast so the veil belongs to the same sun as the city. */}
        <rect x="0" y="0" width="100" height="100" fill="#ffe9bd" opacity="0.16" />
      </g>
    </svg>
  );
}
