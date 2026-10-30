/**
 * Where the words go on Mara's map. Each hotel's name (and who asked) takes the first free spot around its pin, further
 * out on a short leader when the route runs close; each stop on Orren's route does the same, and goes unlabelled rather
 * than cover anything. Nothing on the map sits on anything else, and nothing leaves the paper.
 */
export type Anchor = "start" | "middle" | "end";
export type LabelSpot = { dx: number; dy: number; anchor: Anchor };
export type StopLabel = LabelSpot & { leader: boolean };
export type PinLabel = { name: LabelSpot; asked: LabelSpot; leader: boolean };

export type Box = { x1: number; y1: number; x2: number; y2: number };
type Point = { x: number; y: number };

const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

export const MAP_FONTS = {
  name: { font: "600 18px Caveat, cursive", size: 18, perChar: 8.6 },
  asked: { font: "500 12px 'DM Sans', sans-serif", size: 12, perChar: 6.9 },
  stop: { font: "500 13px 'DM Sans', sans-serif", size: 13, perChar: 7.4 },
  title: { font: "600 23px Caveat, cursive", size: 23, perChar: 11 },
  note: { font: "600 16px Caveat, cursive", size: 16, perChar: 7.8 },
} as const;
type FontKey = keyof typeof MAP_FONTS;

let context: CanvasRenderingContext2D | null | undefined;
/** The text's width on the page; a generous estimate where there's no canvas to measure with. */
export function textWidth(text: string, key: FontKey): number {
  const spec = MAP_FONTS[key];
  if (context === undefined) {
    try {
      context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      context = null;
    }
  }
  const estimate = text.length * spec.perChar;
  if (!context) return estimate;
  context.font = spec.font;
  // a font still loading measures in its fallback; never trust a reading narrower than most of the estimate
  return Math.max(context.measureText(text).width * 1.04 + (key === "asked" ? text.length * 0.24 : 0), estimate * 0.8);
}

/** The box a line of SVG text covers, with a little air: `y` is its baseline. */
function textBox(x: number, y: number, width: number, size: number, anchor: Anchor): Box {
  const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return { x1: left - 3, y1: y - size * 0.8 - 2, x2: left + width + 3, y2: y + size * 0.28 + 2 };
}

function around(point: Point, radius: number): Box {
  return { x1: point.x - radius, y1: point.y - radius, x2: point.x + radius, y2: point.y + radius };
}

/** Small boxes along the route, so a label doesn't sit on the line Orren draws. */
function alongRoute(stops: Point[]): Box[] {
  const boxes: Box[] = [];
  for (let index = 1; index < stops.length; index++) {
    const from = stops[index - 1];
    const to = stops[index];
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 8));
    for (let step = 1; step < steps; step++) {
      const t = step / steps;
      boxes.push(around({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, 3));
    }
  }
  return boxes;
}

/** The ways a hotel's two lines can sit around its pin, `extra` further out than snug. */
function pinSides(extra: number): Array<{ name: LabelSpot; asked: LabelSpot }> {
  const e = extra;
  return [
    { name: { dx: 0, dy: -17 - e, anchor: "middle" }, asked: { dx: 0, dy: -37 - e, anchor: "middle" } },
    { name: { dx: 0, dy: 29 + e, anchor: "middle" }, asked: { dx: 0, dy: 45 + e, anchor: "middle" } },
    { name: { dx: 16 + e, dy: 2, anchor: "start" }, asked: { dx: 16 + e, dy: 18, anchor: "start" } },
    { name: { dx: -16 - e, dy: 2, anchor: "end" }, asked: { dx: -16 - e, dy: 18, anchor: "end" } },
    { name: { dx: 12 + e, dy: -14 - e, anchor: "start" }, asked: { dx: 12 + e, dy: -34 - e, anchor: "start" } },
    { name: { dx: -12 - e, dy: -14 - e, anchor: "end" }, asked: { dx: -12 - e, dy: -34 - e, anchor: "end" } },
    { name: { dx: 12 + e, dy: 26 + e, anchor: "start" }, asked: { dx: 12 + e, dy: 42 + e, anchor: "start" } },
    { name: { dx: -12 - e, dy: 26 + e, anchor: "end" }, asked: { dx: -12 - e, dy: 42 + e, anchor: "end" } },
  ];
}

/** The ways a stop's name can sit around it, `distance` out. */
function stopSides(distance: number): LabelSpot[] {
  const diagonal = Math.round(distance * 0.72);
  return [
    { dx: distance, dy: 4, anchor: "start" },
    { dx: -distance, dy: 4, anchor: "end" },
    { dx: 0, dy: distance + 10, anchor: "middle" },
    { dx: 0, dy: -distance, anchor: "middle" },
    { dx: diagonal, dy: diagonal + 8, anchor: "start" },
    { dx: -diagonal, dy: diagonal + 8, anchor: "end" },
    { dx: diagonal, dy: -diagonal, anchor: "start" },
    { dx: -diagonal, dy: -diagonal, anchor: "end" },
  ];
}

/** The map's own name, on a slip at the foot of the paper; where it sits, and what it covers. */
export function titleSlip(title: string, size: { width: number; height: number }) {
  const width = textWidth(title, "title") + 24;
  const height = MAP_FONTS.title.size + 9;
  const x = size.width / 2 - width / 2;
  const y = size.height - Math.round(size.height * 0.05) - height;
  return { x, y, width, height, baseline: y + height - 8, box: { x1: x - 4, y1: y - 4, x2: x + width + 4, y2: y + height + 4 } };
}

/** Places that have no pin, named in pencil at the top corner; where they sit, and what they cover. */
export function unpinnedNote(text: string, size: { width: number; height: number }) {
  const x = Math.round(size.width * 0.05);
  const baseline = Math.round(size.height * 0.05) + MAP_FONTS.note.size;
  const width = textWidth(text, "note");
  return { x, baseline, box: { x1: x - 4, y1: baseline - MAP_FONTS.note.size - 2, x2: x + width + 4, y2: baseline + 6 } };
}

export function placeMapLabels(
  size: { width: number; height: number },
  pins: Array<Point & { name: string; asked: string | null }>,
  stops: Array<Point & { label: string }>,
  /** what is already on the paper (the map's name): no label goes there */
  reserved: Box[] = []
): { pins: PinLabel[]; stops: Array<StopLabel | null> } {
  const inside = (box: Box) => box.x1 >= 2 && box.y1 >= 2 && box.x2 <= size.width - 2 && box.y2 <= size.height - 2;
  const taken: Box[] = [
    ...reserved,
    ...pins.map(pin => around(pin, 12)),
    ...stops.map(stop => around(stop, 7)),
    ...alongRoute(stops),
  ];
  const free = (boxes: Box[]) => boxes.every(box => inside(box) && !taken.some(other => overlaps(box, other)));
  const covered = (boxes: Box[]) =>
    boxes.reduce(
      (sum, box) =>
        sum +
        taken.reduce((area, other) => {
          const w = Math.min(box.x2, other.x2) - Math.max(box.x1, other.x1);
          const h = Math.min(box.y2, other.y2) - Math.max(box.y1, other.y1);
          return area + (w > 0 && h > 0 ? w * h : 0);
        }, 0),
      0
    );

  // hotels first: they are what Mara is pointing at
  const pinSpots = pins.map(pin => {
    const nameWidth = textWidth(pin.name, "name");
    const askedWidth = pin.asked ? textWidth(pin.asked, "asked") : 0;
    const boxesFor = (side: { name: LabelSpot; asked: LabelSpot }) => [
      textBox(pin.x + side.name.dx, pin.y + side.name.dy, nameWidth, MAP_FONTS.name.size, side.name.anchor),
      ...(pin.asked ? [textBox(pin.x + side.asked.dx, pin.y + side.asked.dy, askedWidth, MAP_FONTS.asked.size, side.asked.anchor)] : []),
    ];
    const tried: Array<{ side: { name: LabelSpot; asked: LabelSpot }; extra: number }> = [];
    for (const extra of [0, 14, 28, 44]) {
      for (const side of pinSides(extra)) {
        tried.push({ side, extra });
        if (!free(boxesFor(side))) continue;
        taken.push(...boxesFor(side));
        return { ...side, leader: extra > 0 };
      }
    }
    // nowhere is clear: the spot that covers least, still on the paper
    const onPaper = tried.filter(({ side }) => boxesFor(side).every(inside));
    const best = (onPaper.length ? onPaper : tried).reduce((a, b) => (covered(boxesFor(b.side)) < covered(boxesFor(a.side)) ? b : a));
    taken.push(...boxesFor(best.side));
    return { ...best.side, leader: best.extra > 0 };
  });

  const stopSpots = stops.map(stop => {
    const width = textWidth(stop.label, "stop");
    for (const distance of [11, 26, 44, 64]) {
      for (const spot of stopSides(distance)) {
        const box = textBox(stop.x + spot.dx, stop.y + spot.dy, width, MAP_FONTS.stop.size, spot.anchor);
        if (!free([box])) continue;
        taken.push(box);
        return { ...spot, leader: distance > 11 };
      }
    }
    return null;
  });

  return { pins: pinSpots, stops: stopSpots };
}

/** Where a leader from a mark meets its label: the label's near edge, at the text's middle height. */
export function leaderEnd(spot: LabelSpot, size: number = MAP_FONTS.stop.size): Point {
  if (spot.anchor === "middle") return { x: spot.dx, y: spot.dy < 0 ? spot.dy + size * 0.28 + 1 : spot.dy - size * 0.8 - 1 };
  return { x: spot.dx + (spot.anchor === "start" ? -3 : 3), y: spot.dy - size * 0.3 };
}

/** Latitude and longitude onto the paper, north up, the points spread to fill it with `pad` to spare. */
export function projector(points: Array<{ lat: number; lng: number }>, width: number, height: number, pad: number) {
  const lats = points.map(point => point.lat);
  const lngs = points.map(point => point.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const minX = Math.min(...lngs) * kx;
  const maxX = Math.max(...lngs) * kx;
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const spanX = Math.max(maxX - minX, 0.004);
  const spanY = Math.max(maxY - minY, 0.004);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return (point: { lat: number; lng: number }) => ({
    x: offsetX + (point.lng * kx - minX) * scale,
    y: height - (offsetY + (point.lat - minY) * scale),
  });
}

/** "Elena asked, April": who asked from a place, and when, in the person's own mail. */
export function askedLine(asked: { who: string; at: string } | null): string | null {
  if (!asked) return null;
  return `${asked.who.split(/\s+/)[0]} asked, ${new Date(asked.at).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })}`;
}
