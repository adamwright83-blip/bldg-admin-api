import { beforeEach, describe, expect, it, vi } from "vitest";

const apply = vi.hoisted(() => vi.fn());

vi.mock("../../claire/operatorArtifactDecision", () => ({
  applyOperatorArtifactDecision: apply,
}));

import { sendOperatorArtifactTool } from "./sendOperatorArtifactTool";

describe("sendOperatorArtifactTool execution lineage", () => {
  beforeEach(() => {
    apply.mockReset();
    apply.mockResolvedValue({
      applied: true,
      action: "send_operator_artifact",
      result: {
        providerAccepted: true,
        delivered: false,
        resolvedTo: "+13105550001",
        messageSid: "SM_1",
        providerStatus: "queued",
        receipt: { id: "receipt-1" },
        receiptDuplicate: false,
        evidence: [],
      },
    });
  });

  it("requires durable decision lineage for persistent operator sends", async () => {
    await expect(
      sendOperatorArtifactTool.execute(
        { artifact: { kind: "plain_text", text: "hello" } },
        {
          tenantId: "tenant-a",
          agentType: "goal_cycle_agent",
          actorType: "system",
          actorId: "operator-1",
          decisionId: null,
        }
      )
    ).rejects.toThrow("require durable decision lineage");

    expect(apply).not.toHaveBeenCalled();
  });

  it("passes the persistent decision id into the provider send seam", async () => {
    await sendOperatorArtifactTool.execute(
      { artifact: { kind: "plain_text", text: "hello" } },
      {
        tenantId: "tenant-a",
        agentType: "goal_cycle_agent",
        actorType: "system",
        actorId: "operator-1",
        decisionId: "decision-1",
        agentEventId: 88,
      }
    );

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        operatorUserId: "operator-1",
        decisionId: "decision-1",
        agentEventId: 88,
      })
    );
  });

  it("does not require decision lineage for a direct operator voice send", async () => {
    await sendOperatorArtifactTool.execute(
      { artifact: { kind: "plain_text", text: "hello" } },
      {
        tenantId: "tenant-a",
        agentType: "operator_voice_agent",
        actorType: "voice",
        actorId: "operator-1",
      }
    );

    expect(apply).toHaveBeenCalledTimes(1);
  });
});
