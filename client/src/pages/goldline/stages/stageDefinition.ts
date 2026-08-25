import type { OcclusionRegion, OverworldMapDefinition, OverworldPoint } from "../overworld/types";
import { depthScaleAtY, depthSpeedFactorAtY } from "../overworld/perspective";

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
  return depthScaleAtY(presentation.depth, y);
}

export function depthSpeedFactor(presentation: GoldlineStagePresentation, y: number): number {
  return depthSpeedFactorAtY(presentation.depth, y);
}
