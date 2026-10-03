// Authored guest behaviour. Pure: layout in, action script out. Every layout yields exactly one plan.
import { Cell, Layout, ItemKind, blockedSet, findPath, footprint, key, same, DOOR, COLS, ROWS, onBed, Item, inBounds } from "./grid";

export type GuestId = "conductor" | "baker" | "reader";
export const GUEST_ORDER: GuestId[] = ["conductor", "baker", "reader"];
export const GUEST_NAME: Record<GuestId, string> = { conductor: "The Conductor", baker: "The Night Baker", reader: "The Reader" };

export const NOTES: Record<GuestId, { happy: string; workaround: string }> = {
  conductor: {
    happy: "Slept soundly. Watched the 6:15 pass from the window, which I had not done since the strike. Tipped one button.",
    workaround: "Bed adequate. No view of the line, so I counted trains by ear. Eleven. One was late; I forgive it.",
  },
  baker: {
    happy: "Warm all night. Left a bun on the pillow. Do not tell the other guests; there is only one.",
    workaround: "Cold, but my scarf held. Left a bun regardless. I rise early. So, I gather, do you.",
  },
  reader: {
    happy: "Finished chapter nine in a proper chair under a proper light. The ending is a disgrace. Five stars.",
    workaround: "Read three pages and slept on the fourth. A fair review of the room, honestly, and of the book.",
  },
};

export type SleepKind = "bed" | "chair" | "rug" | "floor";
export type LampMethod = "adjacent" | "flick" | "stretch-then-walk" | "walk" | "unreachable" | "none";
export type PreKind = "window" | "window-far" | "keyhole" | "chair-read" | "chair-squint" | "bed-read" | "bun" | "wrap-up" | "scarf" | "none";

export type Action =
  | { t: "walk"; path: Cell[] }
  | { t: "pose"; name: "watch-train" | "keyhole" | "read" | "squint" | "bake" | "shiver" | "wrap" | "sit" | "lie" | "sleep" | "sigh" | "stretch" | "flick" | "click" | "cover-eyes" | "tiptoe" | "bump" | "bun"; at: Cell; face?: Cell; ms: number };

export interface Plan {
  guest: GuestId;
  branch: string; // unique id of the path taken, e.g. "window|bed|adjacent"
  pre: PreKind;
  sleep: { kind: SleepKind; cells: Cell[]; spot: Cell; itemId?: number };
  lamp: { method: LampMethod; lampCell?: Cell; standAt?: Cell };
  happy: boolean;
  note: string;
  actions: Action[];
  lampOffAt: number; // index in actions after which the lamp goes out (-1 = no lamp to turn off)
}

const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
const nbrs = (c: Cell): Cell[] => [{ x: c.x, z: c.z - 1 }, { x: c.x + 1, z: c.z }, { x: c.x, z: c.z + 1 }, { x: c.x - 1, z: c.z }].filter(inBounds);
const cellsOf = (it: Item) => footprint(it.kind, it.x, it.z, it.rot);
const itemsOf = (l: Layout, k: ItemKind) => l.items.filter(i => i.kind === k);

function reachable(blocked: Set<number>, from: Cell, goals: Cell[]) {
  return findPath(blocked, from, goals);
}

export function planGuest(guest: GuestId, l: Layout): Plan {
  const blocked = blockedSet(l);
  const actions: Action[] = [];
  let at: Cell = DOOR;
  const walkTo = (goals: Cell[]): boolean => {
    const p = reachable(blocked, at, goals);
    if (!p) return false;
    if (p.length > 1) actions.push({ t: "walk", path: p });
    at = p[p.length - 1];
    return true;
  };
  const pose = (name: Extract<Action, { t: "pose" }>["name"], ms: number, face?: Cell) => actions.push({ t: "pose", name, at, face, ms });

  // ---- 1. where will they sleep? bed > armchair > rug > doormat. Must be reachable.
  const beds = itemsOf(l, "bed").map(b => ({ b, cells: cellsOf(b) })).filter(x => reachable(blocked, DOOR, x.cells));
  // prefer a blanketed bed (the Baker cares; everyone benefits)
  beds.sort((p, q) => {
    const bp = l.items.some(i => i.kind === "blanket" && onBed(l.items, i) === p.b.id) ? 0 : 1;
    const bq = l.items.some(i => i.kind === "blanket" && onBed(l.items, i) === q.b.id) ? 0 : 1;
    return bp - bq || p.b.id - q.b.id;
  });
  const chairs = itemsOf(l, "armchair").filter(c => reachable(blocked, DOOR, [{ x: c.x, z: c.z }]));
  const rug = itemsOf(l, "rug").find(r => cellsOf(r).some(c => !blocked.has(key(c)) && reachable(blocked, DOOR, [c])));

  let sleep: Plan["sleep"];
  if (beds.length) sleep = { kind: "bed", cells: beds[0].cells, spot: beds[0].cells[0], itemId: beds[0].b.id };
  else if (chairs.length) sleep = { kind: "chair", cells: [{ x: chairs[0].x, z: chairs[0].z }], spot: { x: chairs[0].x, z: chairs[0].z }, itemId: chairs[0].id };
  else if (rug) {
    const c = cellsOf(rug).find(c => !blocked.has(key(c)) && reachable(blocked, DOOR, [c]))!;
    sleep = { kind: "rug", cells: [c], spot: c, itemId: rug.id };
  } else sleep = { kind: "floor", cells: [DOOR], spot: DOOR };

  const blanketed = sleep.kind === "bed" && l.items.some(i => i.kind === "blanket" && onBed(l.items, i) === sleep.itemId);

  // ---- 2. evening routine, per guest
  let pre: PreKind = "none";
  let happyPre = true;
  const windowCell: Cell = { x: Math.max(0, Math.min(COLS - 2, l.windowCol)), z: 0 };
  const windowFace: Cell = { x: windowCell.x + 0.5, z: -1 };

  if (guest === "conductor") {
    if (l.windowCut) {
      if (!blocked.has(key(windowCell)) && walkTo([windowCell])) { pre = "window"; pose("watch-train", 2600, windowFace); }
      else {
        // nearest reachable free cell to the window
        const free: Cell[] = [];
        for (let z = 0; z < ROWS; z++) for (let x = 0; x < COLS; x++) if (!blocked.has(z * COLS + x)) free.push({ x, z });
        free.sort((a, b) => manhattan(a, windowCell) - manhattan(b, windowCell) || key(a) - key(b));
        const target = free.find(c => reachable(blocked, at, [c]) && !same(c, windowCell));
        if (target && walkTo([target])) { pre = "window-far"; pose("tiptoe", 1800, windowFace); pose("watch-train", 1800, windowFace); happyPre = false; }
        else { pre = "keyhole"; pose("keyhole", 2200); happyPre = false; }
      }
    } else { pre = "keyhole"; pose("keyhole", 2400); happyPre = false; }
  } else if (guest === "baker") {
    if (blanketed) { pre = "wrap-up"; /* wraps up once in bed */ }
    else { pre = "scarf"; happyPre = false; }
  } else {
    // reader: chair + light within 2 of chair => proper reading
    const lamps = itemsOf(l, "lamp");
    const chair = chairs[0];
    if (chair) {
      const cc = { x: chair.x, z: chair.z };
      const lit = lamps.some(la => manhattan({ x: la.x, z: la.z }, cc) <= 2);
      if (walkTo([cc])) {
        if (lit) { pre = "chair-read"; pose("sit", 500, nextFacing(chair.rot, cc)); pose("read", 3000, nextFacing(chair.rot, cc)); }
        else { pre = "chair-squint"; pose("sit", 500, nextFacing(chair.rot, cc)); pose("squint", 2600, nextFacing(chair.rot, cc)); happyPre = false; }
      } else { pre = "bed-read"; happyPre = false; }
    } else { pre = "bed-read"; happyPre = false; }
  }

  // ---- 3. walk to the sleeping spot
  if (!same(at, sleep.spot)) {
    const p = reachable(blocked, at, sleep.cells);
    if (p && p.length > 1) { actions.push({ t: "walk", path: p }); at = p[p.length - 1]; }
    else if (!p) { at = sleep.spot; }
  }
  if (guest === "reader" && pre === "bed-read" && sleep.kind === "bed") pose("read", 2200);
  pose("lie", 700);
  if (guest === "baker" && pre === "wrap-up") pose("wrap", 1200);
  if (guest === "baker" && pre === "scarf") pose("shiver", 1400);

  // ---- 4. lamp off
  const lamps = itemsOf(l, "lamp");
  let method: LampMethod = "none";
  let lampCell: Cell | undefined;
  let standAt: Cell | undefined;
  let lampOffAt = -1;
  if (lamps.length) {
    // the lamp that bothers them most: nearest to the sleep spot
    const withD = lamps.map(la => ({ la, d: Math.min(...sleep.cells.map(c => manhattan(c, { x: la.x, z: la.z }))) }));
    withD.sort((a, b) => a.d - b.d || a.la.id - b.la.id);
    const { la, d } = withD[0];
    lampCell = { x: la.x, z: la.z };
    // after lying down, where could they stand to press it? cells next to the lamp that are free
    const stands = nbrs(lampCell).filter(c => !blocked.has(key(c)));
    const walkable = reachable(blocked, at, stands);
    if (d <= 1) { method = "adjacent"; standAt = at; pose("click", 600, lampCell); }
    else if (d === 2 && guest === "conductor") { method = "flick"; pose("flick", 900, lampCell); }
    else if (!walkable) {
      method = "unreachable";
      if (d === 2) pose("stretch", 1000, lampCell);
      pose("sigh", 900);
      pose("cover-eyes", 1000);
    } else if (d === 2) {
      method = "stretch-then-walk";
      pose("stretch", 1000, lampCell);
      pose("sigh", 800);
      walkAndClick();
    } else {
      method = "walk";
      walkAndClick();
    }
    lampOffAt = actions.length - 1;
    if (method === "walk" || method === "stretch-then-walk") {
      // back to bed
      const back = reachable(blocked, at, sleep.cells);
      if (back && back.length > 1) { actions.push({ t: "walk", path: back }); at = back[back.length - 1]; }
      else at = sleep.spot;
    }
    if (method === "unreachable") lampOffAt = -1; // the light stays on; they sleep with it
  }
  function walkAndClick() {
    const p = reachable(blocked, at, nbrs(lampCell!).filter(c => !blocked.has(key(c))))!;
    standAt = p[p.length - 1];
    // a bump: first step that passes beside furniture that isn't the target
    const bumpIdx = p.findIndex((c, i) => i > 0 && i < p.length - 1 && nbrs(c).some(n => blocked.has(key(n)) && !same(n, lampCell!) && !sleep.cells.some(s => same(s, n))));
    if (p.length > 1) {
      if (bumpIdx > 0) {
        const first = p.slice(0, bumpIdx + 1);
        const rest = p.slice(bumpIdx);
        actions.push({ t: "walk", path: first });
        at = first[first.length - 1];
        pose("bump", 700);
        if (rest.length > 1) actions.push({ t: "walk", path: rest });
      } else actions.push({ t: "walk", path: p });
    }
    at = p[p.length - 1];
    pose("click", 600, lampCell);
  }

  pose("sleep", 2500);

  const happy = happyPre && sleep.kind === "bed" && method !== "unreachable";
  const branch = `${pre}|${sleep.kind}|${method}`;
  return {
    guest, branch, pre, sleep, lamp: { method, lampCell, standAt }, happy,
    note: happy ? NOTES[guest].happy : NOTES[guest].workaround, actions, lampOffAt,
  };
}

function nextFacing(rot: number, c: Cell): Cell {
  const d = [{ x: 0, z: 1 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: -1, z: 0 }][rot % 4];
  return { x: c.x + d.x, z: c.z + d.z };
}
