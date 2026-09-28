/**
 * Where a dormant customer sits in Lantern City.
 *
 * WHY THIS IS A JOIN AND NOT A COLUMN
 *
 * `customerChurnSnapshots` carries no building. A native snapshot's `lastOrderId`
 * reaches `orders.buildingSlug`. A CleanCloud snapshot has no numeric id; the
 * caller passes that order's address and slug as evidence instead. Neither
 * path copies the building onto the snapshot, because a customer's building
 * can change with their next order.
 *
 * EVIDENCE, NOT RESIDENCE
 *
 * A last order proves where somebody was *served once*. It is not a claim about
 * where they live, and the labels here never say otherwise. That distinction is
 * the same one the truth firewall makes everywhere else: the strongest claim the
 * evidence supports, and no stronger.
 *
 * AMBIGUITY STAYS AMBIGUOUS
 *
 * Every unresolved case is named and counted rather than guessed. An unplaced
 * customer is visible as unplaced; they are never quietly dropped into a tower
 * to make the city look tidier. A city that invents placements is a city whose
 * lit windows mean nothing.
 */
import { resolveBuildingEvidence, matchBuilding, buildingFromSlug } from "../../shared/buildings";

/** Which piece of evidence actually identified the building. */
export type BindingBasis = "address" | "slug";

/**
 * Why a customer could not be placed. Each is a genuinely different situation
 * with a different remedy, so they are never collapsed into one "unknown".
 */
export type UnresolvedReason =
  /** The snapshot has no last order — nothing to locate them by. */
  | "no_last_order"
  /** A native id or CleanCloud order ref was named, but that row is gone. */
  | "order_not_found"
  /** The order exists but neither its address nor its slug names a known building. */
  | "no_building_evidence"
  /** Address and slug name DIFFERENT buildings. Placing them would be a coin toss. */
  | "conflicting_evidence";

export type CustomerBinding =
  | {
      resolved: true;
      buildingId: string;
      buildingName: string;
      basis: BindingBasis;
      /** Operator-facing, deliberately phrased as evidence rather than residence. */
      evidenceLabel: string;
    }
  | { resolved: false; buildingId: null; reason: UnresolvedReason };

/** The order fields this needs. A structural subset, so tests need no full row. */
export type BindingOrderEvidence = {
  id?: number | null;
  address: string | null;
  buildingSlug: string | null;
};

export type BindingInput = {
  lastOrderId: number | null;
  /** The order named by `lastOrderId`, or null when it could not be loaded. */
  order: BindingOrderEvidence | null;
};

/**
 * Bind one customer to a canonical building, or explain why not.
 *
 * Pure. The caller does the query; this decides. Same split as
 * `facadeRegeneration` — a projection over evidence, holding no connection of
 * its own and therefore trivially testable.
 */
export function bindCustomerToBuilding(input: BindingInput): CustomerBinding {
  if (input.lastOrderId == null && input.order == null) {
    return { resolved: false, buildingId: null, reason: "no_last_order" };
  }
  if (input.order == null) {
    return { resolved: false, buildingId: null, reason: "order_not_found" };
  }

  const evidence = resolveBuildingEvidence(input.order.address, input.order.buildingSlug);

  /*
    `resolveBuildingEvidence` resolves a conflict by letting the address win, and
    reports the contradiction so callers can decide what it means for them. For
    PLACING A CUSTOMER IN THE CITY it means we do not know, so we decline. A lit
    window is a claim about a specific building, and we do not make that claim on
    evidence that contradicts itself.
  */
  if (evidence.conflict !== null) {
    return { resolved: false, buildingId: null, reason: "conflicting_evidence" };
  }
  if (!evidence.building) {
    return { resolved: false, buildingId: null, reason: "no_building_evidence" };
  }

  // Which side actually identified it — address is the stronger evidence, so it
  // is reported whenever it matched.
  const basis: BindingBasis = matchBuilding(input.order.address)
    ? "address"
    : "slug";

  return {
    resolved: true,
    buildingId: evidence.building.id,
    buildingName: evidence.building.name,
    basis,
    evidenceLabel: `Last order at ${evidence.building.name}`,
  };
}

export type BindingSummary = {
  /** Customer ids grouped by the building they were placed in. */
  placedByBuilding: Map<string, string[]>;
  /** How many could not be placed, and why. */
  unresolvedCount: number;
  unresolvedByReason: Record<UnresolvedReason, number>;
};

/**
 * Roll bindings up per building, keeping the unplaced visible.
 *
 * The unresolved tally is returned alongside the placements, not logged and
 * forgotten, because the city must be able to say "and 12 customers I could not
 * place" out loud. Silence there would read as "there are no others".
 */
export function summarizeBindings(
  entries: ReadonlyArray<{ customerId: string; binding: CustomerBinding }>
): BindingSummary {
  const placedByBuilding = new Map<string, string[]>();
  const unresolvedByReason: Record<UnresolvedReason, number> = {
    no_last_order: 0,
    order_not_found: 0,
    no_building_evidence: 0,
    conflicting_evidence: 0,
  };
  let unresolvedCount = 0;

  for (const entry of entries) {
    if (entry.binding.resolved) {
      const list = placedByBuilding.get(entry.binding.buildingId) ?? [];
      list.push(entry.customerId);
      placedByBuilding.set(entry.binding.buildingId, list);
    } else {
      unresolvedCount += 1;
      unresolvedByReason[entry.binding.reason] += 1;
    }
  }

  return { placedByBuilding, unresolvedCount, unresolvedByReason };
}

/** Plain-language line for the unplaced tally. Null when everyone was placed. */
export function describeUnresolved(summary: BindingSummary): string | null {
  if (summary.unresolvedCount === 0) return null;
  const noun = summary.unresolvedCount === 1 ? "customer" : "customers";
  return `${summary.unresolvedCount} ${noun} not placed — no clear building on their last order`;
}

/** Re-exported so callers need not reach past this module into shared/. */
export { buildingFromSlug };
