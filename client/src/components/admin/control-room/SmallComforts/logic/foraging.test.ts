import { describe, expect, it } from "vitest";
import {
  FIXTURES, SHELF_OBJECTS, SHELF_OBSTACLES, SHELF_ORDER, drop, pickUp, pushOut, remainingObjects, resolveRoutine, stepToward,
} from "./foraging";
import { completeStay, emptyEpisode, installFixture, normalizeEpisode } from "./episode";
import { GUEST_ORDER } from "./guests";

describe("carry one thing", () => {
  it("lets you lift one object and refuses a second", () => {
    const first = pickUp({ carrying: null }, "brass_button", []);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = pickUp(first.haul, "thimble", []);
    expect(second).toEqual({ ok: false, reason: "hands_full" });
    expect(pickUp(drop(first.haul).haul, "thimble", []).ok).toBe(true);
  });
  it("will not offer an object whose fixture is already built", () => {
    expect(pickUp({ carrying: null }, "thread_spool", ["spool_stool"])).toEqual({ ok: false, reason: "already_built" });
    expect(remainingObjects(["spool_stool"])).toEqual(["brass_button", "thimble"]);
  });
  it("every object maps to exactly one fixture", () => {
    const fixtures = SHELF_ORDER.map(id => SHELF_OBJECTS[id].fixture);
    expect(new Set(fixtures).size).toBe(SHELF_ORDER.length);
    fixtures.forEach(f => expect(FIXTURES[f]).toBeDefined());
  });
});

describe("the same object changes different residents differently", () => {
  it("every object changes the Conductor's routine, so the first thing you haul never feels like a miss", () => {
    for (const id of SHELF_ORDER) {
      expect(resolveRoutine("conductor", SHELF_OBJECTS[id].fixture).routine).not.toBe("ignores_it");
    }
  });
  it("the button is for the Conductor, the thimble for the Baker, nobody else wants the button", () => {
    expect(resolveRoutine("conductor", "signal_mirror").routine).toBe("signals_trains");
    expect(resolveRoutine("baker", "signal_mirror").routine).toBe("ignores_it");
    expect(resolveRoutine("baker", "thimble_stove").routine).toBe("warms_hands");
    expect(resolveRoutine("conductor", "thimble_stove").routine).toBe("has_tea");
    expect(resolveRoutine("reader", "spool_stool").routine).toBe("perches_by_window");
  });
});

describe("installing a fixture", () => {
  it("changes the existing resident's routine and persists through normalize", () => {
    const start = completeStay(emptyEpisode(), "conductor", "test");
    const { state, reactions } = installFixture(start, "signal_mirror");
    expect(reactions).toHaveLength(1);
    expect(state.routines.conductor).toBe("signals_trains");
    const roundTrip = normalizeEpisode(JSON.parse(JSON.stringify(state)));
    expect(roundTrip.fixtures).toEqual(["signal_mirror"]);
    expect(roundTrip.routines.conductor).toBe("signals_trains");
  });
  it("is idempotent and never downgrades a real routine to 'ignores it'", () => {
    let s = completeStay(emptyEpisode(), "conductor", "test");
    s = installFixture(s, "signal_mirror").state;
    expect(installFixture(s, "signal_mirror").reactions).toEqual([]);
    s = installFixture(s, "thimble_stove").state;
    expect(s.routines.conductor).toBe("has_tea");
    const miss = installFixture(installFixture(completeStay(emptyEpisode(), "baker", "t"), "thimble_stove").state, "signal_mirror").state;
    expect(miss.routines.baker).toBe("warms_hands");
  });
  it("old saves without fixtures still load", () => {
    const old = normalizeEpisode({ residents: [], keepsakes: [], projects: [], arrivals: 0 });
    expect(old.fixtures).toEqual([]);
    expect(old.routines).toEqual({});
    expect(normalizeEpisode({ fixtures: ["nonsense"] as never, routines: { conductor: "nope" } as never }).fixtures).toEqual([]);
    GUEST_ORDER.forEach(g => expect(old.routines[g]).toBeUndefined());
  });
});

describe("walking the shelf", () => {
  it("never ends up inside the suitcase, even when told to walk through it", () => {
    let pos = { x: -5, z: 0 };
    const target = { x: 5, z: 0 };
    for (let i = 0; i < 400; i++) {
      const r = stepToward(pos, target, 0.2, 0.4, SHELF_OBSTACLES);
      pos = r.pos;
      for (const b of SHELF_OBSTACLES) {
        const inside = pos.x > b.x0 + 0.01 && pos.x < b.x1 - 0.01 && pos.z > b.z0 + 0.01 && pos.z < b.z1 - 0.01;
        expect(inside).toBe(false);
      }
      if (r.arrived) break;
    }
  });
  it("pushes a point that starts inside a box out the nearest side", () => {
    const out = pushOut({ x: 0, z: 2.3 }, 0.4, [SHELF_OBSTACLES[0]]);
    expect(out.z).toBeGreaterThan(2.4);
  });
  it("every shelf object is reachable (not inside an obstacle)", () => {
    for (const id of SHELF_ORDER) {
      const s = SHELF_OBJECTS[id].spot;
      expect(pushOut(s, 0.4, SHELF_OBSTACLES)).toEqual(s);
    }
  });
});
