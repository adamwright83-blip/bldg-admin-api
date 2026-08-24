import { GOLDLINE_OVERWORLD_MAP } from "./mapDefinition";
import { nearestValidPoint, surfaceAtPoint } from "./navigation";
import type { OverworldCheckpoint, OverworldFacing } from "./types";

const PREFIX = "goldline:overworld-checkpoint:v1";

export function overworldCheckpointKey(identity: string | null) {
  return `${PREFIX}:${identity?.length ? identity : "anon"}`;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function sanitizeOverworldCheckpoint(
  input: OverworldCheckpoint
): OverworldCheckpoint {
  return {
    mapVersion: input.mapVersion,
    x: input.x,
    y: input.y,
    surfaceId: input.surfaceId,
    facing: input.facing,
    savedAt: input.savedAt,
  };
}

export function saveOverworldCheckpoint(
  input: OverworldCheckpoint,
  identity: string | null
) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      overworldCheckpointKey(identity),
      JSON.stringify(sanitizeOverworldCheckpoint(input))
    );
  } catch {
    /* positional continuity is best-effort */
  }
}

export function loadOverworldCheckpoint(
  identity: string | null
): OverworldCheckpoint | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(overworldCheckpointKey(identity));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<OverworldCheckpoint>;
    const facings: OverworldFacing[] = ["front", "back", "left", "right"];
    if (
      value.mapVersion !== GOLDLINE_OVERWORLD_MAP.version ||
      typeof value.x !== "number" ||
      typeof value.y !== "number" ||
      typeof value.surfaceId !== "string" ||
      !facings.includes(value.facing as OverworldFacing)
    )
      return null;
    const recovered = nearestValidPoint(GOLDLINE_OVERWORLD_MAP, {
      x: value.x,
      y: value.y,
    });
    return sanitizeOverworldCheckpoint({
      mapVersion: GOLDLINE_OVERWORLD_MAP.version,
      x: recovered.x,
      y: recovered.y,
      surfaceId:
        surfaceAtPoint(GOLDLINE_OVERWORLD_MAP, recovered) ??
        recovered.surfaceId,
      facing: value.facing as OverworldFacing,
      savedAt:
        typeof value.savedAt === "string"
          ? value.savedAt
          : new Date().toISOString(),
    });
  } catch {
    return null;
  }
}
