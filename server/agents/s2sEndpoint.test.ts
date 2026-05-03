import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { createAgentS2SRunToolHandler, isValidAgentSharedSecret } from "./s2sEndpoint";

function createMockResponse() {
  let statusCode = 200;
  let responseData: unknown = null;
  const res: Partial<Response> = {
    status: vi.fn((code: number) => {
      statusCode = code;
      return res as Response;
    }),
    json: vi.fn((data: unknown) => {
      responseData = data;
      return res as Response;
    }),
  };
  return { res: res as Response, getStatus: () => statusCode, getData: () => responseData };
}

describe("POST /api/agent/s2s/run-tool", () => {
  beforeEach(() => {
    process.env.ADMIN_AGENT_SHARED_SECRET = "test-agent-secret";
  });

  it("rejects missing or invalid shared secrets", async () => {
    expect(isValidAgentSharedSecret(undefined, "test-agent-secret")).toBe(false);
    expect(isValidAgentSharedSecret("wrong", "test-agent-secret")).toBe(false);

    const runTool = vi.fn();
    const handler = createAgentS2SRunToolHandler({ runTool });
    const { res, getStatus, getData } = createMockResponse();

    await handler({ headers: {}, body: {} } as Request, res);

    expect(getStatus()).toBe(401);
    expect(getData()).toMatchObject({ code: "AGENT_S2S_UNAUTHORIZED" });
    expect(runTool).not.toHaveBeenCalled();
  });

  it("rejects and logs non-allowlisted tools", async () => {
    const runTool = vi.fn();
    const logEvent = vi.fn().mockResolvedValue(1);
    const handler = createAgentS2SRunToolHandler({ runTool, logEvent });
    const { res, getStatus, getData } = createMockResponse();

    await handler({
      headers: { "x-agent-shared-secret": "test-agent-secret" },
      body: {
        toolName: "sendCustomerReminderTool",
        tenantId: "default",
        agentType: "resident_agent",
        actorType: "resident_chat",
        sessionId: "sess_1",
        conversationId: "conv_1",
        input: { orderId: 123 },
      },
    } as Request, res);

    expect(getStatus()).toBe(403);
    expect(getData()).toMatchObject({ code: "AGENT_S2S_TOOL_FORBIDDEN" });
    expect(runTool).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "sendCustomerReminderTool",
      status: "blocked",
      ctx: expect.objectContaining({ sessionId: "sess_1", conversationId: "conv_1" }),
    }));
  });

  it("runs allowlisted tools and returns tool output directly", async () => {
    const runTool = vi.fn().mockResolvedValue({ orderId: 456 });
    const handler = createAgentS2SRunToolHandler({ runTool });
    const { res, getStatus, getData } = createMockResponse();

    await handler({
      headers: { "x-agent-shared-secret": "test-agent-secret" },
      body: {
        toolName: "createLaundryOrderTool",
        tenantId: "default",
        agentType: "resident_agent",
        actorType: "resident_chat",
        actorId: "resident_1",
        sessionId: "sess_2",
        conversationId: "conv_2",
        input: {
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "+13235550123",
          serviceType: "wash_fold",
          pickupDate: "2026-05-04",
          pickupTimeWindow: "7:00am-9:00am",
          address: "10000 Santa Monica Blvd",
        },
      },
    } as Request, res);

    expect(getStatus()).toBe(200);
    expect(getData()).toEqual({ orderId: 456 });
    expect(runTool).toHaveBeenCalledWith(
      "createLaundryOrderTool",
      expect.objectContaining({ firstName: "Ada" }),
      expect.objectContaining({
        tenantId: "default",
        agentType: "resident_agent",
        actorType: "resident_chat",
        sessionId: "sess_2",
        conversationId: "conv_2",
      })
    );
  });

  it("returns a structured error when the runtime rejects a tool call", async () => {
    const runTool = vi.fn().mockRejectedValue(new Error("Database not available"));
    const handler = createAgentS2SRunToolHandler({ runTool });
    const { res, getStatus, getData } = createMockResponse();

    await handler({
      headers: { "x-agent-shared-secret": "test-agent-secret" },
      body: {
        toolName: "createLaundryOrderTool",
        tenantId: "default",
        agentType: "resident_agent",
        actorType: "resident_chat",
        input: {},
      },
    } as Request, res);

    expect(getStatus()).toBe(500);
    expect(getData()).toMatchObject({
      code: "AGENT_TOOL_FAILED",
      message: "Database not available",
    });
  });
});
