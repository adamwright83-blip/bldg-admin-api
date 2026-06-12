import { describe, expect, it } from "vitest";
import { assertToolPermission, type AgentContext } from "./permissions";
import { s2sAgentToolAllowlist } from "./s2sEndpoint";
import { getAgentTool } from "./toolRegistry";

const TOOL = "createOrderFollowupTaskTool";

// The resident post-order follow-up must clear ALL THREE admin gates, or the
// horse would never become real (S2S allowlist passes but the tool throws):
//   1) registry  — getAgentTool resolves it
//   2) S2S allowlist — resident may invoke it over the shared-secret channel
//   3) permission — resident_agent context is allowed to run it
describe(`${TOOL} — resident_agent end-to-end gating`, () => {
  const residentCtx: AgentContext = {
    tenantId: "default",
    agentType: "resident_agent",
    actorType: "resident_chat",
  };

  it("is registered in the tool registry", () => {
    expect(getAgentTool(TOOL).name).toBe(TOOL);
  });

  it("is allowlisted for S2S agent calls", () => {
    expect(s2sAgentToolAllowlist.has(TOOL)).toBe(true);
  });

  it("is permitted for a resident_agent context (assertToolPermission does not throw)", () => {
    expect(() => assertToolPermission(residentCtx, TOOL)).not.toThrow();
  });

  it("still blocks a tool the resident_agent is not allowed to run", () => {
    expect(() => assertToolPermission(residentCtx, "deleteOrderTool")).toThrow(
      /not allowed to run/,
    );
  });
});
