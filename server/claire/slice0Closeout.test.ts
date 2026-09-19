import { describe, expect, it } from "vitest";
import { inventoryPlusReceipts, lintPostGenerationStateVerbs, lintSpokenClock, VerifiedFactInventory } from "./assertionGuard";
import { sanitizeSpeakAgainstInventory } from "./verifiedFactInventoryFromContext";
import { classifyOpenDialogueAct } from "./turn/dialogueAct";
import { replyDecision } from "./turn/claireTurn";
import {
  claireQueuedSpeechMetadata,
  claireSpeechDeliveryOf,
  isAuthoritativeOperatorTurn,
  isConfirmedHeardClaireSpeech,
  isKnownNotHeardClaireSpeech,
  OPERATOR_REPRESENTATION,
  SPEECH_DELIVERY,
} from "./conversation/speechDelivery";
import { formatLiveTranscript } from "./analysis/conversationEvaluator";
import type { ConversationTurn } from "./conversation/types";

describe("deterministic dialogue acts do not require a new model hop", () => {
  it("routes obvious confiding away from Day Line work", () => {
    expect(classifyOpenDialogueAct("I'm stressed and I don't have any plans I don't know what to do").kind).toBe("confide");
  });
  it("routes a direct personal question", () => {
    expect(classifyOpenDialogueAct("Do you have plans this weekend?").kind).toBe("question");
  });
  it("routes an explicit Day Line add", () => {
    expect(classifyOpenDialogueAct("Zeely is spelled z-e-e-l-y and you can put that on the dayline").kind).toBe("explicit_track");
  });
  it("a leading no while holding is a reject with remainder, not a silent ignore", () => {
    expect(replyDecision("No, I I'm confiding with you and I was hoping you would have a suggestion")).toMatchObject({
      decision: "no",
    });
    expect(replyDecision("No longer a good opportunity")).toMatchObject({ decision: "other" });
  });
});

describe("mutation claims require the matching receipt", () => {
  const empty = new VerifiedFactInventory([]);

  it("rejects unconstrained Adding to the Day Line… Done with no receipt", () => {
    const speech = "Adding to the Day Line: create Instagram ad in Zeli AI. Done. That's your Saturday task.";
    expect(lintPostGenerationStateVerbs(speech, empty).pass).toBe(false);
    expect(sanitizeSpeakAgainstInventory(speech, empty)).not.toMatch(/Adding to the Day Line/i);
  });

  it("allows Done. N on today's line only with a created receipt for that write", () => {
    const withReceipt = inventoryPlusReceipts(empty, [
      { claimedState: "created", entityId: "c-1", statement: "Added Instagram ad" },
    ]);
    expect(lintPostGenerationStateVerbs("Done. 1 on today's line.", withReceipt).pass).toBe(true);
  });

  it("rejects engineering Sent to… without a sent receipt (shared invariant, not a workflow redesign)", () => {
    expect(lintPostGenerationStateVerbs("Sent to engineering. I'll let you know what they find.", empty).pass).toBe(false);
  });
});

describe("authoritative clock", () => {
  it("rejects it's 3 AM against 10:02 AM Pacific", () => {
    expect(lintSpokenClock("Glad it landed. Get some sleep — it's 3 AM.", "10:02 AM").pass).toBe(false);
  });
  it("accepts a matching local time", () => {
    expect(lintSpokenClock("It's 10:02 AM. Sunday's your first real shot.", "10:02 AM").pass).toBe(true);
  });
});

describe("generated ≠ confirmed heard", () => {
  it("heardConfirmed false on queued speech means unconfirmed, not confirmed-not-heard", () => {
    const meta = claireQueuedSpeechMetadata();
    expect(claireSpeechDeliveryOf(meta)).toBe("generated_queued");
    expect(isConfirmedHeardClaireSpeech(meta)).toBe(false);
    expect(isKnownNotHeardClaireSpeech(meta)).toBe(false);
  });

  it("tri-state: confirmed heard, confirmed not heard, and unknown-unconfirmed are distinct", () => {
    expect(
      isConfirmedHeardClaireSpeech({
        speechDelivery: SPEECH_DELIVERY.CONFIRMED_HEARD,
        heardConfirmed: true,
      })
    ).toBe(true);
    expect(
      isKnownNotHeardClaireSpeech({
        speechDelivery: SPEECH_DELIVERY.CONFIRMED_NOT_HEARD,
        heardConfirmed: false,
      })
    ).toBe(true);
    expect(isKnownNotHeardClaireSpeech(claireQueuedSpeechMetadata())).toBe(false);
  });

  it("analysis does not promote queued Claire speech to heard, and ignores non-authoritative operator fragments", () => {
    const turns: ConversationTurn[] = [
      {
        id: 1, sessionId: "s", ordinal: 1, speaker: "OPERATOR", text: "won't be in",
        source: "twilio_speech_result", idempotencyKey: "a",
        providerMetadata: { representation: OPERATOR_REPRESENTATION.PROVIDER_FRAGMENT, authoritativeOperatorTurn: false },
        occurredAt: "2026-09-19T17:04:17.000Z",
      },
      {
        id: 2, sessionId: "s", ordinal: 2, speaker: "OPERATOR", text: "won't be in So perhaps Zeely",
        source: "twilio_speech_result", idempotencyKey: "b",
        providerMetadata: { representation: OPERATOR_REPRESENTATION.CANONICAL_UTTERANCE, authoritativeOperatorTurn: true, providerFragments: ["won't be in", "So perhaps Zeely"] },
        occurredAt: "2026-09-19T17:04:43.000Z",
      },
      {
        id: 3, sessionId: "s", ordinal: 3, speaker: "CLAIRE", text: "Got that too.",
        source: "goldline_generated_speech", idempotencyKey: "c",
        providerMetadata: claireQueuedSpeechMetadata(),
        occurredAt: "2026-09-19T17:04:43.000Z",
      },
    ];
    const transcript = formatLiveTranscript(turns);
    expect(transcript).not.toMatch(/^1\. ADAM: won't be in$/m);
    expect(transcript).toContain("ADAM: won't be in So perhaps Zeely");
    expect(transcript).toContain("heard-unconfirmed");
    expect(transcript).not.toContain("confirmed-not-heard");
    expect(isAuthoritativeOperatorTurn(turns[0]!.providerMetadata)).toBe(false);
  });
});
