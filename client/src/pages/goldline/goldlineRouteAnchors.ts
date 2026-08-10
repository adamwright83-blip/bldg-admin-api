import type { CSSProperties } from "react";

export type GoldlineLabelPlacement = "above-right" | "right" | "below";

export type GoldlineRouteAnchor = {
  id: string;
  xPercent: number;
  yPercent: number;
  labelPlacement: GoldlineLabelPlacement;
};

/**
 * Coordinates use the native 862 x 1825 Goldline artwork, not the viewport.
 * The order follows the river away from the Operator toward the upper city.
 */
export const GOLDLINE_ROUTE_ANCHORS = [
  {
    id: "lower-gold-reliquary",
    xPercent: 68.5,
    yPercent: 71,
    labelPlacement: "above-right",
  },
  {
    id: "central-cyan-reliquary",
    xPercent: 42,
    yPercent: 58,
    labelPlacement: "right",
  },
  {
    id: "mid-river-gold-temple",
    xPercent: 35,
    yPercent: 43.5,
    labelPlacement: "right",
  },
  {
    id: "upper-river-landing",
    xPercent: 58.5,
    yPercent: 33,
    labelPlacement: "below",
  },
] as const satisfies readonly GoldlineRouteAnchor[];

/** The Operator occupies the lower-left foreground of the approved world. */
export const OPERATOR_EXCLUSION_REGION = {
  xMinPercent: 0,
  xMaxPercent: 42,
  yMinPercent: 53,
  yMaxPercent: 96,
} as const;

export function anchorIsInsideRegion(
  anchor: GoldlineRouteAnchor,
  region: typeof OPERATOR_EXCLUSION_REGION
): boolean {
  return (
    anchor.xPercent >= region.xMinPercent &&
    anchor.xPercent <= region.xMaxPercent &&
    anchor.yPercent >= region.yMinPercent &&
    anchor.yPercent <= region.yMaxPercent
  );
}

export function goldlineAnchorStyle(
  anchor: GoldlineRouteAnchor
): CSSProperties {
  return {
    "--goldline-anchor-x": `${anchor.xPercent}%`,
    "--goldline-anchor-y": `${anchor.yPercent}%`,
  } as CSSProperties;
}
