/**
 * Authored gold route — replaces the generic 2-point bezier with a polyline
 * traced from the actual gold-inlay pixels in corridor_01/mid.webp (see
 * gold_route.json for the trace methodology). `lateralForProgress` returns
 * the route's own centerline as a 0..1 fraction of screen width; the
 * player's free joystick deviation is added on top of this, not instead of
 * it, so pushing left/right still moves off the authored line exactly as it
 * did against the old formula-only path.
 */

export type GoldRoutePoint = { progress: number; lateral: number };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseGoldRoute(payload: unknown): GoldRoutePoint[] {
  if (!payload || typeof payload !== "object") return [];
  const points = (payload as { points?: unknown }).points;
  if (!Array.isArray(points)) return [];
  const parsed = points
    .map((raw): GoldRoutePoint | null => {
      if (!raw || typeof raw !== "object") return null;
      const record = raw as Record<string, unknown>;
      if (!isFiniteNumber(record.progress) || !isFiniteNumber(record.lateral)) return null;
      return { progress: record.progress, lateral: record.lateral };
    })
    .filter((point): point is GoldRoutePoint => point !== null)
    .sort((a, b) => a.progress - b.progress);
  return parsed;
}

/** Piecewise-linear interpolation across the authored points. Clamps at ends. */
export function lateralForProgress(points: GoldRoutePoint[], progress: number): number {
  if (points.length === 0) return 0.5;
  if (progress <= points[0]!.progress) return points[0]!.lateral;
  const last = points[points.length - 1]!;
  if (progress >= last.progress) return last.lateral;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (progress >= a.progress && progress <= b.progress) {
      const span = b.progress - a.progress;
      const t = span === 0 ? 0 : (progress - a.progress) / span;
      return a.lateral + (b.lateral - a.lateral) * t;
    }
  }
  return last.lateral;
}

export async function loadGoldRoute(basePath: string): Promise<GoldRoutePoint[]> {
  try {
    const response = await fetch(`${basePath}/gold_route.json`);
    if (!response.ok) return [];
    return parseGoldRoute(await response.json());
  } catch {
    return [];
  }
}
