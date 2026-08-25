import type { OverworldRuntimePresentation } from "./types";

type AuthoredDepth = NonNullable<OverworldRuntimePresentation["depth"]>;

export function depthProgress(depth: AuthoredDepth, y: number): number {
  const span = depth.nearY - depth.farY;
  return span === 0
    ? 0
    : Math.max(0, Math.min(1, (depth.nearY - y) / span));
}

export function depthScaleAtY(depth: AuthoredDepth, y: number): number {
  const far = depthProgress(depth, y);
  return depth.nearScale + (depth.farScale - depth.nearScale) * far;
}

/** Used directly by the production movement path. */
export function depthSpeedFactorAtY(depth: AuthoredDepth, y: number): number {
  const far = depthProgress(depth, y);
  return 1 + ((depth.farSpeedFactor ?? 1) - 1) * far;
}
