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
