import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canPermanentlyClear,
  createGuardianWorld,
  guardianReducer,
  type GuardianWorld,
} from "./goldlineGuardianEngine";
import { allGuardians, guardianIdForStableKey, GUARDIAN_ROSTER } from "./goldlineGuardians";
import { lineCountForGuardian, speakGuardian } from "./goldlineGuardianDialogue";

function play(world: GuardianWorld, ms: number, step = 16): GuardianWorld {
  let next = world;
  for (let elapsed = 0; elapsed < ms; elapsed += step) {
    next = guardianReducer(next, { type: "tick", deltaMs: step });
  }
  return next;
}

describe("guardian roster", () => {
  it("has six genuinely distinct silhouettes and attacks", () => {
    const roster = allGuardians();
    expect(roster).toHaveLength(6);
    const profiles = new Set(roster.map(guardian => guardian.silhouette.profile));
    const gimmicks = new Set(roster.map(guardian => guardian.signatureGimmick));
    const sequences = new Set(roster.map(guardian => guardian.attackSequence.join(">")));
    expect(profiles.size).toBe(6);
    expect(gimmicks.size).toBe(6);
    expect(sequences.size).toBe(6);
    expect(roster.map(guardian => guardian.id).sort()).toEqual([
      "cloud_duchess",
      "drizzle_detective",
      "gust_jester",
      "sleepy_one_eye",
      "thunder_king",
      "tiny_emperor",
    ]);
  });

  it("assigns the same guardian to the same published stable key", () => {
    const key = "territory:default:visit_hunt:a,b,c";
    expect(guardianIdForStableKey(key)).toBe(guardianIdForStableKey(key));
    expect(GUARDIAN_ROSTER[guardianIdForStableKey(key)]).toBeTruthy();
  });

  it("authors enough lines that a revisit is not a single looped sentence", () => {
    for (const guardian of allGuardians()) {
      expect(lineCountForGuardian(guardian.id)).toBeGreaterThanOrEqual(24);
    }
  });
});

describe("guardian engine", () => {
  it("notices and pranks before the street is ready, but cannot clear", () => {
    let world = createGuardianWorld({
      guardianId: "thunder_king",
      confrontationReady: false,
    });
    world = guardianReducer(world, { type: "notice" });
    world = play(world, 1100);
    expect(world.noticed).toBe(true);
    expect(world.projectiles.length).toBeGreaterThan(0);
    expect(world.projectiles.every(projectile => projectile.harmless)).toBe(true);
    world = guardianReducer(world, { type: "counter" });
    expect(canPermanentlyClear(world)).toBe(false);
    expect(world.defeated).toBe(false);
  });

  it("starts a real fight only once derived readiness is true", () => {
    let world = createGuardianWorld({
      guardianId: "tiny_emperor",
      confrontationReady: true,
    });
    world = guardianReducer(world, { type: "notice" });
    world = play(world, 1200);
    expect(world.phase === "telegraph" || world.projectiles.length > 0).toBe(true);
    const tell = world.lastTell.toLowerCase();
    expect(tell.length).toBeGreaterThan(4);
  });

  it("lets a counter during the telegraph injure the guardian", () => {
    let world = createGuardianWorld({
      guardianId: "cloud_duchess",
      confrontationReady: true,
      seed: 7,
    });
    world = guardianReducer(world, { type: "notice" });
    world = play(world, 1000);
    world = play(world, 200);
    world = guardianReducer(world, { type: "counter" });
    expect(world.health).toBeLessThan(world.maxHealth);
    expect(world.lastHitKind).toBe("guardian");
  });

  it("defeats only a ready guardian, and losing does not mark defeat", () => {
    let world = createGuardianWorld({
      guardianId: "gust_jester",
      confrontationReady: true,
      seed: 3,
    });
    world = { ...world, playerHealth: 1, invulnMs: 0, phase: "attack" };
    world = {
      ...world,
      projectiles: [
        {
          id: "hit",
          family: "bomb_arc",
          x: world.player.x,
          y: world.player.y,
          vx: 0,
          vy: 0,
          radius: 8,
          telegraphMs: 0,
          liveMs: 20,
          impactAtX: world.player.x,
          impactAtY: world.player.y,
          harmless: false,
          fused: true,
          huge: false,
          fizzled: false,
        },
      ],
    };
    world = guardianReducer(world, { type: "tick", deltaMs: 16 });
    expect(world.phase).toBe("retry");
    expect(world.defeated).toBe(false);
    expect(canPermanentlyClear(world)).toBe(false);
  });

  it("cannot import business truth", () => {
    const source = readFileSync(join(__dirname, "goldlineGuardianEngine.ts"), "utf8");
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports.join("\n")).not.toMatch(/server\/|drizzle|goldlineWorld[^P]|fetch|localStorage/);
    expect(source).not.toMatch(/account_won|proposal_sent|field_commitment/);
  });
});

describe("dialogue stays inside derived state", () => {
  it("can say how many doors remain without naming a person", () => {
    const line = speakGuardian({
      guardianId: "thunder_king",
      lineClass: "MID_PROGRESS",
      context: {
        grammar: "visit_hunt",
        remaining: 3,
        completed: 2,
        total: 5,
        obligationPresent: false,
      },
    });
    expect(line.toLowerCase()).toMatch(/three doors still sleep/);
    expect(line).not.toMatch(/Sarah|rejected|GM agreed/i);
  });
});
