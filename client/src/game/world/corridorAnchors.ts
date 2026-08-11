/**
 * Interaction anchors and occlusion zones for corridor_01.
 *
 * Data lives in `client/public/assets/goldline/corridor_01/*.json` (the
 * documented asset contract) and is parsed here with a runtime shape check —
 * malformed or missing data degrades to an empty list rather than throwing,
 * since a corrupt fixture must never break traversal.
 */

export type CorridorAnchorType = "comms_portal" | "stronghold";

export type CorridorAnchor = {
  id: string;
  type: CorridorAnchorType;
  /** progress: 0..1 along the corridor. lateral: -1..1 across it. */
  position: { progress: number; lateral: number };
  /** Radius (in the same progress/lateral units) at which the label fades in. */
  labelRadius: number;
  /** Tighter radius at which ENGAGE becomes available. */
  interactionRadius: number;
  missionBinding: string;
};

export type OcclusionZone = {
  id: string;
  bounds: {
    progressMin: number;
    progressMax: number;
    lateralMin: number;
    lateralMax: number;
  };
  occluderZIndex: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseAnchor(raw: unknown): CorridorAnchor | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const position = record.position as Record<string, unknown> | undefined;
  if (
    typeof record.id !== "string" ||
    (record.type !== "comms_portal" && record.type !== "stronghold") ||
    !position ||
    !isFiniteNumber(position.progress) ||
    !isFiniteNumber(position.lateral) ||
    !isFiniteNumber(record.labelRadius) ||
    !isFiniteNumber(record.interactionRadius) ||
    typeof record.missionBinding !== "string"
  ) {
    return null;
  }
  return {
    id: record.id,
    type: record.type,
    position: { progress: position.progress, lateral: position.lateral },
    labelRadius: record.labelRadius,
    interactionRadius: record.interactionRadius,
    missionBinding: record.missionBinding,
  };
}

function parseZone(raw: unknown): OcclusionZone | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const bounds = record.bounds as Record<string, unknown> | undefined;
  if (
    typeof record.id !== "string" ||
    !bounds ||
    !isFiniteNumber(bounds.progressMin) ||
    !isFiniteNumber(bounds.progressMax) ||
    !isFiniteNumber(bounds.lateralMin) ||
    !isFiniteNumber(bounds.lateralMax) ||
    !isFiniteNumber(record.occluderZIndex)
  ) {
    return null;
  }
  return {
    id: record.id,
    bounds: {
      progressMin: bounds.progressMin,
      progressMax: bounds.progressMax,
      lateralMin: bounds.lateralMin,
      lateralMax: bounds.lateralMax,
    },
    occluderZIndex: record.occluderZIndex,
  };
}

export function parseCorridorAnchors(payload: unknown): CorridorAnchor[] {
  if (!payload || typeof payload !== "object") return [];
  const anchors = (payload as { anchors?: unknown }).anchors;
  if (!Array.isArray(anchors)) return [];
  return anchors.map(parseAnchor).filter((anchor): anchor is CorridorAnchor => anchor !== null);
}

export function parseOcclusionZones(payload: unknown): OcclusionZone[] {
  if (!payload || typeof payload !== "object") return [];
  const zones = (payload as { zones?: unknown }).zones;
  if (!Array.isArray(zones)) return [];
  return zones.map(parseZone).filter((zone): zone is OcclusionZone => zone !== null);
}

/** Distance in corridor units — not a real-world unit, just anchor proximity. */
export function anchorDistance(
  anchor: CorridorAnchor,
  playerProgress: number,
  playerLateral: number
): number {
  const dp = anchor.position.progress - playerProgress;
  const dl = anchor.position.lateral - playerLateral;
  return Math.hypot(dp, dl);
}

export function pointInZone(
  zone: OcclusionZone,
  progress: number,
  lateral: number
): boolean {
  return (
    progress >= zone.bounds.progressMin &&
    progress <= zone.bounds.progressMax &&
    lateral >= zone.bounds.lateralMin &&
    lateral <= zone.bounds.lateralMax
  );
}

export async function loadCorridorAnchors(basePath: string): Promise<{
  anchors: CorridorAnchor[];
  zones: OcclusionZone[];
}> {
  try {
    const [traversalResponse, occlusionResponse] = await Promise.all([
      fetch(`${basePath}/traversal.json`),
      fetch(`${basePath}/occlusion.json`),
    ]);
    const [traversal, occlusion] = await Promise.all([
      traversalResponse.ok ? traversalResponse.json() : null,
      occlusionResponse.ok ? occlusionResponse.json() : null,
    ]);
    return {
      anchors: parseCorridorAnchors(traversal),
      zones: parseOcclusionZones(occlusion),
    };
  } catch {
    // A missing/broken fixture must never break traversal — just no anchors.
    return { anchors: [], zones: [] };
  }
}
