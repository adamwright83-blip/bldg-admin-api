import { describe, expect, it } from "vitest";
import { doormanLines, initialRope, isSomebody, lineClear, objectives, ropeReducer, type RopeEvent, type RopeState } from "./velvetRope";

const run = (events: RopeEvent[], s: RopeState = initialRope()) => events.reduce(ropeReducer, s);

describe("The Velvet Rope", () => {
  it("Sterling turns you away first, and says the building's real name", () => {
    const s = run([{ type: "TALK_DOORMAN" }]);
    expect(s.phase).toBe("turned_away");
    const lines = doormanLines(initialRope(), "Maybourne Beverly Hills").map(l => l.text).join(" ");
    expect(lines).toContain("Beverly Hills doesn't have one.");
    expect(lines).toContain("Maybourne Beverly Hills");
  });

  it("the juice can only be bought once every influencer has left the line", () => {
    let s = run([{ type: "BUY_JUICE" }]);
    expect(s.have.juice).toBe(false);
    s = run([{ type: "PHOTOBOMB", who: "aurora" }, { type: "PHOTOBOMB", who: "blaze" }, { type: "PHOTOBOMB", who: "blaze" }], s);
    expect(s.photobombed).toEqual(["aurora", "blaze"]);
    expect(lineClear(s)).toBe(false);
    s = run([{ type: "BUY_JUICE" }, { type: "PHOTOBOMB", who: "sage" }, { type: "BUY_JUICE" }], s);
    expect(s.have.juice).toBe(true);
  });

  it("three things make you somebody, and only then does the rope drop", () => {
    let s = run([{ type: "TALK_DOORMAN" }, { type: "CATCH_PUG" }, { type: "GRAB_SHADES" }]);
    expect(s.phase).toBe("collecting");
    expect(run([{ type: "TALK_DOORMAN" }], s).phase).toBe("collecting");
    expect(doormanLines(s, "x").map(l => l.text).join(" ")).toContain("Missing: a $26 green juice");
    s = run([{ type: "PHOTOBOMB", who: "aurora" }, { type: "PHOTOBOMB", who: "blaze" }, { type: "PHOTOBOMB", who: "sage" }, { type: "BUY_JUICE" }], s);
    expect(isSomebody(s)).toBe(true);
    expect(s.phase).toBe("ready");
    expect(run([{ type: "TALK_DOORMAN" }], s).phase).toBe("admitted");
  });

  it("a busy operator can always skip straight to the door", () => {
    const s = run([{ type: "SKIP" }]);
    expect(s).toMatchObject({ phase: "admitted", skipped: true });
    // nothing after admission rewinds it
    expect(run([{ type: "CATCH_PUG" }], s).have.pug).toBe(false);
  });

  it("the checklist hints at the next step for each thing", () => {
    const o = objectives(initialRope());
    expect(o.map(x => x.item)).toEqual(["juice", "pug", "shades"]);
    expect(o[0].hint).toMatch(/3 influencers filming/);
    expect(o.every(x => !x.done)).toBe(true);
  });
});
