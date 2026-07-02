/** Saleslay Battle Canvas — shared types. No engine, no React, no tRPC. */

export type BattleSnapshot = {
  trueNetCents: number;
  todayGainCents: number;
  dailyContractTargetCents: number;
  dailyContractProgressCents: number;
  dragonHp: number;
  dragonEnergy: number;
  villainHp: number;
  villainMaxHp: number;
  xp: number;
  blockers: {
    overdueReturns: number;
    failedPayments: number;
    blockedOrders: number;
  };
};

export type BusinessEvent =
  | "email_sent"
  | "sales_call_logged"
  | "pickup_completed"
  | "payment_collected"
  | "order_blocked"
  | "payment_failed"
  | "overdue_return_added";

export type Vec2 = { x: number; y: number };

export type Fireball = {
  id: number;
  x: number;
  y: number;
  vx: number;
  /** Set when this fireball carries a business-action reward; undefined for
   * a plain SPACE shot. Kept on the fireball itself (not tracked by array
   * index) so the reward always lands on the shot that earned it, even as
   * other fireballs are added/removed around it. */
  abilityId?: string;
};

export type ExcuseProjectile = {
  id: number;
  x: number;
  y: number;
  vx: number;
};

export type Floater = {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
  createdAt: number;
};

export type LogEntry = {
  id: number;
  text: string;
  at: number;
};

export type BannerState = {
  text: string;
  createdAt: number;
} | null;

/** A business-action fireball waiting out its attack windup before it
 * actually spawns and travels — the reward still lands when it arrives. */
export type PendingShot = {
  id: number;
  fireAt: number;
  abilityId?: string;
};

export type BattleState = {
  snapshot: BattleSnapshot;
  dragonBobT: number;
  dragonHitFlashUntil: number;
  dragonCelebrating: boolean;
  dragonWindupUntil: number;
  villainShuffleT: number;
  villainHitFlashUntil: number;
  villainTelegraphUntil: number;
  villainDefeated: boolean;
  villainDefeatedAt: number;
  villainAttackCooldownMs: number;
  contractComplete: boolean;
  /** 0..100 eased "who is winning" value shared by the DOM meter and the
   * canvas lantern/fog split so both agree on the same frontier line. */
  frontierPct: number;
  fireballs: Fireball[];
  pendingShots: PendingShot[];
  excuses: ExcuseProjectile[];
  floaters: Floater[];
  log: LogEntry[];
  banner: BannerState;
  shakeUntil: number;
  cooldowns: Record<string, number>;
  nextId: number;
  /** Attract mode — demo-only, local, never touches real business data. */
  autoMode: boolean;
  autoActionAt: number;
  autoResetAt: number;
  paused: boolean;
};
