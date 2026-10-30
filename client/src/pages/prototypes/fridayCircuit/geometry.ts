import type { Junction, Leg, Pad, Side } from "./model";

/** The tabletop, in SVG units. Pads and the junction stay put; the THEN and NOW layers slide beneath them. */
export type Point = { x: number; y: number };

export const BOARD = { width: 1000, height: 640 };
export const AT: Record<Pad | "J" | "H", Point> = {
  S: { x: 140, y: 470 },
  J: { x: 450, y: 470 },
  Q: { x: 830, y: 470 },
  P: { x: 450, y: 190 },
  H: { x: 830, y: 190 },
};
/** The junction's turntable radius: its three ports sit on this circle. */
export const JR = 48;
export const PORT: Record<Side, Point> = {
  west: { x: AT.J.x - JR, y: AT.J.y },
  north: { x: AT.J.x, y: AT.J.y - JR },
  east: { x: AT.J.x + JR, y: AT.J.y },
};
/** The hotel is a bend, rounded with this radius. */
const BEND = 44;

function arc(cx: number, cy: number, r: number, from: number, to: number, steps = 10): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const angle = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
  });
}

/** The rail inside the turntable for each position, from its first side's port to its second's. */
export function junctionRail(junction: Junction): Point[] {
  switch (junction) {
    case "west-east":
      return [PORT.west, PORT.east];
    case "west-north":
      // a quarter circle around the turntable's north-west corner
      return arc(AT.J.x - JR, AT.J.y - JR, JR, 90, 0);
    case "north-east":
      return arc(AT.J.x + JR, AT.J.y - JR, JR, 180, 90);
  }
}

export function railPath(points: Point[]): string {
  return points.map((point, i) => `${i ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

/** THEN's three tracks and NOW's two, as drawn on their layers (the junction's own rail is drawn on the turntable). */
export const THEN_TRACKS: Point[][] = [
  [AT.S, PORT.west],
  [PORT.north, AT.P],
  [PORT.east, AT.Q],
];
export const HOTEL_BEND: Point[] = [AT.P, { x: AT.H.x - BEND, y: AT.H.y }, ...arc(AT.H.x - BEND, AT.H.y + BEND, BEND, 270, 360, 8).slice(1), AT.Q];
export const NOW_TRACKS: Point[][] = [HOTEL_BEND];
/** where the invitation is handed over, at the middle of the bend */
export const DELIVERY_POINT: Point = arc(AT.H.x - BEND, AT.H.y + BEND, BEND, 315, 315, 1)[0];

const toward = (a: Point, b: Point, distance: number): Point => {
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + ((b.x - a.x) / length) * distance, y: a.y + ((b.y - a.y) / length) * distance };
};

const SIDE_OF: Record<Pad, Side> = { S: "west", P: "north", Q: "east" };

/** The points the courier passes on a leg, and where along them the invitation is delivered (if it is). */
export function legPoints(leg: Leg, junction: Junction): { points: Point[]; deliverAt: number | null } {
  if (leg.kind === "spun") return { points: [AT[leg.from]], deliverAt: null };
  if (leg.kind === "blocked") {
    // up to the turntable's rim on the side it doesn't join, nose against the spring stop
    const port = PORT[leg.side];
    return { points: [AT[leg.from], toward(port, AT[leg.from], 16)], deliverAt: null };
  }
  if (leg.path.includes("H")) {
    const points = leg.from === "P" ? HOTEL_BEND : [...HOTEL_BEND].reverse();
    // handed over at the middle of the bend, whichever way it's running
    const gap = (point: Point) => Math.hypot(point.x - DELIVERY_POINT.x, point.y - DELIVERY_POINT.y);
    const deliverAt = points.reduce((best, point, index) => (gap(point) < gap(points[best]) ? index : best), 0);
    return { points, deliverAt };
  }
  const rail = junctionRail(junction);
  const entering = SIDE_OF[leg.from];
  const through = junction.startsWith(entering) ? rail : [...rail].reverse();
  return { points: [AT[leg.from], ...through, AT[leg.to]], deliverAt: null };
}

/**
 * The whole round trip as one line, lit once the courier is home: out on THEN, round the hotel on NOW, home on THEN.
 * Clockwise (studio, P, hotel, Q, studio) when it came home from Q; the other way round when it came home from P.
 */
export function circuitRoute(homeFrom: Pad): Point[] {
  const clockwise = homeFrom !== "P";
  const first: Pad = clockwise ? "P" : "Q";
  const second: Pad = clockwise ? "Q" : "P";
  const out = legPoints({ kind: "docked", from: "S", to: first, path: ["S", "J", first], delivers: false }, clockwise ? "west-north" : "west-east");
  const across = legPoints({ kind: "docked", from: first, to: second, path: [first, "H", second], delivers: true }, "west-east");
  const back = legPoints({ kind: "docked", from: second, to: "S", path: [second, "J", "S"], delivers: false }, clockwise ? "west-east" : "west-north");
  return [...out.points, ...across.points.slice(1), ...back.points.slice(1)];
}

/** Distance along a polyline, and the point and heading at a fraction of it. */
export function polyline(points: Point[]) {
  const lengths = points.slice(1).map((point, i) => Math.hypot(point.x - points[i].x, point.y - points[i].y));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return {
    total,
    at(fraction: number): Point & { dx: number } {
      if (points.length === 1 || total === 0) return { ...points[0], dx: 0 };
      let remaining = Math.min(Math.max(fraction, 0), 1) * total;
      for (let i = 0; i < lengths.length; i += 1) {
        if (remaining <= lengths[i] || i === lengths.length - 1) {
          const t = lengths[i] ? Math.min(remaining / lengths[i], 1) : 1;
          const a = points[i];
          const b = points[i + 1];
          return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: b.x - a.x };
        }
        remaining -= lengths[i];
      }
      return { ...points[points.length - 1], dx: 0 };
    },
    /** how far along (0 to 1) a given point index sits */
    fractionOf(index: number): number {
      if (!total) return 0;
      return lengths.slice(0, index).reduce((sum, length) => sum + length, 0) / total;
    },
  };
}
