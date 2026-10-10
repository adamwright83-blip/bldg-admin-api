import { describe, expect, it, vi } from "vitest";
import type {
  OperatorArtifactDecision,
  OperatorArtifactDecisionResult,
} from "./operatorArtifactDecision";
import {
  OPERATOR_ARTIFACT_DAYLINE_NO_SOURCE_SPEAK,
  OPERATOR_ARTIFACT_FAILED_SPEAK,
  OPERATOR_ARTIFACT_NO_SOURCE_SPEAK,
  OPERATOR_ARTIFACT_SENT_SPEAK,
  OPERATOR_ARTIFACT_SMS_MAX_TEXT,
  OPERATOR_ARTIFACT_TOO_LONG_SPEAK,
  appendOperatorArtifactVoiceHistory,
  executeStandaloneOperatorArtifactVoiceRequest,
  isStandaloneOperatorArtifactVoiceRequest,
  latestClaireArtifactText,
  parseOperatorArtifactVoiceRequest,
  renderDaylineOperatorArtifact,
} from "./operatorArtifactVoice";

const history = [
  {
    speaker: "operator" as const,
    text: "What's the address?",
    at: 1,
  },
  {
    speaker: "claire" as const,
    text: "The Louise is at 1633 N Edgemont Street.",
    at: 2,
  },
];

function acceptedResult(): OperatorArtifactDecisionResult {
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

describe("operator artifact voice request", () => {
  it.each([
    "Claire, text me that.",
    "text me that address",
    "Can you send me the address?",
    "please send that to my phone",
    "could you text that to me",
    "send me the link",
  ])("recognizes standalone referential send request: %s", utterance => {
    expect(isStandaloneOperatorArtifactVoiceRequest(utterance)).toBe(true);
  });

  it.each([
    "I need to text Dana tomorrow",
    "text Dana tomorrow",
    "don't text me that",
    "what's Dana's address? text me that",
    "send a customer a reminder",
    "can you text Russell for me",
  ])("does not hijack other work or mixed turns: %s", utterance => {
    expect(isStandaloneOperatorArtifactVoiceRequest(utterance)).toBe(false);
  });

  it.each([
    "text me my Dayline schedule",
    "Claire, send me today's Day Line",
    "Can you text me my schedule for today?",
    "send today's plan to my phone",
    "Can you send me a text with my day line schedule today?",
  ])("recognizes a named Dayline artifact request: %s", utterance => {
    expect(parseOperatorArtifactVoiceRequest(utterance)).toEqual({ kind: "dayline" });
  });

  it.each([
    "text Dana my Dayline schedule",
    "send today's plan to Russell",
    "I need to text my schedule to Dana",
  ])("does not route named Dayline artifacts to arbitrary people: %s", utterance => {
    expect(parseOperatorArtifactVoiceRequest(utterance)).toBeNull();
  });

  it("renders the authoritative Day Line without inventing tasks", () => {
    expect(
      renderDaylineOperatorArtifact({
        businessDate: "2026-09-22",
        routeAvailable: true,
        open: [
          {
            id: "route-1",
            title: "Pickup at OPUS LA",
            status: "open",
            source: "route",
            timing: "at 9:00 AM",
            completedAt: null,
          },
          {
            id: "day-director:1",
            title: "Print sales collateral",
            status: "open",
            source: "day_line",
            timing: null,
            completedAt: null,
          },
        ],
        completed: [
          {
            id: "day-director:2",
            title: "Jetro pickup",
            status: "completed",
            source: "day_line",
            timing: null,
            completedAt: "2026-09-22T15:00:00.000Z",
          },
        ],
      })
    ).toBe(
      "DAYLINE — 2026-09-22\n• Pickup at OPUS LA (at 9:00 AM)\n• Print sales collateral\n• Jetro pickup ✓"
    );
  });

  it("warns when route coverage is unavailable instead of presenting a complete schedule", () => {
    const rendered = renderDaylineOperatorArtifact({
      businessDate: "2026-09-22",
      routeAvailable: false,
      open: [
        {
          id: "day-director:1",
          title: "Print sales collateral",
          status: "open",
          source: "day_line",
          timing: null,
          completedAt: null,
        },
      ],
      completed: [],
    });

    expect(rendered).toContain("Route stops unavailable");
    expect(rendered).toContain("Print sales collateral");
  });

  it("resolves and sends a named Dayline artifact instead of reusing the previous Claire line", async () => {
    const apply = vi.fn(
      async (_decision: OperatorArtifactDecision): Promise<OperatorArtifactDecisionResult> =>
        acceptedResult()
    );
    const resolveNamedArtifact = vi.fn(async () => "DAYLINE — 2026-09-22\n• Pickup at OPUS LA");

    const outcome = await executeStandaloneOperatorArtifactVoiceRequest(
      {
        tenantId: "default",
        operatorUserId: "operator-1",
        utterance: "text me my Dayline schedule",
        history,
      },
      apply,
      { resolveNamedArtifact }
    );

    expect(resolveNamedArtifact).toHaveBeenCalledWith({ kind: "dayline" });
    expect(outcome).toEqual({
      speak: OPERATOR_ARTIFACT_SENT_SPEAK,
      providerAccepted: true,
      sourceText: "DAYLINE — 2026-09-22\n• Pickup at OPUS LA",
    });
    expect(apply.mock.calls[0]![0]).toMatchObject({
      action: "send_operator_artifact",
      artifact: {
        kind: "plain_text",
        text: "DAYLINE — 2026-09-22\n• Pickup at OPUS LA",
      },
    });
  });

  it("fails closed when a named Dayline artifact cannot be loaded", async () => {
    const apply = vi.fn();
    const outcome = await executeStandaloneOperatorArtifactVoiceRequest(
      {
        tenantId: "default",
        operatorUserId: "operator-1",
        utterance: "text me my Dayline schedule",
        history,
      },
      apply as never,
      { resolveNamedArtifact: async () => null }
    );

    expect(outcome?.speak).toBe(OPERATOR_ARTIFACT_DAYLINE_NO_SOURCE_SPEAK);
    expect(outcome?.providerAccepted).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("uses the last substantive Claire line and skips its own send confirmation", () => {
    expect(
      latestClaireArtifactText([
        ...history,
        { speaker: "operator", text: "text me that", at: 3 },
        { speaker: "claire", text: OPERATOR_ARTIFACT_SENT_SPEAK, at: 4 },
      ])
    ).toBe("The Louise is at 1633 N Edgemont Street.");
  });

  it("sends plain text through the decision seam without a caller destination", async () => {
    const apply = vi.fn(
      async (_decision: OperatorArtifactDecision): Promise<OperatorArtifactDecisionResult> =>
        acceptedResult()
    );

    const outcome = await executeStandaloneOperatorArtifactVoiceRequest(
      {
        tenantId: "default",
        operatorUserId: "operator-1",
        utterance: "Claire, text me that.",
        history,
      },
      apply
    );

    expect(outcome).toEqual({
      speak: OPERATOR_ARTIFACT_SENT_SPEAK,
      providerAccepted: true,
      sourceText: "The Louise is at 1633 N Edgemont Street.",
    });
    expect(apply).toHaveBeenCalledTimes(1);
    const decision = apply.mock.calls[0]![0] as Record<string, unknown>;
    expect(decision).toMatchObject({
      action: "send_operator_artifact",
      tenantId: "default",
      operatorUserId: "operator-1",
      artifact: {
        kind: "plain_text",
        text: "The Louise is at 1633 N Edgemont Street.",
      },
    });
    expect(decision).not.toHaveProperty("to");
    expect(decision).not.toHaveProperty("phone");
    expect(decision).not.toHaveProperty("destination");
  });

  it("does not call Twilio when there is no substantive prior Claire content", async () => {
    const apply = vi.fn();
    const outcome = await executeStandaloneOperatorArtifactVoiceRequest(
      {
        tenantId: "default",
        operatorUserId: "operator-1",
        utterance: "text me that",
        history: [{ speaker: "claire", text: "Hey Adam. What's up?", at: 1 }],
      },
      apply as never
    );

    expect(outcome?.speak).toBe(OPERATOR_ARTIFACT_NO_SOURCE_SPEAK);
    expect(outcome?.providerAccepted).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("fails closed instead of truncating an oversized prior answer", async () => {
    const apply = vi.fn();
    const outcome = await executeStandaloneOperatorArtifactVoiceRequest(
      {
        tenantId: "default",
        operatorUserId: "operator-1",
        utterance: "send me that",
        history: [
          {
            speaker: "claire",
            text: "x".repeat(OPERATOR_ARTIFACT_SMS_MAX_TEXT + 1),
            at: 1,
          },
        ],
      },
      apply as never
    );

    expect(outcome?.speak).toBe(OPERATOR_ARTIFACT_TOO_LONG_SPEAK);
    expect(outcome?.providerAccepted).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("speaks send success only when the provider accepted the message", async () => {
    const rejected = vi.fn(
      async (_decision: OperatorArtifactDecision): Promise<OperatorArtifactDecisionResult> => ({
        applied: true,
        action: "send_operator_artifact",
        result: {
          providerAccepted: false,
          delivered: false,
          resolvedTo: "+13105550100",
          messageSid: null,
          providerStatus: null,
          receipt: null,
          receiptDuplicate: false,
          evidence: [],
        },
      })
    );

    const outcome = await executeStandaloneOperatorArtifactVoiceRequest(
      {
        tenantId: "default",
        operatorUserId: "operator-1",
        utterance: "text me that",
        history,
      },
      rejected
    );

    expect(outcome?.speak).toBe(OPERATOR_ARTIFACT_FAILED_SPEAK);
    expect(outcome?.providerAccepted).toBe(false);
    expect(outcome?.speak.toLowerCase()).not.toContain("delivered");
  });

  it("keeps the voice history bounded and records the utility turn", () => {
    const longHistory = Array.from({ length: 16 }, (_, index) => ({
      speaker: index % 2 === 0 ? ("operator" as const) : ("claire" as const),
      text: `turn-${index}`,
      at: index,
    }));
    const updated = appendOperatorArtifactVoiceHistory(longHistory, {
      operatorText: "text me that",
      claireText: OPERATOR_ARTIFACT_SENT_SPEAK,
      at: 100,
    });

    expect(updated).toHaveLength(16);
    expect(updated.at(-2)).toMatchObject({
      speaker: "operator",
      text: "text me that",
    });
    expect(updated.at(-1)).toMatchObject({
      speaker: "claire",
      text: OPERATOR_ARTIFACT_SENT_SPEAK,
    });
  });
});
