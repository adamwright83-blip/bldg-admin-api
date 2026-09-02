/**
 * FACADE REGENERATION — the city healing, and the only direction the damage
 * model could not previously express.
 *
 * The layer model gained a stage:
 *
 *     pristine plate
 *       + settled scars / patina      permanent history (facadeScars.ts)
 *         + REGENERATION              this module — scars closing over
 *           + fresh damage            today (freshDamage.ts)
 *             + weapon, projectile, vfx
 *
 * Until now a building could only ever get worse. Scars accumulated and
 * nothing removed them, so a customer who came back looked exactly like a
 * customer who never did. That is a world that can record loss but not
 * recovery, which is the wrong shape for a business where recovery is the
 * whole point.
 *
 * WHAT DRIVES IT — AND WHAT MAY NOT
 *
 * Regeneration reads the SAME authoritative fact `strongholdRestoration.ts`
 * already treats as canonical: an order reaching `collected`. Real work
 * actually delivered for that building is what closes its wounds. There is
 * deliberately no other input:
 *
 *   - no score, combo, or timing grade
 *   - no Guardian defeat
 *   - no Tower Wars result
 *   - no campaign chapter completion
 *   - no elapsed time
 *
 * `RegenerationInput` has nowhere to put any of them, so no caller can heal a
 * facade by playing well. Winning a fictional battle over a building whose
 * customer never returned must leave it exactly as scarred as it was.
 *
 * HISTORY IS NEVER DELETED
 *
 * A healed scar does not disappear; it settles toward patina. `closure` runs
 * 0..1 and the renderer fades and softens rather than removing, so the
 * building carries visible evidence that it was once hurt and has since been
 * rebuilt. That is a different statement from "this was never damaged", and
 * the world should be able to tell the two apart. It also keeps the module
 * consistent with the campaign rule that completed history stays fixed.
 *
 * Oldest wounds close first. A facade recovers the way a real one does —
 * the long-settled damage gets repaired while the newest is still raw — and
 * it means the most recent, most legible scars are the last to fade, so the
 * building never looks healed while a fresh wound is still open.
 */
import type { SettledStratum } from "./facadeScars";

/**
 * Authoritative restoration evidence for ONE building.
 *
 * Deliberately the narrowest shape that can express "real work landed here".
 * Every field traces to order truth; there is no gameplay channel.
 */
export type RegenerationInput = {
  /**
   * Orders that reached `collected` for this building since the damage was
   * settled. The canonical restoration fact — see `strongholdRestoration.ts`,
   * which treats the collected order as primary and audit events as merely
   * supporting, because the order is the truth.
   */
  collectedOrderCount: number;
  /** Settled history, oldest first. Never mutated here. */
  strata: readonly SettledStratum[];
};

/** How much of one settled day's scarring has closed over. */
export type StratumRegeneration = {
  /** Matches `SettledStratum.businessDate` so the renderer can pair them. */
  businessDate: string;
  /**
   * 0 = untouched, 1 = fully closed to patina. Never removes the stratum —
   * a closed scar is still a scar that healed, not an absence of one.
   */
  closure: number;
};

export type RegenerationProjection = {
  byStratum: StratumRegeneration[];
  /** 0..1 across the whole facade. Drives the ambient "rebuilt" wash. */
  overall: number;
  /**
   * True only when authoritative restoration exists at all. The renderer uses
   * this to decide whether to show any healing treatment, so a building with
   * no collected orders gets no visual credit for recovery it has not earned.
   */
  hasAuthoritativeRestoration: boolean;
};

/**
 * Collected orders needed to fully close one settled day of damage.
 *
 * Not a currency and not spendable — it is a read over order truth. The value
 * is deliberately above 1 so a single delivery does not erase a whole day of
 * history; recovery should be legible as a process rather than a switch.
 */
export const ORDERS_TO_CLOSE_ONE_STRATUM = 3;

/**
 * Projects how far each settled stratum has healed.
 *
 * Pure and deterministic: the same order count and the same history always
 * produce the same facade, so a reload cannot reroll how repaired a building
 * looks. Oldest wounds absorb the restoration first.
 */
export function projectRegeneration(
  input: RegenerationInput
): RegenerationProjection {
  const collected = Math.max(0, Math.floor(input.collectedOrderCount));
  const byStratum: StratumRegeneration[] = [];

  // Oldest first, so the long-settled damage is repaired before the newest.
  const ordered = [...input.strata].sort((a, b) =>
    a.businessDate < b.businessDate ? -1 : a.businessDate > b.businessDate ? 1 : 0
  );

  let budget = collected;
  for (const stratum of ordered) {
    const spent = Math.min(budget, ORDERS_TO_CLOSE_ONE_STRATUM);
    budget -= spent;
    byStratum.push({
      businessDate: stratum.businessDate,
      closure: spent / ORDERS_TO_CLOSE_ONE_STRATUM,
    });
  }

  const overall =
    byStratum.length === 0
      ? 0
      : byStratum.reduce((sum, item) => sum + item.closure, 0) / byStratum.length;

  return {
    byStratum,
    overall,
    // Evidence, not appearance: a facade with nothing settled and nothing
    // collected has not "fully recovered", it simply has no history.
    hasAuthoritativeRestoration: collected > 0,
  };
}

/**
 * Opacity multiplier for a settled stratum's scars.
 *
 * Floors above zero on purpose. A fully closed scar still reads faintly,
 * because the building remembers being hurt even after it was rebuilt.
 */
export const HEALED_SCAR_FLOOR = 0.22;

export function scarOpacityFor(closure: number): number {
  const value = Math.max(0, Math.min(1, closure));
  return 1 - value * (1 - HEALED_SCAR_FLOOR);
}
