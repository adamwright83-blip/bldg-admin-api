import { describe, expect, it } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import {
  conservativeClaireFollowUp,
  isClaireCallComplete,
  isExplicitClaireCallEnd,
  shouldEndClaireCallOnUtterance,
} from "./preDriveConversation";

const context: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-13T12:00:00.000Z",
  businessDate: "2026-09-13",
  actorId: "adam",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: {
    id: "mission-42",
    kind: "commercial_visit",
    title: "The Wilshire",
    subtitle: "Commercial visit",
    urgency: "today",
    scheduledAt: null,
    destination: "100 Wilshire Boulevard",
    sourceReference: "commercial_missions:42",
    whySurfaced: null,
    actions: [],
  },
  blockers: [],
  relevantTimeline: [],
  mission: null,
};

describe("Claire pre-drive conversation", () => {
  it.each(["Got it", "I'm good", "That's enough", "End the call", "goodbye"])(
    "recognizes a natural close: %s",
    utterance => expect(isClaireCallComplete(utterance)).toBe(true)
  );

  it.each([
    "Have a good day. I'm done talking.",
    "I'm done talking.",
    "Have a good day.",
    "End the call please.",
  ])("treats explicit end-call speech as a close: %s", utterance => {
    expect(isClaireCallComplete(utterance)).toBe(true);
    expect(isExplicitClaireCallEnd(utterance)).toBe(true);
    expect(shouldEndClaireCallOnUtterance(utterance, { holding: true })).toBe(true);
    expect(shouldEndClaireCallOnUtterance(utterance, { holding: false })).toBe(true);
  });

  it.each(["Got it", "I'm good", "That's enough"])(
    "never auto-hangs up on an ambiguous acknowledgement: %s",
    utterance => {
      expect(shouldEndClaireCallOnUtterance(utterance, { holding: true })).toBe(false);
      expect(shouldEndClaireCallOnUtterance(utterance, { holding: false })).toBe(false);
    }
  );

  it("does not hang up on a status-update fragment that contains an ambiguous closer", () => {
    expect(
      shouldEndClaireCallOnUtterance(
        "Got it, and after that I still need to charge Ryan.",
        { holding: false }
      )
    ).toBe(false);
  });

  it("does not mistake reported goodbye language inside a status update for call-end intent", () => {
    expect(
      shouldEndClaireCallOnUtterance(
        "I told Dana goodbye and then she said to email the proposal.",
        { holding: false }
      )
    ).toBe(false);
  });

  it("routes mixed business-plus-goodbye content through Claire before ending", () => {
    expect(
      shouldEndClaireCallOnUtterance(
        "Dana still hasn't replied, but I gotta go.",
        { holding: false }
      )
    ).toBe(false);
  });

  it("still ends on an explicit standalone goodbye", () => {
    expect(shouldEndClaireCallOnUtterance("Bye Claire.", { holding: false })).toBe(true);
  });

  it("does not mistake a follow-up question for a close", () => {
    expect(
      isClaireCallComplete("What should I say if they have laundry?")
    ).toBe(false);
  });

  it("does not invent a person when asked who the operator is meeting", () => {
    expect(
      conservativeClaireFollowUp({
        utterance: "Who am I meeting?",
        brief: "Visit The Wilshire and ask about management effort.",
        context,
      })
    ).toBe(
      "Today's context identifies The Wilshire, but it does not name a specific person. I don't want to guess."
    );
  });

  it("handles an incumbent-laundry hypothetical without claiming it is fact", () => {
    expect(
      conservativeClaireFollowUp({
        utterance: "What if they already have laundry?",
        brief: "Visit The Wilshire and ask about management effort.",
        context,
      })
    ).toContain("doesn't confirm their laundry setup");
  });

  it("repeats the frozen brief when the operator could not hear it", () => {
    expect(
      conservativeClaireFollowUp({
        utterance: "What did you say? I can't hear you.",
        brief: "Visit The Wilshire and ask about management effort.",
        context,
      })
    ).toBe("I mean this: Visit The Wilshire and ask about management effort.");
  });

  it("treats natural confusion as a request to clarify the frozen brief", () => {
    expect(
      conservativeClaireFollowUp({
        utterance: "What are you talking about?",
        brief: "Visit The Wilshire and ask about management effort.",
        context,
      })
    ).toBe("I mean this: Visit The Wilshire and ask about management effort.");
  });

  it("keeps unclear telephone speech grounded by returning to the frozen brief", () => {
    expect(
      conservativeClaireFollowUp({
        utterance: "Claire, answer my... give it to me.",
        brief: "Visit The Wilshire and ask about management effort.",
        context,
      })
    ).toContain("Visit The Wilshire and ask about management effort.");
  });
});
