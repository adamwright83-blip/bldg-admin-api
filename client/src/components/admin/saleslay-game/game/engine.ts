/** Saleslay Battle Canvas — the game engine. Owns one mutable BattleState and
 * exposes update(dt) + a small event API. No React, no canvas drawing, no
 * network calls — this is demo-only local state, nothing here ever reaches
 * a real customer, order, or payment. */
import {
  ABILITY_CONFIG,
  DAILY_CONTRACT_COMPLETE_BONUS_XP,
  DRAGON_WINDUP_MS,
  FIRE_COOLDOWN_ID,
  FIRE_COOLDOWN_MS,
  FIRE_DAMAGE,
  VILLAIN_ATTACK_DAMAGE,
  VILLAIN_ATTACK_INTERVAL_MS,
  VILLAIN_TELEGRAPH_MS,
  type AbilityId,
} from "./abilities";
import type { BattleSnapshot, BattleState, BusinessEvent } from "./types";
import type { WeaponActionStatus } from "./weaponCapability";

export const CANVAS_W = 1280;
export const CANVAS_H = 720;

// Positions leave a clear combat lane: SAGE owns the far-left edge of the
// board, Spark sits well clear of SAGE and the bottom HUD, the villain sits
// well clear of the right-column HUD stack (notice board / ledger / contract).
export const DRAGON_X = 300;
export const DRAGON_Y = 440;
export const VILLAIN_X = 960;
export const VILLAIN_Y = 440;
export const HIT_RADIUS = 60;

const AUTO_ACTION_MIN_MS = 1_800;
const AUTO_ACTION_MAX_MS = 3_000;
const AUTO_BURST_CHANCE = 0.2;
const AUTO_CLOSE_DEAL_EXTRA_PAUSE_MS = 1_500;
const AUTO_ROUND_END_PAUSE_MS = 3_000;

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
    dragonWindupUntil: 0,
    villainShuffleT: 0,
    villainHitFlashUntil: 0,
    villainTelegraphUntil: 0,
    villainDefeated: false,
    villainDefeatedAt: 0,
    villainAttackCooldownMs: VILLAIN_ATTACK_INTERVAL_MS,
    contractComplete: false,
    frontierPct: 50,
    fireballs: [],
    pendingShots: [],
    excuses: [],
    floaters: [],
    log: [],
    banner: null,
    shakeUntil: 0,
    cooldowns: {},
    nextId: 1,
    autoMode: false,
    autoActionAt: 0,
    autoResetAt: 0,
    paused: false,
  };
}

export class SaleslayBattleEngine {
  private state: BattleState = freshState();
  private rng: () => number;

  constructor(options?: { rng?: () => number }) {
    this.rng = options?.rng ?? Math.random;
  }

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
      this.state.villainDefeatedAt = Date.now();
      this.state.banner = { text: "DAY WON — THE KINGDOM ADVANCES", createdAt: Date.now() };
      this.state.dragonCelebrating = true;
      this.pushLog("The Procrastinator retreats. DAY WON.");
      this.scheduleAutoRoundReset();
    }
  }

  private damageDragon(amount: number) {
    const snap = this.state.snapshot;
    snap.dragonHp = Math.max(0, snap.dragonHp - amount);
    this.state.dragonHitFlashUntil = Date.now() + 220;
    this.pushFloater(DRAGON_X, DRAGON_Y - 80, `-${amount}`, "#ffb020");
  }

  /** Queues a shot behind the attack windup — the projectile itself spawns
   * once the anticipation pose finishes (see update()). Reward, cooldown,
   * and damage still resolve when the projectile actually lands. */
  private queueShot(abilityId?: AbilityId) {
    this.state.dragonWindupUntil = Date.now() + DRAGON_WINDUP_MS;
    this.state.pendingShots.push({ id: this.takeId(), fireAt: Date.now() + DRAGON_WINDUP_MS, abilityId });
  }

  fireBasic() {
    if (this.isOnCooldown(FIRE_COOLDOWN_ID)) return;
    this.setCooldown(FIRE_COOLDOWN_ID, FIRE_COOLDOWN_MS);
    this.queueShot();
    this.cancelAutoMode();
  }

  useAbility(id: AbilityId) {
    if (this.isOnCooldown(id)) return;
    const ability = ABILITY_CONFIG.find((a) => a.id === id);
    if (!ability) return;
    this.setCooldown(id, ability.cooldownMs);
    this.queueShot(id);
    this.cancelAutoMode();
  }

  // ── Weapon-capability adapter surface (see weaponCapability.ts) ──────────
  // Today these run the exact same demo path as useAbility/fireBasic — the
  // reward still lands when the fireball reaches the villain. A future
  // real-action adapter (phone/email/pickup/payment) will call
  // completeWeaponAction() directly once the real business milestone fires
  // (call connected, message sent, task completed, payment collected)
  // instead of relying on the fireball's travel time, with no HUD rewrite.

  /** Launches a weapon action. Demo path: identical to useAbility/fireBasic. */
  startWeaponAction(id: AbilityId | "fire") {
    if (id === "fire") this.fireBasic();
    else this.useAbility(id);
  }

  /** Credits the reward for a real (non-demo) confirmed success, bypassing
   * the projectile travel time entirely — a real order mutation's server
   * round-trip has nothing to do with fireball travel time. Puts the
   * ability on cooldown from the moment of CONFIRMED success (not from the
   * original click), so a repeated press can't double-complete the same
   * real action, and plays Spark's attack pose so the hit still reads as
   * an attack even though no projectile was queued/traveled. */
  completeWeaponAction(id: AbilityId) {
    const ability = ABILITY_CONFIG.find((a) => a.id === id);
    if (!ability) return;
    this.setCooldown(id, ability.cooldownMs);
    this.state.dragonWindupUntil = Date.now() + DRAGON_WINDUP_MS;
    this.applyAbilityReward(ability);
  }

  /** Records a real action failure without crediting any reward or
   * touching cooldown — the player may retry immediately. */
  failWeaponAction(id: AbilityId | "fire", reason?: string) {
    this.pushLog(reason ? `${id} action failed: ${reason}` : `${id} action failed.`);
  }

  /** Derived (not stored) so it can never drift from the real cooldown/
   * in-flight state — a pending or traveling shot for this ability reads
   * as "working"; otherwise cooldown vs. ready. "success"/"failed"/
   * "live"/etc. are defined in WeaponActionStatus for future adapters but
   * have no demo-path trigger yet. */
  getWeaponStatus(id: AbilityId | "fire"): WeaponActionStatus {
    const state = this.state;
    // A plain SPACE shot carries no abilityId — match undefined for "fire".
    const matches = (shotAbilityId: string | undefined) =>
      id === "fire" ? shotAbilityId === undefined : shotAbilityId === id;
    const hasPendingOrInFlight =
      state.pendingShots.some((s) => matches(s.abilityId)) ||
      state.fireballs.some((f) => matches(f.abilityId));
    if (hasPendingOrInFlight) return "working";
    if (this.isOnCooldown(id === "fire" ? FIRE_COOLDOWN_ID : id)) return "cooldown";
    if (id !== "fire" && state.villainDefeated) return "disabled";
    return "ready";
  }

  /** Internal variant used by attract mode — does NOT cancel auto (it IS auto). */
  private autoUseAbility(id: AbilityId): boolean {
    if (this.isOnCooldown(id)) return false;
    const ability = ABILITY_CONFIG.find((a) => a.id === id);
    if (!ability) return false;
    this.setCooldown(id, ability.cooldownMs);
    this.queueShot(id);
    return true;
  }

  private autoFireBasic(): boolean {
    if (this.isOnCooldown(FIRE_COOLDOWN_ID)) return false;
    this.setCooldown(FIRE_COOLDOWN_ID, FIRE_COOLDOWN_MS);
    this.queueShot();
    return true;
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
      this.state.shakeUntil = Date.now() + 300;
      this.pushLog("Daily Contract complete: +500 XP.");
      this.scheduleAutoRoundReset();
    }
  }

  /** Guards against villain-defeat and contract-completion both trying to
   * schedule a loop reset — only one auto-reset may be pending at a time. */
  private scheduleAutoRoundReset() {
    if (!this.state.autoMode) return;
    if (this.state.autoResetAt > 0) return;
    this.state.autoResetAt = Date.now() + AUTO_ROUND_END_PAUSE_MS;
  }

  setAutoMode(on: boolean) {
    this.state.autoMode = on;
    if (on) {
      this.state.autoActionAt = Date.now() + this.jitter();
      this.state.autoResetAt = 0;
    } else {
      this.state.autoResetAt = 0;
    }
  }

  private cancelAutoMode() {
    if (this.state.autoMode) this.setAutoMode(false);
  }

  setPaused(paused: boolean) {
    this.state.paused = paused;
  }

  private jitter(): number {
    return AUTO_ACTION_MIN_MS + this.rng() * (AUTO_ACTION_MAX_MS - AUTO_ACTION_MIN_MS);
  }

  reset(options?: { preserveAutoMode?: boolean }) {
    const preserveAutoMode = options?.preserveAutoMode ?? false;
    const wasAuto = this.state.autoMode;
    this.state = freshState();
    if (preserveAutoMode && wasAuto) {
      this.state.autoMode = true;
      this.state.autoActionAt = Date.now() + this.jitter();
    }
  }

  /** Returns true if a Close the Deal action fired, so the caller can add
   * its extra pause on top of the normal jitter (not overwrite it). */
  private runAutoAction(): boolean {
    let usedCollect = false;
    // Auto is demo-only by hard rule: any ability with autoEligible===false
    // (currently "pickup", which requires a real confirmed order mutation)
    // is never included in Auto's pool, in the burst pool below, or
    // reachable through autoUseAbility at all.
    const autoEligible = (a: (typeof ABILITY_CONFIG)[number]) => a.autoEligible !== false;
    const options: Array<{ act: () => boolean; id: AbilityId | "fire" }> = [
      { act: () => this.autoFireBasic(), id: "fire" },
      ...ABILITY_CONFIG.filter((a) => autoEligible(a) && !this.isOnCooldown(a.id)).map((a) => ({
        act: () => this.autoUseAbility(a.id),
        id: a.id,
      })),
    ];
    if (options.length === 0) return false;
    const pick = options[Math.floor(this.rng() * options.length)];
    const acted = pick.act();
    if (acted && pick.id === "collect") usedCollect = true;

    if (acted && this.rng() < AUTO_BURST_CHANCE) {
      // Short two-action burst: queue a second pick shortly after.
      const remaining = ABILITY_CONFIG.filter((a) => autoEligible(a) && !this.isOnCooldown(a.id));
      if (remaining.length > 0) {
        const second = remaining[Math.floor(this.rng() * remaining.length)];
        if (this.autoUseAbility(second.id) && second.id === "collect") usedCollect = true;
      }
    }
    return usedCollect;
  }

  update(dtMs: number) {
    if (this.state.paused) return;
    const dt = dtMs / 1000;
    const state = this.state;
    state.dragonBobT += dt;
    if (!state.villainDefeated) state.villainShuffleT += dt;

    // Attract mode: act on a calm, jittered cadence; reset the round after a
    // guarded pause once a win/completion has been reached.
    if (state.autoMode) {
      const now = Date.now();
      if (state.autoResetAt > 0 && now >= state.autoResetAt) {
        this.reset({ preserveAutoMode: true });
      } else if (state.autoResetAt === 0 && now >= state.autoActionAt) {
        const usedCollect = this.runAutoAction();
        state.autoActionAt = now + this.jitter() + (usedCollect ? AUTO_CLOSE_DEAL_EXTRA_PAUSE_MS : 0);
      }
    }

    // Resolve queued windup shots — the projectile spawns once the
    // anticipation pose finishes.
    const now = Date.now();
    const stillPending: typeof state.pendingShots = [];
    for (const shot of state.pendingShots) {
      if (now >= shot.fireAt) {
        this.spawnFireball(shot.abilityId as AbilityId | undefined);
      } else {
        stillPending.push(shot);
      }
    }
    state.pendingShots = stillPending;

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

    // Villain attacks on a timer, unless defeated: telegraph first, throw after.
    if (!state.villainDefeated) {
      state.villainAttackCooldownMs -= dtMs;
      if (state.villainAttackCooldownMs <= 0 && state.villainTelegraphUntil === 0) {
        state.villainTelegraphUntil = now + VILLAIN_TELEGRAPH_MS;
      }
      if (state.villainTelegraphUntil > 0 && now >= state.villainTelegraphUntil) {
        state.villainTelegraphUntil = 0;
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
    state.floaters = state.floaters.filter((f) => now - f.createdAt < 900);
    if (state.banner && now - state.banner.createdAt > 2_600) state.banner = null;

    // Ease the shared frontier value toward "who is winning" so the DOM
    // meter and the canvas lantern/fog split always agree.
    const damageDealt = 100 - state.snapshot.villainHp;
    const damageTaken = 100 - state.snapshot.dragonHp;
    const totalDamage = damageDealt + damageTaken || 1;
    const frontierTarget = (damageDealt / totalDamage) * 100;
    state.frontierPct += (frontierTarget - state.frontierPct) * Math.min(1, dt * 2);
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
