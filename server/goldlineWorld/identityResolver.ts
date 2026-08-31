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
    const matches = candidates.filter(candidate => {
      const values = [candidate.canonicalAddress, ...candidate.aliases].map(normalized);
      return values.includes(addressClue);
    });
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

export function normalizePhysicalAlias(value: string): string {
  return normalizeSourceAddress(value);
}
