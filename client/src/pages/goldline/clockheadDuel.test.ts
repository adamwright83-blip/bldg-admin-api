import { describe, expect, it } from "vitest";
import {
  CLOCK_ATTACK_NAMES,
  DUEL_BOSS_HP,
  DUEL_TUNING,
  PHASE_FLOOR,
  PHASE_PATTERNS,
  PROLOGUE_TUNING,
  createClockDuel,
  recoilToAnchor,
  stepClockDuel,
  type ClockDuel,
  type ClockPattern,
  type DuelEvent,
} from "./clockheadDuelEngine";
import { AVATAR_TUNING } from "./colosseumAvatar";
import {
  ARENA_ANCHOR,
  CLOCKHEAD_WINDING_CENTER,
  artPoint,
  torsoPoint,
} from "./colosseumStage";

const IDLE = { x: 0, y: 0 };
/** Feet position from which the Lineblade reaches the winding mainspring. */
const REACH = artPoint(50, 49);

function run(state: ClockDuel, ms: number, input: Parameters<typeof stepClockDuel>[2] = IDLE) {
  let s = state;
  const events: DuelEvent[] = [];
  for (let t = 0; t < ms; t += 16) {
    s = stepClockDuel(s, 16, input);
    events.push(...s.events);
  }
  return { state: s, events };
}

function withAvatar(state: ClockDuel, patch: Partial<ClockDuel["avatar"]>): ClockDuel {
  return { ...state, avatar: { ...state.avatar, ...patch } };
}

function exposedAt(state: ClockDuel, feet = REACH): ClockDuel {
  return withAvatar(
    { ...state, stage: "exposed", clock: 0, windowHits: 0, staggerMs: 0, freezeMs: 0, projectiles: [] },
    { feet, velocity: { x: 0, y: 0 }, strikeRecoveryMs: 0, strikeBufferMs: 0 }
  );
}

describe("Clockhead cannot be beaten by waiting or mashing", () => {
  it("cannot win by time, holding strike, or attacking out of reach", () => {
    let s = createClockDuel();
    for (let i = 0; i < 4000 && s.stage !== "lost"; i += 1) {
      s = stepClockDuel(s, 16, { x: 0, y: 0, strike: true });
    }
    expect(s.bossHp).toBe(DUEL_BOSS_HP);
    expect(s.stage).toBe("lost");
  });

  it("only lets the Lineblade land while he is winding himself", () => {
    const s = withAvatar(createClockDuel(), { feet: REACH });
    const struck = stepClockDuel(s, 16, { x: 0, y: 0, strike: true });
    expect(struck.stage).toBe("tell");
    expect(struck.bossHp).toBe(DUEL_BOSS_HP);
    expect(struck.events.some(event => event.type === "slash")).toBe(true);
  });

  it("needs her close: a winding window is useless from across the arena", () => {
    const far = exposedAt(createClockDuel(), ARENA_ANCHOR);
    const swung = stepClockDuel(far, 16, { x: 0, y: 0, strike: true });
    expect(swung.bossHp).toBe(DUEL_BOSS_HP);
    const near = exposedAt(createClockDuel());
    expect(stepClockDuel(near, 16, { x: 0, y: 0, strike: true }).bossHp).toBe(DUEL_BOSS_HP - 1);
  });

  it("caps each winding window at a three-strike combo, whatever the tapping speed", () => {
    let s = exposedAt(createClockDuel());
    for (let i = 0; i < 90; i += 1) s = stepClockDuel(s, 16, { x: 0, y: 0, strike: true });
    expect(DUEL_BOSS_HP - s.bossHp).toBe(DUEL_TUNING.maxWindowHits);
  });
});

describe("the fight escalates through three hours and every canon attack", () => {
  /**
   * Isolates the window contract the way the first duel's test did: she
   * cannot be hurt, and is placed in reach whenever he starts winding.
   */
  function fightWith(strikesPerWindow: number) {
    let s = createClockDuel();
    const phases = new Set<number>();
    const patterns = new Set<ClockPattern>();
    let windows = 0;
    let landed = 0;
    for (let frame = 0; frame < 60_000 && s.stage !== "won"; frame += 1) {
      s = withAvatar(s, { hurtMs: 5000 });
      if (s.stage === "attack") patterns.add(s.pattern);
      phases.add(s.phase);
      if (s.stage === "exposed" && s.clock < 20 && s.windowHits === 0) {
        windows += 1;
        landed = 0;
        s = withAvatar(s, { feet: REACH });
      }
      const striking = s.stage === "exposed" && landed < strikesPerWindow;
      const before = s.bossHp;
      s = stepClockDuel(s, 16, { x: 0, y: 0, strike: striking });
      if (s.bossHp < before) landed += 1;
    }
    return { s, phases, patterns, windows };
  }

  it("walks a steady player through three hours and every canon attack", () => {
    const { s, phases, patterns } = fightWith(1);
    expect(s.stage).toBe("won");
    expect(s.bossHp).toBe(0);
    expect([...phases].sort()).toEqual([1, 2, 3]);
    for (const pattern of ["aimed", "fan", "sweep", "deadline", "rewind"] as const) {
      expect(patterns.has(pattern), pattern).toBe(true);
    }
  });

  it("makes even a perfect player earn six windows — every hour ends at its own floor", () => {
    const { s, windows, patterns } = fightWith(3);
    expect(s.stage).toBe("won");
    expect(windows).toBe(6);
    // The final hour opens with his signature, so nobody skips it.
    expect(patterns.has("rewind")).toBe(true);
  });

  it("winds after every attack in the first hour, but chains two from Overtime on", () => {
    const attacksBeforeWinding = (start: ClockDuel) => {
      let s = withAvatar(start, { hurtMs: 999_999, feet: artPoint(20, 60) });
      let attacks = 0;
      let lastStage = s.stage;
      for (let i = 0; i < 2000 && s.stage !== "exposed"; i += 1) {
        s = withAvatar(stepClockDuel(s, 16, IDLE), { hurtMs: 999_999 });
        if (s.stage === "attack" && lastStage !== "attack") attacks += 1;
        lastStage = s.stage;
      }
      return attacks;
    };
    expect(attacksBeforeWinding(createClockDuel())).toBe(1);
    const overtime = { ...createClockDuel(), phase: 2 as const, bossHp: 8, anchorBossHp: 8, pattern: PHASE_PATTERNS[2][0]! };
    expect(attacksBeforeWinding(overtime)).toBe(2);
  });

  it("stops the world between hours and clears every hazard", () => {
    let s = exposedAt(createClockDuel());
    s = { ...s, bossHp: 9 };
    s = stepClockDuel(s, 16, { x: 0, y: 0, strike: true });
    expect(s.stage).toBe("phase_break");
    expect(s.phase).toBe(2);
    expect(s.anchorBossHp).toBe(8);
    expect(s.projectiles).toHaveLength(0);
    expect(s.events.some(event => event.type === "phase_break")).toBe(true);
    // + the strike's own hit-stop, which holds the whole world still first.
    const after = run(s, DUEL_TUNING.phaseBreakMs + 200).state;
    expect(after.stage).toBe("tell");
    expect(after.pattern).toBe(PHASE_PATTERNS[2][0]);
  });

  it("names each attack with the World Bible's vocabulary", () => {
    expect(CLOCK_ATTACK_NAMES).toEqual({
      aimed: "AIMED BOLT",
      fan: "CLOCK FAN",
      sweep: "SECOND HAND",
      deadline: "DEADLINE",
      rewind: "BORROWED MINUTE",
    });
  });
});

describe("attacks are read before they land", () => {
  it("shows a full tell before anything is thrown", () => {
    const { state } = run(createClockDuel(), DUEL_TUNING.tellMs[1] - 60);
    expect(state.stage).toBe("tell");
    expect(state.projectiles).toHaveLength(0);
  });

  it("hangs the Aimed Bolt mid-flight, then resumes toward where she is NOW", () => {
    let s = withAvatar(createClockDuel(), { hurtMs: 99999 });
    s = run(s, DUEL_TUNING.tellMs[1] + 20).state;
    expect(s.stage).toBe("attack");
    let hung = run(s, DUEL_TUNING.hangAtMs + 40);
    expect(hung.events.some(event => event.type === "hang")).toBe(true);
    const frozenAt = { x: hung.state.projectiles[0]!.x, y: hung.state.projectiles[0]!.y };
    hung = run(hung.state, 200);
    expect(hung.state.projectiles[0]!.x).toBeCloseTo(frozenAt.x, 6);
    expect(hung.state.projectiles[0]!.y).toBeCloseTo(frozenAt.y, 6);

    // She walks right while it hangs; the resume commits to her new torso.
    const moved = withAvatar(hung.state, { feet: artPoint(80, 70) });
    const resumed = run(moved, DUEL_TUNING.hangForMs[1]);
    expect(resumed.events.some(event => event.type === "resume")).toBe(true);
    const bolt = resumed.state.projectiles[0]!;
    const torso = torsoPoint(artPoint(80, 70));
    const toward = { x: torso.x - bolt.x, y: torso.y - bolt.y };
    const dot = (bolt.vx * toward.x + bolt.vy * toward.y) / (Math.hypot(bolt.vx, bolt.vy) * Math.hypot(toward.x, toward.y));
    expect(dot).toBeGreaterThan(0.98);
  });

  it("looses the Clock Fan on staggered timing, not all at once", () => {
    let s = withAvatar({ ...createClockDuel(), pattern: "fan" }, { hurtMs: 99999 });
    s = run(s, DUEL_TUNING.tellMs[1] + 20).state;
    const charging = s.projectiles.filter(shot => (shot.delayMs ?? 0) > 0);
    expect(s.projectiles.length).toBe(DUEL_TUNING.fanCount[1]);
    expect(charging.length).toBeGreaterThanOrEqual(DUEL_TUNING.fanCount[1] - 2);
  });
});

describe("each attack has its own answer", () => {
  function midSweep(guard: boolean, dodge: boolean): ClockDuel {
    let s = { ...createClockDuel(), phase: 2 as const, bossHp: 8, anchorBossHp: 8, pattern: "sweep" as const };
    s = withAvatar(s, { feet: artPoint(50, 72) });
    s = run(s, DUEL_TUNING.tellMs[2] + 20, { x: 0, y: 0, guard }).state;
    // Wait until the hand is almost on top of her, then react.
    for (let i = 0; i < 200 && !(s.sweep && s.sweep.angle > 70 && s.sweep.angle < 110); i += 1) {
      s = stepClockDuel(s, 16, { x: 0, y: 0, guard });
    }
    if (dodge) s = stepClockDuel(s, 16, { x: 1, y: 0, dodge: true });
    return run(s, 500, { x: 0, y: 0, guard }).state;
  }

  it("the Second Hand cannot be blocked — the shield does not stop it", () => {
    expect(midSweep(true, false).hp).toBe(AVATAR_TUNING.maxGuardPips - 1);
  });

  it("…but a dodge carries her through it untouched", () => {
    expect(midSweep(false, true).hp).toBe(AVATAR_TUNING.maxGuardPips);
  });

  it("a Deadline only lands on whoever is still standing on the mark", () => {
    let s = { ...createClockDuel(), phase: 2 as const, bossHp: 8, anchorBossHp: 8, pattern: "deadline" as const };
    s = run(s, DUEL_TUNING.tellMs[2] + 20).state;
    expect(s.deadlines).toHaveLength(1);
    const stayed = run(s, DUEL_TUNING.deadlineFuseMs + 40).state;
    expect(stayed.hp).toBe(AVATAR_TUNING.maxGuardPips - 1);
    const left = run(withAvatar(s, { feet: artPoint(20, 60) }), DUEL_TUNING.deadlineFuseMs + 40).state;
    expect(left.hp).toBe(AVATAR_TUNING.maxGuardPips);
  });

  it("in the final hour a Deadline lands twice: the damage is deferred", () => {
    let s = { ...createClockDuel(), phase: 3 as const, bossHp: 4, anchorBossHp: 4, pattern: "deadline" as const };
    s = run(s, DUEL_TUNING.tellMs[3] + 20).state;
    expect(s.deadlines).toHaveLength(3);
    const first = run(s, DUEL_TUNING.deadlineFuseMs + 40);
    expect(first.events.filter(event => event.type === "deadline_slam")).toHaveLength(3);
    // She steps back onto the mark once it "resolved" — and it lands again.
    const back = withAvatar(first.state, { feet: s.deadlines[0]!.at, hurtMs: 0 });
    const second = run(back, DUEL_TUNING.deferredFuseMs + 40);
    const deferred = second.events.filter(event => event.type === "deadline_slam" && event.deferred);
    expect(deferred.length).toBe(3);
    expect(second.state.hp).toBeLessThan(first.state.hp);
  });

  it("a Borrowed Minute turns the fan around, and bolts from behind ignore the shield", () => {
    let s = { ...createClockDuel(), phase: 3 as const, bossHp: 4, anchorBossHp: 4, pattern: "rewind" as const };
    s = withAvatar(s, { hurtMs: 99999 });
    s = run(s, DUEL_TUNING.tellMs[3] + 20).state;
    const rewound = run(s, DUEL_TUNING.rewindAtMs + 40);
    expect(rewound.events.some(event => event.type === "rewind")).toBe(true);
    const fan = rewound.state.projectiles.filter(shot => shot.reversed);
    expect(fan.length).toBeGreaterThan(0);
    expect(fan.every(shot => shot.vy < 0)).toBe(true);

    // Stand guarding, facing him, with a returning bolt coming up from behind.
    const feet = artPoint(50, 70);
    const torso = torsoPoint(feet);
    const fromBehind = { id: "back", x: torso.x, y: torso.y + 10, vx: 0, vy: -80, ageMs: 0, reversed: true };
    const guarded = withAvatar({ ...rewound.state, projectiles: [fromBehind] }, {
      feet,
      hurtMs: 0,
      guarding: true,
      guardHeldMs: 60,
    });
    const hit = run(guarded, 400, { x: 0, y: 0, guard: true });
    expect(hit.events.some(event => event.type === "block")).toBe(false);
    expect(hit.events.some(event => event.type === "hurt")).toBe(true);
    expect(hit.state.hp).toBe(AVATAR_TUNING.maxGuardPips - 1);
  });
});

describe("the shield: perfect blocks store force, RETURN spends it", () => {
  function boltArriving(state: ClockDuel): ClockDuel {
    const feet = artPoint(50, 70);
    const torso = torsoPoint(feet);
    return withAvatar(
      {
        ...state,
        stage: "attack",
        pattern: "fan",
        clock: 0,
        projectiles: [{ id: "b", x: torso.x, y: torso.y - 16, vx: 0, vy: 80, ageMs: 0 }],
      },
      { feet, velocity: { x: 0, y: 0 } }
    );
  }

  it("a shield raised just before impact is perfect and stores one force", () => {
    let s = boltArriving(createClockDuel());
    s = run(s, 60).state; // bolt closes in, shield still down
    const blocked = run(s, 200, { x: 0, y: 0, guard: true });
    const block = blocked.events.find(event => event.type === "block");
    expect(block && block.type === "block" && block.perfect).toBe(true);
    expect(blocked.state.avatar.force).toBe(1);
    expect(blocked.state.hp).toBe(AVATAR_TUNING.maxGuardPips);
  });

  it("a shield held up long in advance still blocks, but stores nothing", () => {
    let s = boltArriving(createClockDuel());
    s = withAvatar(s, { guarding: true, guardHeldMs: 2000 });
    const blocked = run(s, 260, { x: 0, y: 0, guard: true });
    const block = blocked.events.find(event => event.type === "block");
    expect(block && block.type === "block" && block.perfect).toBe(false);
    expect(blocked.state.avatar.force).toBe(0);
  });

  it("RETURN needs three stored force, clears the air, wounds him and knocks him off schedule", () => {
    const loaded = withAvatar(createClockDuel(), { force: AVATAR_TUNING.forceMax });
    const armed = { ...loaded, projectiles: [{ id: "x", x: 50, y: 90, vx: 0, vy: 40, ageMs: 0 }] };
    const released = stepClockDuel(armed, 16, { x: 0, y: 0, returnWave: true });
    expect(released.events.some(event => event.type === "return")).toBe(true);
    expect(released.projectiles).toHaveLength(0);
    expect(released.bossHp).toBe(DUEL_BOSS_HP - DUEL_TUNING.returnDamage);
    expect(released.stage).toBe("exposed");
    expect(released.avatar.force).toBe(0);

    const empty = stepClockDuel(withAvatar(createClockDuel(), { force: 2 }), 16, { x: 0, y: 0, returnWave: true });
    expect(empty.events.some(event => event.type === "return")).toBe(false);
    expect(empty.bossHp).toBe(DUEL_BOSS_HP);
  });

  it("dodging grants a brief, real window of invulnerability", () => {
    const s = createClockDuel();
    const dodged = stepClockDuel(s, 16, { x: 1, y: 0, dodge: true });
    expect(dodged.avatar.dodgeMs).toBeGreaterThan(0);
    expect(dodged.player.x).toBeGreaterThan(s.player.x);
    expect(dodged.events.some(event => event.type === "dodge")).toBe(true);
  });
});

describe("losing is RECOIL, not GAME OVER", () => {
  it("throws her back to the start of the hour she fell in, with full guard", () => {
    let s = { ...createClockDuel(), phase: 2 as const, bossHp: 6, anchorBossHp: 8 };
    s = withAvatar(s, { guardPips: 1 });
    s = { ...s, stage: "attack", pattern: "fan", projectiles: [{ id: "k", ...torsoPoint(s.avatar.feet), vx: 0, vy: 1, ageMs: 0 }] };
    const lost = stepClockDuel(s, 16, IDLE);
    expect(lost.stage).toBe("lost");
    expect(lost.events.some(event => event.type === "recoil")).toBe(true);
    const back = recoilToAnchor(lost);
    expect(back.bossHp).toBe(8);
    expect(back.phase).toBe(2);
    // Full guard, and the first retry of an hour is steadied by one extra pip.
    expect(back.hp).toBe(back.avatar.maxGuardPips);
    expect(back.avatar.maxGuardPips).toBe(AVATAR_TUNING.maxGuardPips + 1);
    expect(back.player).toEqual(ARENA_ANCHOR);
    expect(back.stats.recoils).toBe(1);
  });

  it("steadies each retry of the same hour — +1 guard per RECOIL, up to five — and resets next hour", () => {
    let s = { ...createClockDuel(), phase: 2 as const, bossHp: 7, anchorBossHp: 8 };
    const loseNow = (state: ClockDuel) => {
      const doomed = withAvatar(
        { ...state, stage: "attack" as const, pattern: "fan" as const },
        { guardPips: 1, hurtMs: 0 }
      );
      const torso = torsoPoint(doomed.avatar.feet);
      return stepClockDuel({ ...doomed, projectiles: [{ id: "x", ...torso, vx: 0, vy: 1, ageMs: 0 }] }, 16, IDLE);
    };
    const guards: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      s = recoilToAnchor(loseNow(s));
      guards.push(s.avatar.maxGuardPips);
      expect(s.hp).toBe(s.avatar.maxGuardPips);
    }
    expect(guards).toEqual([4, 5, 5, 5]);

    // Clearing the hour resets the assist for the next one.
    let next = exposedAt(s);
    next = { ...next, bossHp: 5 };
    next = stepClockDuel(next, 16, { x: 0, y: 0, strike: true });
    expect(next.stage).toBe("phase_break");
    expect(next.anchorRecoils).toBe(0);
  });

  it("carries no business state anywhere in the duel", () => {
    const forbidden = /mission|target|visit|outcome|pitch|revenue|order|customer/i;
    const keys = (value: unknown, prefix = ""): string[] =>
      value && typeof value === "object"
        ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
            `${prefix}${key}`,
            ...(Array.isArray(child) ? [] : keys(child, `${prefix}${key}.`)),
          ])
        : [];
    for (const key of keys(createClockDuel())) expect(forbidden.test(key), key).toBe(false);
    expect(CLOCKHEAD_WINDING_CENTER).toBeTruthy();
  });
});

describe("the first-entry prologue: a real taste of the fight that can be neither won nor lost", () => {
  /** She is placed in reach whenever he winds, and strikes until something changes. */
  function tasteIt(state: ClockDuel) {
    let s = state;
    const events: DuelEvent[] = [];
    for (let frame = 0; frame < 20_000 && s.stage !== "escaped"; frame += 1) {
      s = withAvatar(s, { hurtMs: 5000 });
      if (s.stage === "exposed" && s.clock < 20) s = withAvatar(s, { feet: REACH });
      s = stepClockDuel(s, 16, { x: 0, y: 0, strike: s.stage === "exposed" });
      events.push(...s.events);
    }
    return { s, events };
  }

  it("lets her hits land for real, then he escapes at the end of his first hour", () => {
    const { s, events } = tasteIt(createClockDuel({ mode: "prologue" }));
    expect(s.stage).toBe("escaped");
    expect(s.bossHp).toBe(PROLOGUE_TUNING.bossFloor);
    expect(events.filter(event => event.type === "strike_hit")).toHaveLength(DUEL_BOSS_HP - PROLOGUE_TUNING.bossFloor);
    expect(events.some(event => event.type === "escape" && event.reason === "cornered")).toBe(true);
    // Never the finale's beats: no hour break, no defeat.
    expect(events.some(event => event.type === "phase_break" || event.type === "defeated")).toBe(false);
  });

  it("is over once he escapes: nothing she does afterwards moves him", () => {
    const { s } = tasteIt(createClockDuel({ mode: "prologue" }));
    const after = run(s, 3000, { x: 0, y: 0, strike: true, returnWave: true });
    expect(after.state.stage).toBe("escaped");
    expect(after.state.bossHp).toBe(PROLOGUE_TUNING.bossFloor);
    expect(after.events).toEqual([]);
  });

  it("cannot be lost: standing still under fire, the Line never lets her guard reach zero", () => {
    let s = createClockDuel({ mode: "prologue" });
    let lowest = s.hp;
    const events: DuelEvent[] = [];
    for (let i = 0; i < 8000 && s.stage !== "escaped"; i += 1) {
      s = stepClockDuel(s, 16, IDLE);
      lowest = Math.min(lowest, s.hp);
      events.push(...s.events);
    }
    expect(s.stats.hitsTaken).toBeGreaterThan(3);
    expect(lowest).toBe(PROLOGUE_TUNING.minGuardPips);
    expect(events.some(event => event.type === "recoil")).toBe(false);
    // …and a player who never closes in still gets the story, between attacks.
    expect(s.stage).toBe("escaped");
    expect(events.some(event => event.type === "escape" && event.reason === "timeout")).toBe(true);
    expect(s.stats.elapsedMs).toBeGreaterThanOrEqual(PROLOGUE_TUNING.timeoutMs);
  });

  it("a RETURN that would carry him past the floor only makes him escape sooner", () => {
    const primed = withAvatar(
      { ...createClockDuel({ mode: "prologue" }), bossHp: PROLOGUE_TUNING.bossFloor + 1 },
      { force: AVATAR_TUNING.forceMax, returnBufferMs: 0 }
    );
    const released = stepClockDuel(primed, 16, { x: 0, y: 0, returnWave: true });
    expect(released.stage).toBe("escaped");
    expect(released.bossHp).toBe(PROLOGUE_TUNING.bossFloor);
  });

  it("gives a new player a longer winding window than the finale's first hour", () => {
    expect(PROLOGUE_TUNING.exposedMs).toBeGreaterThan(DUEL_TUNING.exposedMs[1]);
    const prologue = exposedAt(createClockDuel({ mode: "prologue" }), ARENA_ANCHOR);
    const stillOpen = run(prologue, DUEL_TUNING.exposedMs[1] + 200).state;
    expect(stillOpen.stage).toBe("exposed");
  });

  it("leaves the finale exactly as it was: the same blow there is an hour break", () => {
    expect(PROLOGUE_TUNING.bossFloor).toBe(PHASE_FLOOR[1]);
    const finale = exposedAt({ ...createClockDuel(), bossHp: PHASE_FLOOR[1] + 1 });
    const struck = stepClockDuel(finale, 16, { x: 0, y: 0, strike: true });
    expect(struck.stage).toBe("phase_break");
    expect(struck.events.some(event => event.type === "escape")).toBe(false);
  });
});
