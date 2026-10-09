import type { NormalizedPlaceCandidate } from "../procurement/googlePlacesDiscoveryConnector";

export type PlaceResolution =
  | { status: "matched"; candidate: NormalizedPlaceCandidate; confidence: "high"; reasons: string[] }
  | { status: "needs_review"; candidates: NormalizedPlaceCandidate[]; reasons: string[] }
  | { status: "not_found" | "provider_unconfigured" | "provider_error"; reasons: string[] };

function words(value: string | null | undefined) {
  return new Set((value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean));
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  return Array.from(left).filter(value => right.has(value)).length / Math.max(left.size, right.size);
}

export function selectPlaceCandidate(input: {
  propertyName?: string | null;
  addressClue?: string | null;
  candidates: NormalizedPlaceCandidate[];
}): PlaceResolution {
  if (!input.candidates.length) return { status: "not_found", reasons: ["Places returned no candidates"] };
  const ranked = input.candidates.map(candidate => {
    const nameScore = overlap(words(input.propertyName), words(candidate.businessName));
    const addressScore = overlap(words(input.addressClue), words(candidate.address));
    const score = nameScore * 0.45 + addressScore * 0.55;
    return { candidate, score, nameScore, addressScore };
  }).sort((a, b) => b.score - a.score || a.candidate.placeId.localeCompare(b.candidate.placeId));
  const first = ranked[0]!;
  const second = ranked[1];
  const clearLead = !second || first.score - second.score >= 0.18;
  if (first.score >= 0.72 && clearLead)
    return {
      status: "matched",
      candidate: first.candidate,
      confidence: "high",
      reasons: [`name=${first.nameScore.toFixed(2)}`, `address=${first.addressScore.toFixed(2)}`],
    };
  return {
    status: "needs_review",
    candidates: ranked.slice(0, 5).map(item => item.candidate),
    reasons: ["No single Places candidate cleared the high-confidence identity threshold"],
  };
}

