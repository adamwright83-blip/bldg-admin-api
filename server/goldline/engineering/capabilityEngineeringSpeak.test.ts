import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  findOpenCapabilityGap: vi.fn(async () => null as unknown),
  getCapabilityGap: vi.fn(),
  insertCapabilityGap: vi.fn(async () => ({ unavailable: true, reason: "database_unavailable" }) as unknown),
  updateCapabilityGap: vi.fn(async () => null),
  config: vi.fn(() => ({ missing: ["ENGINEERING_AGENT_URL"] }) as unknown),
}));

vi.mock("./capabilityGapStore", () => ({
  findOpenCapabilityGap: store.findOpenCapabilityGap,
  getCapabilityGap: store.getCapabilityGap,
  insertCapabilityGap: store.insertCapabilityGap,
  updateCapabilityGap: store.updateCapabilityGap,
}));
vi.mock("./agentsClient", () => ({
  buildCapabilityEngineeringPrompt: vi.fn(() => "prompt"),
  capabilityEngineeringConfig: store.config,
  continueCapabilityBuilderSession: vi.fn(),
  createCapabilityBuilderSession: vi.fn(async () => {
    throw new Error("agent unreachable");
  }),
  extractTerminalFromAgentEvents: vi.fn(() => null),
}));
vi.mock("../../claire/conversation/ledgerService", () => ({
  productionConversationStore: () => ({ insertNotification: vi.fn(async () => ({})) }),
}));

import { approveCapabilityEngineering } from "./capabilityEngineeringService";

const request = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  capabilityKey: "dayline.teleport",
  operatorRequest: "Teleport the Maybourne stop to Friday",
};

const GAP = { id: "gap-1", tenantId: "default", operatorUserId: "adam-admin", capabilityKey: "dayline.teleport", status: "IDENTIFIED" };

beforeEach(() => {
  store.findOpenCapabilityGap.mockResolvedValue(null);
  store.insertCapabilityGap.mockResolvedValue({ unavailable: true, reason: "database_unavailable" });
  store.config.mockReturnValue({ missing: ["ENGINEERING_AGENT_URL"] });
});

describe("Claire speaks the engineering request's real state", () => {
  it("never says 'Sent' when the request could not be saved", async () => {
    const result = await approveCapabilityEngineering(request);
    expect(result.gap).toBeNull();
    expect(result.speak).not.toMatch(/\bSent\b/);
    expect(result.speak).toContain("nothing was sent");
  });

  it("says the request is waiting when engineering isn't configured", async () => {
    store.insertCapabilityGap.mockResolvedValue(GAP);
    const result = await approveCapabilityEngineering(request);
    expect(result.speak).toBe("I saved the request, but engineering can't start until it's configured, so it's waiting.");
  });

  it("says blocked, not sent, when engineering could not start", async () => {
    store.insertCapabilityGap.mockResolvedValue(GAP);
    store.config.mockReturnValue({ url: "https://agents.example.test", token: "t" });
    const result = await approveCapabilityEngineering(request);
    expect(result.speak).toBe("I saved the request, but engineering couldn't start, so it's blocked for now.");
  });
});
