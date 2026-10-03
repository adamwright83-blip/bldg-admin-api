// Pure grid + placement rules. No three.js in here.
export const COLS = 6;
export const ROWS = 4;
export const DOOR: Cell = { x: 0, z: 3 };

export type Cell = { x: number; z: number };
export type ItemKind = "bed" | "blanket" | "armchair" | "lamp" | "table" | "rug";
export type Rot = 0 | 1 | 2 | 3; // facing: 0=+z(front) 1=+x 2=-z 3=-x

export interface Item {
  id: number;
  kind: ItemKind;
  x: number; // anchor cell
  z: number;
  rot: Rot;
}

export const LIMITS: Record<ItemKind, number> = { bed: 2, blanket: 2, armchair: 2, lamp: 2, table: 2, rug: 1 };
export const ITEM_LABEL: Record<ItemKind, string> = {
  bed: "Matchbox bed", blanket: "Felt blanket", armchair: "Armchair", lamp: "Button lamp", table: "Spool table", rug: "Rug",
};

/** cells an item covers */
export function footprint(kind: ItemKind, x: number, z: number, rot: Rot): Cell[] {
  const horiz = rot % 2 === 1;
  if (kind === "bed") return horiz ? [{ x, z }, { x: x + 1, z }] : [{ x, z }, { x, z: z + 1 }];
  if (kind === "rug") return [{ x, z }, { x: x + 1, z }, { x, z: z + 1 }, { x: x + 1, z: z + 1 }];
  return [{ x, z }];
}
export const inBounds = (c: Cell) => c.x >= 0 && c.z >= 0 && c.x < COLS && c.z < ROWS;
export const same = (a: Cell, b: Cell) => a.x === b.x && a.z === b.z;
export const key = (c: Cell) => c.z * COLS + c.x;
/** furniture that blocks walking */
export const blocks = (k: ItemKind) => k === "bed" || k === "armchair" || k === "lamp" || k === "table";

export interface Layout {
  items: Item[];
  windowCut: boolean;
  /** first column of the 2-wide window cut into the back wall */
  windowCol: number;
}
export const emptyLayout = (): Layout => ({ items: [], windowCut: false, windowCol: 3 });

export function blockedSet(l: Layout): Set<number> {
  const s = new Set<number>();
  for (const it of l.items) if (blocks(it.kind)) for (const c of footprint(it.kind, it.x, it.z, it.rot)) s.add(key(c));
  return s;
}

export type PlaceResult = { ok: true } | { ok: false; reason: string };

/** can `kind` go at anchor (x,z)? `ignoreId` lets us test a move/rotate of an existing item. */
export function canPlace(l: Layout, kind: ItemKind, x: number, z: number, rot: Rot, ignoreId?: number): PlaceResult {
  const items = l.items.filter(i => i.id !== ignoreId);
  if (items.filter(i => i.kind === kind).length >= LIMITS[kind]) return { ok: false, reason: "That's all of those." };
  const cells = footprint(kind, x, z, rot);
  if (cells.some(c => !inBounds(c))) return { ok: false, reason: "Doesn't fit." };
  if (kind === "blanket") {
    const c = cells[0];
    const bed = items.find(i => i.kind === "bed" && footprint("bed", i.x, i.z, i.rot).some(f => same(f, c)));
    if (!bed) return { ok: false, reason: "Blankets go on beds." };
    const has = items.some(i => i.kind === "blanket" && onBed(items, i) === bed.id);
    if (has) return { ok: false, reason: "Already tucked in." };
    return { ok: true };
  }
  if (kind === "rug") {
    if (items.some(i => i.kind === "rug")) return { ok: false, reason: "One rug is plenty." };
    if (cells.some(c => same(c, DOOR))) return { ok: false, reason: "Not by the door." };
    return { ok: true };
  }
  if (cells.some(c => same(c, DOOR))) return { ok: false, reason: "Keep the door clear." };
  const occ = new Set<number>();
  for (const it of items) if (blocks(it.kind)) for (const f of footprint(it.kind, it.x, it.z, it.rot)) occ.add(key(f));
  if (cells.some(c => occ.has(key(c)))) return { ok: false, reason: "Something's there." };
  return { ok: true };
}

/** id of the bed a blanket lies on (or -1) */
export function onBed(items: Item[], blanket: Item): number {
  const b = items.find(i => i.kind === "bed" && footprint("bed", i.x, i.z, i.rot).some(f => f.x === blanket.x && f.z === blanket.z));
  return b ? b.id : -1;
}

/** remove items orphaned by a change (blankets whose bed is gone) */
export function prune(l: Layout): Layout {
  return { ...l, items: l.items.filter(i => i.kind !== "blanket" || onBed(l.items, i) >= 0) };
}

export function itemAt(l: Layout, c: Cell, preferTop = true): Item | undefined {
  const hits = l.items.filter(i => footprint(i.kind, i.x, i.z, i.rot).some(f => same(f, c)));
  if (!hits.length) return undefined;
  const rank: Record<ItemKind, number> = { blanket: 5, lamp: 4, armchair: 3, table: 3, bed: 2, rug: 1 };
  hits.sort((a, b) => (preferTop ? rank[b.kind] - rank[a.kind] : rank[a.kind] - rank[b.kind]));
  return hits[0];
}

// ---------------------------------------------------------------- A*
const DIRS: Cell[] = [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }];

/** shortest 4-way path from `from` to any goal. Goals may be blocked cells (bed, chair). null if none. */
export function findPath(blocked: Set<number>, from: Cell, goals: Cell[]): Cell[] | null {
  if (!goals.length) return null;
  const gset = new Set(goals.map(key));
  if (gset.has(key(from))) return [from];
  const h = (c: Cell) => Math.min(...goals.map(g => Math.abs(g.x - c.x) + Math.abs(g.z - c.z)));
  const open: { c: Cell; g: number; f: number; n: number }[] = [{ c: from, g: 0, f: h(from), n: 0 }];
  const came = new Map<number, number>();
  const gs = new Map<number, number>([[key(from), 0]]);
  let seq = 0;
  while (open.length) {
    open.sort((a, b) => a.f - b.f || a.n - b.n);
    const cur = open.shift()!;
    if (gset.has(key(cur.c))) {
      const out: Cell[] = [cur.c];
      let k = key(cur.c);
      while (came.has(k)) { k = came.get(k)!; out.push({ x: k % COLS, z: Math.floor(k / COLS) }); }
      return out.reverse();
    }
    for (const d of DIRS) {
      const nc = { x: cur.c.x + d.x, z: cur.c.z + d.z };
      if (!inBounds(nc)) continue;
      const nk = key(nc);
      if (blocked.has(nk) && !gset.has(nk)) continue;
      const g = cur.g + 1;
      if (g >= (gs.get(nk) ?? Infinity)) continue;
      gs.set(nk, g);
      came.set(nk, key(cur.c));
      open.push({ c: nc, g, f: g + h(nc), n: ++seq });
    }
  }
  return null;
}
