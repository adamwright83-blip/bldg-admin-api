import type { GrowMove } from "./growTypes";

export function rankGrowMoves(input: { moves: GrowMove[]; now: Date; capacityFull: boolean }): GrowMove[] {
  return input.moves
    .filter(move => !move.expiresAt || Date.parse(move.expiresAt) > input.now.getTime())
    .filter(move => !(input.capacityFull && move.moveType === "visit_nearby_prospect"))
    .sort((a, b) => {
      const valueA = a.expectedValue.value?.highCents ?? 0;
      const valueB = b.expectedValue.value?.highCents ?? 0;
      const urgencyA = a.expiresAt ? Math.max(1, Date.parse(a.expiresAt) - input.now.getTime()) : Number.MAX_SAFE_INTEGER;
      const urgencyB = b.expiresAt ? Math.max(1, Date.parse(b.expiresAt) - input.now.getTime()) : Number.MAX_SAFE_INTEGER;
      const scoreA = valueA / Math.max(1, a.expectedTimeMinutes) + 1_000_000_000 / urgencyA;
      const scoreB = valueB / Math.max(1, b.expectedTimeMinutes) + 1_000_000_000 / urgencyB;
      return scoreB - scoreA || a.id.localeCompare(b.id);
    });
}
