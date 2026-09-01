/**
 * What matters on a given day, and why.
 *
 * Goldline does not store "the day". It stores truth, evidence, promises and
 * constraints, and then answers the question "what is relevant now?" every
 * time it is asked. That is the whole difference between a world that
 * remembers and a calendar that goes stale: a stored plan is wrong the moment
 * reality moves, but a projection is simply re-derived.
 *
 * Two rules keep this honest:
 *
 *   Reality may recompile the future. It may not rewrite history.
 *   A reason to look is not a commitment, however loudly it wants to be one.
 */

import {
  claimIsRelevantOn,
  describeTemporalClaim,
  type TemporalClaim,
} from "./goldlineTemporal";
import type { ObligationRecord } from "./goldlineObligations";

/** How hard the day pushes on a place. Never a claim about certainty. */
export type PressureWeight = "ambient" | "notable" | "insistent";

export type FuturePressureItem = {
  physicalEntityId: string | null;
  /** Why this is on today's horizon, in words the player can read. */
  reason: string;
  /** The evidence this traces back to, so it is always auditable. */
  sourceEvidenceReference: string;
  /** When the source evidence entered the Chronicle, for player-facing provenance. */
  sourceOccurredAt: string | null;
  weight: PressureWeight;
  /** True only for a promise the operator actually made. */
  isObligation: boolean;
  /** True when the source hedged. Uncertainty survives all the way here. */
  uncertain: boolean;
  /** The local date this became relevant. */
  relevantFrom: string;
};

export type FuturePressure = {
  date: string;
  items: FuturePressureItem[];
};

/**
 * A promise is the only thing that gets to be insistent, and only once it is
 * actually due. Everything else is a reason to look, which is what "ambient"
 * and "notable" mean — the world leans, it does not shout.
 */
function weighObligation(record: ObligationRecord, date: string): PressureWeight {
  if (record.dueDate === null) return "notable";
  if (record.dueDate < date) return "insistent";
  if (record.dueDate === date) return "insistent";
  return "ambient";
}

function weighClaim(claim: TemporalClaim): PressureWeight {
  if (claim.when?.hedged) return "ambient";
  return claim.kind === "reported_availability" ? "notable" : "ambient";
}

/**
 * Everything worth surfacing on `date`, newest pressure first.
 *
 * Obligations that are past due stay in the list — a promise does not expire
 * because its day did. Soft signals drop out when their window closes, because
 * "Sarah is back Wednesday" says nothing at all about Saturday.
 */
export function projectFuturePressure(input: {
  date: string;
  obligations: ObligationRecord[];
  claims: Array<{
    claim: TemporalClaim;
    physicalEntityId: string | null;
    sourceEvidenceReference: string;
    sourceOccurredAt?: string | null;
  }>;
}): FuturePressure {
  const items: FuturePressureItem[] = [];

  for (const record of input.obligations) {
    if (record.resolution !== null) continue;
    // A promise with no stated day is always live; one with a day waits for it.
    if (record.dueDate !== null && record.dueDate > input.date) continue;
    items.push({
      physicalEntityId: record.physicalEntityId,
      reason: record.explanation,
      sourceEvidenceReference: record.sourceEvidenceReference,
      sourceOccurredAt: record.madeAt,
      weight: weighObligation(record, input.date),
      isObligation: true,
      uncertain: false,
      relevantFrom: record.dueDate ?? record.madeAt.slice(0, 10),
    });
  }

  for (const entry of input.claims) {
    if (!claimIsRelevantOn(entry.claim, input.date)) continue;
    items.push({
      physicalEntityId: entry.physicalEntityId,
      reason: describeTemporalClaim(entry.claim),
      sourceEvidenceReference: entry.sourceEvidenceReference,
      sourceOccurredAt: entry.sourceOccurredAt ?? null,
      weight: weighClaim(entry.claim),
      isObligation: false,
      uncertain: Boolean(entry.claim.when?.hedged),
      relevantFrom: entry.claim.when?.startDate ?? input.date,
    });
  }

  const order: Record<PressureWeight, number> = {
    insistent: 0,
    notable: 1,
    ambient: 2,
  };
  return {
    date: input.date,
    items: items.sort(
      (a, b) =>
        order[a.weight] - order[b.weight] ||
        Number(b.isObligation) - Number(a.isObligation) ||
        a.sourceEvidenceReference.localeCompare(b.sourceEvidenceReference)
    ),
  };
}

/**
 * The atmosphere a place is allowed to wear because of what is coming.
 *
 * Deliberately not a badge. "Sarah might be back Wednesday" may make a building
 * lean into the light; it may never render as "2 PM MEETING", because the world
 * must not impersonate a certainty nobody has.
 */
export type FutureAtmosphere = {
  physicalEntityId: string;
  /**
   * Restrained visual emphasis only. A place with anything at all on its
   * horizon stirs; only a due promise makes it lean. There is no "none" —
   * a place with nothing coming returns no atmosphere rather than a blank one.
   */
  intensity: "stirring" | "leaning";
  /** Always available as text, never as colour alone. */
  explanation: string;
  /** True when everything here is soft. Hard promises are never "maybe". */
  entirelyUncertain: boolean;
};

export function futureAtmosphereFor(
  physicalEntityId: string,
  pressure: FuturePressure
): FutureAtmosphere | null {
  const mine = pressure.items.filter(
    item => item.physicalEntityId === physicalEntityId
  );
  if (!mine.length) return null;
  const insistent = mine.some(item => item.weight === "insistent");
  return {
    physicalEntityId,
    intensity: insistent ? "leaning" : "stirring",
    explanation: mine.map(item => item.reason).join(" "),
    entirelyUncertain: mine.every(item => item.uncertain),
  };
}
