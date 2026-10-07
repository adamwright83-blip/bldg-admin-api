import { beforeEach, describe, expect, it, vi } from "vitest";

const commitMocks = vi.hoisted(() => ({
  commitBriefing: vi.fn(),
  loadExistingWork: vi.fn(),
  reconcileBriefing: vi.fn(),
  speakBriefingCommit: vi.fn(),
}));

vi.mock("../../briefing/briefingCommit", () => commitMocks);

import { mintActionGrant } from "../executive/grants";
import {
  brainV2CallControlResult,
  brainV2ExecutionFailureResult,
  executeGrantBoundLegacyAdapter,
} from "../live/grantBoundLegacyAdapter";

function grant(input: {
  actionClass: "propose_day_line" | "commit_day_line" | "commit_briefing" | "cancel_pending";
  text: string;
  titles?: string[];
  identity?: string;
}) {
  return mintActionGrant({
    actionClass: input.actionClass,
    scope: {
      ...(input.titles ? { titles: input.titles } : {}),
      ...(input.identity ? { identity: input.identity } : {}),
    },
    authorityBasis:
      input.actionClass === "commit_briefing"
        ? "pending_lifecycle"
        : "current_turn_explicit_request",
    sourceTurnAssembledText: input.text,
    expiresAtMs: Date.now() + 60_000,
    constraints: { mutationAllowed: true, shadowOnly: false },
  });
}

const common = {
  tenantId: "tenant-a",
  operatorUserId: "operator-a",
  dayDirectorActorId: "42",
  conversationKey: "call-a",
  timeZone: "America/Los_Angeles",
  surface: "voice" as const,
  now: new Date("2026-10-06T17:00:00.000Z"),
};

describe("Brain V2 grant-bound legacy adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitMocks.loadExistingWork.mockResolvedValue([]);
    commitMocks.reconcileBriefing.mockImplementation(parsed => parsed);
    commitMocks.speakBriefingCommit.mockReturnValue("Done. 1 on today's line.");
    commitMocks.commitBriefing.mockResolvedValue({
      added: [],
      completed: [],
      failed: [],
      commitmentIds: ["commit-1"],
      receipts: [
        {
          claimedState: "created",
          entityId: "commit-1",
          statement: "Added Call Dana to the Day Line",
        },
      ],
    });
  });

  it("proposes only the work named by the V2 grant and performs no durable write", async () => {
    const state: any = {};
    const result = await executeGrantBoundLegacyAdapter({
      ...common,
      state,
      grant: grant({
        actionClass: "propose_day_line",
        text: "I need to call Dana Tuesday.",
        titles: ["Call Dana Tuesday"],
      }),
    });

    expect(result.kind).toBe("briefing_proposed");
    expect(state.pendingBriefing?.parsed?.items).toHaveLength(1);
    expect(state.pendingBriefing.parsed.items[0].title).toMatch(/call dana/i);
    expect(commitMocks.commitBriefing).not.toHaveBeenCalled();
  });

  it("commits the bounded V2 Day Line scope through the canonical briefing writer", async () => {
    const state: any = {};
    const result = await executeGrantBoundLegacyAdapter({
      ...common,
      state,
      grant: grant({
        actionClass: "commit_day_line",
        text: "Add call Dana Tuesday to the Day Line.",
        titles: ["Call Dana Tuesday"],
      }),
    });

    expect(commitMocks.commitBriefing).toHaveBeenCalledTimes(1);
    const parsed = commitMocks.commitBriefing.mock.calls[0]![0];
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].title).toMatch(/call dana/i);
    expect(result.actionIds).toEqual(["commit-1"]);
    expect(result.mutationReceipts).toHaveLength(1);
  });

  it("commits the existing pending briefing without reinterpreting a bare yes", async () => {
    const pending = {
      items: [
        {
          kind: "new_work",
          title: "Call Dana",
          quote: "Call Dana",
          businessDate: "2026-10-06",
          timing: { kind: "none" },
          quantity: null,
          people: ["Dana"],
          place: null,
          needs: null,
          existing: null,
        },
      ],
      context: [],
      questions: [],
      unparsed: [],
      source: "deterministic",
    };
    const state: any = { pendingBriefing: { parsed: pending, createdAt: 1 } };

    const result = await executeGrantBoundLegacyAdapter({
      ...common,
      state,
      grant: grant({
        actionClass: "commit_briefing",
        text: "Yes.",
        identity: "pending-briefing",
      }),
    });

    expect(commitMocks.commitBriefing.mock.calls[0]![0]).toEqual(pending);
    expect(result.kind).toBe("briefing_saved");
    expect(state.pendingBriefing).toBeNull();
  });

  it("refuses an unsupported V2 action class instead of letting V1 choose another mutation", async () => {
    await expect(
      executeGrantBoundLegacyAdapter({
        ...common,
        state: {} as any,
        grant: grant({
          actionClass: "cancel_pending",
          text: "Cancel that.",
        }),
      })
    ).rejects.toThrow(/refuses unsupported action class/i);
    expect(commitMocks.commitBriefing).not.toHaveBeenCalled();
  });

  it("uses indeterminate speech after a grant execution error and never claims nothing changed", () => {
    const result = brainV2ExecutionFailureResult({
      assembledUtterance: "Add call Dana Tuesday to the Day Line.",
    });
    expect(result).toMatchObject({
      kind: "answered",
      actionIds: [],
      assembledUtterance: "Add call Dana Tuesday to the Day Line.",
    });
    expect(result.speak).toMatch(/couldn't verify/i);
    expect(result.speak).toMatch(/won't retry/i);
    expect(result.speak).not.toMatch(/\bdone\b|\bsaved\b|nothing changed/i);
  });

  it("renders V2 call control without invoking any business mutation adapter", () => {
    expect(
      brainV2CallControlResult({
        candidateSpeak: "",
        assembledUtterance: "I gotta go.",
      })
    ).toMatchObject({
      speak: "All right.",
      kind: "answered",
      endCall: true,
      endCallReason: "brain_v2_call_control",
      actionIds: [],
    });
    expect(commitMocks.commitBriefing).not.toHaveBeenCalled();
  });
});
