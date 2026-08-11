/**
 * Formalizes the boundary between "a real business opportunity was
 * discovered somewhere" and "it became a playable Goldline mission" — so a
 * future mission-producing system can plug into the same world without
 * rewriting traversal, encounters, Armory, mutation, or mission projection.
 *
 * This is a documentation/typing layer over FOUR mission sources that
 * already exist and already work:
 *   - FIELD            → server/field/getFieldMoves.ts (FieldMoveCandidate)
 *   - Cold Call         → server/driverGameWorld/coldCallBurstService.ts (ColdCallTarget)
 *   - Recovery/Rekindle → server/driverGameWorld/driverGameWorldService.ts (DriverGameWorldNode)
 *   - Expansion Scout   → server/driverGameWorld/expansionScoutService.ts (ScoutDiscovery)
 *
 * None of those four services are refactored to literally implement
 * MissionSourceAdapter this run — each already has a working, tested,
 * differently-shaped output, and forcing a shared runtime interface onto
 * all four in one pass would be a high-risk rewrite for no functional gain.
 * Instead this file documents the SHAPE they already conform to, and
 * provides one real, reusable piece of cross-source logic: entity-identity
 * deduplication, wired into client/src/game/state/WorldProjection.ts so a
 * business discovered by two sources still produces exactly one mission.
 */

export const MISSION_SOURCE_TYPES = [
  "field",
  "cold_call",
  "recovery",
  "scout",
] as const;

export type MissionSourceType = (typeof MISSION_SOURCE_TYPES)[number];

/**
 * Deterministic tie-break order when the same real entity is deduped across
 * sources. Lower number wins. FIELD wins because it's the most immediately
 * actionable, already-vetted candidate; Recovery wins next because it
 * represents a relationship the player already has evidence for; Scout is
 * last among mission-producing sources because it's a freshly sourced,
 * unverified discovery. Cold Call is not part of this ranking — it never
 * competes for a mission-list slot, it's its own action queue.
 */
export const MISSION_SOURCE_PRIORITY: Record<
  Exclude<MissionSourceType, "cold_call">,
  number
> = {
  field: 0,
  recovery: 1,
  scout: 2,
};

/**
 * What every mission must be able to answer, regardless of source. Not
 * necessarily rendered to the player verbatim — this is the provenance
 * record a mission source attaches when it hands off a candidate.
 */
export type MissionSourceProvenance = {
  sourceType: MissionSourceType;
  /** Opaque reference into the source's own system (scan id, batch id, move id). */
  sourceReference: string;
  /** Why this is actionable now — real evidence, not an invented urgency score. */
  eligibilityReason: string;
  observedAt: string;
};

/**
 * The conceptual contract a future mission source (Commerce, Supplier,
 * Retail buyer, Investor — see MISSION_SOURCE_ARCHITECTURE.md) would
 * implement to plug into the same world without new traversal/encounter/
 * Armory/mutation code. Documentation-grade: TypeScript can't enforce a
 * generic adapter across four already-shipped, differently-shaped services
 * without risky forced refactors, so this exists to describe the shape new
 * sources should converge on, not to be `implements`-ed today.
 */
export interface MissionSourceAdapter<TCandidate, TMission> {
  sourceType: MissionSourceType;
  /** Find raw candidates from this source's own system. */
  discover(context: unknown): Promise<TCandidate[]> | TCandidate[];
  /** Convert a raw candidate into the shape the world/UI understands. */
  normalize(candidate: TCandidate, context: unknown): TMission;
  /** Is this candidate real/actionable right now? Never a fabricated check. */
  evaluateEligibility(candidate: TCandidate, context: unknown): boolean;
  /** Produce the actual playable mission representation. */
  buildMission(candidate: TCandidate, context: unknown): TMission;
  /** Authoritative source-truth record — see MissionSourceProvenance. */
  provenance(candidate: TCandidate): MissionSourceProvenance;
  /** The stable real-world identity key used for cross-source dedup below. */
  dedupeIdentity(candidate: TCandidate): string;
}

/**
 * Given candidates from potentially multiple sources, keeps exactly one per
 * real-world entity — the highest-priority source's candidate wins. Stable:
 * ties within the same source/priority keep the first-seen candidate.
 *
 * This does not invent an entity identity — callers supply whatever real
 * key already uniquely identifies the business (a mission id once a
 * commercialMissions row exists, a provider account id before it does).
 */
export function dedupeByEntityIdentity<T>(
  candidates: T[],
  identityOf: (candidate: T) => string,
  priorityOf: (candidate: T) => number
): T[] {
  const bestByIdentity = new Map<string, { item: T; priority: number; index: number }>();
  candidates.forEach((item, index) => {
    const identity = identityOf(item);
    const priority = priorityOf(item);
    const existing = bestByIdentity.get(identity);
    if (!existing || priority < existing.priority) {
      bestByIdentity.set(identity, { item, priority, index });
    }
  });
  return Array.from(bestByIdentity.values())
    .sort((a, b) => a.index - b.index)
    .map(entry => entry.item);
}
