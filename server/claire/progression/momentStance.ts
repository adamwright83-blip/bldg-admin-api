/**
 * Bounded current-moment stance: a small, temporary presentation signal from real context.
 *
 * It may only change HOW Claire sounds this turn (shorter, softer, firmer, more amused, more
 * familiar). It reads facts and returns text; it has no access to, and cannot mutate, business
 * truth, canon, the rapport band, the personal-access rung, entitlements, disclosure eligibility
 * or progression evidence. This is deliberately not an emotional simulation.
 */
export type MomentSignals = {
  urgentBusinessOpen: boolean;
  businessAgendaFinished: boolean;
  /** A verified hard workday just completed (from verified evidence, never self-report). */
  difficultVerifiedDay: boolean;
  /** A real setback shared by both of you (verified). */
  sharedSetback: boolean;
  /** How many times the operator has pushed the same boundary in this call. */
  boundaryPushesThisCall: number;
};

export type MomentStance = "neutral" | "brisk" | "soft" | "firm" | "amused" | "familiar";

export function deriveMomentStance(signals: MomentSignals): MomentStance {
  if (signals.boundaryPushesThisCall >= 3) return "firm";
  if (signals.boundaryPushesThisCall === 2) return "amused";
  if (signals.difficultVerifiedDay || signals.sharedSetback) return "soft";
  if (signals.urgentBusinessOpen) return "brisk";
  if (signals.businessAgendaFinished) return "familiar";
  return "neutral";
}

const GUIDANCE: Record<Exclude<MomentStance, "neutral">, string> = {
  brisk: "Right now there is urgent unresolved business: keep this reply short and pointed.",
  soft: "It has been a hard verified day: a little quieter and gentler in tone. No consolation speech, no reassurance, no invented feeling.",
  firm: "The same boundary has been pushed repeatedly this call: hold it a touch more firmly, still dry, never cold.",
  amused: "The same boundary is being tested again: a flicker of dry amusement is fine.",
  familiar: "The business agenda is done: you can be a little more at ease in tone.",
};

/** Text for the prompt. Tone only — it never states or implies any level, unlock, trust or score. */
export function momentStanceGuidance(stance: MomentStance): string | null {
  return stance === "neutral" ? null : `Tone for this turn only: ${GUIDANCE[stance]} This changes how you sound, not what is true or what you may say.`;
}
