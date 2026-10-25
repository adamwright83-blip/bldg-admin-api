import { describe, expect, it } from "vitest";
import { DEEP, R, SEAM, SPOTS, STEPPABLE, WIDTH, chargeThrow, dist, freshAdventure, hop, interact, prompt, releaseThrow, restoreAdventure, tick, type Adventure } from "./adventure";

// the sim at 60 Hz, the way the renderer drives it
const run = (s: Adventure, seconds: number, dx = 0, dy = 0) => {
  for (let n = 0; n < Math.round(seconds * 60); n++) tick(s, 1 / 60, { dx, dy });
};
const until = (s: Adventure, done: () => boolean, seconds: number) => {
  for (let n = 0; n < seconds * 60 && !done(); n++) tick(s, 1 / 60, { dx: 0, dy: 0 });
  return done();
};
/** walks her there with the real controls (left/right, deeper/nearer) */
const walkTo = (s: Adventure, x: number, d: number, seconds = 40) => {
  const p = s.player;
  for (let n = 0; n < seconds * 60; n++) {
    const dx = Math.abs(x - p.x) < 5 ? 0 : Math.sign(x - p.x);
    const dy = Math.abs(d - p.d) < 0.015 ? 0 : Math.sign(d - p.d);
    if (!dx && !dy) return;
    tick(s, 1 / 60, { dx, dy });
  }
  throw new Error(`could not walk to ${x}, ${d}; stuck at ${p.x.toFixed(0)}, ${p.d.toFixed(2)}`);
};
const face = (s: Adventure, dir: 1 | -1) => tick(s, 1 / 60, { dx: dir, dy: 0 });
const act = (s: Adventure, action: string) => {
  expect(prompt(s)?.action).toBe(action);
  interact(s);
};
const moods = (s: Adventure, who: "terrier" | "boxer" | "calf") => s.inserts.filter(i => i.who === who).map(i => i.mood);
const heard = (s: Adventure, seconds: number, dx = 0) => {
  const all = new Set<string>();
  for (let n = 0; n < seconds * 60; n++) {
    tick(s, 1 / 60, { dx, dy: 0 });
    for (const c of s.cues) all.add(c);
    s.cues = [];
  }
  return all;
};
/** hold F for a while, let go */
const heldThrow = (s: Adventure, seconds: number) => {
  expect(chargeThrow(s)).toBe(true);
  run(s, seconds);
  expect(releaseThrow(s)).toBe(true);
};
const pickUpBall = (s: Adventure) => {
  walkTo(s, s.toy!.x, s.toy!.d);
  act(s, "pickup");
  expect(s.player.item).toBe("ball");
};

/** Solution A: park him at the landing while the creek is dry, open the sluice, open the hose */
function solveWithTheBoxer(s: Adventure) {
  pickUpBall(s);
  walkTo(s, R + 1100, 0.3);
  face(s, 1);
  heldThrow(s, 1);
  expect(until(s, () => s.boxer.state === "nap", 30)).toBe(true);
  expect(dist(s.boxer, SPOTS.landing)).toBeLessThan(260);
  walkTo(s, SPOTS.sluice.x - 40, SPOTS.sluice.d);
  act(s, "sluice");
  walkTo(s, SPOTS.hose.x, SPOTS.hose.d + 0.05);
  act(s, "hose");
  expect(until(s, () => s.flags.rescued, 40)).toBe(true);
}

describe("The Lost Creek: one place, two eras", () => {
  it("1. the hose drains the fountain into the creek; shutting it brings the water home; the sluice routes it to the hole", () => {
    const s = freshAdventure();
    expect(s.water.F).toBe(1);
    s.player.x = SPOTS.hose.x;
    s.player.d = SPOTS.hose.d;
    act(s, "hose");
    expect(s.hose).toBe(true);
    run(s, 0.5);
    const early = { ...s.water };
    run(s, 3);
    expect(s.water.F).toBeLessThan(early.F);
    expect(s.water.C).toBeGreaterThan(early.C);
    // the creek lags the fountain a little: that is what reads as flow
    expect(s.water.C).toBeLessThan(1 - s.water.F);
    run(s, 6);
    expect(s.water.ford).toBeGreaterThan(DEEP);
    expect(s.water.channel).toBe(0);
    expect(s.water.F).toBe(0);
    // shut: the fountain's pump refills it, the creek goes home
    act(s, "hose");
    const full = { ...s.water };
    run(s, 4);
    expect(s.water.F).toBeGreaterThan(full.F);
    expect(s.water.C).toBeLessThan(full.C);
    run(s, 10);
    expect(s.water.F).toBe(1);
    expect(s.water.ford).toBeLessThan(0.02);
    // sluice open: the creek runs down the old channel into the hole and the trough floats up
    s.player.x = SPOTS.sluice.x;
    s.player.d = SPOTS.sluice.d;
    act(s, "sluice");
    expect(s.sluice).toBe(true);
    s.player.x = SPOTS.hose.x;
    s.player.d = SPOTS.hose.d;
    act(s, "hose");
    run(s, 12);
    expect(s.water.ford).toBeLessThanOrEqual(DEEP);
    expect(s.water.channel).toBeGreaterThan(0.9);
    expect(s.water.hw).toBeGreaterThanOrEqual(STEPPABLE);
    expect(s.water.trend).toBe(0);
  });

  it("2. a ball dropped down the storm drain comes out of the culvert, wet, 0.6 s later", () => {
    const s = freshAdventure();
    pickUpBall(s);
    walkTo(s, SPOTS.drain.x - 200, SPOTS.drain.d);
    face(s, 1);
    heldThrow(s, 0.1); // a tap: the short toss, 160 px
    run(s, 0.75);
    expect(s.toy?.phase).toBe("drain");
    run(s, 0.5);
    expect(s.toy?.phase).toBe("drain");
    const cues = heard(s, 0.2);
    expect(cues.has("pop")).toBe(true);
    expect(s.toy!.wet).toBe(true);
    run(s, 1);
    expect(s.toy!.x).toBeGreaterThan(SEAM);
    expect(dist(s.toy!, SPOTS.culvert)).toBeLessThan(200);
  });

  it("3. the boxer will not swim a flowing channel; he settles and naps right where he caught the ball", () => {
    const s = freshAdventure();
    // the creek runs down the channel
    s.sluice = true;
    s.hose = true;
    run(s, 9);
    expect(s.water.channel).toBeGreaterThan(DEEP);
    // he is awake beside her on the east bank of the ford (which the sluice keeps shallow)
    s.player.x = R + 1530;
    s.player.d = 0.5;
    s.boxer.x = R + 1450;
    s.boxer.d = 0.55;
    s.boxer.state = "follow";
    s.toy = null;
    s.player.item = "ball";
    s.player.face = 1;
    s.calf.ledge = false; // nobody on the ledge this time: this is about him
    // into the channel
    s.player.d = 0.4;
    s.player.x = R + 1500;
    expect(chargeThrow(s)).toBe(true);
    s.player.charge = 0;
    releaseThrow(s);
    let refused = false;
    for (let n = 0; n < 60 * 8 && s.boxer.state !== "carry"; n++) {
      tick(s, 1 / 60, { dx: 0, dy: 0 });
      if (s.boxer.state === "refuse") refused = true;
    }
    expect(refused).toBe(true);
    // the ball drifted to a bank and he had it from there
    expect(s.boxer.item).toBe("ball");
    const caught = s.boxer.x;
    expect(until(s, () => s.boxer.state === "nap", 12)).toBe(true);
    expect(Math.abs(s.boxer.x - caught)).toBeLessThanOrEqual(262);
    // and then the place he lay down is where he stays
    const napped = { x: s.boxer.x, d: s.boxer.d };
    run(s, 5);
    expect(s.boxer).toMatchObject(napped);
    expect(s.toy?.phase).toBe("rest"); // he dropped it beside him
  });

  it("3b. on dry ground he trots 120–260 px on from the catch before he lies down", () => {
    const s = freshAdventure();
    pickUpBall(s);
    walkTo(s, 700, 0.6);
    face(s, 1);
    heldThrow(s, 0.5);
    let caughtAt = 0;
    for (let n = 0; n < 60 * 20 && s.boxer.state !== "nap"; n++) {
      const before = s.boxer.state;
      tick(s, 1 / 60, { dx: 0, dy: 0 });
      if (before === "chase" && s.boxer.state === "carry") caughtAt = s.boxer.x;
    }
    expect(s.boxer.state).toBe("nap");
    expect(Math.abs(s.boxer.x - caughtAt)).toBeGreaterThanOrEqual(118);
    expect(Math.abs(s.boxer.x - caughtAt)).toBeLessThanOrEqual(262);
  });

  it("4. Solution A: park him at the landing, open the sluice, open the hose: the calf comes down to him", () => {
    const s = freshAdventure();
    solveWithTheBoxer(s);
    expect(s.calf.ledge).toBe(false);
    expect(dist(s.calf, SPOTS.landing)).toBeLessThan(200);
    expect(s.calf.trust).toBe(3);
    expect(moods(s, "calf")).toContain("trusting");
  });

  it("5. Solution B: no boxer across; she earns the calf's trust by being still with the ball, and waits at the landing", () => {
    const s = freshAdventure();
    pickUpBall(s);
    // the water first: sluice, then hose
    walkTo(s, SPOTS.sluice.x - 40, SPOTS.sluice.d);
    act(s, "sluice");
    walkTo(s, SPOTS.hose.x, SPOTS.hose.d + 0.05);
    act(s, "hose");
    expect(until(s, () => s.water.hw >= STEPPABLE, 20)).toBe(true);
    expect(s.boxer.state).toBe("nap");
    expect(s.boxer.x).toBeLessThan(SEAM); // still asleep in the courtyard
    // running up to it frightens it
    walkTo(s, R + 1700, 0.5);
    walkTo(s, R + 1760, 0.33);
    expect(s.calf.ledge).toBe(true);
    expect(s.calf.trust).toBe(0);
    // stand still, with the ball
    let trustSeen = 0;
    for (let n = 0; n < 60 * 9 && !s.flags.rescued; n++) {
      tick(s, 1 / 60, { dx: 0, dy: 0 });
      trustSeen = Math.max(trustSeen, s.calf.trust);
    }
    expect(trustSeen).toBe(3);
    expect(moods(s, "calf").length).toBeGreaterThan(0);
    expect(until(s, () => s.flags.rescued, 4)).toBe(true);
    expect(s.player.item).toBe("ball"); // he never came near her
  });

  it("5b. trust is earned and lost by behaviour: stillness adds, the ball adds once, a run at it takes one away", () => {
    const s = freshAdventure();
    s.player.x = R + 1760;
    s.player.d = 0.33;
    s.player.item = "ball";
    s.calf.near = true;
    run(s, 0.6);
    expect(s.calf.trust).toBe(1);
    expect(moods(s, "calf")).toContain("delighted");
    run(s, 2.1);
    expect(s.calf.trust).toBe(2);
    expect(moods(s, "calf")).toContain("curious");
    // a hop startles it (no trust lost)
    hop(s);
    expect(moods(s, "calf")).toContain("startled");
    run(s, 1);
    expect(s.calf.trust).toBe(2);
    // run away and come back at a run: scared, backs off, trust down one
    walkTo(s, R + 1300, 0.6);
    run(s, 0.3, 1);
    walkTo(s, R + 1760, 0.33);
    expect(s.calf.trust).toBe(1);
    expect(moods(s, "calf")).toContain("scared");
  });

  it("6. recoverable: drain the creek with him on the wrong bank and he refuses; shut the hose and he follows her across", () => {
    const s = freshAdventure();
    s.player.x = R + 900;
    s.player.d = 0.5;
    s.boxer.x = R + 800;
    s.boxer.d = 0.55;
    s.boxer.state = "follow";
    s.boxer.t = 5;
    s.hose = true; // sluice shut: everything comes down the ford
    run(s, 6);
    expect(s.water.ford).toBeGreaterThan(DEEP);
    // she wades across; he will not
    walkTo(s, R + 1450, 0.5);
    expect(s.player.wet).toBeGreaterThan(0.5); // she wades
    const seen = new Set<string>();
    walkTo(s, R + 1820, 0.6);
    for (let n = 0; n < 180; n++) {
      tick(s, 1 / 60, { dx: 0, dy: 0 });
      moods(s, "boxer").forEach(m => seen.add(m));
      for (const c of s.cues) seen.add(c);
      s.cues = [];
    }
    expect(s.boxer.state).toBe("refuse");
    expect(s.boxer.x).toBeLessThan(R + 1090 + 600 * s.boxer.d);
    expect(seen.has("confused") || moods(s, "boxer").includes("confused")).toBe(true);
    // shut the hose (from here she has to go back for it: the water goes home)
    s.hose = false;
    expect(until(s, () => s.water.ford <= DEEP, 20)).toBe(true);
    run(s, 6);
    expect(s.boxer.state).toBe("follow");
    expect(s.boxer.x).toBeGreaterThan(R + 1270 + 600 * s.boxer.d);
  });

  it("7. after the rescue the calf follows her, and the boxer lets her keep the ball, once, tenderly", () => {
    const s = freshAdventure();
    solveWithTheBoxer(s);
    expect(s.boxer.yields).toBe(true);
    expect(s.boxer.state).toBe("follow");
    // the calf comes to her
    run(s, 14);
    expect(Math.abs(s.calf.x - (s.player.x + 70))).toBeLessThan(40);
    // the ball, where he left it
    const ball = s.toy!;
    s.player.x = ball.x;
    s.player.d = ball.d;
    interact(s);
    expect(s.player.item).toBe("ball");
    s.boxer.x = s.player.x + 60;
    s.boxer.d = s.player.d;
    s.boxer.state = "follow";
    s.boxer.t = 5;
    s.inserts = [];
    run(s, 0.2);
    expect(s.flags.yielded).toBe(true);
    expect(s.player.item).toBe("ball");
    expect(moods(s, "boxer")).toContain("tender");
    expect(moods(s, "terrier")).toContain("delighted");
    expect(s.boxer.state).toBe("settle"); // he lies down without it
    run(s, 4);
    s.inserts = [];
    s.boxer.x = s.player.x + 60;
    run(s, 2);
    expect(s.player.item).toBe("ball");
    expect(moods(s, "boxer")).not.toContain("tender");
  });

  it("8. the three walk through the seam into the overlap; home is a place she walks; lying down ends it", () => {
    const s = freshAdventure();
    solveWithTheBoxer(s);
    walkTo(s, SEAM - 200, 0.6);
    run(s, 12);
    expect(dist(s.calf, s.player)).toBeLessThan(200);
    expect(dist(s.boxer, s.player)).toBeLessThan(260);
    // through the seam together
    for (let n = 0; n < 600 && s.chapter === "creek"; n++) tick(s, 1 / 60, { dx: 1, dy: 0 });
    expect(s.chapter).toBe("home");
    run(s, 1.5);
    expect(s.tear).toBeNull();
    const x0 = s.player.x;
    run(s, 1, 1);
    expect(s.player.x).toBeGreaterThan(x0 + 150);
    walkTo(s, SPOTS.home.pool, 0.6);
    act(s, "drink");
    run(s, 2.2);
    walkTo(s, SPOTS.home.elevator, 0.6);
    act(s, "ride");
    expect(s.card?.text).toBe("the beans are coming up");
    walkTo(s, SPOTS.home.oak, 0.6);
    act(s, "lie");
    run(s, 3);
    expect(s.flags.ended).toBe(true);
    const after = JSON.stringify(s);
    run(s, 2, -1, 1);
    hop(s);
    expect(JSON.stringify(s)).toBe(after);
    expect(prompt(s)).toBeNull();
  });

  it("9. a v3 afternoon round-trips; a v2 save or junk starts fresh", () => {
    const s = freshAdventure();
    s.water.F = 0.4;
    s.hose = true;
    s.sluice = true;
    s.calf.trust = 2;
    s.player.x = R + 400;
    s.player.d = 0.3;
    s.boxer.x = R + 1830;
    s.boxer.d = 0.32;
    s.boxer.state = "nap";
    const back = restoreAdventure(JSON.stringify(s));
    expect(back.water.F).toBeCloseTo(0.4);
    expect(back.water.channel).toBeCloseTo(0.6);
    expect(back.water.ford).toBeCloseTo(0.21);
    expect(back.hose).toBe(true);
    expect(back.sluice).toBe(true);
    expect(back.calf.trust).toBe(2);
    expect(back.calf.ledge).toBe(true);
    expect(back.player).toMatchObject({ x: R + 400, d: 0.3 });
    expect(back.boxer).toMatchObject({ x: R + 1830, d: 0.32, state: "nap" });
    // after the rescue, and the ending
    s.chapter = "home";
    s.flags.rescued = true;
    s.flags.yielded = true;
    s.flags.ended = true;
    const home = restoreAdventure(JSON.stringify(s));
    expect(home.chapter).toBe("home");
    expect(home.flags).toMatchObject({ rescued: true, yielded: true, ended: true });
    expect(restoreAdventure(JSON.stringify({ version: 2, chapter: "home", flags: { rescued: true } })).chapter).toBe("creek");
    expect(restoreAdventure(JSON.stringify({ version: 2, chapter: "home" })).flags.rescued).toBe(false);
    expect(restoreAdventure("not json").chapter).toBe("creek");
    expect(restoreAdventure(null).toy?.x).toBe(SPOTS.ball.x);
  });

  it("10. a longer hold throws further; a throw never lands outside the world", () => {
    const landing = (hold: number) => {
      const s = freshAdventure();
      s.toy = null;
      s.player.item = "ball";
      s.player.x = 300;
      s.player.face = 1;
      heldThrow(s, hold);
      run(s, 1.2);
      return s.toy!.x - 300;
    };
    const tap = landing(0.05), half = landing(0.45), full = landing(1.2);
    expect(tap).toBeCloseTo(160 + 40, 0);
    expect(half).toBeGreaterThan(tap + 150);
    expect(full).toBeGreaterThan(half + 150);
    expect(full).toBeCloseTo(160 + 520 + 40, 0);
    for (const [x, dir] of [[WIDTH - 100, 1], [100, -1]] as const) {
      const s = freshAdventure();
      s.toy = null;
      s.player.item = "ball";
      s.player.x = x;
      s.player.face = dir;
      heldThrow(s, 1);
      run(s, 1.5);
      expect(s.toy!.x).toBeGreaterThanOrEqual(70);
      expect(s.toy!.x).toBeLessThanOrEqual(WIDTH - 70);
    }
  });

  it("every verb has its own sound, and the seam rustles (with a card the first time)", () => {
    const s = freshAdventure();
    const at = (x: number, d: number) => {
      s.player.x = x;
      s.player.d = d;
    };
    at(SPOTS.ball.x, SPOTS.ball.d);
    interact(s);
    expect(s.cues).toContain("pick");
    s.cues = [];
    at(SPOTS.hose.x, SPOTS.hose.d);
    interact(s);
    expect(s.cues).toContain("hose");
    at(SPOTS.sluice.x, SPOTS.sluice.d);
    s.cues = [];
    interact(s);
    expect(s.cues).toContain("creak");
    at(SEAM - 10, 0.6);
    const crossing = heard(s, 0.5, 1);
    expect(crossing.has("rustle")).toBe(true);
    expect(s.card?.text).toBe("Two times, one courtyard");
  });

  it("nothing in the fiction names a customer, a building or an order", () => {
    const s = freshAdventure();
    const text = JSON.stringify(s) + JSON.stringify(SPOTS);
    expect(text).not.toMatch(/customer|order|address|hanger|laundry/i);
  });
});
