/**
 * THE UNCONQUERED CITY, DRAWN AS WEATHER — AND THE GUARDIANS STANDING ON IT.
 *
 * A neighbourhood where you have customers is clear. A neighbourhood where you
 * have none is under cloud, with a guardian on top of it. That is the whole
 * rule, and it comes straight from real geocoded customers — see
 * `shared/neighbourhoodVeil.ts` for why reveal is per NEIGHBOURHOOD rather than
 * per customer, and for the case where the cloud must not be drawn at all.
 *
 * WHY THE CLOUD IS PAINTED PER NEIGHBOURHOOD, NOT MASKED GLOBALLY
 *
 * The previous version clouded the whole map and cut holes out of it. Against
 * real data that inverted: with customers spread over nine districts the map
 * was mostly holes, the surviving cloud was a lattice of gaps between them, and
 * a neighbourhood the operator genuinely owns still had weather sitting on it.
 * Painting only the clouded neighbourhoods means a district you work is clear
 * to its edges, and the sky is only ever drawn where the claim is true.
 */
import { useMemo } from "react";
import { GuardianActor } from "../GuardianActor";
import { BOARD_OVERLAYS } from "@shared/goldlineBoardKit";
import {
  deriveNeighbourhoodVeil,
  selectActiveCloudGuardians,
  type NeighbourhoodVeil,
} from "@shared/neighbourhoodVeil";

/**
 * The overlapping cloud fields.
 *
 * Tile sizes are coprime so their seams never coincide; one tiled pattern read
 * as exactly what it was, a grid of rectangles marching across the sky.
 */
const CLOUD_LAYERS = [
  { id: "gl-veil-clouds-a", width: 37, height: 21, dx: 0, dy: 0, opacity: 0.95, flip: false },
  { id: "gl-veil-clouds-b", width: 53, height: 29, dx: 11, dy: 7, opacity: 0.7, flip: true },
  { id: "gl-veil-clouds-c", width: 71, height: 43, dx: 23, dy: 17, opacity: 0.5, flip: false },
] as const;

export function WorldVeilLayer({
  clusters,
  totalCustomers,
  atlasReady,
  onConfront,
}: {
  /** Mapped customer clusters, already projected into atlas space. */
  clusters: readonly { x: number; y: number; outsideAtlas: boolean }[];
  /** Everything the atlas knows about, mapped or not. */
  totalCustomers: number;
  atlasReady: boolean;
  onConfront?: (neighbourhood: NeighbourhoodVeil) => void;
}) {
  const derivation = useMemo(
    () =>
      deriveNeighbourhoodVeil({
        mappedCustomers: clusters.filter(cluster => !cluster.outsideAtlas),
        totalCustomers,
        atlasReady,
      }),
    [clusters, totalCustomers, atlasReady]
  );

  // Nothing is drawn when the absence of lanterns is a pipeline gap rather
  // than an unconquered city. An incomplete screen beats a confident lie.
  if (derivation.suppressed) return null;

  const mappedCustomers = clusters.filter(cluster => !cluster.outsideAtlas);
  const clouded = selectActiveCloudGuardians(
    derivation.neighbourhoods,
    mappedCustomers
  );
  if (!clouded.length) return null;

  return (
    <>
      <svg
        className="gl-world-veil"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
        focusable="false"
      >
        <defs>
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
                transform={
                  layer.flip ? `scale(-1,1) translate(${-layer.width} 0)` : undefined
                }
              />
            </pattern>
          ))}

          {/* Solid at the centre, gone at the rim, so adjacent clouded
              neighbourhoods merge into overcast instead of reading as discs. */}
          <radialGradient id="gl-veil-falloff">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#000000" />
          </radialGradient>

          <mask id="gl-veil-mask" maskUnits="userSpaceOnUse">
            {/* Black hides. Only the clouded neighbourhoods are painted. */}
            <rect x="0" y="0" width="100" height="100" fill="#000000" />
            {clouded.map(neighbourhood => (
              <circle
                key={neighbourhood.name}
                cx={neighbourhood.x}
                cy={neighbourhood.y}
                r={neighbourhood.cloudRadius}
                fill="url(#gl-veil-falloff)"
              />
            ))}
          </mask>
        </defs>

        <g mask="url(#gl-veil-mask)">
          {/* Warm daylight body first, or the tiled fog reads as grey smoke. */}
          <rect x="0" y="0" width="100" height="100" fill="#fdfaf2" opacity="0.92" />
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
          <rect x="0" y="0" width="100" height="100" fill="#ffe9bd" opacity="0.16" />
        </g>
      </svg>

      {/*
        A guardian stands on every clouded neighbourhood. This is the threat
        layer: the operator can see, without reading anything, exactly which
        districts are still holding out and who is holding them.
      */}
      {clouded.map(neighbourhood => (
        <div
          key={neighbourhood.name}
          className="gl-veil-guardian"
          data-neighbourhood={neighbourhood.name}
          style={{ left: `${neighbourhood.x}%`, top: `${neighbourhood.y}%` }}
        >
          <GuardianActor guardianId={neighbourhood.guardianId!} phase="notice" />
          <button
            type="button"
            className="gl-veil-guardian-hit"
            onClick={() => onConfront?.(neighbourhood)}
            aria-label={`${neighbourhood.name} is under cloud. No customers here yet.`}
          />
          <span className="gl-veil-plate" aria-hidden>
            <strong>{neighbourhood.name}</strong>
            <small>Unclaimed</small>
          </span>
        </div>
      ))}
    </>
  );
}
