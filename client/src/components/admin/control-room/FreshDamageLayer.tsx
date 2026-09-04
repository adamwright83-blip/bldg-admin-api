/**
 * Today's wounds, drawn on the building.
 *
 * Sits above the settled scars and below the weapon overlays, and shares the
 * 800x1200 art space so it letterboxes and bottom-anchors exactly like the plate.
 * Deliberately louder than the scar layer: a scar is a memory, a wound is happening.
 */
import { useMemo } from "react";
import {
  freshDamageAtStrike,
  projectFreshDamage,
  type FreshWound,
} from "./freshDamage";
import { ART_SPACE } from "./buildingArt";

/**
 * Wounds must read decisively. A subtle crack is a failure: a first-time viewer
 * has to see that a giant weapon just hit the building.
 */
const MARK_SCALE = 16;

/** The newest wound burns; older ones have cooled but have not closed. */
function woundOpacity(heat: number): number {
  return 0.72 + heat * 0.28;
}

function WoundMark({ wound }: { wound: FreshWound }) {
  const common = {
    transform: `rotate(${wound.rotation})`,
    opacity: woundOpacity(wound.heat),
  };
  switch (wound.kind) {
    case "collapse":
      // A section has come away entirely.
      return (
        <g {...common} className="tw-wound tw-wound--collapse">
          <path d="M -5 -5.5 L 1 -6.5 L 5.5 -2 L 4 3 L 6 5.5 L -1 6.5 L -5.5 3 L -4 -1 Z" />
          <path className="tw-wound-core" d="M -3 -3 L 0.5 -3.8 L 3.2 -0.6 L 2 2.6 L -1.4 3.6 L -3.4 0.8 Z" />
          <path className="tw-wound-spall" d="M -5 -5.5 L -7.5 -7 M 5.5 -2 L 8 -3 M -1 6.5 L -1.5 9" />
        </g>
      );
    case "rupture":
      return (
        <g {...common} className="tw-wound tw-wound--rupture">
          <path d="M -4 -4 L 1.5 -4.8 L 4.2 -1 L 3 3 L -2 4.2 L -4.4 1 Z" />
          <path className="tw-wound-core" d="M -2 -1.8 L 1.2 -2.4 L 2.4 0.4 L 0.6 2.4 L -1.8 1.6 Z" />
          <path className="tw-wound-spall" d="M 4.2 -1 L 6.4 -1.8 M -4.4 1 L -6.6 2" />
        </g>
      );
    case "breach":
      return (
        <g {...common} className="tw-wound tw-wound--breach">
          <path d="M -2.8 -2.6 L 1 -3.2 L 3 -0.4 L 1.8 2.4 L -1.6 2.8 L -3 0.4 Z" />
          <path className="tw-wound-core" d="M -1.2 -1 L 0.8 -1.4 L 1.4 0.6 L -0.4 1.4 Z" />
        </g>
      );
    case "scorch":
    default:
      return (
        <g {...common} className="tw-wound tw-wound--scorch">
          <path d="M -2 -1.8 L 1.4 -2.2 L 2.4 0.2 L 0.8 2 L -1.8 1.4 Z" />
        </g>
      );
  }
}

export function FreshDamageLayer({
  buildingId,
  buildingName,
  businessDate,
  incomingToday,
  strikesRevealed,
}: {
  buildingId: string;
  buildingName: string;
  businessDate: string;
  incomingToday: number;
  /**
   * How many of today's strikes have actually landed on screen. During replay this
   * is the prefix count, so damage at event N equals business state after event N.
   * Omit to show all of today's damage.
   */
  strikesRevealed?: number;
}) {
  const wounds = useMemo(
    () => projectFreshDamage({ buildingId, businessDate, incomingToday }),
    [buildingId, businessDate, incomingToday]
  );
  const visible = useMemo(
    () =>
      strikesRevealed == null
        ? wounds
        : freshDamageAtStrike(wounds, strikesRevealed),
    [wounds, strikesRevealed]
  );

  if (!visible.length) return null;

  return (
    <svg
      className="tw-wound-layer"
      viewBox={`0 0 ${ART_SPACE.width} ${ART_SPACE.height}`}
      preserveAspectRatio="xMidYMax meet"
      role="img"
      aria-label={`${buildingName} has taken ${visible.length} ${
        visible.length === 1 ? "strike" : "strikes"
      } today`}
    >
      {visible.map(wound => (
        <g
          key={wound.key}
          transform={`translate(${(wound.xPercent / 100) * ART_SPACE.width} ${
            (wound.yPercent / 100) * ART_SPACE.height
          }) scale(${MARK_SCALE})`}
        >
          <WoundMark wound={wound} />
          <g className="tw-fracture" transform={`rotate(${wound.rotation})`}>
            <path d="M0 0 -3 -2 -6 -6 -9 -7 M-6 -6 -5 -9 M0 0 4 -3 7 -3 10 -6 M4 -3 3 -7 M0 0 3 4 7 6 8 9 M3 4 1 8 M0 0 -4 3 -8 4 -10 7 M-4 3 -5 7" />
            <path className="tw-fracture-glint" d="m-5 -3 -2 -2 1 3Zm8 5 3 1-1-3ZM2-5 4-7 5-4Z" />
          </g>
        </g>
      ))}
    </svg>
  );
}
