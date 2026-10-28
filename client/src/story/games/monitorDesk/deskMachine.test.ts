import { describe, expect, it } from "vitest";
import {
  APPROACH_S,
  BOOT_S,
  CAMS,
  DOOR_Z,
  LOBBY,
  ROUNDS_S,
  clockAt,
  createDesk,
  figureAt,
  indicatorAt,
  phaseAt,
  readDeskSettings,
  signalAt,
  type FrameBox,
  type Framing,
} from "./deskMachine";

const settings = readDeskSettings({ desk: { clockStart: "3:00", window: "3:20", windowSeconds: 90, panelFloors: 12, litFloor: 14 } });
const good: FrameBox = { x0: 0.4, y0: 0.35, x1: 0.48, y1: 0.7 };
const indicator: FrameBox = { x0: 0.6, y0: 0.1, x1: 0.68, y1: 0.14 };
const lobby = (boxes: Framing["boxes"], ind: FrameBox | null = indicator): Framing => ({ cam: LOBBY, boxes, indicator: ind });

/** the first moment after `from` when the figure is out and the lobby feed has its signal */
function clearShot(desk: ReturnType<typeof createDesk>, from = desk.tl.figure.out + 1): number {
  for (let t = from; t < desk.tl.figure.back; t += 0.05) if (signalAt(desk.tl, LOBBY, t) && figureAt(desk.tl, t).visible) return t;
  throw new Error("no clear moment");
}

describe("desk settings", () => {
  it("reads the night from config and falls back to neutral defaults", () => {
    expect(settings).toMatchObject({ start: 3 * 3600, window: 3 * 3600 + 20 * 60, windowSeconds: 90, panelFloors: 12, litFloor: 14 });
    const blank = readDeskSettings({});
    expect(blank.litFloor).toBe(blank.panelFloors + 1);
    expect(blank.window - blank.start).toBeGreaterThan(APPROACH_S);
    expect(readDeskSettings({ desk: { clockStart: "nope", litFloor: -3, tint: "green", windowSeconds: 5 } })).toEqual(blank);
  });

  it("a window too close to the start of the shift is moved out, never squeezed", () => {
    const s = readDeskSettings({ desk: { clockStart: "2:00", window: "2:00" } });
    expect(s.window - s.start).toBeGreaterThanOrEqual(APPROACH_S + 60);
  });
});

describe("the night's clock", () => {
  it("a first play is about five minutes: the shift, the last half minute at the real pace, then the window", () => {
    const desk = createDesk(settings, { rehearsed: false, seed: 7 });
    const { tl } = desk;
    expect(tl.windowStart).toBe(BOOT_S + ROUNDS_S + APPROACH_S);
    expect(tl.windowEnd - tl.windowStart).toBe(90);
    expect(tl.windowEnd / 60).toBeGreaterThan(4.5);
    expect(tl.windowEnd / 60).toBeLessThan(5.5);
    expect(clockAt(tl, 0)).toBe(settings.start);
    expect(clockAt(tl, tl.approachStart)).toBeCloseTo(settings.window - APPROACH_S);
    expect(clockAt(tl, tl.windowStart)).toBeCloseTo(settings.window);
    expect(phaseAt(tl, 1)).toBe("boot");
    expect(phaseAt(tl, 60)).toBe("rounds");
    expect(phaseAt(tl, tl.windowStart + 1)).toBe("window");
  });

  it("a retry starts half a minute before the window, with no rounds", () => {
    const { tl } = createDesk(settings, { rehearsed: true, seed: 7 });
    expect(tl.windowStart).toBe(BOOT_S + APPROACH_S);
    expect(tl.alerts.every(a => a.decoy)).toBe(true);
    expect(clockAt(tl, tl.windowStart)).toBeCloseTo(settings.window);
  });

  it("for any seed the figure is out and back inside the window, and the doors shut before it ends", () => {
    for (let seed = 1; seed < 400; seed++) {
      const { tl } = createDesk(settings, { rehearsed: seed % 2 === 0, seed });
      expect(tl.figure.doorsOpen).toBeGreaterThanOrEqual(tl.windowStart + 12);
      expect(tl.figure.out).toBeGreaterThan(tl.figure.doorsOpen);
      expect(tl.figure.back - tl.figure.out).toBeGreaterThanOrEqual(13);
      expect(tl.figure.doorsShut).toBeLessThan(tl.windowEnd);
    }
  });

  it("the indicator reads the lit floor only while the window is open", () => {
    const { tl } = createDesk(settings, { rehearsed: false, seed: 3 });
    expect(indicatorAt(tl, tl.windowStart - 1)).toEqual({ text: "L", lit: false });
    expect(indicatorAt(tl, tl.windowStart + 1)).toEqual({ text: "14", lit: true });
    expect(indicatorAt(tl, tl.windowEnd + 1).lit).toBe(false);
    // the resident's ride climbs only to floors the panel has
    const ride = tl.alerts.find(a => a.kind === "resident_lift")!;
    for (let t = ride.at; t < tl.approachStart; t += 0.5) {
      const r = indicatorAt(tl, t);
      if (r.text !== "L") expect(Number(r.text)).toBeLessThanOrEqual(settings.panelFloors);
    }
  });

  it("only the lobby feed drops its signal, and only while the indicator is lit", () => {
    const { tl } = createDesk(settings, { rehearsed: false, seed: 11 });
    expect(tl.drops.length).toBeGreaterThan(5);
    for (const d of tl.drops) {
      expect(d.at).toBeGreaterThanOrEqual(tl.windowStart);
      expect(signalAt(tl, LOBBY, (d.at + d.until) / 2)).toBe(false);
      for (let cam = 1; cam < CAMS.length; cam++) expect(signalAt(tl, cam, (d.at + d.until) / 2)).toBe(true);
    }
  });

  it("no camera sees the figure while it is still behind the lift doors", () => {
    const { tl } = createDesk(settings, { rehearsed: false, seed: 5 });
    for (let t = tl.figure.doorsOpen - 1; t < tl.figure.doorsShut + 1; t += 0.02) {
      const pose = figureAt(tl, t);
      if (pose.visible) expect(pose.z).toBeGreaterThan(DOOR_Z);
    }
  });
});

describe("a still", () => {
  it("wins with the figure on the lobby camera, framed, close enough, with the lit indicator in frame", () => {
    const desk = createDesk(settings, { rehearsed: true, seed: 21 });
    const t = clearShot(desk);
    expect(desk.status(t).outcome).toBeNull();
    expect(desk.capture(t, lobby({ figure: good }))).toBe("figure");
    expect(desk.status(t + 0.1).outcome).toBe("win");
    // a win stands: later the night is over, not lost
    expect(desk.status(desk.tl.windowEnd + 10).outcome).toBe("win");
  });

  it("is refused for every way it can be wrong", () => {
    const desk = createDesk(settings, { rehearsed: true, seed: 22 });
    let t = clearShot(desk);
    const next = () => (t = clearShot(desk, t + 1.2));
    expect(desk.capture(t, { cam: 1, boxes: { figure: good }, indicator })).toBe("nothing");
    next();
    expect(desk.capture(t, lobby({ figure: { x0: 0.45, y0: 0.5, x1: 0.47, y1: 0.6 } }))).toBe("too_wide");
    next();
    expect(desk.capture(t, lobby({ figure: { x0: 0.9, y0: 0.3, x1: 1.1, y1: 0.7 } }))).toBe("cropped");
    next();
    expect(desk.capture(t, lobby({ figure: good }, null))).toBe("no_indicator");
    next();
    expect(desk.capture(t, lobby({ figure: good }, { x0: 0.95, y0: 0.1, x1: 1.05, y1: 0.14 }))).toBe("no_indicator");
    expect(desk.status(t).outcome).toBeNull();
  });

  it("the recorder needs a moment between stills, and a dropped signal spoils one", () => {
    const desk = createDesk(settings, { rehearsed: true, seed: 23 });
    const t = clearShot(desk);
    expect(desk.capture(t, lobby({}))).toBe("nothing");
    expect(desk.capture(t + 0.3, lobby({ figure: good }))).toBe("printing");
    const drop = desk.tl.drops.find(d => d.at > t + 2)!;
    expect(desk.capture(drop.at + 0.1, lobby({ figure: good }))).toBe("no_signal");
  });

  it("loses when the doors shut with no still, and not a moment before", () => {
    const desk = createDesk(settings, { rehearsed: false, seed: 24 });
    const { doorsShut } = desk.tl.figure;
    expect(desk.status(doorsShut).outcome).toBeNull();
    expect(desk.status(doorsShut + 2).outcome).toBe("lose");
    expect(desk.capture(doorsShut + 2, lobby({ figure: good }))).toBe("closed");
  });

  it("the shift's rounds are logged on their own camera and count toward nothing but the log", () => {
    const desk = createDesk(settings, { rehearsed: false, seed: 25 });
    const rounds = desk.tl.alerts.filter(a => !a.decoy);
    expect(desk.status(0).roundTotal).toBe(rounds.length);
    const first = rounds[0];
    const t = first.at + 2;
    expect(desk.status(t).alerts.map(a => a.id)).toContain(first.id);
    expect(desk.capture(t, { cam: first.cam, boxes: { [first.id]: { x0: 0.4, y0: 0.4, x1: 0.42, y1: 0.43 } }, indicator: null })).toBe("too_wide");
    expect(desk.capture(t + 1.2, { cam: first.cam, boxes: { [first.id]: { x0: 0.3, y0: 0.3, x1: 0.6, y1: 0.7 } }, indicator: null })).toBe("logged");
    expect(desk.status(t + 1.3).logged).toEqual([first.id]);
    expect(desk.status(t + 1.3).alerts.map(a => a.id)).not.toContain(first.id);
    expect(desk.status(t + 1.3).outcome).toBeNull();
  });

  it("every round sits on a camera that exists, and none overlaps another", () => {
    const { tl } = createDesk(settings, { rehearsed: false, seed: 26 });
    const rounds = tl.alerts.filter(a => !a.decoy);
    for (const [i, a] of rounds.entries()) {
      expect(CAMS[a.cam]).toBeDefined();
      if (i) expect(a.at).toBeGreaterThan(rounds[i - 1].until);
      expect(a.until).toBeLessThan(tl.approachStart);
    }
    for (const decoy of tl.alerts.filter(a => a.decoy)) expect(decoy.cam).not.toBe(LOBBY);
  });
});
