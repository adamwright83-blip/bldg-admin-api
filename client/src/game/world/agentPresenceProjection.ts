import type { GoldlineProgressionProjection } from "../../../../shared/goldlineProgression";
import type { AgentWorldPresence } from "./PopulationSystem";

/**
 * Physical stations are a view of server-projected capability. Candidates
 * may light a station, but neither the station nor its animation can create a
 * candidate or capability.
 */
export function projectAgentWorldPresence(
  progression: GoldlineProgressionProjection | null | undefined,
  authoritativeScoutDiscoveryCount: number
): AgentWorldPresence[] {
  const candidates = progression?.missionCandidates ?? [];
  return (progression?.agents ?? [])
    .filter(agent => agent.eligible)
    .map(agent => ({
      agentId: agent.agentId,
      hasAuthoritativeSignal:
        candidates.some(candidate => candidate.agentId === agent.agentId) ||
        (agent.agentId === "SCOUT" && authoritativeScoutDiscoveryCount > 0),
    }));
}
