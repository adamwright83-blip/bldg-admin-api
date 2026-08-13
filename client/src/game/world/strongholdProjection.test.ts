import { describe, expect, it } from "vitest";
import { presentAgents, projectStronghold } from "./strongholdProjection";
import type { GoldlineAgentProjection } from "../../../../shared/goldlineProgression";

function agent(overrides: Partial<GoldlineAgentProjection> = {}): GoldlineAgentProjection {
  return {
    agentId: "SCOUT_AGENT",
    eligible: false,
    eligibilityRule: "INTEL_MINIMUM_EVIDENCE",
    evidenceRefs: [],
    capabilities: [],
    ...overrides,
  };
}

describe("projectStronghold", () => {
  it("passes through the real route table, agents, and chronicle with no transformation of truth", () => {
    const stronghold = projectStronghold({
      routeTable: [],
      agents: [agent()],
      chronicle: [],
    });
    expect(stronghold.agents).toHaveLength(1);
  });

  it("intel defaults to null rather than an invented empty summary object with fake zeros presented as real", () => {
    const stronghold = projectStronghold({ routeTable: [], agents: [], chronicle: [] });
    expect(stronghold.intel).toBeNull();
  });

  it("contains no Field Kit / inventory field anywhere in its shape", () => {
    const stronghold = projectStronghold({ routeTable: [], agents: [], chronicle: [] });
    expect(stronghold).not.toHaveProperty("fieldKit");
    expect(stronghold).not.toHaveProperty("inventory");
  });
});

describe("presentAgents", () => {
  it("shows only agents whose real evidence rule is actually satisfied", () => {
    const agents = [agent({ agentId: "SCOUT_AGENT", eligible: true }), agent({ agentId: "RECOVERY_AGENT", eligible: false })];
    expect(presentAgents(agents).map(a => a.agentId)).toEqual(["SCOUT_AGENT"]);
  });

  it("never unlocks an agent client-side — filtering only reads the eligible flag, never sets it", () => {
    expect(presentAgents([agent({ eligible: false })])).toEqual([]);
  });
});
