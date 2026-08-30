/**
 * The scar layer that sits ON the tower art.
 *
 * Deliberately drawn as masonry repairs rather than damage: a patched panel,
 * a reset seam, a replacement section. The building looks like it was fixed,
 * which is what actually happened at the close of each settled day.
 *
 * It is painted UNDER today's damage effects and at low contrast, so today's
 * live match always reads first. History should be felt at a glance and only
 * resolve into individual events on inspection.
 */
import { useMemo } from "react";
import {
  boundsForBuilding,
  projectFacade,
  type FacadeScar,
  type PatinaZone,
  type SettledStratum,
} from "./facadeScars";

/**
 * Intrinsic size of both tower PNGs. The layer must letterbox and bottom-anchor
 * exactly as the <img> does (object-fit:contain, object-position:center bottom)
 * or scars drift off the silhouette onto sky.
 */
const ART_WIDTH = 800;
const ART_HEIGHT = 1200;
/** Marks are authored in a 100-unit space; scale them into the art's. */
const MARK_SCALE = 8;

/**
 * Older repairs have weathered further into the facade, but never vanish.
 * Tuned against the actual renders: the towers are photoreal and brightly lit,
 * so a low-contrast wash reads as nothing at all. These are plates.
 */
function scarOpacity(recency: number): number {
  return 0.55 + recency * 0.35;
}

function ScarMark({ scar }: { scar: FacadeScar }) {
  const common = {
    transform: `rotate(${scar.rotation})`,
    opacity: scarOpacity(scar.recency),
  };
  switch (scar.kind) {
    case "graft":
      return (
        <g {...common} className="tw-scar tw-scar--graft">
          <rect x={-3.4} y={-4.2} width={6.8} height={8.4} rx={0.4} />
          <line x1={-3.4} y1={-1.4} x2={3.4} y2={-1.4} />
          <line x1={-3.4} y1={1.4} x2={3.4} y2={1.4} />
          <line x1={0} y1={-4.2} x2={0} y2={4.2} />
        </g>
      );
    case "panel":
      return (
        <g {...common} className="tw-scar tw-scar--panel">
          <rect x={-2.6} y={-3} width={5.2} height={6} rx={0.3} />
          <line x1={-2.6} y1={0} x2={2.6} y2={0} />
        </g>
      );
    case "seam":
      // A sealed joint with stitching, NOT a zigzag crack: the day is over and
      // the damage was repaired. A jagged line would read as live damage and
      // compete with today's match.
      return (
        <g {...common} className="tw-scar tw-scar--seam">
          <path d="M -3 0 L 3 0" />
          <path d="M -2.2 -1.1 L -2.2 1.1" />
          <path d="M -0.7 -1.1 L -0.7 1.1" />
          <path d="M 0.7 -1.1 L 0.7 1.1" />
          <path d="M 2.2 -1.1 L 2.2 1.1" />
        </g>
      );
    case "patch":
    default:
      return (
        <g {...common} className="tw-scar tw-scar--patch">
          <rect x={-1.5} y={-1.5} width={3} height={3} rx={0.3} />
        </g>
      );
  }
}

/**
 * A consolidated era. Deliberately low-detail: it reads as accumulated
 * weathering on the lower structure, not as a stack of analytics bands.
 */
function PatinaBand({ zone }: { zone: PatinaZone }) {
  const x = (zone.xPercent / 100) * ART_WIDTH;
  const y = (zone.yPercent / 100) * ART_HEIGHT;
  const width = (zone.widthPercent / 100) * ART_WIDTH;
  const height = (zone.heightPercent / 100) * ART_HEIGHT;
  return (
    <rect
      className="tw-patina"
      x={x}
      y={y}
      width={width}
      height={height}
      opacity={0.1 + zone.intensity * 0.16}
    >
      <title>
        {`${zone.days} settled days, ${zone.fromDate} to ${zone.toDate}: ${zone.absorbedStrikes} repaired strikes`}
      </title>
    </rect>
  );
}

export function FacadeScarLayer({
  strata,
  buildingId,
  buildingName,
}: {
  strata: readonly SettledStratum[];
  buildingId: string;
  buildingName: string;
}) {
  const { scars, patina, compressed } = useMemo(
    () => projectFacade(strata, boundsForBuilding(buildingId)),
    [strata, buildingId]
  );

  if (!scars.length && !patina.length) return null;

  // Count the WHOLE record, not just what is drawn individually. Reporting
  // scars.length beside a full day count would announce a truncated strike
  // total against every settled day, which is simply wrong once history
  // compresses.
  const settledDays = strata.filter(s => s.incomingAttacks > 0);
  const totalAbsorbed = settledDays.reduce(
    (sum, s) => sum + s.incomingAttacks,
    0
  );
  const dayCount = settledDays.length;

  return (
    <svg
      className="tw-scar-layer"
      viewBox={`0 0 ${ART_WIDTH} ${ART_HEIGHT}`}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label={`${buildingName} carries ${totalAbsorbed} repaired ${
        totalAbsorbed === 1 ? "strike" : "strikes"
      } across ${dayCount} settled ${dayCount === 1 ? "day" : "days"}${
        compressed
          ? `; ${scars.length} shown individually and the rest consolidated into weathering at the base`
          : ""
      }`}
    >
      {/* Compressed eras first, so individual repairs sit on top of them. */}
      {patina.map(zone => (
        <PatinaBand key={zone.key} zone={zone} />
      ))}
      {scars.map(scar => (
        <g
          key={scar.key}
          transform={`translate(${(scar.xPercent / 100) * ART_WIDTH} ${
            (scar.yPercent / 100) * ART_HEIGHT
          }) scale(${MARK_SCALE})`}
        >
          <ScarMark scar={scar} />
        </g>
      ))}
    </svg>
  );
}
