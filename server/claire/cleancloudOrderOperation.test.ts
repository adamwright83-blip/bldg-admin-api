/**
 * Claire queues CleanCloud intake only after an exact approval.
 * Disposable MySQL cases live in cleancloudOrderOperation.mysql.integration.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertToolPermission, type AgentContext } from "../agents/permissions";
import { s2sAgentToolAllowlist } from "../agents/s2sEndpoint";

describe("CleanCloud order operation stays off the provider", () => {
  it("does not import a CleanCloud login, SMS, or charge client", () => {
    const source = readFileSync(new URL("./cleancloudOrderOperation.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/loginCleanCloud|cleancloudapp\.com|twilio|stripe/i);
    expect(source).toContain("commandIntake");
  });

  it("keeps the commit tool off the resident S2S allowlist", () => {
    expect(s2sAgentToolAllowlist.has("commitCleanCloudOrderOperationTool")).toBe(false);
    expect(s2sAgentToolAllowlist.has("proposeCleanCloudOrderOperationTool")).toBe(false);
    const resident: AgentContext = {
      tenantId: "tenant",
      agentType: "resident_agent",
      actorType: "resident_chat",
    };
    expect(() => assertToolPermission(resident, "commitCleanCloudOrderOperationTool")).toThrow(
      /not allowed/
    );
  });
});
