import { describe, expect, it } from "vitest";
import type { GoldlineProgressionProjection } from "../../../../shared/goldlineProgression";
import { projectAgentWorldPresence } from "./agentPresenceProjection";

function projection(): GoldlineProgressionProjection {
  return {
    ruleVersion: 1,
    recencyDays: 90,
    tenantId: "tenant-1",
    actorId: "actor-1",
    projectedAt: "2026-08-12T00:00:00.000Z",
    unlocks: [],
    branches: [],
    techniques: [],
    agents: [
      {
        agentId: "SCOUT",
        eligible: true,
        eligibilityRule: "FIRST_CAPTURE",
        evidenceRefs: [],
        capabilities: ["SURFACE_SCOUT_DISCOVERIES"],
      },
      {
        agentId: "FOLLOW_UP",
        eligible: false,
        eligibilityRule: "FOLLOW_UP_AFTER_NO_ANSWER",
        evidenceRefs: [],
        capabilities: ["SURFACE_DUE_FOLLOW_UPS"],
      },
    ],
    missionCandidates: [],
  };
}

describe("Agent physical presence projection", () => {
  it("renders only server-eligible capabilities", () => {
    expect(projectAgentWorldPresence(projection(), 0)).toEqual([
      { agentId: "SCOUT", hasAuthoritativeSignal: false },
    ]);
  });

  it("does not fabricate a Scout signal with zero real discoveries", () => {
    expect(projectAgentWorldPresence(projection(), 0)[0]).toEqual({
      agentId: "SCOUT",
      hasAuthoritativeSignal: false,
    });
  });

  it("lights a station only from an authoritative discovery/candidate", () => {
    expect(projectAgentWorldPresence(projection(), 1)[0]).toEqual({
      agentId: "SCOUT",
      hasAuthoritativeSignal: true,
    });
  });
});
