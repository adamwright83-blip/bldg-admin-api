import { describe, expect, it } from "vitest";
import {
  SEARCH_TUNING,
  createSearchArena,
  doorProgress,
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

function run(state: SearchArena, ms: number, input: SearchInput = IDLE) {
  let s = state;
  const events: SearchEvent[] = [];
  for (let t = 0; t < ms; t += 16) {
    s = stepSearchArena(s, 16, input);
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

describe("six doors, and none of them hide him", () => {
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

  it("lets her find Door VI, which is debated, not painted, and has nothing behind it", () => {
    const six = COLOSSEUM_DOORS.find(candidate => candidate.id === "VI")!;
    const at = place(createSearchArena(), six.threshold);
    const opened = stepSearchArena(at, 16, IDLE);
    expect(doorProgress(opened)?.door.id).toBe("VI");
    const { events, state } = run(opened, SEARCH_TUNING.door.debatedMs + 200);
    expect(events.map(event => event.type)).toContain("door_empty");
    expect(events.map(event => event.type)).not.toContain("door_close");
    expect(state.doorsChecked).toEqual(["VI"]);
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
