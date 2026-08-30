/**
 * THE SEAM, MADE VISIBLE — getting in, then how much of the inside is yours.
 *
 * A commercial building runs two entirely different real games. They are
 * INDEPENDENT AXES, not stages of one story, and the UI must never collapse
 * them into a single verdict about the building:
 *
 *   COMMERCIAL ACCESS   how far into the account you have got. Every rung is
 *                       a real transition in the thirteen-state machine, and
 *                       the lowest sealed rung IS the next action.
 *   RESIDENT TERRITORY  whether the finite resident population is in play.
 *                       428 doors at OPUS, 576 at Century Park East — the
 *                       only honest denominators in the product, because they
 *                       are countable physical facts.
 *
 * An unfinished commercial siege does NOT imply the resident board is closed.
 * Century Park East is exactly that case today: no won account, and residents
 * who predate any mission. Saying "Sealed" about the whole building there
 * would be false, and would erase the distinction `preexisting_residents`
 * exists to record.
 *
 * The account_won -> board opens transformation is real, but it may only be
 * claimed where `access === "commercial_win"`. Where residents predate the
 * mission, the board was already there and nothing opened it.
 *
 * WHAT THE OCCUPANCY FIELD DOES AND DOES NOT CLAIM
 *
 * Each mark represents one unit of aggregate building capacity. The COUNTS
 * and the DENOMINATOR are authoritative. The coloured POSITION is not: it does
 * not identify which apartment or customer is paying or signed up. No unit
 * identities exist in the data and none are rendered. Cells are scattered
 * deterministically so the field reads as a building with lights on rather
 * than as a progress bar — but a viewer must never be able to point at a mark
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

/**
 * `signup` means signed up but NOT paying. The upstream `signups` count
 * includes payers, so this band is the remainder — naming it plainly here
 * stops the legend from reading as though 27 people signed up in total when
 * the real enrolled figure is 61.
 */
export type OccupancyCell = "paid" | "signup" | "unclaimed";

export type OccupancyField = {
  totalUnits: number;
  paidResidents: number;
  /** Signed up but NOT paying. Never negative. A band, not a total. */
  signupsOnly: number;
  /**
   * Everyone enrolled: paying plus signed-up-only. Exposed for copy that wants
   * the headline figure, and deliberately NOT a fourth band — adding it to the
   * field would double-count the payers it already contains.
   */
  totalEnrolled: number;
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
    totalEnrolled: paidResidents + signupsOnly,
    unclaimed,
    denominatorVerified: input.denominatorVerified,
    columns,
    rows,
    cells,
  };
}

/* ── The two axes ───────────────────────────────────────────────────────── */

/** How far into the commercial account you have got. Says nothing about residents. */
export type CommercialAccess =
  | "no_mission"
  | "sealed"
  | "inside"
  | "held"
  | "closed";

/** Whether the resident population is in play, and what put it there. */
export type ResidentTerritory =
  | "none"
  | "active_preexisting"
  | "unlocked_by_win";

export function commercialAccessFor(
  depth: SiegeDepth | null | undefined
): CommercialAccess {
  if (depth == null) return "no_mission";
  if (depth === "closed") return "closed";
  if (depth === "held") return "held";
  if (depth === "inside") return "inside";
  return "sealed";
}

export function residentTerritoryFor(input: {
  hasField: boolean;
  access: string | null | undefined;
}): ResidentTerritory {
  if (!input.hasField) return "none";
  // Only a real won account may claim it opened this board.
  if (input.access === "commercial_win") return "unlocked_by_win";
  return "active_preexisting";
}

export type AxisCopy = { label: string; detail: string };

export function commercialAccessCopy(state: CommercialAccess): AxisCopy {
  switch (state) {
    case "held":
      return {
        label: "Won",
        detail: "The account is held.",
      };
    case "inside":
      return {
        label: "Inside",
        detail: "You have been inside and talked to someone. Not won yet.",
      };
    case "sealed":
      return {
        label: "Sealed",
        detail: "Still working your way into the account.",
      };
    case "closed":
      return {
        label: "Closed",
        detail: "The approach ended.",
      };
    case "no_mission":
    default:
      return {
        label: "No commercial mission",
        detail: "Nothing is being pursued at this building.",
      };
  }
}

export function residentTerritoryCopy(state: ResidentTerritory): AxisCopy {
  switch (state) {
    case "unlocked_by_win":
      return {
        label: "Unlocked by the win",
        detail:
          "Winning the account opened this board. That is the start of the resident game, not the end of anything.",
      };
    case "active_preexisting":
      return {
        label: "Active — pre-existing",
        detail:
          "These residents predate any commercial mission here, so no win opened this board. It was already in play.",
      };
    case "none":
    default:
      return {
        label: "No resident evidence",
        detail: "No resident unit data for this building yet.",
      };
  }
}

/** True only where a real commercial win is what put the board in play. */
export function winOpenedTheBoard(state: ResidentTerritory): boolean {
  return state === "unlocked_by_win";
}
