/**
 * THE SEAM, MADE VISIBLE — getting in, then how much of the inside is yours.
 *
 * A commercial building runs two entirely different real games, and winning
 * the account is the hinge between them, not the finish line:
 *
 *   SIEGE       a sealed structure. Every rung of the ladder is a real
 *               transition in the thirteen-state mission machine, and the
 *               lowest sealed rung IS the next action.
 *   PENETRATION once held, the building opens and its finite resident
 *               population becomes the board. 428 doors at OPUS, 576 at
 *               Century Park East — the only honest denominators in the
 *               product, because they are countable physical facts.
 *
 * WHAT THE OCCUPANCY FIELD DOES AND DOES NOT CLAIM
 *
 * The field draws one cell per real rentable unit and lights the real number
 * that have signed up or paid. The COUNTS and the DENOMINATOR are truth. The
 * ARRANGEMENT is not: no cell corresponds to a specific apartment, no unit
 * numbers exist in the data, and none are rendered. Lit cells are scattered
 * deterministically so the field reads as a building with lights on rather
 * than as a progress bar — but a viewer must never be able to point at a cell
 * and say "that one is 14B", because the data cannot support it.
 *
 * A denominator that is still a placeholder (`needsVerification` upstream)
 * travels with `denominatorVerified: false` and must be rendered visibly
 * differently. A guess and a count may not look alike.
 */
import { SIEGE_DEPTHS, type SiegeDepth } from "@shared/canonicalBuilding";

/* ── The siege ladder ───────────────────────────────────────────────────── */

export type SiegeRung = {
  depth: SiegeDepth;
  label: string;
  /**
   * What it takes to REACH this rung, in the operator's language. Phrased
   * this way deliberately: the next action is what gets you to the lowest
   * sealed rung, not what you would do after arriving there.
   */
  reachedBy: string;
  reached: boolean;
  isCurrent: boolean;
  /** The lowest sealed rung — the honest "next action". */
  isNext: boolean;
};

const RUNG_COPY: Record<SiegeDepth, { label: string; reachedBy: string }> = {
  unsighted: { label: "Not yet targeted", reachedBy: "Appears as a candidate" },
  sighted: { label: "Targeted", reachedBy: "Select it as a target" },
  briefed: { label: "Briefed", reachedBy: "Prepare the approach" },
  reachable: {
    label: "A human is reachable",
    reachedBy: "Get a reachable contact",
  },
  committed: { label: "Committed", reachedBy: "Commit to going" },
  inbound: { label: "On the way", reachedBy: "Depart" },
  at_the_door: { label: "At the door", reachedBy: "Arrive" },
  inside: { label: "Inside", reachedBy: "Get inside and talk" },
  held: { label: "Held", reachedBy: "Win the account" },
  closed: { label: "Closed", reachedBy: "The mission was lost" },
};

/** The climbable rungs, in order. `closed` is an exit, never a depth. */
export const LADDER_DEPTHS = SIEGE_DEPTHS.filter(
  depth => depth !== "closed"
) as readonly SiegeDepth[];

export function projectSiegeLadder(depth: SiegeDepth | null): SiegeRung[] {
  const currentIndex = depth == null ? -1 : LADDER_DEPTHS.indexOf(depth);
  // A lost mission has no position on the ladder; nothing reads as reached.
  const reachedThrough = depth === "closed" ? -1 : currentIndex;
  const nextIndex = reachedThrough + 1;

  return LADDER_DEPTHS.map((rungDepth, index) => ({
    depth: rungDepth,
    label: RUNG_COPY[rungDepth].label,
    reachedBy: RUNG_COPY[rungDepth].reachedBy,
    reached: index <= reachedThrough,
    isCurrent: index === reachedThrough,
    isNext: index === nextIndex && nextIndex < LADDER_DEPTHS.length,
  }));
}

/* ── The occupancy field ────────────────────────────────────────────────── */

export type OccupancyCell = "paid" | "signup" | "unclaimed";

export type OccupancyField = {
  totalUnits: number;
  paidResidents: number;
  /** Signed up but not yet paying. Never negative. */
  signupsOnly: number;
  unclaimed: number;
  denominatorVerified: boolean;
  columns: number;
  rows: number;
  /** One entry per real unit. Position is presentation, never identity. */
  cells: OccupancyCell[];
};

export type PenetrationInput = {
  totalUnits: number;
  denominatorVerified: boolean;
  signups: number;
  paidResidents: number;
};

/**
 * MurmurHash3 finalizer. FNV-1a alone has weak avalanche on sequential
 * suffixes -- `unit:104` through `unit:157`, or consecutive business dates,
 * hash almost monotonically, which turns a "scatter" into a contiguous clump.
 * This decorrelates the output so ordering by it is actually uniform.
 */
function mix32(value: number): number {
  let hash = value;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** FNV-1a — deterministic scatter, never randomness. */
function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return mix32(hash >>> 0);
}

/**
 * Portrait-leaning grid so a field of units reads as a tower rather than a
 * square block or a horizontal bar.
 */
export function fieldShape(totalUnits: number): {
  columns: number;
  rows: number;
} {
  const columns = Math.max(4, Math.round(Math.sqrt(totalUnits * 0.75)));
  return { columns, rows: Math.ceil(totalUnits / columns) };
}

export function projectOccupancyField(
  input: PenetrationInput | null | undefined
): OccupancyField | null {
  if (!input) return null;
  const totalUnits = Math.floor(input.totalUnits);
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) return null;

  const paidResidents = Math.max(0, Math.min(totalUnits, input.paidResidents));
  // Signups include payers upstream, so the "signed up only" band is the
  // remainder. Clamped so bad data can never over-fill the field.
  const signupsOnly = Math.max(
    0,
    Math.min(totalUnits - paidResidents, input.signups - paidResidents)
  );
  const unclaimed = totalUnits - paidResidents - signupsOnly;

  // Deterministic scatter: order every index by a stable hash, then assign the
  // real counts in that order. Same data always produces the same field, and
  // the lit units are spread like windows instead of stacked like a bar.
  const order = Array.from({ length: totalUnits }, (_, index) => index).sort(
    (a, b) => stableHash(`unit:${a}`) - stableHash(`unit:${b}`) || a - b
  );

  const cells: OccupancyCell[] = new Array(totalUnits).fill("unclaimed");
  order.forEach((cellIndex, rank) => {
    if (rank < paidResidents) cells[cellIndex] = "paid";
    else if (rank < paidResidents + signupsOnly) cells[cellIndex] = "signup";
  });

  const { columns, rows } = fieldShape(totalUnits);
  return {
    totalUnits,
    paidResidents,
    signupsOnly,
    unclaimed,
    denominatorVerified: input.denominatorVerified,
    columns,
    rows,
    cells,
  };
}

/* ── Phase copy ─────────────────────────────────────────────────────────── */

export type BuildingPhase =
  | "unknown"
  | "prospect"
  | "under_siege"
  | "held_unpenetrated"
  | "held_penetrating"
  | "closed";

/**
 * What the operator should understand at a glance. The held phrasings exist to
 * make the hinge obvious: winning the account opened the doors, it did not
 * finish anything.
 */
export function phaseHeadline(phase: BuildingPhase): string {
  switch (phase) {
    case "prospect":
      return "Sealed. Not yet targeted.";
    case "under_siege":
      return "Sealed. You are working your way in.";
    case "held_unpenetrated":
      return "The doors are open. Nobody inside is yours yet.";
    case "held_penetrating":
      return "The doors are open. The building is the board now.";
    case "closed":
      return "Closed. The approach ended.";
    case "unknown":
    default:
      return "Nothing known about this building yet.";
  }
}

export function isHeld(phase: BuildingPhase): boolean {
  return phase === "held_unpenetrated" || phase === "held_penetrating";
}
