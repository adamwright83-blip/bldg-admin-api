import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const hoisted = vi.hoisted(() => ({
  commitment: vi.fn(async (_input: { state: Record<string, unknown> }) => ({ kind: "not_applicable" as string, speak: "" })),
  followUp: vi.fn(async () => "Follow-up answer."),
}));

vi.mock("./preDriveRuntime", () => ({
  previewClairePreDrive: async () => ({
    brief: "Two stops today.",
    workday: null,
    relationshipDimensions: null,
    disclosureTier: null,
  }),
}));
vi.mock("./contextAssembler", () => ({
  assembleClaireDriveContext: async () => ({
    phase: "pre_drive",
    generatedAt: "2026-09-15T02:00:00.000Z",
    businessDate: "2026-09-14",
    actorId: "operator-1",
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment: null,
    blockers: [],
    relevantTimeline: [],
    mission: null,
  }),
}));
vi.mock("./voiceCommitmentLoop", async importOriginal => ({
  ...(await importOriginal<typeof import("./voiceCommitmentLoop")>()),
  handleVoiceCommitmentTurn: hoisted.commitment,
}));
vi.mock("./preDriveConversation", async importOriginal => ({
  ...(await importOriginal<typeof import("./preDriveConversation")>()),
  answerClairePreDriveFollowUp: hoisted.followUp,
}));
vi.mock("../analytics/businessQuery", async importOriginal => {
  const actual = await importOriginal<typeof import("../analytics/businessQuery")>();
  const fixture = await import("../analytics/businessLedgerFixture");
  const ledger = await import("../analytics/paidOrderLedger");
  return {
    ...actual,
    runBusinessQuery: (tenantId: string, query: Parameters<typeof actual.runBusinessQuery>[1]) =>
      actual.runBusinessQuery(tenantId, query, {
        loadLedger: input => ledger.loadPaidOrderLedger(input, fixture.fixtureLoaders()),
        loadOpenOrders: async () => ({ openTotal: 0, byStatus: {}, awaitingPayment: 0 }),
        loadCompleteness: async () => fixture.fixtureCompleteness,
        now: () => fixture.FIXTURE_NOW,
        timeZone: () => fixture.FIXTURE_TZ,
      }),
  };
});

import { FIXTURE_NOW } from "../analytics/businessLedgerFixture";
import { claireRouter } from "./claireRouter";

function caller(userId: number, role = "admin") {
  return claireRouter.createCaller({
    req: undefined,
    res: undefined,
    user: { id: userId, openId: `operator-${userId}`, role },
    vendorSession: null,
    tenantId: "tenant-1",
  } as unknown as TrpcContext);
}

beforeEach(() => {
  vi.useFakeTimers({ now: FIXTURE_NOW, toFake: ["Date"] });
  hoisted.commitment.mockClear();
  hoisted.followUp.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("desktop Claire business questions (V)", () => {
  it("answers from analytics and keeps the thread per desktop conversation", async () => {
    const claire = caller(101);
    const conversationId = "desk-conversation-a";
    const first = await claire.talk({ utterance: "What was revenue in the last 30 days?", conversationId });
    expect(first.reply).toContain("Paid revenue in the last 30 days is $190 across 5 orders.");
    const second = await claire.talk({ utterance: "What about the 30 before that?", conversationId });
    expect(second.reply).toContain("$95.00 across 2 orders");
    expect(hoisted.commitment).not.toHaveBeenCalled();

    const otherWindow = await claire.talk({ utterance: "Which period had more orders?", conversationId: "desk-conversation-b" });
    expect(otherWindow.reply).toBe("Which two periods do you want me to compare?");
  });

  it("the same question gives the same number on desktop and voice formatting (W)", async () => {
    const desk = await caller(102).talk({ utterance: "How many active customers do we have?", conversationId: "desk-conversation-w" });
    expect(desk.reply).toContain("that's 3 customer identities");
  });

  it("work requests and ordinary conversation are unaffected (Q, R)", async () => {
    const claire = caller(103);
    await claire.talk({ utterance: "Add reviewing revenue.", conversationId: "desk-conversation-q" });
    expect(hoisted.commitment).toHaveBeenCalledTimes(1);
    const ordinary = await claire.talk({ utterance: "Who am I meeting today?", conversationId: "desk-conversation-q" });
    expect(ordinary.reply).toBe("Follow-up answer.");
  });

  it("a pending confirmation survives a business question, and yes still confirms it (T)", async () => {
    const claire = caller(104);
    hoisted.commitment.mockImplementationOnce(async input => {
      input.state.pendingProposal = { title: "Review revenue", sourceText: "Add reviewing revenue." };
      return { kind: "proposed", speak: "Should I add that to today's plan? Say yes or no." };
    });
    await claire.talk({ utterance: "Add reviewing revenue.", conversationId: "desk-conversation-t" });
    const answer = await claire.talk({ utterance: "What was revenue last month?", conversationId: "desk-conversation-t" });
    expect(answer.reply).toContain("last month");
    expect(answer.reply).toContain('still holding "Review revenue"');
    expect(hoisted.commitment).toHaveBeenCalledTimes(1);
    await claire.talk({ utterance: "Yes.", conversationId: "desk-conversation-t" });
    expect(hoisted.commitment).toHaveBeenCalledTimes(2);
  });

  it("non-admin users cannot interrogate the business through Claire (Y)", async () => {
    await expect(caller(105, "user").talk({ utterance: "What was revenue last month?" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
