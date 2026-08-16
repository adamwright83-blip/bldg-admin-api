import { beforeEach, describe, expect, it } from "vitest";
import {
  Hunter,
  RUINBOUND_TUNING,
  Shieldbearer,
  Slinger,
  resetProjectileIds,
  stepProjectiles,
  type Projectile,
} from "./ruinbound";

const FRAME = 1 / 60;

function run(fn: (dt: number) => void, seconds: number) {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) fn(FRAME);
}

beforeEach(() => resetProjectileIds());

describe("Hunter — movement pressure", () => {
  it("ignores the player until inside aggro range", () => {
    const hunter = new Hunter("h", { x: 1000, y: 0 });
    run(dt => hunter.update(dt, { x: 0, y: 0 }, []), 1);
    expect(hunter.phase).toBe("idle");
    expect(hunter.x).toBe(1000);
  });

  it("closes distance once aggroed", () => {
    const hunter = new Hunter("h", { x: 250, y: 0 });
    run(dt => hunter.update(dt, { x: 0, y: 0 }, []), 0.5);
    expect(hunter.phase).toBe("pursue");
    expect(hunter.x).toBeLessThan(250);
  });

  it("telegraphs before striking, with readable progress", () => {
    const hunter = new Hunter("h", { x: 40, y: 0 });
    const player = { x: 0, y: 0 };
    hunter.update(FRAME, player, []);
    hunter.update(FRAME, player, []);
    expect(hunter.phase).toBe("telegraph");

    run(dt => hunter.update(dt, player, []), RUINBOUND_TUNING.hunter.telegraphSeconds / 2);
    expect(hunter.isTelegraphing()).toBe(true);
    expect(hunter.telegraphProgress()).toBeGreaterThan(0.3);
    expect(hunter.telegraphProgress()).toBeLessThan(0.8);
    // Still no damage during the wind-up — the tell is honest.
    expect(hunter.pendingHit).toBeNull();
  });

  it("commits to the telegraph so moving away is a real counter-play", () => {
    const hunter = new Hunter("h", { x: 40, y: 0 });
    const player = { x: 0, y: 0 };
    hunter.update(FRAME, player, []);
    hunter.update(FRAME, player, []);
    expect(hunter.phase).toBe("telegraph");
    const committedX = hunter.x;

    // Player flees during the wind-up.
    run(dt => hunter.update(dt, { x: 400, y: 0 }, []), RUINBOUND_TUNING.hunter.telegraphSeconds + 0.05);

    // It did not track during the telegraph, and the strike whiffs.
    expect(hunter.x).toBe(committedX);
    expect(hunter.pendingHit).toBeNull();
  });

  it("lands the strike when the player stands still", () => {
    const hunter = new Hunter("h", { x: 40, y: 0 });
    const player = { x: 0, y: 0 };
    run(dt => hunter.update(dt, player, []), RUINBOUND_TUNING.hunter.telegraphSeconds + 0.1);
    const hit = hunter.consumePendingHit();
    expect(hit).not.toBeNull();
    expect(hit?.damage).toBe(RUINBOUND_TUNING.hunter.damage);
    expect(hit?.knockbackX).toBeLessThan(0);
  });

  it("dies after enough damage and stops acting", () => {
    const hunter = new Hunter("h", { x: 60, y: 0 });
    hunter.applyHit(RUINBOUND_TUNING.hunter.maxHp, { x: 0, y: 0 }, false);
    expect(hunter.alive).toBe(false);

    const restingX = hunter.x;
    run(dt => hunter.update(dt, { x: 0, y: 0 }, []), 1);
    expect(hunter.x).toBe(restingX);
  });

  it("recoils away from the blow", () => {
    const hunter = new Hunter("h", { x: 60, y: 0 });
    hunter.applyHit(1, { x: 0, y: 0 }, false);
    expect(hunter.recoilSeconds).toBeGreaterThan(0);
    expect(hunter.recoilX).toBe(1);
  });
});

describe("Slinger — ranged spatial pressure", () => {
  it("winds up visibly before releasing", () => {
    const slinger = new Slinger("s", { x: 250, y: 0 });
    const out: Projectile[] = [];
    slinger.update(FRAME, { x: 0, y: 0 }, out);
    expect(slinger.phase).toBe("windup");

    run(dt => slinger.update(dt, { x: 0, y: 0 }, out), RUINBOUND_TUNING.slinger.windupSeconds / 2);
    expect(slinger.isTelegraphing()).toBe(true);
    expect(slinger.telegraphProgress()).toBeGreaterThan(0.3);
    expect(out).toHaveLength(0);
  });

  it("emits exactly one readable projectile per cycle", () => {
    const slinger = new Slinger("s", { x: 250, y: 0 });
    const out: Projectile[] = [];
    run(dt => slinger.update(dt, { x: 0, y: 0 }, out), RUINBOUND_TUNING.slinger.windupSeconds + 0.1);

    expect(out).toHaveLength(1);
    expect(out[0].vx).toBeLessThan(0);
    expect(out[0].damage).toBe(RUINBOUND_TUNING.slinger.damage);
    expect(out[0].id).toBe("proj_1");
  });

  it("uses deterministic projectile ids, never random", () => {
    const a: Projectile[] = [];
    const s1 = new Slinger("s", { x: 250, y: 0 });
    run(dt => s1.update(dt, { x: 0, y: 0 }, a), RUINBOUND_TUNING.slinger.windupSeconds + 0.1);

    resetProjectileIds();
    const b: Projectile[] = [];
    const s2 = new Slinger("s", { x: 250, y: 0 });
    run(dt => s2.update(dt, { x: 0, y: 0 }, b), RUINBOUND_TUNING.slinger.windupSeconds + 0.1);

    expect(a.map(p => p.id)).toEqual(b.map(p => p.id));
  });

  it("holds its preferred range instead of being walked over", () => {
    const slinger = new Slinger("s", { x: 60, y: 0 });
    run(dt => slinger.update(dt, { x: 0, y: 0 }, []), 0.3);
    // Too close: it backs off.
    expect(slinger.x).toBeGreaterThan(60);
  });

  it("resolves a projectile hit on the player", () => {
    const projectiles: Projectile[] = [
      { id: "p", x: 30, y: 0, vx: -240, vy: 0, damage: 9, ttl: 4, active: true },
    ];
    let hit = null;
    run(dt => {
      const r = stepProjectiles(projectiles, dt, { x: 0, y: 0 }, 20);
      if (r.hit) hit = r.hit;
    }, 0.3);

    expect(hit).not.toBeNull();
    expect(projectiles[0].active).toBe(false);
  });

  it("expires a projectile that misses rather than leaking it", () => {
    const projectiles: Projectile[] = [
      { id: "p", x: 0, y: 500, vx: 0, vy: 240, damage: 9, ttl: 0.5, active: true },
    ];
    run(dt => stepProjectiles(projectiles, dt, { x: 0, y: 0 }, 20), 1);
    expect(projectiles[0].active).toBe(false);
  });
});

describe("Shieldbearer — proves the Linehook changes combat", () => {
  const front = { x: -100, y: 0 };

  function facingThePlayer() {
    const sb = new Shieldbearer("sb", { x: 0, y: 0 });
    sb.update(FRAME, front, []);
    return sb;
  }

  it("blocks a frontal basic lash almost entirely", () => {
    const sb = facingThePlayer();
    const before = sb.hp;
    const result = sb.applyHit(3, front, false);

    expect(result.guarded).toBe(true);
    expect(result.applied).toBe(0);
    expect(sb.hp).toBe(before);
  });

  it("takes a basic lash from behind the guard arc", () => {
    const sb = facingThePlayer();
    const behind = { x: 200, y: 0 };
    const result = sb.applyHit(3, behind, false);

    expect(result.guarded).toBe(false);
    expect(result.applied).toBe(3);
  });

  it("is exposed by the Linehook and then takes full damage", () => {
    const sb = facingThePlayer();
    expect(sb.exposed).toBe(false);

    sb.onLinehookLatch(front);
    expect(sb.exposed).toBe(true);
    expect(sb.exposedRemaining()).toBeGreaterThan(0);

    const result = sb.applyHit(3, front, false);
    expect(result.guarded).toBe(false);
    expect(result.applied).toBe(3);
  });

  it("cannot act while exposed", () => {
    const sb = facingThePlayer();
    sb.onLinehookLatch(front);
    run(dt => sb.update(dt, front, []), 1);
    expect(sb.pendingHit).toBeNull();
    expect(sb.phase).toBe("exposed");
  });

  it("recovers its guard after the vulnerability window closes", () => {
    const sb = facingThePlayer();
    sb.onLinehookLatch(front);
    run(dt => sb.update(dt, front, []), RUINBOUND_TUNING.shieldbearer.exposedSeconds + 0.1);
    expect(sb.exposed).toBe(false);

    run(dt => sb.update(dt, front, []), RUINBOUND_TUNING.shieldbearer.recoverSeconds + 0.1);
    expect(sb.applyHit(3, front, false).guarded).toBe(true);
  });

  it("always yields to the Line regardless of angle", () => {
    const sb = facingThePlayer();
    expect(sb.applyHit(2, front, true).guarded).toBe(false);
  });

  it("telegraphs its slam", () => {
    const sb = new Shieldbearer("sb", { x: 50, y: 0 });
    const player = { x: 0, y: 0 };
    sb.update(FRAME, player, []);
    expect(sb.phase).toBe("telegraph");
    run(dt => sb.update(dt, player, []), RUINBOUND_TUNING.shieldbearer.telegraphSeconds / 2);
    expect(sb.telegraphProgress()).toBeGreaterThan(0.2);
    expect(sb.pendingHit).toBeNull();
  });

  it("refreshes rather than stacking on a re-latch", () => {
    const sb = facingThePlayer();
    sb.onLinehookLatch(front);
    run(dt => sb.update(dt, front, []), 1);
    const partway = sb.exposedRemaining();
    sb.onLinehookLatch(front);
    expect(sb.exposedRemaining()).toBeGreaterThan(partway);
  });
});
