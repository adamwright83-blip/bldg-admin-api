import { describe, expect, it } from "vitest";
import {
  SEARCH_TUNING,
  createSearchArena,
  doorProgress,
  holdSearchArena,
  shieldInReach,
  stepSearchArena,
  type SearchArena,
  type SearchEvent,
  type SearchInput,
} from "./colosseumSearchEngine";
import { AVATAR_TUNING } from "./colosseumAvatar";
import {
  ARENA_ANCHOR,
  COLOSSEUM_DOORS,
  SHIELD_REST,
  doorAt,
  stageDistance,
  torsoPoint,
} from "./colosseumStage";

const IDLE: SearchInput = { x: 0, y: 0 };

function run(
  state: SearchArena,
  ms: number,
  input: SearchInput = IDLE,
  doorAccess: ReadonlySet<(typeof COLOSSEUM_DOORS)[number]["id"]> | null = null
) {
  let s = state;
  const events: SearchEvent[] = [];
  for (let t = 0; t < ms; t += 16) {
    s = stepSearchArena(s, 16, input, doorAccess);
    events.push(...s.events);
  }
  return { state: s, events };
}

function place(state: SearchArena, feet: { x: number; y: number }): SearchArena {
  return { ...state, avatar: { ...state.avatar, feet: { ...feet }, velocity: { x: 0, y: 0 } } };
}

describe("the arena before the shield is a calm place to look around", () => {
  it("throws nothing at her until she takes the shield", () => {
    const { state, events } = run(createSearchArena(), 20_000);
    expect(state.shieldTaken).toBe(false);
    expect(state.projectiles).toHaveLength(0);
    expect(events.some(event => event.type === "launch" || event.type === "sweep")).toBe(false);
  });

  it("offers the shield when she is close and takes it when she walks onto it", () => {
    const near = place(createSearchArena(), { x: SHIELD_REST.x, y: SHIELD_REST.y + 7 });
    expect(shieldInReach(near)).toBe(true);
    const pressed = stepSearchArena(near, 16, { x: 0, y: 0, takeShield: true });
    expect(pressed.shieldTaken).toBe(true);

    const walked = run(place(createSearchArena(), { x: SHIELD_REST.x, y: SHIELD_REST.y + 12 }), 900, { x: 0, y: -1 });
    expect(walked.state.shieldTaken).toBe(true);
    expect(walked.events.some(event => event.type === "shield_taken")).toBe(true);
  });

  it("then spars with his projection on a readable rhythm", () => {
    const armed = stepSearchArena(place(createSearchArena(), SHIELD_REST), 16, IDLE);
    expect(armed.shieldTaken).toBe(true);
    const { events } = run({ ...armed, avatar: { ...armed.avatar, hurtMs: 99999 } }, 12_000);
    const tells = events.filter(event => event.type === "tell");
    expect(tells.length).toBeGreaterThanOrEqual(3);
    expect(events.some(event => event.type === "hang")).toBe(true);
    expect(events.some(event => event.type === "sweep")).toBe(true);
  });
});

describe("door access is earned outside the fiction engine", () => {
  it("opens a painted door onto nothing, then sets her back on the floor unharmed", () => {
    const door = COLOSSEUM_DOORS.find(candidate => candidate.id === "III")!;
    const at = place(createSearchArena(), { x: door.threshold.x, y: door.threshold.y + 1 });
    const { state, events } = run(at, SEARCH_TUNING.door.paintedMs + 200);
    const kinds = events.map(event => event.type);
    expect(kinds).toContain("door_open");
    expect(kinds).toContain("door_empty");
    expect(kinds).toContain("door_close");
    expect(kinds.indexOf("door_open")).toBeLessThan(kinds.indexOf("door_empty"));
    expect(state.doorsChecked).toContain("III");
    expect(state.avatar.guardPips).toBe(AVATAR_TUNING.maxGuardPips);
    expect(kinds).not.toContain("recoil_start");
    expect(doorAt(state.avatar.feet)).toBeNull();
  });

  it("refuses a painted door until the gate grants abstract access", () => {
    const door = COLOSSEUM_DOORS.find(candidate => candidate.id === "II")!;
    const at = place(createSearchArena(), door.threshold);
    const locked = stepSearchArena(at, 16, IDLE, new Set());
    expect(locked.events).toEqual([{ type: "door_locked", door: "II" }]);
    expect(locked.stage).not.toBe("door");
    expect(locked.doorsChecked).not.toContain("II");

    const opened = stepSearchArena(at, 16, IDLE, new Set<(typeof COLOSSEUM_DOORS)[number]["id"]>(["II"]));
    expect(opened.events).toContainEqual({ type: "door_open", door: "II" });
    expect(doorProgress(opened)?.door.id).toBe("II");
  });

  it("keeps Door VI lore-only and permanently sealed", () => {
    const six = COLOSSEUM_DOORS.find(candidate => candidate.id === "VI")!;
    const at = place(createSearchArena(), six.threshold);
    const locked = stepSearchArena(at, 16, IDLE, new Set<(typeof COLOSSEUM_DOORS)[number]["id"]>(["VI"]));
    expect(locked.events).toEqual([{ type: "door_locked", door: "VI" }]);
    expect(doorProgress(locked)).toBeNull();
    expect(locked.doorsChecked).toEqual([]);
  });

  it("does not trigger a door while she dodges through its threshold", () => {
    const door = COLOSSEUM_DOORS[1]!;
    const dodging = place(createSearchArena(), door.threshold);
    const moving = { ...dodging, avatar: { ...dodging.avatar, dodgeMs: 200 } };
    expect(stepSearchArena(moving, 16, IDLE).stage).not.toBe("door");
  });
});

describe("falling is RECOIL to the anchor, never GAME OVER", () => {
  it("drains, yanks her back along the Line, and restores her guard", () => {
    const armed = stepSearchArena(place(createSearchArena(), SHIELD_REST), 16, IDLE);
    const torso = torsoPoint(armed.avatar.feet);
    const doomed: SearchArena = {
      ...armed,
      stage: "attack",
      pattern: "fan",
      avatar: { ...armed.avatar, guardPips: 1, hurtMs: 0 },
      projectiles: [{ id: "k", x: torso.x, y: torso.y - 1, vx: 0, vy: 30, ageMs: 0 }],
    };
    const fell = run(doomed, 200);
    expect(fell.events.some(event => event.type === "recoil_start")).toBe(true);
    expect(fell.state.stage).toBe("recoil");
    const { recoil } = SEARCH_TUNING;
    const back = run(fell.state, recoil.drainMs + recoil.yankMs + recoil.settleMs + 100);
    expect(back.events.some(event => event.type === "recoil_land")).toBe(true);
    expect(stageDistance(back.state.avatar.feet, ARENA_ANCHOR)).toBeLessThan(0.001);
    expect(back.state.avatar.guardPips).toBe(AVATAR_TUNING.maxGuardPips);
    expect(back.state.stage).toBe("rest");
  });
});

describe("RETURN can disrupt a projection, but cannot find him", () => {
  it("clears the air and makes him flicker out for a moment", () => {
    const armed = stepSearchArena(place(createSearchArena(), SHIELD_REST), 16, IDLE);
    const loaded: SearchArena = {
      ...armed,
      stage: "attack",
      avatar: { ...armed.avatar, force: AVATAR_TUNING.forceMax },
      projectiles: [{ id: "p", x: 50, y: 70, vx: 0, vy: 20, ageMs: 0 }],
    };
    const released = stepSearchArena(loaded, 16, { x: 0, y: 0, returnWave: true });
    expect(released.stage).toBe("disrupted");
    expect(released.projectiles).toHaveLength(0);
    expect(released.avatar.force).toBe(0);
    // + the RETURN's own hit-stop.
    const later = run(released, SEARCH_TUNING.disruptedMs + 300).state;
    expect(later.stage).toBe("rest");
  });

  it("has nowhere to keep business truth, even if asked", () => {
    const forbidden = /mission|target|visit|outcome|pitch|revenue|order|customer|seal|trace/i;
    for (const key of Object.keys(createSearchArena())) expect(forbidden.test(key), key).toBe(false);
  });

  it("is deterministic: the same inputs always produce the same arena", () => {
    const script: SearchInput[] = Array.from({ length: 900 }, (_, i) => ({
      x: Math.sin(i / 40),
      y: Math.cos(i / 55),
      guard: i % 90 < 20,
      dodge: i % 170 === 0,
      strike: i % 45 === 0,
    }));
    const play = () =>
      script.reduce((s, input) => stepSearchArena(s, 16, input), place(createSearchArena(), SHIELD_REST));
    const a = play();
    const b = play();
    expect({ ...a, events: [] }).toEqual({ ...b, events: [] });
  });
});

describe("a seal reveal is never a free hit", () => {
  function midVolley() {
    const armed = stepSearchArena(place(createSearchArena(), SHIELD_REST), 16, IDLE);
    let s: SearchArena = { ...armed, avatar: { ...armed.avatar, hurtMs: 0 } };
    for (let i = 0; i < 2000 && !(s.stage === "attack" && s.projectiles.length > 0); i += 1) {
      s = stepSearchArena(s, 16, IDLE);
    }
    expect(s.stage).toBe("attack");
    return s;
  }

  it("calls off everything in the air and stops her where she stands", () => {
    const moving = midVolley();
    const walking = { ...moving, avatar: { ...moving.avatar, velocity: { x: 20, y: 0 }, moving: true, guarding: true } };
    const held = holdSearchArena(walking);
    expect(held.projectiles).toHaveLength(0);
    expect(held.sweep).toBeNull();
    expect(held.avatar.velocity).toEqual({ x: 0, y: 0 });
    expect(held.avatar.guarding).toBe(false);
    expect(held.stage).toBe("rest");
    // Pure: the state it was handed is untouched.
    expect(walking.projectiles.length).toBeGreaterThan(0);
  });

  it("gives her a full rest after the reveal before his next volley", () => {
    const held = holdSearchArena(midVolley());
    const pips = held.avatar.guardPips;
    const soon = run(held, SEARCH_TUNING.restMs - 80);
    expect(soon.events.some(event => event.type === "tell" || event.type === "launch" || event.type === "hurt")).toBe(false);
    expect(soon.state.avatar.guardPips).toBe(pips);
  });

  it("moves his rotation on, so the dropped volley is not simply replayed", () => {
    const attacking = midVolley();
    const held = holdSearchArena(attacking);
    expect(held.patternIndex).toBe(attacking.patternIndex + 1);
  });
});
