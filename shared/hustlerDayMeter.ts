/**
 * The Hustler Meter — "did I do the hard things within my control today?"
 *
 * WHY THIS IS NOT THE EXISTING METER
 *
 * `adaptiveSalesMeter` answers a different question over a 30-day window: how
 * much momentum has built up. Useful, but it cannot answer the one the carnival
 * machine asks, because a 30-day average barely moves when you do one hard
 * thing this morning — and a meter that does not visibly respond to today's
 * effort is a scoreboard, not a game mechanic.
 *
 * WHAT MOVES IT, AND WHAT DELIBERATELY DOES NOT
 *
 * Effort you control, attested. Not revenue, not customer replies, not orders.
 * Those are outcomes and they belong to Tower Wars, which dramatises what
 * customers subsequently do economically. Collapsing both into one number would
 * mean a day of genuinely hard work reading as failure because nobody happened
 * to order, and that is exactly the feedback loop that makes people stop doing
 * the hard work.
 *
 * A reactivation text is worth HALF a notch. A full notch needs something
 * harder — an in-person visit, a completed pickup. Otherwise you could fire off
 * ten texts and max the meter while avoiding every difficult thing in the day.
 *
 * DERIVED, NEVER STORED
 *
 * Same discipline as facadeRegeneration: this is a projection over evidence
 * that already exists. A stored score drifts from the evidence that justified
 * it; a projection cannot.
 */

/** The tiers, weakest first. */
export const HUSTLER_TIERS = [
  "reject",
  "coffee",
  "grinder",
  "hustler",
  "badass",
  "legend",
] as const;
export type HustlerTier = (typeof HUSTLER_TIERS)[number];

export const TIER_LABELS: Record<HustlerTier, { name: string; blurb: string }> = {
  reject: { name: "REJECT", blurb: "Get up. Try again." },
  coffee: { name: "COFFEE", blurb: "Functioning" },
  grinder: { name: "GRINDER", blurb: "Hold the line" },
  hustler: { name: "HUSTLER", blurb: "Getting it done" },
  badass: { name: "BADASS", blurb: "Crushing it" },
  legend: { name: "LEGEND", blurb: "Unstoppable" },
};

/** Half a notch. A personalized reactivation the operator actually sent. */
export const NOTCH_OUTREACH = 0.5;
/** A full notch. Work that required being somewhere, or moving something. */
export const NOTCH_HARD_ACTION = 1;

/**
 * Today's countable effort. Every field is a COUNT of attested actions, never a
 * score handed in by a caller — there is nowhere here to inject a number that
 * did not come from a recorded event.
 */
export type DayEffort = {
  /** Reactivation messages the operator attested sending today. */
  outreachSent: number;
  /** Real visits, walk-ins, pickups and deliveries completed today. */
  hardActions: number;
};

export type HustlerDayMeter = {
  notches: number;
  tier: HustlerTier;
  tierIndex: number;
  /** 0..1 toward the next tier. 1 at Legend, which has nothing above it. */
  progressToNext: number;
  nextTier: HustlerTier | null;
  /** Plain-language reason the meter sits where it does. */
  because: string;
};

/**
 * One notch per tier step. Five steps from Reject to Legend, so a Legend day
 * is five notches — reachable, but only by doing several genuinely hard things
 * rather than by repeating the cheapest one.
 */
export const NOTCHES_PER_TIER = 1;

export function projectHustlerDay(effort: DayEffort): HustlerDayMeter {
  const outreach = Math.max(0, Math.floor(effort.outreachSent));
  const hard = Math.max(0, Math.floor(effort.hardActions));
  const notches = outreach * NOTCH_OUTREACH + hard * NOTCH_HARD_ACTION;

  const maxIndex = HUSTLER_TIERS.length - 1;
  const rawIndex = Math.floor(notches / NOTCHES_PER_TIER);
  const tierIndex = Math.min(maxIndex, rawIndex);
  const tier = HUSTLER_TIERS[tierIndex];
  const nextTier = tierIndex < maxIndex ? HUSTLER_TIERS[tierIndex + 1] : null;

  const withinTier = notches - tierIndex * NOTCHES_PER_TIER;
  const progressToNext = nextTier
    ? Math.max(0, Math.min(1, withinTier / NOTCHES_PER_TIER))
    : 1;

  return {
    notches,
    tier,
    tierIndex,
    progressToNext,
    nextTier,
    because: describeEffort(outreach, hard),
  };
}

/**
 * Says what actually happened, in counts. Never "you're doing great" — the
 * meter's credibility comes from being reducible to things the operator can
 * remember doing.
 */
function describeEffort(outreach: number, hard: number): string {
  if (outreach === 0 && hard === 0) return "Nothing recorded yet today.";
  const parts: string[] = [];
  if (hard > 0) parts.push(`${hard} real ${hard === 1 ? "stop" : "stops"}`);
  if (outreach > 0)
    parts.push(`${outreach} ${outreach === 1 ? "reactivation" : "reactivations"} sent`);
  return parts.join(" · ");
}

/** What one more of each would be worth, for the "next notch" hint. */
export function nextNotchHint(meter: HustlerDayMeter): string | null {
  if (!meter.nextTier) return null;
  const remaining = NOTCHES_PER_TIER - (meter.notches % NOTCHES_PER_TIER || 0);
  const needed = remaining === 0 ? NOTCHES_PER_TIER : remaining;
  if (needed <= NOTCH_OUTREACH) return "One reactivation reaches the next tier.";
  return "One real stop reaches the next tier.";
}
