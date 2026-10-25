import { describe, it, expect } from "vitest";
import {
  freshAdventure,
  tick,
  interact,
  throwToy,
  hop,
  restoreAdventure,
  prompt,
} from "./adventure";
const advance = (
  s: ReturnType<typeof freshAdventure>,
  seconds: number,
  direction = 0
) => {
  for (let n = 0; n < seconds * 60; n++) tick(s, 1 / 60, direction);
};
describe("The Other Rodeo playable arc", () => {
  it("requires the boxer, water crossing and cooperation before the payoff", () => {
    const s = freshAdventure();
    s.x = 1690;
    interact(s);
    expect(s.chapter).toBe("courtyard");
    s.x = 480;
    interact(s);
    expect(s.item).toBe("ball");
    throwToy(s);
    advance(s, 4);
    expect(s.passage).toBe(true);
    s.x = 1690;
    interact(s);
    expect(s.chapter).toBe("pasture");
    s.x = 1080;
    interact(s);
    expect(s.metCalf).toBe(true);
    s.x = 1250;
    interact(s);
    s.x = 1400;
    throwToy(s);
    advance(s, 5);
    expect(s.gate).toBe(true);
    s.x = 1740;
    advance(s, 0.5, 1);
    expect(s.x).toBeLessThan(1760);
    hop(s);
    advance(s, 0.75, 1);
    expect(s.x).toBeGreaterThan(1900);
    s.x = 2010;
    interact(s);
    expect(s.water).toBe(true);
    s.x = 2730;
    interact(s);
    expect(s.chapter).toBe("distortion");
    expect(s.water).toBe(false);
    s.x = 400;
    interact(s);
    expect(s.item).toBe("rope");
    s.x = 700;
    interact(s);
    expect(s.tether).toBe(true);
    s.x = 1070;
    interact(s);
    expect(s.water).toBe(true);
    s.x = 1490;
    interact(s);
    advance(s, 8);
    expect(s.chapter).toBe("home");
  });
  it("keeps wrong-way throws and saved games recoverable", () => {
    const s = freshAdventure();
    s.chapter = "pasture";
    s.metCalf = true;
    s.x = 1250;
    interact(s);
    s.facing = -1;
    throwToy(s);
    advance(s, 10);
    expect(s.gate).toBe(false);
    s.x = s.toy!;
    expect(prompt(s)?.action).toBe("stick");
    interact(s);
    expect(s.item).toBe("stick");
    const resumed = restoreAdventure(
      JSON.stringify({ ...s, item: null, chase: 5 })
    );
    expect(resumed.item).toBe("stick");
    expect(restoreAdventure("{bad").chapter).toBe("courtyard");
    expect(
      restoreAdventure(JSON.stringify({ version: 1, chapter: "garbage" }))
        .chapter
    ).toBe("courtyard");
  });
  it("retrieves a rightward ball throw from the blocked courtyard edge without reloading", () => {
    const s = freshAdventure();
    s.x = 480;
    interact(s);
    s.x = 1450;
    s.facing = 1;
    throwToy(s);
    advance(s, 10);
    expect(s.passage).toBe(false);
    expect(prompt(s)?.action).toBe("ball");
    interact(s);
    expect(s.item).toBe("ball");
    s.facing = -1;
    throwToy(s);
    advance(s, 4);
    expect(s.passage).toBe(true);
  });
  it("never crosses the garage gap before the platform is raised", () => {
    const s = freshAdventure();
    s.chapter = "distortion";
    s.tether = true;
    s.x = 1185;
    advance(s, 3, 1);
    expect(s.x).toBe(1190);
  });
});
