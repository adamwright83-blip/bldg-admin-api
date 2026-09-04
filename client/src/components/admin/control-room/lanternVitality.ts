/**
 * How a building's windows read, from evidence that already exists.
 *
 * WARMTH MEANS ACTIVE, NOT RECOVERED
 *
 * An earlier draft of this had warmth mean "recovered", which was wrong in a way
 * worth recording: it implied an ordinary customer who has ordered happily for
 * two years and never lapsed would show a dark window until they were rescued
 * from a dormancy they never entered. Most warm windows in a healthy city belong
 * to customers no one ever had to win back.
 *
 * The real rule is narrower, and it is the only one the firewall needs:
 *
 *   A DORMANT CUSTOMER CANNOT REACH WARMTH THROUGH OUTREACH ALONE.
 *
 * Outreach earns a transient ribbon and nothing else. Only order evidence makes
 * a window warm. `recovered` is not a state here at all — a customer who
 * reorders simply becomes active again, which is what recovery actually means,
 * and which is why lapsing a second time returns them to quiet with no residue.
 *
 * UNKNOWN IS NOT QUIET
 *
 * Absent evidence is its own state. Rendering it as quiet would assert dormancy
 * we cannot support; rendering it as warm would assert health we cannot support.
 * It says "no evidence" and is excluded from the lit fraction, so a building we
 * know nothing about cannot masquerade as a building doing badly.
 *
 * DERIVED, NEVER STORED
 *
 * A projection over evidence, in the same discipline as `facadeRegeneration`.
 * Stored vitality would drift from the orders that justified it.
 */

/**
 * Score at or above which a customer counts as dormant. Matches the lever's
 * `LEVER_MIN_SCORE`, deliberately: the customers the city shows as quiet are
 * exactly the customers the lever is willing to deal. Two different thresholds
 * would let a window contradict the machine.
 */
export const DORMANT_SCORE_FLOOR = 40;

/**
 * How long an outreach ribbon burns. Anchored to the outreach event, never to
 * page load, so opening the city cannot restart it — see `ribbonExpiryFor`.
 */
export const RIBBON_WINDOW_MS = 6 * 60 * 60 * 1000;

export type CustomerVitality = "warm" | "quiet" | "unknown";

export type CustomerVitalityInput = {
  customerId: string;
  /** Orders in flight right now. Any at all means unambiguously active. */
  activeOrderCount: number | null;
  /** Churn score. Null when the customer was never scored. */
  score: number | null;
  daysSinceLastOrder: number | null;
  /** When the operator last attested sending outreach. Null if never. */
  contactedAt: Date | null;
};

export type CustomerVitalityState = {
  customerId: string;
  vitality: CustomerVitality;
  /** True only while a real outreach event is still inside its window. */
  ribbonActive: boolean;
  /** Exactly when the ribbon stops. Null when there is no live ribbon. */
  ribbonExpiresAt: Date | null;
  /** Always populated, so colour and motion are never the only signal. */
  statusLine: string;
};

/**
 * When an outreach ribbon ends, derived from the event itself.
 *
 * This is the whole anti-restart mechanism: expiry is `contactedAt + window`, a
 * fixed point in time. Remounting the page, refetching, or navigating back
 * recomputes the same instant, so a ribbon cannot be made to burn twice by
 * looking at it again. A ribbon that restarted on load would be claiming an
 * outreach happened now that actually happened yesterday.
 */
export function ribbonExpiryFor(contactedAt: Date | null): Date | null {
  if (!contactedAt) return null;
  return new Date(contactedAt.getTime() + RIBBON_WINDOW_MS);
}

export function projectCustomerVitality(
  input: CustomerVitalityInput,
  now: Date
): CustomerVitalityState {
  const vitality = classify(input);

  const expiry = ribbonExpiryFor(input.contactedAt);
  /*
    A ribbon only ever sits on a quiet window. On a warm one it would be noise:
    the customer is already active, which is the stronger statement. This is also
    what keeps outreach from reading as an upgrade — the ribbon is visibly an
    event on a still-dormant building, not a step toward warmth.
  */
  const ribbonActive =
    vitality === "quiet" && expiry !== null && expiry.getTime() > now.getTime();

  return {
    customerId: input.customerId,
    vitality,
    ribbonActive,
    ribbonExpiresAt: ribbonActive ? expiry : null,
    statusLine: describeCustomer(input, vitality, ribbonActive, now),
  };
}

function classify(input: CustomerVitalityInput): CustomerVitality {
  // An order in flight is the strongest possible evidence of an active customer,
  // and it outranks any score — a scan can be stale, an in-flight order cannot.
  if ((input.activeOrderCount ?? 0) > 0) return "warm";
  if (input.score === null) return "unknown";
  return input.score >= DORMANT_SCORE_FLOOR ? "quiet" : "warm";
}

function describeCustomer(
  input: CustomerVitalityInput,
  vitality: CustomerVitality,
  ribbonActive: boolean,
  now: Date
): string {
  if (vitality === "unknown") return "No order history recorded";

  if (vitality === "warm") {
    const active = input.activeOrderCount ?? 0;
    if (active > 0) return `Active · ${active} order${active === 1 ? "" : "s"} in progress`;
    return input.daysSinceLastOrder === null
      ? "Active"
      : `Active · ordered ${input.daysSinceLastOrder}d ago`;
  }

  const quiet =
    input.daysSinceLastOrder === null
      ? "Quiet"
      : `Quiet · ${input.daysSinceLastOrder}d since last order`;

  /*
    Deliberately reports outreach and dormancy in the same breath. "Reached out"
    on its own could be read as progress; "still quiet" is the fact that matters
    and the fact the ribbon must not be allowed to soften.
  */
  if (ribbonActive && input.contactedAt) {
    const hours = Math.max(
      0,
      Math.round((now.getTime() - input.contactedAt.getTime()) / 3_600_000)
    );
    const when = hours < 1 ? "just now" : `${hours}h ago`;
    return `${quiet} · reached out ${when}, no order yet`;
  }
  return quiet;
}

export type BuildingVitality = {
  buildingId: string;
  warmCount: number;
  quietCount: number;
  unknownCount: number;
  /**
   * Share of KNOWN customers who are active, 0..1. Null when nothing is known,
   * which is different from 0 and must render differently.
   */
  litFraction: number | null;
  /** True while any customer in the building has a live outreach ribbon. */
  ribbonActive: boolean;
  /** Earliest moment the building's appearance changes. Drives the expiry timer. */
  nextChangeAt: Date | null;
  statusLine: string;
};

/**
 * Aggregate a building from its bound customers.
 *
 * MIXED IS THE NORMAL CASE. A tower holds many customers and they are rarely in
 * the same state, so vitality is a proportion rather than a verdict. One dormant
 * resident dimming an entire building would be both wrong and demoralising — it
 * would show a healthy tower as a failure because a single customer lapsed.
 */
export function projectBuildingVitality(
  buildingId: string,
  customers: readonly CustomerVitalityState[]
): BuildingVitality {
  let warmCount = 0;
  let quietCount = 0;
  let unknownCount = 0;
  let ribbonActive = false;
  let nextChangeAt: Date | null = null;

  for (const customer of customers) {
    if (customer.vitality === "warm") warmCount += 1;
    else if (customer.vitality === "quiet") quietCount += 1;
    else unknownCount += 1;

    if (customer.ribbonActive) ribbonActive = true;
    // The soonest expiry decides when this building must re-render.
    if (customer.ribbonExpiresAt) {
      if (!nextChangeAt || customer.ribbonExpiresAt < nextChangeAt) {
        nextChangeAt = customer.ribbonExpiresAt;
      }
    }
  }

  const known = warmCount + quietCount;
  return {
    buildingId,
    warmCount,
    quietCount,
    unknownCount,
    litFraction: known === 0 ? null : warmCount / known,
    ribbonActive,
    nextChangeAt,
    statusLine: describeBuilding(warmCount, quietCount, unknownCount, ribbonActive),
  };
}

function describeBuilding(
  warm: number,
  quiet: number,
  unknown: number,
  ribbonActive: boolean
): string {
  const known = warm + quiet;
  if (known === 0) {
    return unknown === 0
      ? "No customers placed here yet"
      : `${unknown} customer${unknown === 1 ? "" : "s"} here, no order history recorded`;
  }

  const parts = [`${warm} of ${known} active`];
  if (quiet > 0) parts.push(`${quiet} quiet`);
  if (ribbonActive) parts.push("outreach sent today");
  // Reported separately so they never distort the active/quiet ratio.
  if (unknown > 0) parts.push(`${unknown} without history`);
  return parts.join(" · ");
}

/**
 * How long until a building's appearance next changes on its own, in ms.
 *
 * A mounted page must expire its own ribbon rather than wait for the next
 * navigation — a city left open on a desk would otherwise keep claiming an
 * outreach was recent hours after it stopped being true. Callers schedule a
 * single timer against this instead of polling.
 */
export function msUntilNextChange(
  building: BuildingVitality,
  now: Date
): number | null {
  if (!building.nextChangeAt) return null;
  return Math.max(0, building.nextChangeAt.getTime() - now.getTime());
}
