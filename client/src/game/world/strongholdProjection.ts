/**
 * Stronghold home base (Slice 97) — a pure aggregation of systems that
 * already exist, projected into the shape a spatialized home-base panel
 * needs. This module creates no truth: every field traces to an existing
 * projection (`todayRoute.ts`, `goldlineProgression.ts`'s
 * `GoldlineAgentProjection`, `chronicleProjection.ts`), or is explicitly
 * `null`/empty when the underlying signal doesn't exist.
 *
 * No Field Kit object is modeled here. See shared/actionGrammar.ts's
 * documented discrepancy note — this repository has no inventory system,
 * and Stronghold does not invent one. The panel that would have shown
 * "enough/not-enough" Field Kit state instead shows nothing for that slot;
 * inventory-gating remains genuinely absent rather than fabricated.
 */
import type { TodayRouteEntry } from "./todayRoute";
import type { ChronicleEntry } from "./chronicleProjection";
import type { GoldlineAgentProjection } from "../../../../shared/goldlineProgression";

export type StrongholdIntelSummary = {
  acceptedTeachingCount: number;
  /** Allowlisted category counts from the accepted general-teaching corpus. */
  byCategory: Array<{ category: string; count: number }>;
};

export type StrongholdProjection = {
  routeTable: TodayRouteEntry[];
  agents: GoldlineAgentProjection[];
  intel: StrongholdIntelSummary | null;
  chronicle: ChronicleEntry[];
};

export function projectStronghold(input: {
  routeTable: TodayRouteEntry[];
  agents: GoldlineAgentProjection[];
  intel?: StrongholdIntelSummary | null;
  chronicle: ChronicleEntry[];
}): StrongholdProjection {
  return {
    routeTable: input.routeTable,
    agents: input.agents,
    intel: input.intel ?? null,
    chronicle: input.chronicle,
  };
}

/** Only agents whose real evidence rules have actually been satisfied — never a client unlock. */
export function presentAgents(agents: GoldlineAgentProjection[]): GoldlineAgentProjection[] {
  return agents.filter(agent => agent.eligible);
}
