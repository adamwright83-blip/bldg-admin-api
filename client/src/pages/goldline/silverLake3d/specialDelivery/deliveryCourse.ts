import type { CourseDef } from "./deliveryPhysics";

/**
 * Where Rook's airmail course sits in the real Silver Lake courtyard.
 *
 * The course is the open east lawn between the teal cottage and the yellow thatched cottage (no quest spots, no
 * villager doorstep in the plane). Seen from the plaza looking east, the afternoon sun behind the camera: Rook's
 * station stands by the teal cottage on the right (he faces left, his painted side), Bella's balcony is on the yellow
 * cottage's sunlit front on the left, and her wall is a forgiving backboard. The flight plane is the vertical plane
 * x = PLANE_X (Blender and three.js x).
 *
 * The simulation (deliveryPhysics.ts) runs left to right in its own x; deliveryScene.ts maps it onto the screen
 * right to left: screen u = -x + OFFSET, three.js (x, y, z) = (PLANE_X + depth, y, u).
 *
 * Three ways across, none scripted: an aimed lob straight into the basket; the high road (wings open over the fan,
 * ride the updraft, glide through the cups, fold to drop in); and the low road (laundry, Cleo, luck).
 */
export const PLANE_X = 9.4;

export const COURSE: CourseDef = {
  gravity: 7.5,
  launch: { x: -3.6, y: 1.2 },
  bounds: { minX: -7.4, maxX: 5.4, maxY: 7.4 },
  // a box fan on an upturned crate, blowing straight up unless someone turns it
  fan: { x: -2.2, y: 0.78, width: 1.0, reach: 3.1, strength: 7.0 },
  // the washing line, from the top of Rook's mast across to a hook on the yellow cottage above Bella
  line: { a: { x: -5.1, y: 4.75 }, b: { x: 4.4, y: 4.95 }, sag: 0.7 },
  // a sheet pegged out near the yellow cottage; a second, nearer the camera, only sways and hides things
  sheets: [{ x0: -3.35, x1: -2.75, drop: 0.95 }],
  // three cups hung out to dry on strings from the line, stepping down left to right
  cups: [
    { anchor: { x: -1.3, y: 0 }, length: 0.3, radius: 0.11 },
    { anchor: { x: -0.3, y: 0 }, length: 0.52, radius: 0.11 },
    { anchor: { x: 0.7, y: 0 }, length: 0.74, radius: 0.11 },
  ],
  // Cleo, asleep in the sun on the paving under the balcony, tail curled toward the launcher
  cat: {
    x: 1.1,
    y: 0,
    rx: 0.38,
    ry: 0.34,
    head: { x: 0.1, y: 0.86 },
    headR: 0.25,
    tailRoot: { x: -0.28, y: 0.16 },
    tailLen: 0.72,
    rest: 3.3,
    swat: { windup: 3.3, follow: 1.95, duration: 0.14 },
    fling: 14.5,
    flingAngle: 1.3,
    flingSpread: 1.2,
    rideMaxSpeed: 6,
  },
  // Bella's big wicker basket stands on her balcony against the yellow cottage, whose wall makes a forgiving backboard;
  // the balcony sits low enough under the thatch that Bella stands clear of the eave, beside her basket
  basket: { x: 3.05, y: 2.75, width: 1.0, depth: 0.55 },
  balcony: { x0: 2.35, x1: 4.4, floor: 2.2, rail: 2.95 },
  bella: { x: 3.95, y: 2.75, rx: 0.2, ry: 0.55 },
  station: { x0: -4.45, x1: -3.5, top: 1.0 },
  rook: { x: -4.75, reach: { x: -4.45, y: 1.55 }, radius: 0.42 },
  walls: [
    // Rook's mast behind the station, which holds the line's end
    { a: { x: -5.1, y: 0 }, b: { x: -5.1, y: 4.75 } },
    // the teal cottage, beyond the station
    { a: { x: -7.64, y: 0 }, b: { x: -7.64, y: 5.4 } },
    // the yellow cottage: the wall behind the balcony and the ground floor under it
    { a: { x: 4.4, y: 0 }, b: { x: 4.4, y: 5.2 } },
  ],
};

/** Cups hang from the line itself: their anchors sit on the line's resting curve. */
for (const cup of COURSE.cups) {
  const { a, b, sag } = COURSE.line;
  const s = (cup.anchor.x - a.x) / (b.x - a.x);
  cup.anchor.y = a.y + (b.y - a.y) * s - 4 * sag * s * (1 - s);
}
