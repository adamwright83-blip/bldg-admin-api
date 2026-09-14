import { describe, expect, it } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import {
  conservativeClaireFollowUp,
  isClaireCallComplete,
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
});
