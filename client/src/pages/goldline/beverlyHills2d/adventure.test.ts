import { describe, expect, it } from "vitest";
import { SPOTS, freshAdventure, hop, inWater, interact, prompt, restoreAdventure, throwToy, tick, type Adventure } from "./adventure";

const run = (s: Adventure, seconds: number, dx = 0, dy = 0) => {
  for (let n = 0; n < seconds * 60; n++) tick(s, 1 / 60, { dx, dy });
};
const moods = (s: Adventure, who: "terrier" | "boxer" | "calf") => s.inserts.filter(i => i.who === who).map(i => i.mood);

describe("The Other Rodeo: the boxer's four habits are the puzzles", () => {
  it("courtyard: he sleeps across the stairs; a ball thrown away from them is the only thing more interesting", () => {
    const s = freshAdventure();
    expect(s.boxer.state).toBe("sleep");
    s.player.x = 1400;
    run(s, 0.5, 1);
    expect(s.player.x).toBeLessThanOrEqual(1470); // blocked
    s.player.x = SPOTS.courtyard.ball.x;
    s.player.d = SPOTS.courtyard.ball.d;
    expect(prompt(s)?.action).toBe("pickup");
    interact(s);
    expect(s.player.item).toBe("ball");
    // thrown toward the stairs: he fetches it and lies back down in the doorway with it
    s.player.x = 1000;
    s.player.face = 1;
    throwToy(s);
    run(s, 9);
    expect(s.flags.stairs).toBe(false);
    expect(s.boxer.state).toBe("sleep");
    expect(s.toy?.kind).toBe("ball"); // dropped again, within reach
    // thrown away from the stairs: he settles far from the doorway, and the way down is open
    s.player.x = s.toy!.x;
    s.player.d = s.toy!.d;
    interact(s);
    s.player.x = 700;
    s.player.face = -1;
    throwToy(s);
    run(s, 9);
    expect(s.flags.stairs).toBe(true);
    s.player.x = SPOTS.courtyard.stairs.x;
    s.player.d = SPOTS.courtyard.stairs.d;
    expect(prompt(s)?.action).toBe("passage");
    interact(s);
    expect(s.chapter).toBe("pasture");
    expect(s.tear?.from).toBe("courtyard");
    run(s, 1.5);
    expect(s.tear).toBeNull();
  });

  it("pasture: the calf picks the boxer (the terrier is jealous); he steals the latch rope and drags the gate open", () => {
    const s = freshAdventure();
    s.chapter = "pasture";
    s.player.x = 200;
    s.boxer.state = "follow";
    s.boxer.x = 700;
    s.toy = { kind: "rope", ...SPOTS.pasture.rope };
    s.player.x = SPOTS.pasture.calf.x - 60;
    s.player.d = SPOTS.pasture.calf.d;
    expect(prompt(s)?.action).toBe("meet");
    interact(s);
    expect(s.calf.met).toBe(true);
    expect(moods(s, "terrier")).toContain("jealous");
    expect(moods(s, "calf")).toContain("delighted");
    run(s, 6);
    expect(Math.abs(s.calf.x - s.boxer.x)).toBeLessThan(260); // the calf went to him
    // the rope: she picks it up, he takes it (his first habit), the gate comes open behind him
    s.player.x = SPOTS.pasture.rope.x;
    s.player.d = SPOTS.pasture.rope.d;
    interact(s);
    expect(s.player.item).toBe("rope");
    expect(s.flags.gate).toBe(false);
    s.boxer.x = s.player.x - 60;
    s.boxer.d = s.player.d;
    s.boxer.t = 5;
    run(s, 4);
    expect(s.boxer.item === "rope" || s.boxer.item === null).toBe(true);
    expect(s.flags.gate).toBe(true);
    expect(s.player.item).toBeNull();
  });

  it("pasture: he will not put a paw in the water; she crosses alone and pulls the sluice", () => {
    const s = freshAdventure();
    s.chapter = "pasture";
    s.calf.met = true;
    s.flags.gate = true;
    s.boxer.state = "follow";
    s.boxer.x = 1300;
    s.player.x = 1450;
    expect(inWater(s, 1600)).toBe(true);
    let baffled = false;
    for (let n = 0; n < 180; n++) {
      tick(s, 1 / 60, { dx: 1, dy: 0 });
      if (moods(s, "boxer").includes("confused")) baffled = true;
    }
    expect(s.player.x).toBeGreaterThan(SPOTS.pasture.waterX1); // she got through
    expect(s.boxer.x).toBeLessThan(SPOTS.pasture.waterX0); // he did not
    expect(s.boxer.state).toBe("refuse");
    expect(baffled).toBe(true);
    s.player.x = SPOTS.pasture.sluice.x;
    s.player.d = SPOTS.pasture.sluice.d;
    expect(prompt(s)?.action).toBe("sluice");
    interact(s);
    expect(s.flags.water).toBe(true);
    expect(inWater(s, 1600)).toBe(false);
    run(s, 4);
    expect(s.boxer.x).toBeGreaterThan(SPOTS.pasture.waterX0); // and now he comes
  });

  it("distortion: run from the coyote and he charges it; give him the rope and he anchors; the calf trusts them both", () => {
    const s = freshAdventure();
    s.chapter = "distortion";
    s.player.x = 820;
    s.boxer.state = "follow";
    s.boxer.x = 650;
    s.coyote.state = "hidden";
    s.toy = { kind: "rope", ...SPOTS.distortion.rope };
    run(s, 0.5, 1);
    expect(s.coyote.state).toBe("stalk");
    run(s, 2);
    // she runs from it
    run(s, 1.2, -1);
    expect(s.boxer.state === "charge" || s.coyote.state === "flee").toBe(true);
    run(s, 4);
    expect(["flee", "gone"]).toContain(s.coyote.state);
    // the rope
    s.player.x = SPOTS.distortion.rope.x;
    s.player.d = SPOTS.distortion.rope.d;
    s.boxer.x = 200;
    interact(s);
    expect(s.player.item).toBe("rope");
    s.boxer.x = s.player.x + 80;
    s.boxer.state = "follow";
    expect(prompt(s)?.action).toBe("tether");
    interact(s);
    expect(s.flags.tether).toBe(true);
    expect(s.boxer.state).toBe("anchor");
    expect(moods(s, "boxer")).toContain("guilty");
    run(s, 3);
    s.player.x = SPOTS.distortion.sluice.x;
    s.player.d = SPOTS.distortion.sluice.d;
    expect(prompt(s)?.action).toBe("lift");
    interact(s);
    expect(s.flags.water).toBe(true);
    s.player.x = SPOTS.distortion.ledge.x;
    s.player.d = SPOTS.distortion.ledge.d;
    expect(prompt(s)?.action).toBe("rescue");
    interact(s);
    expect(s.flags.rescued).toBe(true);
    expect(moods(s, "calf")).toContain("trusting");
    expect(moods(s, "terrier")).toContain("tender");
    run(s, 7);
    expect(s.chapter).toBe("home");
  });

  it("a hop leaves the ground and comes back; depth stays inside the picture", () => {
    const s = freshAdventure();
    hop(s);
    run(s, 0.2);
    expect(s.player.jump).toBeGreaterThan(0);
    run(s, 1.5);
    expect(s.player.jump).toBe(0);
    run(s, 4, 0, 1);
    expect(s.player.d).toBe(1);
    run(s, 4, 0, -1);
    expect(s.player.d).toBe(0);
  });

  it("a saved afternoon resumes whole; junk or an old save starts fresh", () => {
    const s = freshAdventure();
    s.chapter = "pasture";
    s.calf.met = true;
    s.flags.gate = true;
    s.player.x = 1600;
    const back = restoreAdventure(JSON.stringify(s));
    expect(back.chapter).toBe("pasture");
    expect(back.calf.met).toBe(true);
    expect(back.flags.gate).toBe(true);
    expect(back.player.x).toBe(1600);
    expect(back.boxer.state).toBe("follow");
    expect(restoreAdventure('{"version":1,"chapter":"home","x":640}').chapter).toBe("courtyard");
    expect(restoreAdventure("not json").chapter).toBe("courtyard");
    const nearly = restoreAdventure(JSON.stringify({ ...freshAdventure(), chapter: "courtyard" }));
    expect(nearly.toy?.kind).toBe("ball"); // the ball is always back on the ground until the stairs are clear
  });

  it("nothing in the fiction names a customer, a building or an order", () => {
    const s = freshAdventure();
    const text = JSON.stringify(s) + JSON.stringify(SPOTS);
    expect(text).not.toMatch(/customer|order|address|hanger|laundry/i);
  });
});
