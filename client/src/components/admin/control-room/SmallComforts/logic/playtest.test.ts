import { describe, expect, it } from "vitest";
import { deriveMetrics, modeFromSearch, type PtEvent } from "./playtest";

const ev = (t: number, type: string, extra: Record<string, unknown> = {}): PtEvent => ({ t: t * 1000, gt: t, type, ...extra });

describe("playtest metrics (derived from the raw timeline only)", () => {
  it("counts a full session", () => {
    const events = [
      ev(0, "session_start"),
      ev(2, "text_shown", { channel: "hint", text: "Tap the shelf to walk." }),
      ev(4, "walk_start"),
      ev(9, "pickup", { id: "brass_button" }),
      ev(20, "placing_start"),
      ev(21, "outcome", { outcome: "miss" }),
      ev(25, "press"), ev(26, "outcome", { outcome: "miss" }), ev(27, "release"),
      ev(30, "press"), ev(31, "outcome", { outcome: "glance" }), ev(32, "outcome", { outcome: "glance" }),
      ev(35, "outcome", { outcome: "aligned" }),
      ev(38, "installed"),
      ev(40, "canvas_down", { phase: "furnish", hit: "installed_mirror" }),
      ev(44, "canvas_down", { phase: "furnish", hit: "item:3" }),
      ev(46, "ui_click", { id: "btn-out" }),
    ];
    const d = deriveMetrics(events);
    expect(d.tFirstIntentionalMove).toBe(4);
    expect(d.tButtonPickup).toBe(9);
    expect(d.tButtonHome).toBe(20);
    expect(d.tFirstPressOnButton).toBe(25);
    expect(d.dragAttempts).toBe(2);
    expect(d.outcomeSequence.map(o => o.outcome)).toEqual(["miss", "glance", "aligned"]);
    expect(d.secondsInPlacement).toBe(18);
    expect(d.installed).toBe(true);
    expect(d.leftBeforeInstall).toBe(false);
    expect(d.installedMirrorTouchesAfter).toBe(1);
    expect(d.otherInteractionsAfterInstall.map(o => o.what)).toEqual(["furnish:item:3", "ui:btn-out"]);
    expect(d.textShownDuringPlacement).toEqual([]);
    expect(d.textShownBeforePlacement).toHaveLength(1);
    expect(d.assistFired).toBe(false);
    expect(d.hintCueShown).toBe(false);
  });

  it("marks an abandoned session and never invents values", () => {
    const d = deriveMetrics([ev(0, "session_start"), ev(3, "walk_start"), ev(8, "pickup", { id: "thimble" }), ev(15, "pickup", { id: "brass_button" }), ev(30, "visibility", { state: "hidden" })]);
    expect(d.tButtonHome).toBeNull();
    expect(d.tFirstPressOnButton).toBeNull();
    expect(d.dragAttempts).toBe(0);
    expect(d.installed).toBe(false);
    expect(d.leftBeforeInstall).toBe(true);
    expect(d.otherPickupsBeforeButton).toEqual(["thimble"]);
  });

  it("records assist, hint cue and in-placement text when they happen", () => {
    const d = deriveMetrics([
      ev(0, "session_start"), ev(10, "placing_start"),
      ev(30, "hint_cue"), ev(31, "text_shown", { channel: "toast", text: "x" }), ev(50, "assist_fired"), ev(60, "installed"),
    ]);
    expect(d.hintCueShown).toBe(true);
    expect(d.assistFired).toBe(true);
    expect(d.textShownDuringPlacement).toHaveLength(1);
    expect(d.tFirstPressOnButton).toBeNull();
  });

  it("can read the game clock instead of wall time", () => {
    const events: PtEvent[] = [{ t: 5, gt: 1, type: "session_start" }, { t: 90000, gt: 3, type: "walk_start" }];
    expect(deriveMetrics(events, "gt").tFirstIntentionalMove).toBe(2);
  });

  it("parses the entry param strictly", () => {
    expect(modeFromSearch("?playtest=mirror-cold")).toBe("mirror-cold");
    expect(modeFromSearch("?playtest=mirror-hinted")).toBe("mirror-hinted");
    expect(modeFromSearch("?playtest=other")).toBeNull();
    expect(modeFromSearch("")).toBeNull();
  });
});
