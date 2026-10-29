import { describe, expect, it } from "vitest";
import { buildReveals } from "@shared/firstTenMinutesCrew";
import { asViews, exampleReading } from "../../../../../server/firstTenMinutes/testSupport/exampleReading";
import { MAP_FONTS, askedLine, placeMapLabels, projector, textWidth, titleSlip, type Anchor } from "./mapLabels";

type Box = { x1: number; y1: number; x2: number; y2: number };

function box(x: number, y: number, text: string, key: keyof typeof MAP_FONTS, anchor: Anchor): Box {
  const width = textWidth(text, key);
  const size = MAP_FONTS[key].size;
  const left = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
  return { x1: left, y1: y - size * 0.8, x2: left + width, y2: y + size * 0.28 };
}
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

describe("the words on Mara's map (Nina)", () => {
  it("puts every hotel and its asker in the clear, and each Friday stop's name where it covers nothing", async () => {
    const { all, opportunities } = await exampleReading();
    const reveals = buildReveals(asViews([...all, ...opportunities]));
    const mara = reveals.find(reveal => reveal.companion === "mara");
    const orren = reveals.find(reveal => reveal.companion === "orren");
    if (mara?.kind !== "places" || orren?.kind !== "route") throw new Error("Nina's map and route are missing");
    const stops = orren.stops.filter((stop): stop is typeof stop & { lat: number; lng: number } => stop.lat !== null && stop.lng !== null);
    const size = { width: 600, height: 380 };
    const project = projector([...mara.pins, ...stops], size.width, size.height, 70);
    const pins = mara.pins.map(pin => ({ ...project(pin), name: pin.name, asked: askedLine(pin.asked) }));
    const stopPoints = stops.map(stop => ({ ...project(stop), label: stop.label }));
    const slip = titleSlip("Wildroot Flowers", size);
    const labels = placeMapLabels(size, pins, stopPoints, [slip.box]);

    const words: Box[] = [];
    pins.forEach((pin, index) => {
      const spot = labels.pins[index];
      words.push(box(pin.x + spot.name.dx, pin.y + spot.name.dy, pin.name, "name", spot.name.anchor));
      if (pin.asked) words.push(box(pin.x + spot.asked.dx, pin.y + spot.asked.dy, pin.asked, "asked", spot.asked.anchor));
    });
    stopPoints.forEach((stop, index) => {
      const spot = labels.stops[index];
      if (spot) words.push(box(stop.x + spot.dx, stop.y + spot.dy, stop.label, "stop", spot.anchor));
    });
    const marks: Box[] = [
      slip.box,
      ...pins.map(pin => ({ x1: pin.x - 9, y1: pin.y - 9, x2: pin.x + 9, y2: pin.y + 9 })),
      ...stopPoints.map(stop => ({ x1: stop.x - 5, y1: stop.y - 5, x2: stop.x + 5, y2: stop.y + 5 })),
    ];

    // all three hotels are labelled, with who asked and when
    expect(pins.map(pin => pin.asked)).toEqual(["Elena asked, April", "Marcus asked, May", "Priya asked, June"]);
    expect(words.length).toBeGreaterThanOrEqual(6);
    for (const [index, word] of words.entries()) {
      expect(word.x1).toBeGreaterThanOrEqual(0);
      expect(word.y1).toBeGreaterThanOrEqual(0);
      expect(word.x2).toBeLessThanOrEqual(size.width);
      expect(word.y2).toBeLessThanOrEqual(size.height);
      for (const other of words.slice(index + 1)) expect(overlaps(word, other)).toBe(false);
      for (const mark of marks) expect(overlaps(word, mark)).toBe(false);
    }
  });

  it("leaves a stop unlabelled rather than cover a hotel", () => {
    const labels = placeMapLabels(
      { width: 120, height: 60 },
      [{ x: 60, y: 30, name: "The Larkspur Hotel", asked: "Elena asked, April" }],
      [{ x: 64, y: 32, label: "Café Lumen" }]
    );
    expect(labels.stops).toEqual([null]);
  });
});
