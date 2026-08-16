/**
 * Expedition run state — HP, Momentum, Relic, defeat and recovery.
 *
 * BUSINESS-TRUTH FIREWALL (§5/§31). Everything in this file is fiction.
 * Nothing here can collect an order, create revenue, fabricate a visit, or
 * touch any authoritative record. Trailblazer can be defeated and the real
 * pickup remains exactly as pending as it was before. There is deliberately
 * no import of any tRPC client, order type, or business module in this
 * file, and `expeditionState.test.ts` asserts the run can be won, lost,
 * redeployed and pressed through without a single business call.
 *
 * Run economy is topology only (§35): HP, MOMENTUM, RELIC. No third
 * currency, no shop, no permanence.
 */

export const EXPEDITION = {
  maxHp: 100,
  /** Momentum is spent on recovery; it is not a damage stat. */
  maxMomentum: 100,
  momentum: {
    hostileDefeated: 18,
    goodEvade: 12,
    lineLatch: 8,
    cacheFound: 20,
    /** Recovery costs the run's mastery resource — a real trade. */
    recoveryCost: 45,
    recoveryHeal: 30,
  },
  /** Redeploy costs expedition standing only. No real-world penalty. */
  redeployMomentumLoss: 0.5,
} as const;

export type RelicId = "echo_thread" | "sunstep" | "brass_guard";

export type Relic = {
  readonly id: RelicId;
  readonly name: string;
  /** One physical sentence. Never a stat line. */
  readonly promise: string;
};

/**
 * §27: the player must FEEL which relic they picked without reading a stat
 * screen. Each of these changes a verb, not a number.
 */
export const RELICS: readonly Relic[] = [
  {
    id: "echo_thread",
    name: "Echo Thread",
    promise: "The lash leaps onward to a second guardian.",
  },
  {
    id: "sunstep",
    name: "Sunstep",
    promise: "A clean evade leaves a burst of sunfire behind you.",
  },
  {
    id: "brass_guard",
    name: "Brass Guard",
    promise: "The first blow of each clash rings off brass.",
  },
];

export type ExpeditionOutcome = "running" | "down" | "arrived";
export type RouteChoice = "unchosen" | "safe" | "upper" | "scarred";

/**
 * The one snapshot shape for consumers outside the expedition layer — the
 * HUD, GoldlineGame, GoldlineGameHome. Previously GoldlineGameHome kept a
 * hand-written duplicate (`relic: string | null`, missing the real
 * RelicId union) alongside this. Duplicated truths in this subsystem have
 * already caused two of the bugs fixed this session.
 */
export type ExpeditionSnapshot = {
  hp: number;
  momentum: number;
  outcome: ExpeditionOutcome;
  route: RouteChoice;
  relic: RelicId | null;
};

export type Waystone = {
  readonly id: string;
  /** Corridor progress 0..1 this waystone restores to. */
  readonly progress: number;
};

export class ExpeditionRun {
  hp: number = EXPEDITION.maxHp;
  momentum: number = 0;
  relic: Relic | null = null;
  outcome: ExpeditionOutcome = "running";
  route: RouteChoice = "unchosen";
  /** True once PRESS ON has been taken — the run is on the Scarred Route. */
  scarred = false;
  /** Optional content the Scarred Route forfeits (§34). */
  optionalRewardsAvailable = true;
  lastWaystone: Waystone | null = null;
  /** Fictional invulnerability after taking a hit, in fictional seconds. */
  private invulnerable = 0;
  /** Set for one frame when Brass Guard absorbs a blow, for feedback. */
  guardAbsorbedThisFrame = false;
  private brassGuardCharged = true;

  step(dt: number) {
    if (this.invulnerable > 0) this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.guardAbsorbedThisFrame = false;
  }

  isInvulnerable(): boolean {
    return this.invulnerable > 0;
  }

  chooseRelic(id: RelicId) {
    this.relic = RELICS.find(r => r.id === id) ?? null;
    this.brassGuardCharged = true;
  }

  hasRelic(id: RelicId): boolean {
    return this.relic?.id === id;
  }

  addMomentum(amount: number) {
    this.momentum = Math.min(EXPEDITION.maxMomentum, this.momentum + amount);
  }

  /**
   * @param ignoreIFrames used by hazards that should always connect.
   * @returns damage actually taken.
   */
  takeDamage(amount: number, options: { ignoreIFrames?: boolean } = {}): number {
    if (this.outcome !== "running") return 0;
    if (!options.ignoreIFrames && this.invulnerable > 0) return 0;

    // Brass Guard: the first blow of each clash rings off brass. A verb
    // change the player hears and sees, not a percentage.
    if (this.hasRelic("brass_guard") && this.brassGuardCharged) {
      this.brassGuardCharged = false;
      this.guardAbsorbedThisFrame = true;
      this.invulnerable = 0.6;
      return 0;
    }

    this.hp = Math.max(0, this.hp - amount);
    this.invulnerable = 0.45;
    if (this.hp === 0) this.outcome = "down";
    return amount;
  }

  /**
   * Recharges Brass Guard once the pressure genuinely lets up. The CALLER
   * decides what "lets up" means — ExpeditionLayer requires no living
   * guardian in engagement range and nothing in the air, held for a fixed
   * quiet period. A plain timer here would have re-armed the guard mid-fight.
   */
  clashEnded() {
    this.brassGuardCharged = true;
  }

  /** Whether Brass Guard will absorb the next blow. Read-only, for tests
   *  and feedback — nothing outside this class may set it. */
  get guardCharged(): boolean {
    return this.brassGuardCharged;
  }

  spendMomentumForRecovery(): boolean {
    if (this.momentum < EXPEDITION.momentum.recoveryCost) return false;
    if (this.hp >= EXPEDITION.maxHp) return false;
    this.momentum -= EXPEDITION.momentum.recoveryCost;
    this.hp = Math.min(EXPEDITION.maxHp, this.hp + EXPEDITION.momentum.recoveryHeal);
    return true;
  }

  /**
   * Monotonic: a waystone earlier than the one already held is ignored. The
   * player can walk backward — toward the tutorial target, or to bait a
   * Slinger into a better angle — and that must never overwrite a later
   * checkpoint with an earlier one.
   */
  setWaystone(waystone: Waystone) {
    if (this.lastWaystone && waystone.progress <= this.lastWaystone.progress) {
      return;
    }
    this.lastWaystone = waystone;
  }

  /**
   * §33 REDEPLOY — return to the last fictional waystone. Expedition-level
   * loss only. The real pickup objective is untouched and still pending.
   */
  redeploy(): { restoredProgress: number } {
    this.hp = EXPEDITION.maxHp;
    this.momentum = Math.floor(this.momentum * EXPEDITION.redeployMomentumLoss);
    this.outcome = "running";
    this.invulnerable = 1;
    this.brassGuardCharged = true;
    return { restoredProgress: this.lastWaystone?.progress ?? 0 };
  }

  /**
   * §34 PRESS ON — NOT a teleport to the pickup. Enters the Scarred Route:
   * traversal continues, mandatory combat pressure mostly lifts, and the
   * optional treasure and relic opportunities close. Game-only opportunity
   * cost; the real job is never blocked by game skill.
   */
  /**
   * The mapped destination has been physically reached with the climax
   * genuinely cleared. Stops fictional combat. Never touches business
   * state — arrival is a fictional milestone, not a completion event.
   */
  arrive(): void {
    if (this.outcome === "running") this.outcome = "arrived";
  }

  pressOn(): void {
    this.scarred = true;
    this.route = "scarred";
    this.optionalRewardsAvailable = false;
    this.hp = Math.max(1, Math.floor(EXPEDITION.maxHp * 0.35));
    this.outcome = "running";
    this.invulnerable = 1.5;
  }

  chooseRoute(route: Exclude<RouteChoice, "unchosen" | "scarred">) {
    if (this.scarred) return;
    this.route = route;
  }

  /** Expedition rank is fiction and is forfeited by pressing on. */
  expeditionRank(): "none" | "bronze" | "brass" | "gold" {
    if (this.scarred) return "none";
    if (this.momentum >= 80 && this.hp >= 70) return "gold";
    if (this.momentum >= 45) return "brass";
    if (this.momentum > 0) return "bronze";
    return "none";
  }
}
