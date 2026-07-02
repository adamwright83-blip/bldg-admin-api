/** Saleslay Battle Canvas — the game engine. Owns one mutable BattleState and
 * exposes update(dt) + a small event API. No React, no canvas drawing, no
 * network calls — this is demo-only local state, nothing here ever reaches
 * a real customer, order, or payment. */
import {
  ABILITY_CONFIG,
  DAILY_CONTRACT_COMPLETE_BONUS_XP,
  FIRE_COOLDOWN_ID,
  FIRE_COOLDOWN_MS,
  FIRE_DAMAGE,
  VILLAIN_ATTACK_DAMAGE,
  VILLAIN_ATTACK_INTERVAL_MS,
  type AbilityId,
} from "./abilities";
import type { BattleSnapshot, BattleState, BusinessEvent } from "./types";

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

export const DRAGON_X = 220;
export const DRAGON_Y = 520;
export const VILLAIN_X = 1040;
export const VILLAIN_Y = 520;
export const HIT_RADIUS = 60;

const DEFAULT_SNAPSHOT: BattleSnapshot = {
  trueNetCents: 2_847_600,
  todayGainCents: 124_000,
  dailyContractTargetCents: 300_000,
  dailyContractProgressCents: 124_000,
  dragonHp: 100,
  dragonEnergy: 100,
  villainHp: 100,
  villainMaxHp: 100,
  xp: 0,
  blockers: { overdueReturns: 3, failedPayments: 2, blockedOrders: 0 },
};

function freshState(): BattleState {
  return {
    snapshot: { ...DEFAULT_SNAPSHOT, blockers: { ...DEFAULT_SNAPSHOT.blockers } },
    dragonBobT: 0,
    dragonHitFlashUntil: 0,
    dragonCelebrating: false,
    villainShuffleT: 0,
    villainHitFlashUntil: 0,
    villainDefeated: false,
    villainAttackCooldownMs: VILLAIN_ATTACK_INTERVAL_MS,
    contractComplete: false,
    fireballs: [],
    excuses: [],
    floaters: [],
    log: [],
    banner: null,
    shakeUntil: 0,
    cooldowns: {},
    nextId: 1,
  };
}

export class SaleslayBattleEngine {
  private state: BattleState = freshState();

  private takeId(): number {
    return this.state.nextId++;
  }

  private pushLog(text: string) {
    const entry = { id: this.takeId(), text, at: Date.now() };
    this.state.log = [entry, ...this.state.log].slice(0, 5);
  }

  private pushFloater(x: number, y: number, text: string, color: string) {
    this.state.floaters.push({ id: this.takeId(), x, y, text, color, createdAt: Date.now() });
  }

  private isOnCooldown(id: string): boolean {
    const until = this.state.cooldowns[id] ?? 0;
    return Date.now() < until;
  }

  private setCooldown(id: string, ms: number) {
    this.state.cooldowns[id] = Date.now() + ms;
  }

  getCooldownRemaining(id: string): number {
    return Math.max(0, (this.state.cooldowns[id] ?? 0) - Date.now());
  }

  getCooldownDuration(id: string): number {
    if (id === FIRE_COOLDOWN_ID) return FIRE_COOLDOWN_MS;
    const ability = ABILITY_CONFIG.find((a) => a.id === id);
    return ability?.cooldownMs ?? 0;
  }

  private spawnFireball(abilityId?: AbilityId) {
    this.state.fireballs.push({ id: this.takeId(), x: DRAGON_X + 60, y: DRAGON_Y - 40, vx: 900, abilityId });
  }

  private damageVillain(amount: number) {
    if (this.state.villainDefeated) return;
    const snap = this.state.snapshot;
    snap.villainHp = Math.max(0, snap.villainHp - amount);
    this.state.villainHitFlashUntil = Date.now() + 220;
    this.state.shakeUntil = Date.now() + 150;
    this.pushFloater(VILLAIN_X, VILLAIN_Y - 80, `-${amount}`, "#ff6b6b");
    if (snap.villainHp <= 0 && !this.state.villainDefeated) {
      this.state.villainDefeated = true;
      this.state.banner = { text: "DAY WON — THE KINGDOM ADVANCES", createdAt: Date.now() };
      this.state.dragonCelebrating = true;
      this.pushLog("The Procrastinator retreats. DAY WON.");
    }
  }

  private damageDragon(amount: number) {
    const snap = this.state.snapshot;
    snap.dragonHp = Math.max(0, snap.dragonHp - amount);
    this.state.dragonHitFlashUntil = Date.now() + 220;
    this.pushFloater(DRAGON_X, DRAGON_Y - 80, `-${amount}`, "#ffb020");
  }

  fireBasic() {
    if (this.isOnCooldown(FIRE_COOLDOWN_ID)) return;
    this.setCooldown(FIRE_COOLDOWN_ID, FIRE_COOLDOWN_MS);
    this.spawnFireball();
  }

  useAbility(id: AbilityId) {
    if (this.isOnCooldown(id)) return;
    const ability = ABILITY_CONFIG.find((a) => a.id === id);
    if (!ability) return;
    this.setCooldown(id, ability.cooldownMs);
    this.spawnFireball(id);
  }

  applyBusinessEvent(event: BusinessEvent) {
    const snap = this.state.snapshot;
    switch (event) {
      case "email_sent":
        this.useAbility("email");
        break;
      case "sales_call_logged":
        this.useAbility("call");
        break;
      case "pickup_completed":
        this.useAbility("pickup");
        break;
      case "payment_collected":
        this.useAbility("collect");
        break;
      case "order_blocked":
        snap.blockers.blockedOrders += 1;
        break;
      case "payment_failed":
        snap.blockers.failedPayments += 1;
        break;
      case "overdue_return_added":
        snap.blockers.overdueReturns += 1;
        break;
    }
  }

  private applyAbilityReward(ability: (typeof ABILITY_CONFIG)[number]) {
    const snap = this.state.snapshot;
    this.damageVillain(ability.damage);
    snap.xp += ability.xp;
    snap.dailyContractProgressCents = Math.min(
      snap.dailyContractTargetCents,
      snap.dailyContractProgressCents + ability.contractCents
    );
    this.pushLog(ability.logText);
    if (!this.state.contractComplete && snap.dailyContractProgressCents >= snap.dailyContractTargetCents) {
      this.state.contractComplete = true;
      snap.xp += DAILY_CONTRACT_COMPLETE_BONUS_XP;
      this.state.banner = { text: "DAILY CONTRACT COMPLETE", createdAt: Date.now() };
      this.pushLog("Daily Contract complete: +500 XP.");
    }
  }

  update(dtMs: number) {
    const dt = dtMs / 1000;
    const state = this.state;
    state.dragonBobT += dt;
    if (!state.villainDefeated) state.villainShuffleT += dt;

    // Fireballs travel; resolve ability payload / basic damage on hit.
    const remainingFireballs: typeof state.fireballs = [];
    for (let i = 0; i < state.fireballs.length; i++) {
      const fb = state.fireballs[i];
      fb.x += fb.vx * dt;

      // Excuse projectiles can be destroyed mid-air.
      let destroyed = false;
      state.excuses = state.excuses.filter((ex) => {
        const dx = ex.x - fb.x;
        const dy = ex.y - fb.y;
        if (Math.hypot(dx, dy) < 40) {
          this.pushFloater(ex.x, ex.y, "poof", "#c9c9c9");
          destroyed = true;
          return false;
        }
        return true;
      });

      // Fireballs resolve once they reach the villain's line, whether or not
      // he's already defeated — ability rewards (XP/Daily Contract) are a
      // separate progression from villain HP and must keep landing. Reward
      // is carried on the fireball itself (fb.abilityId), not by array
      // position, so it always lands on the shot that earned it.
      const ability = fb.abilityId ? ABILITY_CONFIG.find((a) => a.id === fb.abilityId) : undefined;
      const reachedVillain = fb.x >= VILLAIN_X - HIT_RADIUS;
      if (reachedVillain) {
        if (ability) {
          this.applyAbilityReward(ability);
        } else if (!state.villainDefeated) {
          this.damageVillain(FIRE_DAMAGE);
          this.pushLog("Dragon fire hit The Procrastinator.");
        }
        continue; // fireball consumed
      }
      if (destroyed) {
        // A business-action fireball still credits its reward even when the
        // shot was spent destroying an excuse mid-flight — the real action
        // (email/call/pickup/payment) happened and must always land.
        if (ability) this.applyAbilityReward(ability);
        continue;
      }
      if (fb.x > CANVAS_W + 50) continue;
      remainingFireballs.push(fb);
    }
    state.fireballs = remainingFireballs;

    // Villain attacks on a timer, unless defeated.
    if (!state.villainDefeated) {
      state.villainAttackCooldownMs -= dtMs;
      if (state.villainAttackCooldownMs <= 0) {
        state.villainAttackCooldownMs = VILLAIN_ATTACK_INTERVAL_MS;
        state.excuses.push({ id: this.takeId(), x: VILLAIN_X - 60, y: VILLAIN_Y - 40, vx: -650 });
        this.pushLog("The Procrastinator threw an excuse.");
      }
    }

    // Excuse projectiles travel toward the dragon.
    const remainingExcuses: typeof state.excuses = [];
    for (const ex of state.excuses) {
      ex.x += ex.vx * dt;
      if (ex.x <= DRAGON_X + HIT_RADIUS) {
        this.damageDragon(VILLAIN_ATTACK_DAMAGE);
        continue;
      }
      if (ex.x < -50) continue;
      remainingExcuses.push(ex);
    }
    state.excuses = remainingExcuses;

    // Prune old floaters (lifetime ~900ms) and banners (~2600ms).
    const now = Date.now();
    state.floaters = state.floaters.filter((f) => now - f.createdAt < 900);
    if (state.banner && now - state.banner.createdAt > 2_600) state.banner = null;
  }

  getSnapshot(): BattleSnapshot {
    return { ...this.state.snapshot, blockers: { ...this.state.snapshot.blockers } };
  }

  setBattleSnapshot(partial: Partial<BattleSnapshot>) {
    this.state.snapshot = {
      ...this.state.snapshot,
      ...partial,
      blockers: { ...this.state.snapshot.blockers, ...(partial.blockers ?? {}) },
    };
  }

  getState(): BattleState {
    return this.state;
  }
}
