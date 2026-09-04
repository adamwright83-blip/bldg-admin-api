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
import {
  isCollectedTruth,
  type CollectedEvidenceOrder,
} from "@/game/expedition/strongholdRestoration";
import type { SettledStratum } from "./facadeScars";

/**
 * Authoritative restoration evidence for ONE building.
 *
 * Deliberately the narrowest shape that can express "real work landed here".
 * Every field traces to order truth; there is no gameplay channel.
 */
/**
 * An authoritative order, plus WHEN its collection actually happened.
 *
 * `strongholdRestoration.ts` defines what counts as collected truth and this
 * module reuses that definition rather than restating it — but that projection
 * deliberately has no temporal dimension: it counts distinct collected orders
 * over all history, because a Stronghold either has been restored or has not.
 *
 * A facade cannot borrow that. Scars are dated, so healing has to be dated
 * too. Without a boundary an order collected in March would retroactively
 * close a wound inflicted in August — the building would appear repaired by
 * work that happened before the damage existed.
 */
export type DatedCollectedOrder = CollectedEvidenceOrder & {
  /**
   * ISO date the collection occurred, compared against a stratum's
   * `businessDate`. Authoritative order truth, never a render timestamp.
   */
  readonly collectedOn: string;
};

export type RegenerationInput = {
  /**
   * Authoritative orders for this building. Only those that both pass
   * `isCollectedTruth` and were collected strictly AFTER a given stratum's
   * business date may heal that stratum.
   */
  orders: readonly DatedCollectedOrder[];
  /** Settled history. Never mutated here. */
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
  // Distinct genuinely-collected orders, oldest collection first. Deduped by
  // id because one order is one piece of evidence however many rows mention it.
  const seen = new Set<number>();
  const eligible: DatedCollectedOrder[] = [];
  for (const order of input.orders) {
    if (!isCollectedTruth(order) || seen.has(order.id)) continue;
    seen.add(order.id);
    eligible.push(order);
  }
  eligible.sort((a, b) =>
    a.collectedOn < b.collectedOn ? -1 : a.collectedOn > b.collectedOn ? 1 : a.id - b.id
  );

  const byStratum: StratumRegeneration[] = [];
  // Oldest wound first, so long-settled damage is repaired before the newest.
  const ordered = [...input.strata].sort((a, b) =>
    a.businessDate < b.businessDate ? -1 : a.businessDate > b.businessDate ? 1 : 0
  );

  // An order is spent once. Healing the whole facade with a single delivery
  // would make recovery cheaper than the work it is supposed to represent.
  const spentOrderIds = new Set<number>();
  let usedAny = false;
  for (const stratum of ordered) {
    let spent = 0;
    for (const order of eligible) {
      if (spent >= ORDERS_TO_CLOSE_ONE_STRATUM) break;
      if (spentOrderIds.has(order.id)) continue;
      // THE BOUNDARY. Work delivered before the damage was settled cannot
      // have repaired it, so only strictly-later collections are eligible.
      if (order.collectedOn <= stratum.businessDate) continue;
      spentOrderIds.add(order.id);
      spent += 1;
      usedAny = true;
    }
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
    hasAuthoritativeRestoration: usedAny,
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

/**
 * A dated pickup-completion, as recorded in `operations_events`.
 *
 * `actualEventTimestamp` is the authoritative time the pickup actually
 * happened — not when the row was written, and not the order's `updatedAt`.
 */
export type PickupCompletedEvidence = {
  readonly orderId: number | null;
  readonly sourceEventType: string;
  /** ISO instant of the real pickup. Null when the row never captured one. */
  readonly actualEventTimestamp: string | null;
};

/**
 * Pairs collected orders with WHEN their collection actually happened.
 *
 * The order row cannot answer this. `orders` retains no collection timestamp:
 * `updatedAt` moves on every later write, so for an order now `delivered` it
 * is delivery time, and for one in `processing` it is processing time. Using
 * it would place the healing at the wrong moment — usually later than the real
 * collection, which is exactly the direction that wrongly closes a scar.
 *
 * So the date comes from the `pickup_completed` audit event's
 * `actualEventTimestamp`, which is the only field that records the real
 * collection instant.
 *
 * TWO SEPARATE QUESTIONS, TWO SEPARATE AUTHORITIES
 *
 * The audit event is NOT what proves a collection happened. That authority
 * stays exactly where `strongholdRestoration.ts` puts it: the order reaching
 * collected-or-beyond is primary truth, precisely because the audit row can
 * legitimately be missing — the conditional UPDATE and the event write are not
 * one transaction.
 *
 * Regeneration therefore requires BOTH, for different reasons:
 *
 *   collected-or-beyond order state  ->  the pickup OCCURRED   (primary truth)
 *   completed pickup_completed row   ->  it occurred WHEN      (dated evidence)
 *
 * An order with no usable timestamp is still entirely legitimate business
 * truth and still restores a Stronghold. It simply earns no HEALING, because
 * healing is a claim about order-of-events and that claim cannot be supported.
 * Losing regeneration credit is not a statement that the collection is doubted.
 *
 * UNCERTAINTY GETS NO CREDIT — and this is where regeneration deliberately
 * diverges from `strongholdRestoration.ts`.
 *
 * There, a collected order with no audit event still restores the Stronghold,
 * because the order is the truth and a missing audit row is a known gap
 * between two non-transactional writes. That is right for a question shaped
 * "has this ever been restored?".
 *
 * Regeneration asks a different question: "was this building repaired AFTER
 * that specific day's damage?" An order that proves collection happened but
 * carries no trustworthy date cannot be placed on either side of a scar. It is
 * dropped rather than assumed recent, because assuming recent grants healing
 * the evidence does not support.
 */
export function datedCollectedOrders(
  orders: readonly CollectedEvidenceOrder[],
  pickupEvents: readonly PickupCompletedEvidence[]
): DatedCollectedOrder[] {
  const collectedAt = new Map<number, string>();
  for (const event of pickupEvents) {
    if (event.sourceEventType !== "pickup_completed") continue;
    if (event.orderId == null || !event.actualEventTimestamp) continue;
    // Earliest wins: the first genuine pickup is the collection. A later
    // duplicate row must not push the healing forward in time.
    const existing = collectedAt.get(event.orderId);
    if (!existing || event.actualEventTimestamp < existing) {
      collectedAt.set(event.orderId, event.actualEventTimestamp);
    }
  }

  const dated: DatedCollectedOrder[] = [];
  for (const order of orders) {
    if (!isCollectedTruth(order)) continue;
    const at = collectedAt.get(order.id);
    // Genuinely collected — that stands as business truth either way — but
    // undatable, so it cannot be placed relative to a scar. No healing credit.
    if (!at) continue;
    dated.push({ ...order, collectedOn: at.slice(0, 10) });
  }
  return dated;
}
