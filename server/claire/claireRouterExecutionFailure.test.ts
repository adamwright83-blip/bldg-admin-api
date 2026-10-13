import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import type { ClaireTurnResult } from "./turn/claireTurn";

const hoisted = vi.hoisted(() => ({
  runClaireTurn: vi.fn(async (): Promise<ClaireTurnResult> => ({
    speak: "V1 legacy turn response",
    kind: "answered",
    assembledUtterance: "V1 utterance",
    thoughtCompleteness: "complete",
    actionIds: ["legacy-action-id"],
  })),
  runClaireBrainV2LiveTurn: vi.fn(),
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
    businessDate: "2026-09-15",
    actorId: "operator-1",
    truthLaw: "game_projection_never_creates_business_truth",
    nextFixedCommitment: null,
    blockers: [],
    relevantTimeline: [],
    mission: null,
  }),
}));

vi.mock("./turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("./turn/claireTurn")>();
  return {
    ...actual,
    runClaireTurn: hoisted.runClaireTurn,
  };
});

vi.mock("./brain/live/runClaireBrainV2LiveTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("./brain/live/runClaireBrainV2LiveTurn")>();
  return {
    ...actual,
    runClaireBrainV2LiveTurn: hoisted.runClaireBrainV2LiveTurn,
  };
});

import { claireRouter } from "./claireRouter";

function caller(openId = "adam-admin", role = "admin") {
  return claireRouter.createCaller({
    req: undefined,
    res: undefined,
    user: { id: 1, openId, role },
    vendorSession: null,
    tenantId: "default",
  } as unknown as TrpcContext);
}

describe("Desktop router Brain V2 fail-closed execution authority", () => {
  beforeEach(() => {
    hoisted.runClaireTurn.mockClear();
    hoisted.runClaireBrainV2LiveTurn.mockReset();
  });

  it("fails closed on Brain V2 execution_error and strictly blocks V1 legacy execution", async () => {
    // Brain V2 attempted grant-bound execution and failed
    hoisted.runClaireBrainV2LiveTurn.mockResolvedValue({
      active: false,
      reason: "execution_error",
    });

    const claire = caller("adam-admin");
    const utterance = "Add call Dana Tuesday to the Day Line.";
    const result = await claire.talk({
      utterance,
      conversationId: "desk-exec-failure-test",
    });

    // 1. Proves V1 legacy adapter was NOT called
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();

    // 2. Truthful speech confirms verification failure without false promises
    expect(result.reply).toBe(
      "I couldn't verify that action completed, so I won't retry it through another path."
    );

    // 3. Authority flag indicates Brain V2 handled the turn (did not silently fail back to V1)
    expect(result.brainV2LiveHandled).toBe(true);
    expect(result.actionIds).toEqual([]);
    expect(result.receiptBackedCommit).toBeUndefined();
  });

  it("preserves normal V1 fallback when Brain V2 is outside live scope", async () => {
    hoisted.runClaireBrainV2LiveTurn.mockResolvedValue({
      active: false,
      reason: "outside_live_scope",
    });

    const claire = caller("adam-admin");
    const result = await claire.talk({
      utterance: "Good morning.",
      conversationId: "desk-fallback-scope-test",
    });

    // V1 legacy adapter is invoked for unsupported/outside-scope requests
    expect(hoisted.runClaireTurn).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("V1 legacy turn response");
    expect(result.brainV2LiveHandled).toBe(false);
  });

  it("preserves normal V1 fallback when Brain V2 is disabled", async () => {
    hoisted.runClaireBrainV2LiveTurn.mockResolvedValue({
      active: false,
      reason: "disabled",
    });

    const claire = caller("adam-admin");
    const result = await claire.talk({
      utterance: "Good morning.",
      conversationId: "desk-fallback-disabled-test",
    });

    expect(hoisted.runClaireTurn).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("V1 legacy turn response");
    expect(result.brainV2LiveHandled).toBe(false);
  });

  it("preserves normal V1 fallback when operator is not authorized for Brain V2", async () => {
    hoisted.runClaireBrainV2LiveTurn.mockResolvedValue({
      active: false,
      reason: "operator_not_authorized",
    });

    const claire = caller("other-operator");
    const result = await claire.talk({
      utterance: "Good morning.",
      conversationId: "desk-fallback-unauth-test",
    });

    expect(hoisted.runClaireTurn).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("V1 legacy turn response");
    expect(result.brainV2LiveHandled).toBe(false);
  });

  it("returns V2 adapter result when Brain V2 executes successfully", async () => {
    hoisted.runClaireBrainV2LiveTurn.mockResolvedValue({
      active: true,
      result: { candidateSpeak: "Done. Added Dana on Tuesday." },
      adapterResult: {
        speak: "Done. Added Dana on Tuesday.",
        kind: "briefing_saved",
        actionIds: ["receipt-123"],
        receiptBackedCommit: "Done. Added Dana on Tuesday.",
        mutationReceipts: [{ entityType: "task", entityId: "task-1" }],
        thoughtCompleteness: "complete",
        assembledUtterance: "Add call Dana Tuesday",
      },
      actionClasses: ["commit_day_line"],
      handled: true,
    });

    const claire = caller("adam-admin");
    const result = await claire.talk({
      utterance: "Add call Dana Tuesday to the Day Line.",
      conversationId: "desk-success-test",
    });

    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
    expect(result.reply).toBe("Done. Added Dana on Tuesday.");
    expect(result.brainV2LiveHandled).toBe(true);
    expect(result.actionIds).toEqual(["receipt-123"]);
    expect(result.receiptBackedCommit).toBe("Done. Added Dana on Tuesday.");
  });
});
