/**
 * How a player reads real churn pressure in Clockhead's attacks.
 *
 * THE QUESTION THIS ANSWERS
 *
 * Not "how is combat wired to the database" — that is a separate change needing
 * its own approval. This answers the perception question underneath it: given
 * that an attack expresses real dormancy, how does a player know WITHIN ABOUT
 * 400ms, without reading any text, whether this means one customer drifting or a
 * whole building going quiet?
 *
 * WHY CLOCKHEAD IS THE RIGHT VILLAIN FOR CHURN
 *
 * From the World Bible: his obsession is that nothing may happen before the
 * correct time, and the correct time never arrives. His clocks read SOON,
 * PENDING, AFTER REVIEW, NEXT WEEK, WHEN CONDITIONS IMPROVE, NOT YET.
 *
 * That is a description of a dormant customer. Someone who will reorder soon,
 * who has been meaning to, who will get to it next week. Churn is not a villain
 * we bolted onto him — it is what he already was. So the mapping below is
 * recovered from canon rather than invented.
 *
 * THE THREE SILHOUETTES
 *
 * Readability comes from shape, before colour and long before text, because
 * shape survives a small screen, a moving camera and a player already dodging:
 *
 *   one thing      Aimed Bolt    one customer is drifting
 *   several things Clock Fan     several are lapsing together
 *   a moving arc   Second Hand   a whole building has gone quiet
 *
 * A player who has seen each once can tell them apart at a glance, which no
 * amount of numeric tuning could achieve on its own.
 */
import { CUSTOMER_WINDOW_READABILITY_THRESHOLD } from "./goldlineCustomerWindows";

/** Matches `ClockheadAttackKind` in `client/src/pages/goldline/colosseumCombat.ts`. */
export type ClockheadAttackKind = "aimed" | "fan" | "sweep";

/** The names the World Bible gives these attacks. */
export const CANON_ATTACK_NAMES: Record<ClockheadAttackKind, string> = {
  aimed: "Aimed Bolt",
  fan: "Clock Fan",
  sweep: "Second Hand",
};

/**
 * What the world currently knows about dormancy. Counts of real customers —
 * there is nowhere here to inject a difficulty number that no evidence produced.
 */
export type ChurnPressure = {
  /** Customers currently dormant across the tower being fought over. */
  dormantCount: number;
  /** Days overdue for the most overdue of them. Null when nothing is known. */
  worstDaysOverdue: number | null;
  /** True when an entire building has gone quiet — no active customers left. */
  buildingSilent: boolean;
};

/**
 * Fair-difficulty ceilings.
 *
 * Pressure must be readable and survivable, never merely large. A tenfold rise
 * in dormancy cannot produce a tenfold wall of projectiles — that is unreadable
 * AND unwinnable, and it would punish the operator hardest exactly when their
 * business most needs them to keep playing.
 */
export const MAX_PROJECTILES = 5;
export const MIN_PROJECTILES = 1;
/** How long an Aimed Bolt hangs before resuming. His signature beat. */
export const MIN_HANG_MS = 260;
export const MAX_HANG_MS = 1100;
/** The window a player has to identify an attack. Shapes must differ inside it. */
export const RECOGNITION_BUDGET_MS = 400;

/**
 * The clock legend, escalating with how overdue the worst customer is. Text is
 * the LAST readability channel, never the first — it names what the silhouette
 * has already said, for a player who wants the detail.
 */
export const LEGENDS = ["SOON", "PENDING", "AFTER REVIEW", "NEXT WEEK", "NOT YET"] as const;
export type ClockLegend = (typeof LEGENDS)[number];

export type ClockheadAttackPlan = {
  kind: ClockheadAttackKind;
  canonName: string;
  projectileCount: number;
  hangMs: number;
  legend: ClockLegend;
  /** How many real customers this attack stands for. */
  representsCustomers: number;
  /** True when the count was capped for legibility and no longer counts 1:1. */
  aggregated: boolean;
  /** Plain-language description of the tell, for designers and for tests. */
  tell: string;
};

export function legendFor(daysOverdue: number | null): ClockLegend {
  if (daysOverdue === null) return "PENDING";
  if (daysOverdue < 14) return "SOON";
  if (daysOverdue < 45) return "PENDING";
  if (daysOverdue < 90) return "AFTER REVIEW";
  if (daysOverdue < 180) return "NEXT WEEK";
  return "NOT YET";
}

/**
 * The hang before the bolt resumes, scaled by lateness.
 *
 * The longer someone has been "about to order", the longer Clockhead holds the
 * shot — the delay IS the dormancy, felt rather than displayed. Clamped so it
 * never becomes an unreactable stall.
 */
export function hangMsFor(daysOverdue: number | null): number {
  if (daysOverdue === null) return MIN_HANG_MS;
  const ratio = Math.min(1, Math.max(0, daysOverdue / 180));
  return Math.round(MIN_HANG_MS + ratio * (MAX_HANG_MS - MIN_HANG_MS));
}

/**
 * Choose the attack that expresses this pressure.
 *
 * MISSING EVIDENCE STILL FIGHTS. With no scan there is no pressure to express,
 * but the encounter must remain playable — so it falls to the mildest legible
 * attack rather than to nothing. A boss who stops attacking because a query
 * returned empty reads as a broken game, not as an honest one.
 */
export function planClockheadAttack(pressure: ChurnPressure): ClockheadAttackPlan {
  const dormant = Math.max(0, Math.floor(pressure.dormantCount));
  const legend = legendFor(pressure.worstDaysOverdue);
  const hangMs = hangMsFor(pressure.worstDaysOverdue);

  // A whole building gone quiet is categorically different from any number of
  // individuals, so it gets its own silhouette rather than a bigger fan.
  if (pressure.buildingSilent) {
    return {
      kind: "sweep",
      canonName: CANON_ATTACK_NAMES.sweep,
      projectileCount: 0,
      hangMs,
      legend,
      representsCustomers: dormant,
      aggregated: dormant > MAX_PROJECTILES,
      tell: "A single arc crosses the whole arena: this building has gone silent.",
    };
  }

  if (dormant <= 1) {
    return {
      kind: "aimed",
      canonName: CANON_ATTACK_NAMES.aimed,
      projectileCount: 1,
      hangMs,
      legend,
      representsCustomers: dormant,
      aggregated: false,
      tell: "One bolt, hanging before it resumes: one customer is drifting.",
    };
  }

  const projectileCount = Math.min(MAX_PROJECTILES, Math.max(2, dormant));
  return {
    kind: "fan",
    canonName: CANON_ATTACK_NAMES.fan,
    projectileCount,
    hangMs,
    legend,
    representsCustomers: dormant,
    aggregated: dormant > MAX_PROJECTILES,
    tell: `${projectileCount} staggered bolts: several customers are lapsing together.`,
  };
}

/**
 * Whether two plans can be told apart inside the recognition budget.
 *
 * Different silhouettes always can. Two attacks of the SAME shape are only
 * distinguishable if their counts differ enough to read without counting —
 * people do not count past about four under pressure, so adjacent counts are
 * treated as the same silhouette. This is what stops "more dormancy" from being
 * expressed as an imperceptible extra projectile.
 */
export function distinguishableAtAGlance(
  a: ClockheadAttackPlan,
  b: ClockheadAttackPlan
): boolean {
  if (a.kind !== b.kind) return true;
  return Math.abs(a.projectileCount - b.projectileCount) >= 2;
}

/**
 * The point past which counting individual projectiles stops working and the
 * attack stands for a group instead. Deliberately the same principle as
 * `CUSTOMER_WINDOW_READABILITY_THRESHOLD`, which already decided this question
 * for lantern windows — two different answers to "when do we stop counting"
 * would read as two different worlds.
 */
export const AGGREGATION_NOTE = `Counts stop being literal past ${MAX_PROJECTILES}; windows aggregate past ${CUSTOMER_WINDOW_READABILITY_THRESHOLD}.`;
