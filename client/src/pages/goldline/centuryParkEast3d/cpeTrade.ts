/**
 * The trade pack: what the zombies are sent to destroy, so that every resident has to call the business.
 *
 * Laundry Farm sends them at the laundry room's washers. A plumber's build sends them at the restroom's toilets, an
 * electrician's at the utility room's outlets. Everything trade-specific lives here: the room, the devices and
 * where they stand, the verbs, the lines. The game, the set and the desk read the active pack and nothing else, so
 * re-skinning for another trade is `ACTIVE_TRADE` plus a pack.
 */
export type TradeId = "laundry" | "plumbing" | "electrical";
export type DeviceKind = "washer" | "toilet" | "outlet";

export type TradePack = {
  id: TradeId;
  /** the business category the brand sells, for copy ("laundry", "plumbing", "electrical") */
  trade: string;
  /** the room on the amenity floor that gets wrecked */
  room: { name: string; sign: string; floor: number; x0: number; x1: number };
  device: { kind: DeviceKind; noun: string; plural: string };
  /** where each device stands in the room, and how wide it is; the set draws it, the game wrecks it */
  devices: { x: number; z: number; w: number; d: number; h: number }[];
  verbs: { wreck: string; wrecked: string };
  lines: {
    /** the chipped zombie sets off */
    sent: (device: string) => string;
    /** one device down */
    wrecked: (device: string, left: number) => string;
    /** the room is finished: the business line, with the brand filled in */
    roomDone: (brand: string) => string;
    /** what the HUD counts */
    counter: (wrecked: number, total: number) => string;
  };
};

export const TRADE_PACKS: Record<TradeId, TradePack> = {
  laundry: {
    id: "laundry",
    trade: "laundry",
    room: { name: "Laundry room", sign: "LAUNDRY", floor: 1, x0: 0, x1: 9 },
    device: { kind: "washer", noun: "washer", plural: "washers" },
    devices: [0, 1, 2, 3].map(i => ({ x: 1.25 + i * 1.6, z: -4.45, w: 1.3, d: 0.9, h: 1.1 })),
    verbs: { wreck: "chew through", wrecked: "out of order" },
    lines: {
      sent: device => `The chip takes. Eyes go green. It shuffles off toward ${device} with real purpose.`,
      wrecked: (device, left) => `${device} is a pile of suds and sparks. ${left === 0 ? "That was the last one." : `${left} to go.`}`,
      roomDone: brand => `The laundry room is out of order. Every resident in the building needs ${brand} now.`,
      counter: (w, t) => `${w}/${t} washers wrecked`,
    },
  },
  plumbing: {
    id: "plumbing",
    trade: "plumbing",
    room: { name: "Restrooms", sign: "RESTROOMS", floor: 1, x0: 0, x1: 9 },
    device: { kind: "toilet", noun: "toilet", plural: "toilets" },
    devices: [0, 1, 2, 3].map(i => ({ x: 1.25 + i * 1.6, z: -4.45, w: 0.8, d: 0.9, h: 0.8 })),
    verbs: { wreck: "flush everything into", wrecked: "overflowing" },
    lines: {
      sent: device => `The chip takes. It heads for ${device} holding a rubber duck.`,
      wrecked: (device, left) => `${device} is overflowing. ${left === 0 ? "That was the last one." : `${left} to go.`}`,
      roomDone: brand => `Every restroom is out of order. Every resident in the building needs ${brand} now.`,
      counter: (w, t) => `${w}/${t} toilets overflowing`,
    },
  },
  electrical: {
    id: "electrical",
    trade: "electrical",
    room: { name: "Utility room", sign: "UTILITY", floor: 1, x0: 0, x1: 9 },
    device: { kind: "outlet", noun: "outlet", plural: "outlets" },
    devices: [0, 1, 2, 3].map(i => ({ x: 1.25 + i * 1.6, z: -4.9, w: 0.3, d: 0.1, h: 0.3 })),
    verbs: { wreck: "chew the wires out of", wrecked: "dead" },
    lines: {
      sent: device => `The chip takes. It walks to ${device} with a fork.`,
      wrecked: (device, left) => `${device} is dead and smoking. ${left === 0 ? "That was the last one." : `${left} to go.`}`,
      roomDone: brand => `The building has no power to its outlets. Every resident needs ${brand} now.`,
      counter: (w, t) => `${w}/${t} outlets dead`,
    },
  },
};

/** one line to re-skin the building for another trade */
export const ACTIVE_TRADE: TradeId = "laundry";
export const activeTrade = (): TradePack => TRADE_PACKS[ACTIVE_TRADE];
export const deviceName = (pack: TradePack, i: number) => `${pack.device.noun} ${i + 1}`;
