/**
 * Century Park East, the building's measurements and room plan. Shared by the runtime (gameplay, colliders) and the
 * set dressing (what the rooms look like) so neither can drift from the other. Metres; x runs along the cutaway,
 * y is up, the back wall is at z = -DEPTH and the open (cut) front is at z ≈ 0.
 */
export const FLOOR_H = 4.4;
export const WALL_H = 3.5;
export const DEPTH = 5;
export const DOOR_Z0 = -3.4;
export const DOOR_Z1 = -1.3;
export const ELEV_X0 = 27;
export const ELEV_X1 = 30;
export const WIDTH = 38;
export const SLAB = 0.42;

export type RoomKind = "package" | "mail" | "lobby" | "elevator" | "leasing" | "laundry" | "gym" | "closets" | "spa" | "pool" | "lounge";
export type Room = { name: string; kind: RoomKind; x0: number; x1: number; wall: string; floor: string; open?: boolean };
export const FLOORS: { name: string; rooms: Room[] }[] = [
  {
    name: "Ground floor",
    rooms: [
      { name: "Package room", kind: "package", x0: 0, x1: 8, wall: "#c8674e", floor: "#8a6a52" },
      { name: "Mailroom", kind: "mail", x0: 8, x1: 15, wall: "#8fa68a", floor: "#6f6a5e" },
      { name: "Lobby", kind: "lobby", x0: 15, x1: 27, wall: "#e2d2b6", floor: "#c9b9a2" },
      { name: "Elevator", kind: "elevator", x0: ELEV_X0, x1: ELEV_X1, wall: "#a99c8a", floor: "#3a3346" },
      { name: "Leasing lounge", kind: "leasing", x0: 30, x1: 38, wall: "#4f7b86", floor: "#b89a74" },
    ],
  },
  {
    name: "Amenity floor",
    rooms: [
      { name: "Laundry room", kind: "laundry", x0: 0, x1: 9, wall: "#b9c6cf", floor: "#9aa7b0" },
      { name: "Gym", kind: "gym", x0: 9, x1: 18, wall: "#d9a55b", floor: "#40434a" },
      { name: "Closet hall", kind: "closets", x0: 18, x1: 27, wall: "#7d5a78", floor: "#c9b49a" },
      { name: "Elevator", kind: "elevator", x0: ELEV_X0, x1: ELEV_X1, wall: "#a99c8a", floor: "#3a3346" },
      { name: "Dog spa", kind: "spa", x0: 30, x1: 38, wall: "#d9a9a0", floor: "#b9a596" },
    ],
  },
  {
    name: "Roof",
    rooms: [
      { name: "Pool deck", kind: "pool", x0: 0, x1: 27, wall: "#5f6f52", floor: "#d6c4a6", open: true },
      { name: "Elevator", kind: "elevator", x0: ELEV_X0, x1: ELEV_X1, wall: "#a99c8a", floor: "#3a3346" },
      { name: "Sky lounge", kind: "lounge", x0: 30, x1: 38, wall: "#3e3550", floor: "#8a6a52" },
    ],
  },
];
export const fy = (floor: number) => floor * FLOOR_H;

// ------------------------------------------------------------------ what blocks movement
export const PLAYER_RADIUS = 0.3;
export type Collider = { floor: number; x0: number; x1: number; z0: number; z1: number };
/** true when a circle of radius r at (x, z) overlaps the box */
export const hitsCollider = (b: Collider, x: number, z: number, r = PLAYER_RADIUS): boolean => x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1;

/**
 * Fire-station holes: a round hole in the ceiling with a knotted rope hanging through it, one per floor that has a
 * floor above. Climbing lands her a step to the right of the hole on the floor above.
 */
export const ROPES: { floor: number; x: number; z: number }[] = [
  { floor: 0, x: 13.2, z: -1.6 }, // the mailroom, up to the gym
  { floor: 1, x: 6.6, z: -1.7 }, // the laundry room, up to the pool deck
];
export const ROPE_LANDING_DX = 0.9;
/** The roof's larger pool needs a little more front-deck clearance after mantling. */
export const ROOF_ROPE_LANDING_DZ = 0.45;
export const ROPE_HOLE_RADIUS = 0.62;

/** the plunge pool with its coping: it starts east of the laundry rope's hole so the landing and the hole stay clear */
export const ROOF_POOL: Collider = { floor: 2, x0: 8.6, x1: 18.25, z0: -4.85, z1: -1.75 };

/** Shared by the runtime and tests: the upper rope must clear the pool while remaining close enough to slide back. */
export function ropeLanding(rope: (typeof ROPES)[number]): { x: number; z: number } {
  return { x: rope.x + ROPE_LANDING_DX, z: rope.floor === 1 ? rope.z + ROOF_ROPE_LANDING_DZ : rope.z };
}

/** furniture that blocks movement; the set draws each piece on exactly this footprint */
export const FURNITURE_COLLIDERS: Collider[] = [
  { floor: 0, x0: 2.4, x1: 7.2, z0: -4.9, z1: -4.2 }, // package shelving
  { floor: 0, x0: 8.4, x1: 14.6, z0: -4.9, z1: -4.5 }, // mailbox wall
  { floor: 0, x0: 19.5, x1: 24.5, z0: -3.9, z1: -3.0 }, // the concierge desk
  { floor: 0, x0: 17.4, x1: 18.6, z0: -4.6, z1: -3.6 }, // the lobby armchair
  { floor: 0, x0: 30.6, x1: 33.2, z0: -4.6, z1: -3.4 }, // sofas
  { floor: 0, x0: 34.4, x1: 37.4, z0: -4.6, z1: -3.4 },
  { floor: 0, x0: 32.6, x1: 34.6, z0: -2.6, z1: -1.6 }, // coffee table
  ...[0, 1, 2, 3].map(i => ({ floor: 1, x0: 0.6 + i * 1.6, x1: 1.9 + i * 1.6, z0: -4.9, z1: -4.0 })), // washers
  { floor: 1, x0: 7.0, x1: 8.8, z0: -4.9, z1: -4.0 }, // the folding table
  { floor: 1, x0: 10.2, x1: 12.4, z0: -4.6, z1: -3.6 }, // treadmills
  { floor: 1, x0: 13.2, x1: 15.4, z0: -4.6, z1: -3.6 },
  { floor: 1, x0: 16.2, x1: 17.6, z0: -4.9, z1: -4.3 }, // weight rack
  ROOF_POOL,
  { floor: 2, x0: 21.7, x1: 24.3, z0: -2.2, z1: -1.1 }, // the cabana's sofa
  { floor: 2, x0: 30.6, x1: 33.6, z0: -4.6, z1: -3.4 }, // the lounge's sofa
  { floor: 2, x0: 34.6, x1: 37.4, z0: -4.8, z1: -4.0 }, // the bar
];

/** everything static that blocks movement: the side walls, the partitions (with their doorways) and the furniture */
export function staticColliders(): Collider[] {
  const out: Collider[] = [];
  FLOORS.forEach((fl, f) => {
    out.push({ floor: f, x0: -5, x1: 0.25, z0: -10, z1: 10 }, { floor: f, x0: WIDTH - 0.25, x1: WIDTH + 5, z0: -10, z1: 10 });
    for (const r of fl.rooms) {
      if (r.x1 >= WIDTH) continue;
      out.push({ floor: f, x0: r.x1 - 0.15, x1: r.x1 + 0.15, z0: -DEPTH - 1, z1: DOOR_Z0 }, { floor: f, x0: r.x1 - 0.15, x1: r.x1 + 0.15, z0: DOOR_Z1, z1: 2 });
    }
  });
  return out.concat(FURNITURE_COLLIDERS);
}
