/**
 * Frontier cap — at most five locked objects visible in Lantern City.
 *
 * Section 21 of the product bible: the city must never look like the operator
 * failed everywhere. With lost ground now a real state, the count of blockaded
 * territories is no longer bounded by authoring, so it is bounded here.
 *
 * Priority, highest first:
 *   1. a territory with an active campaign chapter (the player is mid-story)
 *   2. lost ground (history the business actually had)
 *   3. authored frontier opportunities, in authored order
 *
 * Everything past the cap is `quiet`: the territory renders dark and calm with
 * no object and no lock. It is still real, still in the opportunity queue, and
 * promoted when a slot opens. Presentation only; nothing here is stored.
 */

export const FRONTIER_VISIBLE_CAP = 5;

export type FrontierCandidate = {
  territoryId: string;
  kind: "lost_ground" | "opportunity";
  activeCampaign: boolean;
  /** Position in the authored frontier list; lower is earlier. */
  authoredRank: number;
};

export type FrontierPresentation =
  | { territoryId: string; visibility: "object"; kind: FrontierCandidate["kind"] }
  | { territoryId: string; visibility: "quiet"; kind: FrontierCandidate["kind"] };

function priority(c: FrontierCandidate): number {
  if (c.activeCampaign) return 0;
  if (c.kind === "lost_ground") return 1;
  return 2;
}

export function applyFrontierCap(
  candidates: readonly FrontierCandidate[],
  cap: number = FRONTIER_VISIBLE_CAP
): FrontierPresentation[] {
  const ordered = [...candidates].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      a.authoredRank - b.authoredRank ||
      a.territoryId.localeCompare(b.territoryId)
  );
  const visible = new Set(ordered.slice(0, Math.max(0, cap)).map(c => c.territoryId));
  return candidates.map(c => ({
    territoryId: c.territoryId,
    kind: c.kind,
    visibility: visible.has(c.territoryId) ? "object" : "quiet",
  }));
}
