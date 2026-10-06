import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getResidentAgentPlan: vi.fn(),
  updateResidentAgentPlan: vi.fn(),
}));

vi.mock("../../db", () => ({
  getResidentAgentPlan: db.getResidentAgentPlan,
  updateResidentAgentPlan: db.updateResidentAgentPlan,
}));

import { updateResidentAgentPlanTool } from "./updateResidentAgentPlanTool";

const ctx = {
  tenantId: "tenant-a",
  agentType: "resident_agent" as const,
  actorType: "resident_chat" as const,
  actorId: "resident-session-user",
  conversationId: "conversation-a",
  sessionId: "session-a",
};

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 15,
    tenantId: "tenant-a",
    bldgUserId: 7001,
    conversationId: "conversation-a",
    sessionId: "session-a",
    planStatus: "pending_confirmation",
    planJson: { step: 1 },
    ...overrides,
  };
}

describe("updateResidentAgentPlanTool authority boundary", () => {
  beforeEach(() => {
    db.getResidentAgentPlan.mockReset();
    db.updateResidentAgentPlan.mockReset();
    db.updateResidentAgentPlan.mockResolvedValue(undefined);
  });

  it("rejects a non-resident action principal before reading the plan", async () => {
    await expect(
      updateResidentAgentPlanTool.execute(
        { planId: 15, planStatus: "completed" },
        { ...ctx, actorType: "human" as const }
      )
    ).rejects.toThrow("resident action authority");

    expect(db.getResidentAgentPlan).not.toHaveBeenCalled();
    expect(db.updateResidentAgentPlan).not.toHaveBeenCalled();
  });

  it("rejects an explicit resident id conflict even when session lineage matches", async () => {
    db.getResidentAgentPlan.mockResolvedValue(plan());

    await expect(
      updateResidentAgentPlanTool.execute(
        { planId: 15, bldgUserId: 8002, planStatus: "completed" },
        ctx
      )
    ).rejects.toThrow("does not belong to resident");

    expect(db.updateResidentAgentPlan).not.toHaveBeenCalled();
  });

  it("rejects a same-tenant plan with no matching resident or session lineage", async () => {
    db.getResidentAgentPlan.mockResolvedValue(
      plan({
        bldgUserId: 7001,
        conversationId: "conversation-other",
        sessionId: "session-other",
      })
    );

    await expect(
      updateResidentAgentPlanTool.execute(
        { planId: 15, planStatus: "completed" },
        ctx
      )
    ).rejects.toThrow("lacks resident ownership evidence");

    expect(db.updateResidentAgentPlan).not.toHaveBeenCalled();
  });

  it("allows exact resident ownership even when conversation lineage is unavailable", async () => {
    db.getResidentAgentPlan.mockResolvedValue(
      plan({ conversationId: null, sessionId: null })
    );

    const result = await updateResidentAgentPlanTool.execute(
      { planId: 15, bldgUserId: 7001, planStatus: "completed" },
      { ...ctx, conversationId: null, sessionId: null }
    );

    expect(db.updateResidentAgentPlan).toHaveBeenCalledWith("tenant-a", 15, {
      planStatus: "completed",
      planJson: { step: 1 },
    });
    expect(result.output).toEqual({ planId: 15, planStatus: "completed" });
  });

  it("allows the persisted conversation lineage when the caller does not repeat bldgUserId", async () => {
    db.getResidentAgentPlan.mockResolvedValue(plan());

    await updateResidentAgentPlanTool.execute(
      { planId: 15, planStatus: "partially_confirmed" },
      ctx
    );

    expect(db.updateResidentAgentPlan).toHaveBeenCalledWith("tenant-a", 15, {
      planStatus: "partially_confirmed",
      planJson: { step: 1 },
    });
  });

  it("allows the persisted session lineage for plans without a stored resident id", async () => {
    db.getResidentAgentPlan.mockResolvedValue(
      plan({ bldgUserId: null, conversationId: null })
    );

    await updateResidentAgentPlanTool.execute(
      { planId: 15, planStatus: "failed" },
      ctx
    );

    expect(db.updateResidentAgentPlan).toHaveBeenCalledTimes(1);
  });

  it("keeps the tenant scope on both read and write", async () => {
    db.getResidentAgentPlan.mockResolvedValue(plan());

    await updateResidentAgentPlanTool.execute(
      { planId: 15, bldgUserId: 7001, planStatus: "cancelled" },
      ctx
    );

    expect(db.getResidentAgentPlan).toHaveBeenCalledWith("tenant-a", 15);
    expect(db.updateResidentAgentPlan).toHaveBeenCalledWith(
      "tenant-a",
      15,
      expect.objectContaining({ planStatus: "cancelled" })
    );
  });
});
