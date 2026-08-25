import type { OcclusionRegion, OverworldMapDefinition, OverworldPoint } from "../overworld/types";

/** Presentation metadata missing from the existing physical-world contract. */
export type GoldlineStagePresentation = {
  referenceAsset: string;
  backgroundAsset: string | null;
  provisionalArt: boolean;
  foregroundMasks: Array<OcclusionRegion & { source: string }>;
  liveEntityIds: string[];
  depth: { nearY: number; farY: number; nearScale: number; farScale: number; farSpeedFactor: number };
  camera: { zoom: number; damping: number; lookAheadSeconds: number; start: OverworldPoint };
};

export type GoldlineStageDefinition = { map: OverworldMapDefinition; presentation: GoldlineStagePresentation };

export function depthScale(presentation: GoldlineStagePresentation, y: number): number {
  const { depth } = presentation;
  const span = depth.nearY - depth.farY;
  const t = span === 0 ? 0 : Math.max(0, Math.min(1, (depth.nearY - y) / span));
  return depth.nearScale + (depth.farScale - depth.nearScale) * t;
}

export function depthSpeedFactor(presentation: GoldlineStagePresentation, y: number): number {
  const { depth } = presentation;
  const scale = depthScale(presentation, y);
  const span = depth.nearScale - depth.farScale;
  const far = span === 0 ? 0 : (depth.nearScale - scale) / span;
  return 1 + (depth.farSpeedFactor - 1) * far;
}
