import { normalizeSourceAddress } from "../geography/geographicTruthService";

export type PhysicalIdentityCandidate = {
  physicalEntityId: string;
  displayName: string;
  googlePlaceId: string | null;
  canonicalAddress: string | null;
  aliases: string[];
};

export type PhysicalIdentitySignal = {
  displayName?: string | null;
  googlePlaceId?: string | null;
  canonicalAddress?: string | null;
  addressClue?: string | null;
};

export type PhysicalIdentityResolution =
  | { status: "matched"; physicalEntityId: string; confidence: "high"; reason: "google_place_id" | "canonical_address" }
  | { status: "needs_review"; candidateIds: string[]; reason: string }
  | { status: "new_entity"; confidence: "high" | "medium"; normalizedAddress: string | null };

function normalized(value: string | null | undefined) {
  return value?.trim() ? normalizeSourceAddress(value) : null;
}

/**
 * Resolves only evidence strong enough to own physical identity. Names and
 * coordinates are intentionally insufficient: buildings can share names and
 * neighboring properties can be only meters apart.
 */
export function resolvePhysicalIdentity(
  signal: PhysicalIdentitySignal,
  candidates: readonly PhysicalIdentityCandidate[]
): PhysicalIdentityResolution {
  const placeId = signal.googlePlaceId?.trim() || null;
  if (placeId) {
    const matches = candidates.filter(candidate => candidate.googlePlaceId === placeId);
    if (matches.length === 1)
      return { status: "matched", physicalEntityId: matches[0].physicalEntityId, confidence: "high", reason: "google_place_id" };
    if (matches.length > 1)
      return { status: "needs_review", candidateIds: matches.map(item => item.physicalEntityId), reason: "duplicate provider identity bindings" };
  }

  const canonicalAddress = normalized(signal.canonicalAddress);
  const addressClue = canonicalAddress ?? normalized(signal.addressClue);
  if (addressClue) {
    const matches = candidates.filter(candidate =>
      [candidate.canonicalAddress, ...candidate.aliases]
        .filter((value): value is string => Boolean(value?.trim()))
        .some(value => physicalAliasesMatch(value, addressClue))
    );
    if (matches.length === 1)
      return { status: "matched", physicalEntityId: matches[0].physicalEntityId, confidence: "high", reason: "canonical_address" };
    if (matches.length > 1)
      return { status: "needs_review", candidateIds: matches.map(item => item.physicalEntityId), reason: "address is bound to multiple physical entities" };
  }

  const name = normalized(signal.displayName);
  const nameMatches = name
    ? candidates.filter(candidate => [candidate.displayName, ...candidate.aliases].map(normalized).includes(name))
    : [];
  if (nameMatches.length)
    return { status: "needs_review", candidateIds: nameMatches.map(item => item.physicalEntityId), reason: "name-only identity is ambiguous" };

  return {
    status: "new_entity",
    confidence: placeId || canonicalAddress ? "high" : "medium",
    normalizedAddress: addressClue,
  };
}

/**
 * Street types, directionals and unit words a real address is written with in
 * a dozen different ways. These are folded to one form so that "1450 S La
 * Cienega Blvd" and "1450 South La Cienega Boulevard, Apt 4" are recognised as
 * the same doorway.
 */
const STREET_TYPES: Record<string, string> = {
  street: "st", str: "st", st: "st",
  avenue: "ave", av: "ave", ave: "ave",
  boulevard: "blvd", boul: "blvd", blvd: "blvd",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  terrace: "ter", ter: "ter",
  circle: "cir", cir: "cir",
  parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy",
  square: "sq", sq: "sq",
  trail: "trl", trl: "trl",
  way: "way",
};

const DIRECTIONALS: Record<string, string> = {
  north: "n", n: "n",
  south: "s", s: "s",
  east: "e", e: "e",
  west: "w", w: "w",
  northeast: "ne", ne: "ne",
  northwest: "nw", nw: "nw",
  southeast: "se", se: "se",
  southwest: "sw", sw: "sw",
};

/** Secondary designators. A unit is not a different building. */
const UNIT_WORDS = new Set([
  "apt", "apartment", "unit", "suite", "ste", "no", "num", "number", "fl",
  "floor", "rm", "room", "bldg", "building", "#",
]);

/**
 * The canonical form used to decide whether two references mean one physical
 * place.
 *
 * This is deliberately separate from `normalizeSourceAddress()`, which is the
 * geographic sync key: that value is stored against geocode results, so
 * changing how it folds would invalidate coordinates that were fetched under
 * the old form. Identity matching can be stricter about sameness without
 * disturbing any of that.
 *
 * It only ever folds notation — abbreviations, directionals, punctuation and
 * unit designators. It never drops a house number or a street name, so two
 * genuinely different doorways can never collapse into one.
 */
export function normalizePhysicalAlias(value: string): string {
  const base = normalizeSourceAddress(value)
    .replace(/#/g, " # ")
    .replace(/[^a-z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";

  const words = base.split(" ");
  const kept: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    // Everything from a unit designator onwards describes a space inside the
    // building rather than the building, so it is dropped.
    if (UNIT_WORDS.has(word)) break;
    kept.push(word);
  }

  return kept
    .map(word => DIRECTIONALS[word] ?? STREET_TYPES[word] ?? word)
    .join(" ")
    .trim();
}

const STREET_TYPE_VALUES = new Set(Object.values(STREET_TYPES));

/**
 * The address split into the doorway and whatever followed it.
 *
 * Street types are a closed set, so the token that ends the street is
 * unambiguous: "1450 s la cienega blvd los angeles ca" is the doorway
 * "1450 s la cienega blvd" plus the locality "los angeles ca". Splitting there
 * lets a reference that omits the city match one that includes it, without
 * ever having to guess which trailing words were a city.
 */
export function physicalAliasKeys(value: string): {
  full: string;
  street: string;
  locality: string;
} {
  const full = normalizePhysicalAlias(value);
  const words = full.split(" ").filter(Boolean);
  // The last street-type token wins, so "1450 park ave st louis ave" splits at
  // the street it actually ends on rather than the first type-looking word.
  let boundary = -1;
  for (let index = words.length - 1; index >= 0; index -= 1) {
    if (STREET_TYPE_VALUES.has(words[index]!)) {
      boundary = index;
      break;
    }
  }
  if (boundary < 0) return { full, street: full, locality: "" };
  return {
    full,
    street: words.slice(0, boundary + 1).join(" "),
    locality: words.slice(boundary + 1).join(" "),
  };
}

/**
 * Whether two address references describe the same doorway.
 *
 * Same street, and localities that do not contradict each other — one side
 * omitting the city is agreement, two different cities are not. This never
 * merges different house numbers or different streets.
 */
export function physicalAliasesMatch(left: string, right: string): boolean {
  const a = physicalAliasKeys(left);
  const b = physicalAliasKeys(right);
  if (!a.full || !b.full) return false;
  if (a.full === b.full) return true;
  if (a.street !== b.street) return false;
  if (!a.locality || !b.locality) return true;
  return a.locality === b.locality || a.locality.startsWith(b.locality) || b.locality.startsWith(a.locality);
}
