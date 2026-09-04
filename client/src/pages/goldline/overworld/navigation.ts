import type {
  OverworldMapDefinition,
  OverworldPoint,
  PathCorridor,
} from "./types";

export function distance(a: OverworldPoint, b: OverworldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointInPolygon(
  point: OverworldPoint,
  polygon: OverworldPoint[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function closestPointOnSegment(
  point: OverworldPoint,
  start: OverworldPoint,
  end: OverworldPoint
): OverworldPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return start;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
    )
  );
  return { x: start.x + dx * t, y: start.y + dy * t };
}

export function closestPointOnCorridor(
  point: OverworldPoint,
  corridor: PathCorridor
) {
  let nearest = corridor.points[0]!;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < corridor.points.length; index += 1) {
    const candidate = closestPointOnSegment(
      point,
      corridor.points[index - 1]!,
      corridor.points[index]!
    );
    const candidateDistance = distance(point, candidate);
    if (candidateDistance < nearestDistance) {
      nearest = candidate;
      nearestDistance = candidateDistance;
    }
  }
  return { point: nearest, distance: nearestDistance };
}

export function surfaceAtPoint(
  map: OverworldMapDefinition,
  point: OverworldPoint
): string | null {
  if (map.blockedRegions?.some(region => pointInPolygon(point, region.polygon))) return null;
  const surface = map.surfaces.find(item =>
    pointInPolygon(point, item.polygon)
  );
  if (surface) return surface.id;
  const corridor = map.corridors.find(
    item => closestPointOnCorridor(point, item).distance <= item.halfWidth
  );
  return corridor?.id ?? null;
}

export function materialAtPoint(
  map: OverworldMapDefinition,
  point: OverworldPoint
) {
  const surface = map.surfaces.find(item =>
    pointInPolygon(point, item.polygon)
  );
  if (surface) return surface.material;
  return (
    map.corridors.find(
      item => closestPointOnCorridor(point, item).distance <= item.halfWidth
    )?.material ?? "stone"
  );
}

export function isWalkable(
  map: OverworldMapDefinition,
  point: OverworldPoint,
  radius = 0
): boolean {
  const samples =
    radius > 0
      ? [
          point,
          ...Array.from({ length: 8 }, (_, index) => {
            const angle = (index / 8) * Math.PI * 2;
            return {
              x: point.x + Math.cos(angle) * radius,
              y: point.y + Math.sin(angle) * radius,
            };
          }),
        ]
      : [point];
  return samples.every(sample => surfaceAtPoint(map, sample) !== null);
}

export function nearestValidPoint(
  map: OverworldMapDefinition,
  point: OverworldPoint,
  radius = 11
): OverworldPoint & { surfaceId: string } {
  if (isWalkable(map, point, radius)) {
    return { ...point, surfaceId: surfaceAtPoint(map, point)! };
  }
  let best = map.spawns[map.defaultSpawnId]!;
  let bestDistance = distance(point, best);
  for (const corridor of map.corridors) {
    const candidate = closestPointOnCorridor(point, corridor).point;
    if (
      isWalkable(map, candidate, radius) &&
      distance(point, candidate) < bestDistance
    ) {
      best = { ...candidate, surfaceId: corridor.id };
      bestDistance = distance(point, candidate);
    }
  }
  for (const spawn of Object.values(map.spawns)) {
    if (distance(point, spawn) < bestDistance) {
      best = spawn;
      bestDistance = distance(point, spawn);
    }
  }
  return best;
}

export function moveWithCollision(
  map: OverworldMapDefinition,
  current: OverworldPoint,
  delta: OverworldPoint,
  radius = 11
): OverworldPoint {
  const length = Math.hypot(delta.x, delta.y);
  const steps = Math.max(1, Math.ceil(length / Math.max(3, radius * 0.45)));
  let position = current;
  for (let step = 0; step < steps; step += 1) {
    const xDelta = delta.x / steps;
    const yDelta = delta.y / steps;
    const direct = { x: position.x + xDelta, y: position.y + yDelta };
    if (isWalkable(map, direct, radius)) {
      position = direct;
      continue;
    }
    const slideX = { x: position.x + xDelta, y: position.y };
    const slideY = { x: position.x, y: position.y + yDelta };
    if (isWalkable(map, slideX, radius)) position = slideX;
    else if (isWalkable(map, slideY, radius)) position = slideY;
  }
  return position;
}

export function applyCorridorAssist(
  map: OverworldMapDefinition,
  position: OverworldPoint,
  deltaSeconds: number
): OverworldPoint {
  for (const corridor of map.corridors) {
    if (!corridor.centerAssist) continue;
    const nearest = closestPointOnCorridor(position, corridor);
    if (nearest.distance > corridor.halfWidth * 0.9) continue;
    const strength = Math.min(1, corridor.centerAssist * deltaSeconds * 6);
    return {
      x: position.x + (nearest.point.x - position.x) * strength,
      y: position.y + (nearest.point.y - position.y) * strength,
    };
  }
  return position;
}
