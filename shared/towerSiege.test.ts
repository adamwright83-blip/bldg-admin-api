import { describe, expect, it } from "vitest";
import {
  returningSiegePressure,
  readSiegeChronicle,
  lapseWarning,
  newSiege,
  restoreSiege,
  siegePressure,
  siegeReducer,
  siegeStorageKey,
  type SiegeState,
} from "./towerSiege";
const tick = (s: SiegeState, count: number) => {
  for (let i = 0; i < count; i++) s = siegeReducer(s, { type: "tick" });
  return s;
};

describe("always-playable Siege", () => {
  it("applies returning-player grace without changing the underlying pressure and validates history", () => {
    const history = [
      {
        sessionId: "one",
        endedAt: 0,
        outcome: "held" as const,
        lanterns: 3,
        wave: 5,
      },
    ];
    expect(returningSiegePressure(0.8, history, 8 * 86400000)).toBe(0.55);
    expect(returningSiegePressure(0.8, history, 86400000)).toBe(0.8);
    expect(readSiegeChronicle("bad")).toEqual([]);
    expect(readSiegeChronicle(JSON.stringify(history))).toEqual(history);
  });

  it("starts with zero paid orders and bounds business difficulty", () => {
    expect(siegePressure(0)).toBe(0.8);
    expect(siegePressure(100)).toBe(0.3);
    expect(siegePressure()).toBe(0.45);
    expect(
      siegeReducer(newSiege(siegePressure(0)), { type: "start" }).phase
    ).toBe("active");
  });
  it("enforces Lumen, fixed pads, recall and no purchases while paused", () => {
    let s = siegeReducer(newSiege(), {
      type: "deploy",
      slot: 0,
      kind: "launch",
    });
    expect(s.lumen).toBe(35);
    expect(
      siegeReducer(s, { type: "deploy", slot: 1, kind: "launch" })
    ).toEqual(s);
    expect(
      siegeReducer(s, { type: "deploy", slot: 4, kind: "beacon" })
    ).toEqual(s);
    s = siegeReducer(s, { type: "sell", slot: 0 });
    expect(s.lumen).toBe(68);
    s.phase = "paused";
    expect(siegeReducer(s, { type: "deploy", slot: 1, kind: "surge" })).toEqual(
      s
    );
  });
  it("pauses without elapsed-world catchup and restores safely", () => {
    const s = tick(siegeReducer(newSiege(), { type: "start" }), 30);
    const restored = restoreSiege(JSON.stringify(s))!;
    expect(restored.phase).toBe("paused");
    expect(tick(restored, 100)).toEqual(restored);
    expect(siegeReducer(restored, { type: "start" }).time).toBe(s.time);
    expect(restoreSiege("{broken")).toBeNull();
    expect(restoreSiege(JSON.stringify({ ...s, slots: [] }))).toBeNull();
  });
  it("telegraphs the Lapse for three seconds before entry", () => {
    const s = { ...newSiege(), phase: "active" as const, wave: 2, time: 27 };
    expect(lapseWarning(s)).toBe(true);
    expect(lapseWarning({ ...s, time: 26.9 })).toBe(false);
  });
  it("a thief steals only a fictional lantern, recoverable before escape", () => {
    let s = newSiege();
    s.phase = "active";
    s.time = 1;
    s.spawned = 1;
    s.enemies = [
      {
        id: 999,
        kind: "lapse",
        position: 0.999,
        hp: 5,
        maxHp: 5,
        slow: 0,
        carrying: false,
      },
    ];
    s = tick(s, 1);
    expect(s.enemies[0].carrying).toBe(true);
    expect(s.lanterns).toBe(3);
    s.enemies[0].position = 0.001;
    s = tick(s, 1);
    expect(s.lanterns).toBe(2);
    expect(s.notice).toContain("escaped");
  });
  it("Beacon deals no damage and accelerates adjacent Launches", () => {
    let s = newSiege();
    s.phase = "active";
    s.spawned = 1;
    s.slots = [
      { kind: "launch", cooldown: 0 },
      { kind: "beacon", cooldown: 0 },
      null,
    ];
    s.enemies = [
      {
        id: 99,
        kind: "dust",
        position: 0.3,
        hp: 10,
        maxHp: 10,
        slow: 0,
        carrying: false,
      },
    ];
    s = tick(s, 1);
    expect(s.enemies[0].hp).toBe(8);
    expect(s.slots[0]?.cooldown).toBeCloseTo(2.7);
  });
  it("losing explains the enemy and route; defeat cannot advance", () => {
    const s = tick(siegeReducer(newSiege(), { type: "start" }), 1500);
    expect(s.phase).toBe("breach");
    expect(s.notice).toContain("Approach Route");
    expect(s.notice).toContain("Dust");
    expect(tick(s, 100)).toEqual(s);
  });
  it("all five zero-order waves are survivable with active play in 5–8 minutes", () => {
    let s = newSiege(siegePressure(0));
    let seconds = 0;
    s = siegeReducer(s, { type: "deploy", slot: 0, kind: "launch" });
    for (
      let i = 0;
      i < 6000 && s.phase !== "held" && s.phase !== "breach";
      i++
    ) {
      if (!s.slots[2] && s.lumen >= 45)
        s = siegeReducer(s, { type: "deploy", slot: 2, kind: "launch" });
      if (!s.slots[1] && s.lumen >= 30)
        s = siegeReducer(s, { type: "deploy", slot: 1, kind: "beacon" });
      if (s.phase === "planning") s = siegeReducer(s, { type: "start" });
      const thief = s.enemies.find(e => e.kind === "lapse");
      if (thief) s = siegeReducer(s, { type: "focus", id: thief.id });
      if (s.enemies.length >= 3 && s.pulseCooldown === 0)
        s = siegeReducer(s, { type: "pulse" });
      s = tick(s, 1);
      seconds += 0.1;
    }
    expect({
      phase: s.phase,
      wave: s.wave,
      integrity: s.integrity,
      seconds,
    }).toMatchObject({ phase: "held", wave: 5 });
    expect(seconds).toBeGreaterThanOrEqual(300);
    expect(seconds).toBeLessThanOrEqual(480);
  });

  it("starts wave 1 from the first deployment rather than a separate Begin click", () => {
    // PLAY SIEGE -> choose pad -> deploy -> wave 1. No redundant gate between.
    const opening = siegeReducer(newSiege(), {
      type: "deploy",
      slot: 0,
      kind: "launch",
    });
    expect(opening.phase).toBe("active");
    expect(opening.wave).toBe(1);
    // Combat is genuinely running, not merely labelled active.
    expect(tick(opening, 10).time).toBeCloseTo(1);
  });

  it("keeps the deliberate planning beat for later waves", () => {
    const planning: SiegeState = { ...newSiege(), wave: 3, lumen: 120 };
    const deployed = siegeReducer(planning, {
      type: "deploy",
      slot: 1,
      kind: "surge",
    });
    expect(deployed.phase).toBe("planning");
    expect(siegeReducer(deployed, { type: "start" }).phase).toBe("active");
  });

  it("scopes a save to one Stronghold so towers cannot overwrite each other", () => {
    const cpe = siegeStorageKey({
      tenantId: "t1",
      openId: "u1",
      buildingId: "century_park_east",
    });
    const opus = siegeStorageKey({
      tenantId: "t1",
      openId: "u1",
      buildingId: "opus_la",
    });
    expect(cpe).toBe("goldline:siege:v1:t1:u1:century_park_east");
    expect(cpe).not.toBe(opus);
    // No tenant or operator context invents no tenant: session play, no save.
    expect(
      siegeStorageKey({ tenantId: null, openId: "u1", buildingId: "opus_la" })
    ).toBeUndefined();
    expect(
      siegeStorageKey({ tenantId: "t1", openId: null, buildingId: "opus_la" })
    ).toBeUndefined();
  });

  it("never writes business truth from any action", () => {
    const actions = [
      { type: "deploy", slot: 0, kind: "launch" },
      { type: "start" },
      { type: "tick" },
      { type: "pulse" },
      { type: "focus", id: 100 },
      { type: "sell", slot: 0 },
      { type: "pause" },
    ] as const;
    let s = newSiege();
    for (const action of actions) s = siegeReducer(s, action);
    // The reducer's whole output surface is game state. There is no order,
    // payment, promise, attack, or property field it could ever produce.
    expect(Object.keys(s).sort()).toEqual(
      [
        "effects",
        "enemies",
        "focus",
        "integrity",
        "kills",
        "lanterns",
        "lumen",
        "notice",
        "phase",
        "pressure",
        "pulseCooldown",
        "reflection",
        "sessionId",
        "slots",
        "spawned",
        "time",
        "version",
        "wave",
      ].sort()
    );
  });
});
