import { describe, expect, it } from "vitest";
import {
  lintPostGenerationStateVerbs,
  lintReceiptBackedCommitSpeech,
  lintSpokenClock,
  VerifiedFactInventory,
} from "./assertionGuard";
import { speakBriefingCommit } from "./briefing/briefingCommit";
import { assembleGuardedClaireSpeak, sanitizeSpeakAgainstInventory } from "./verifiedFactInventoryFromContext";
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
  const createdA = [{ claimedState: "created" as const, entityId: "task-a", statement: "Added task A" }];
  const completedOne = [{ claimedState: "completed" as const, entityId: "task-a", statement: "Marked task A done" }];

  it("6 — original Slice 0 false Adding… Done with zero receipt remains blocked", () => {
    const speech = "Adding to the Day Line: create Instagram ad in Zeli AI. Done. That's your Saturday task.";
    expect(lintPostGenerationStateVerbs(speech, empty).pass).toBe(false);
    expect(sanitizeSpeakAgainstInventory(speech, empty)).not.toMatch(/Adding to the Day Line/i);
  });

  it("1 — created receipt for task A does not authorize model prose claiming task B was added", () => {
    expect(lintPostGenerationStateVerbs("I added task B to the Day Line.", empty).pass).toBe(false);
    expect(
      assembleGuardedClaireSpeak({
        conversational: "I added task B to the Day Line.",
        inventory: empty,
        mutationReceipts: createdA,
      })
    ).not.toMatch(/task B/i);
  });

  it("static verified state for task A cannot authorize a fresh free-form mutation claim about task B", () => {
    const staticCreatedA = new VerifiedFactInventory([
      {
        claimId: "created:task-a",
        statement: "Task A already exists on the work picture",
        entityRef: "task-a",
        status: "verified",
        claimedState: "created",
        provenance: "test.static_inventory",
      },
    ]);
    expect(lintPostGenerationStateVerbs("I added task B to the Day Line.", staticCreatedA).pass).toBe(false);
    expect(lintPostGenerationStateVerbs("Done. 1 on today's line.", staticCreatedA).pass).toBe(false);
  });

  it("verified historical state can still be described passively without becoming a fresh mutation claim", () => {
    const staticScheduled = new VerifiedFactInventory([
      {
        claimId: "scheduled:task-a",
        statement: "Task A is scheduled",
        entityRef: "task-a",
        status: "verified",
        claimedState: "scheduled",
        provenance: "test.static_inventory",
      },
    ]);
    expect(lintPostGenerationStateVerbs("Task A has been scheduled.", staticScheduled).pass).toBe(true);
    expect(lintPostGenerationStateVerbs("I scheduled task B.", staticScheduled).pass).toBe(false);
  });

  it("2 — created receipt does not authorize I completed/marked it done in free-form speech", () => {
    expect(lintPostGenerationStateVerbs("I marked it done.", empty).pass).toBe(false);
    expect(lintPostGenerationStateVerbs("I completed that for you.", empty).pass).toBe(false);
  });

  it("3 — completed receipt does not authorize I added/saved it in free-form speech", () => {
    expect(lintPostGenerationStateVerbs("I added it to the Day Line.", empty).pass).toBe(false);
    expect(lintPostGenerationStateVerbs("I saved that for you.", empty).pass).toBe(false);
  });

  it("4 — speakBriefingCommit may say Done. 1 on today's line after an actual successful create", () => {
    const commit = speakBriefingCommit(
      {
        added: [{ title: "Instagram ad", businessDate: "2026-09-19", kind: "new_work", quote: "", timing: { kind: "none" } } as never],
        completed: [],
        failed: [],
        commitmentIds: ["c-1"],
        receipts: createdA,
      },
      "2026-09-19"
    );
    expect(commit).toBe("Done. 1 on today's line.");
    expect(lintReceiptBackedCommitSpeech(commit, createdA).pass).toBe(true);
    expect(lintPostGenerationStateVerbs(commit, empty).pass).toBe(false);
  });

  it("5 — mixed answer + Day Line write cannot borrow the commit receipt for unrelated mutation claims", () => {
    const commit = "Done. 1 on today's line.";
    const guarded = assembleGuardedClaireSpeak({
      conversational: "Yes, stop at The Louise. I added the Zeely spelling to your list.",
      inventory: empty,
      receiptBackedCommit: commit,
      mutationReceipts: createdA,
    });
    expect(guarded).toContain("Done. 1 on today's line.");
    expect(guarded).not.toMatch(/I added the Zeely/i);
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
