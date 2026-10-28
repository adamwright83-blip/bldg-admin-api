import { describe, expect, it, vi } from "vitest";
import type {
  OperatorArtifactDecision,
  OperatorArtifactDecisionResult,
} from "./operatorArtifactDecision";
import {
  OPERATOR_DRAFT_FAILED_SPEAK,
  OPERATOR_DRAFT_SENT_SPEAK,
  OPERATOR_DRAFT_UNAVAILABLE_SPEAK,
  OPERATOR_DRAFT_UNGROUNDED_SPEAK,
  appendOperatorDraftVoiceHistory,
  executeDraftAndTextMeRequest,
  isDraftAndTextMeRequest,
} from "./operatorDraftVoice";
import {
  isStandaloneOperatorArtifactVoiceRequest,
  latestClaireArtifactText,
} from "./operatorArtifactVoice";

const history = [
  {
    speaker: "claire" as const,
    text: "One thing tonight: The Louise. The follow-up to Dana has been overdue since August 7. Send Dana a short email.",
    at: 1,
  },
  { speaker: "operator" as const, text: "Yeah.", at: 2 },
];

function accepted(): OperatorArtifactDecisionResult {
  return {
    applied: true,
    action: "send_operator_artifact",
    result: {
      providerAccepted: true,
      delivered: false,
      resolvedTo: "+13105550100",
      messageSid: "SM_test",
      providerStatus: "accepted",
      receipt: null,
      receiptDuplicate: false,
      evidence: [],
    },
  };
}

describe("draft-and-text-me request (2026-10-27 evening call)", () => {
  it.each([
    "Yeah. Drop the Dana email and send me a text with it.",
    "Draft the Dana email and send me a text with it.",
    "Draft the Dana email and text it to me.",
    "Can you write the follow-up to Dana and text me?",
    "Write up a note to the Louise manager and send it to my phone.",
    "Text me the draft.",
    "Send me the email for Dana.",
    "Claire, put together a reply to Dana and shoot me a text.",
  ])("recognizes: %s", text => {
    expect(isDraftAndTextMeRequest(text)).toBe(true);
    // It is not the resend lane; that one only repeats what Claire already said.
    expect(isStandaloneOperatorArtifactVoiceRequest(text)).toBe(false);
  });

  it.each([
    "I need to text Dana tomorrow.",
    "Text me that.",
    "Send Dana an email.",
    "What's the address?",
    "I'll email Dana in the morning.",
  ])("does not take the operator's own work or the resend lane: %s", text => {
    expect(isDraftAndTextMeRequest(text)).toBe(false);
  });

  it("drafts from the call, texts the operator, and says one short line", async () => {
    const applyDecision = vi.fn(async (_decision: OperatorArtifactDecision) =>
      accepted()
    );
    const compose = vi.fn(
      async () =>
        "Subject: Following up\n\nHi Dana, following up on our August conversation about The Louise. Could we find 15 minutes this week?\n\nThanks,\nAdam"
    );
    const outcome = await executeDraftAndTextMeRequest(
      {
        tenantId: "laundry_farm",
        operatorUserId: "adam-admin",
        utterance: "Drop the Dana email and send me a text with it.",
        history,
      },
      { applyDecision, compose, composerAvailable: () => true }
    );
    expect(outcome).not.toBeNull();
    expect(outcome!.speak).toBe(OPERATOR_DRAFT_SENT_SPEAK);
    expect(outcome!.providerAccepted).toBe(true);
    expect(compose).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "laundry_farm", history })
    );
    const decision = applyDecision.mock.calls[0]![0];
    expect(decision.action).toBe("send_operator_artifact");
    if (decision.action === "send_operator_artifact") {
      expect(decision.artifact).toEqual({
        kind: "plain_text",
        text: expect.stringContaining("Hi Dana"),
      });
      expect(decision.operatorUserId).toBe("adam-admin");
      expect("to" in decision).toBe(false);
    }
    expect(outcome!.speak).not.toMatch(/\?/);
  });

  it("asks one question when the call does not say who or what, and sends nothing", async () => {
    const applyDecision = vi.fn(async () => accepted());
    const outcome = await executeDraftAndTextMeRequest(
      {
        tenantId: "t",
        operatorUserId: "o",
        utterance: "Draft the email and text it to me.",
        history: [],
      },
      {
        applyDecision,
        compose: async () => null,
        composerAvailable: () => true,
      }
    );
    expect(outcome!.speak).toBe(OPERATOR_DRAFT_UNGROUNDED_SPEAK);
    expect(applyDecision).not.toHaveBeenCalled();
  });

  it("never claims a send the port did not accept, and keeps the draft for a resend", async () => {
    const applyDecision = vi.fn(async () => {
      throw new Error("twilio down");
    });
    const outcome = await executeDraftAndTextMeRequest(
      {
        tenantId: "t",
        operatorUserId: "o",
        utterance: "Draft the Dana email and text it to me.",
        history,
      },
      {
        applyDecision,
        compose: async () => "Hi Dana, quick follow-up on The Louise.",
        composerAvailable: () => true,
      }
    );
    expect(outcome!.speak).toBe(OPERATOR_DRAFT_FAILED_SPEAK);
    expect(outcome!.providerAccepted).toBe(false);
    const next = appendOperatorDraftVoiceHistory(history, {
      operatorText: "Draft the Dana email and text it to me.",
      outcome: outcome!,
      at: 3,
    });
    // "Text me that" a moment later resends the draft, not the failure line.
    expect(latestClaireArtifactText(next)).toBe(
      "Hi Dana, quick follow-up on The Louise."
    );
  });

  it("says so when no composer is available", async () => {
    const outcome = await executeDraftAndTextMeRequest(
      {
        tenantId: "t",
        operatorUserId: "o",
        utterance: "Draft the Dana email and text it to me.",
        history,
      },
      {
        applyDecision: vi.fn(async () => accepted()),
        composerAvailable: () => false,
      }
    );
    expect(outcome!.speak).toBe(OPERATOR_DRAFT_UNAVAILABLE_SPEAK);
  });

  it("returns null for anything else so the next lane runs", async () => {
    const outcome = await executeDraftAndTextMeRequest(
      {
        tenantId: "t",
        operatorUserId: "o",
        utterance: "How did the Opus drop go?",
        history,
      },
      {
        applyDecision: vi.fn(async () => accepted()),
        composerAvailable: () => true,
      }
    );
    expect(outcome).toBeNull();
  });

  it("keeps the draft after a successful send so 'text me that' resends the draft", async () => {
    const outcome = await executeDraftAndTextMeRequest(
      {
        tenantId: "t",
        operatorUserId: "o",
        utterance: "Draft the Dana email and text it to me.",
        history,
      },
      {
        applyDecision: vi.fn(async () => accepted()),
        compose: async () => "Hi Dana, quick follow-up on The Louise.",
        composerAvailable: () => true,
      }
    );
    expect(outcome!.providerAccepted).toBe(true);
    const next = appendOperatorDraftVoiceHistory(history, {
      operatorText: "Draft the Dana email and text it to me.",
      outcome: outcome!,
      at: 3,
    });
    expect(next.at(-1)?.text).toBe(OPERATOR_DRAFT_SENT_SPEAK);
    expect(latestClaireArtifactText(next)).toBe(
      "Hi Dana, quick follow-up on The Louise."
    );
  });
});
