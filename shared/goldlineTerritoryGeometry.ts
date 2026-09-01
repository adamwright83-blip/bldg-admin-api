/**
 * Territory geometry as presentation.
 *
 * Membership truth is physicalEntityIds. The veil shape is derived from those
 * members' real coordinates so the world can show a street, a cluster or a
 * hull. Point-in-polygon never decides who belongs.
 */

import type { GeoPoint, TerritoryGeometryMode } from "./goldlineTerritories";

export type AtlasPoint = { x: number; y: number };

export type TerritoryVeilGeometry = {
  mode: TerritoryGeometryMode;
  /** Atlas-percent polygon used to draw the veil. Presentation only. */
  polygon: AtlasPoint[];
  centroid: AtlasPoint;
  memberApertures: Array<{
    physicalEntityId: string;
    point: AtlasPoint;
    radius: number;
  }>;
};

const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const radius = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const sin =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(sin)));
}

export function centroidOf(points: readonly GeoPoint[]): GeoPoint | null {
  if (!points.length) return null;
  const sum = points.reduce(
    (acc, point) => ({
      latitude: acc.latitude + point.latitude,
      longitude: acc.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 }
  );
  return {
    latitude: sum.latitude / points.length,
    longitude: sum.longitude / points.length,
  };
}

/**
 * Andrew's monotone chain. Stable given identical points; collinear points
 * stay on the hull so a street of three buildings does not collapse to a line
 * that cannot be drawn as a veil.
 */
export function convexHull(points: readonly AtlasPoint[]): AtlasPoint[] {
  const unique = [...points]
    .sort((a, b) => a.x - b.x || a.y - b.y)
    .filter((point, index, list) =>
      index === 0 || point.x !== list[index - 1]!.x || point.y !== list[index - 1]!.y
    );
  if (unique.length <= 2) return unique.map(point => ({ ...point }));

  const cross = (o: AtlasPoint, a: AtlasPoint, b: AtlasPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: AtlasPoint[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0)
      lower.pop();
    lower.push(point);
  }
  const upper: AtlasPoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0)
      upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function padPolygon(polygon: AtlasPoint[], pad: number): AtlasPoint[] {
  if (polygon.length === 0) return [];
  const cx = polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length;
  const cy = polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length;
  return polygon.map(point => {
    const dx = point.x - cx;
    const dy = point.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: cx + dx + (dx / length) * pad,
      y: cy + dy + (dy / length) * pad,
    };
  });
}

function corridorPolygon(ordered: AtlasPoint[], halfWidth: number): AtlasPoint[] {
  if (ordered.length === 0) return [];
  if (ordered.length === 1) {
    const point = ordered[0]!;
    return [
      { x: point.x - halfWidth, y: point.y - halfWidth },
      { x: point.x + halfWidth, y: point.y - halfWidth },
      { x: point.x + halfWidth, y: point.y + halfWidth },
      { x: point.x - halfWidth, y: point.y + halfWidth },
    ];
  }
  const left: AtlasPoint[] = [];
  const right: AtlasPoint[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const prev = ordered[Math.max(0, index - 1)]!;
    const next = ordered[Math.min(ordered.length - 1, index + 1)]!;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = (-dy / length) * halfWidth;
    const ny = (dx / length) * halfWidth;
    const point = ordered[index]!;
    left.push({ x: point.x + nx, y: point.y + ny });
    right.push({ x: point.x - nx, y: point.y - ny });
  }
  return left.concat(right.reverse());
}

export function classifyGeometryMode(points: readonly GeoPoint[]): Exclude<TerritoryGeometryMode, "authoritative_polygon"> {
  if (points.length < 2) return "cluster";
  const center = centroidOf(points)!;
  let maxAlong = 0;
  let maxAcross = 0;
  const ref = points[0]!;
  const axis = {
    x: ref.longitude - center.longitude,
    y: ref.latitude - center.latitude,
  };
  const axisLength = Math.hypot(axis.x, axis.y) || 1;
  const ux = axis.x / axisLength;
  const uy = axis.y / axisLength;
  for (const point of points) {
    const vx = point.longitude - center.longitude;
    const vy = point.latitude - center.latitude;
    maxAlong = Math.max(maxAlong, Math.abs(vx * ux + vy * uy));
    maxAcross = Math.max(maxAcross, Math.abs(vx * -uy + vy * ux));
  }
  if (maxAcross < 1e-9) return "corridor";
  return maxAlong / maxAcross >= 2.2 ? "corridor" : "cluster";
}

export function polygonToSvgPath(polygon: readonly AtlasPoint[]): string {
  if (polygon.length === 0) return "";
  const start = polygon[0]!;
  const rest = polygon
    .slice(1)
    .map(point => `L ${point.x.toFixed(3)} ${point.y.toFixed(3)}`)
    .join(" ");
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} ${rest} Z`;
}

export function buildVeilGeometry(input: {
  mode: TerritoryGeometryMode;
  members: Array<{ physicalEntityId: string; atlas: AtlasPoint }>;
  authoritativePolygon?: AtlasPoint[] | null;
}): TerritoryVeilGeometry {
  const points = input.members.map(member => member.atlas);
  const centroid = points.length
    ? {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      }
    : { x: 50, y: 50 };

  let polygon: AtlasPoint[];
  if (input.mode === "authoritative_polygon" && input.authoritativePolygon?.length) {
    polygon = input.authoritativePolygon.map(point => ({ ...point }));
  } else if (input.mode === "corridor") {
    const ordered = [...input.members]
      .sort((a, b) => a.atlas.x - b.atlas.x || a.atlas.y - b.atlas.y)
      .map(member => member.atlas);
    polygon = corridorPolygon(ordered, 1.8);
  } else {
    const hull = convexHull(points);
    polygon = padPolygon(hull.length >= 3 ? hull : points, 1.6);
  }

  return {
    mode: input.mode,
    polygon,
    centroid,
    memberApertures: input.members.map(member => ({
      physicalEntityId: member.physicalEntityId,
      point: member.atlas,
      radius: 1.35,
    })),
  };
}

export function pointInPolygon(point: AtlasPoint, polygon: readonly AtlasPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersect =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (intersect) inside = !inside;
  }
  return inside;
}
