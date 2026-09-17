import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import {
  writeClaireOutcomeConfirmation,
  writeClairePostStopOpening,
  writeClairePreDriveBrief,
} from "./reasoning";

const context: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-14T12:00:00.000Z",
  businessDate: "2026-09-14",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: {
    id: "visit-42",
    kind: "commercial_visit",
    title: "The Wilshire",
    subtitle: "Commercial visit",
    urgency: "today",
    scheduledAt: "2026-09-14T17:00:00.000Z",
    destination: "100 Wilshire Boulevard",
    sourceReference: "commercial_missions:42",
    whySurfaced: "scheduled",
    actions: [],
  },
  blockers: [],
  relevantTimeline: [],
  mission: null,
};

describe("Claire natural-language generation", () => {
  it("A — opening brief success returns model text with bounded context and no schema", async () => {
    const invokeText = vi.fn().mockResolvedValue("Model-written field brief.");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration }
    );

    expect(result).toBe("Model-written field brief.");
    expect(result).not.toContain("Your next field commitment is");
    const request = invokeText.mock.calls[0][0];
    expect(request).not.toHaveProperty("outputSchema");
    expect(request.messages[0].content).toContain(
      "Do not introduce yourself"
    );
    // PR1 Claire Intelligence Repair: the old blanket 70-word cap is gone.
    expect(request.messages[0].content).not.toContain("never exceed 70 words");
    expect(request.messages[0].content).toContain(
      "General professional/strategic knowledge"
    );
    expect(JSON.parse(request.messages[1].content)).toMatchObject({
      businessDate: context.businessDate,
      nextFixedCommitment: context.nextFixedCommitment,
      blockers: context.blockers,
      relevantTimeline: context.relevantTimeline,
      mission: context.mission,
      picture: { sufficient: true },
    });
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: {
          kind: "opening_brief",
          source: "model",
          failureReason: null,
        },
      })
    );
  });

  it("B — opening brief failure returns the exact fallback and marks telemetry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      {
        invokeText: vi
          .fn()
          .mockRejectedValue(new Error("secret prompt must not leak")),
        recordGeneration,
      }
    );
    expect(result).toBe(
      "Your next field commitment is The Wilshire. Keep the drive focused on that stop, and leave anything not on the route for later."
    );
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: {
          kind: "opening_brief",
          source: "fallback",
          failureReason: "generation_failed",
        },
      })
    );
    expect(log).toHaveBeenCalledWith(
      "[Claire] opening brief generation failed",
      expect.objectContaining({ failureReason: "generation_failed" })
    );
  });

  it("C — follow-up success passes frozen inputs and returns model text", async () => {
    const invokeText = vi
      .fn()
      .mockResolvedValue("The model clarified the brief.");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-1",
        utterance: "Who is the stop?",
        brief: "Visit The Wilshire.",
        context,
      },
      { invokeText, recordGeneration }
    );
    expect(result).toBe("The model clarified the brief.");
    const payload = JSON.parse(invokeText.mock.calls[0][0].messages[1].content);
    expect(payload).toMatchObject({
      openingBrief: "Visit The Wilshire.",
      operatorUtterance: "Who is the stop?",
      currentContext: { businessDate: "2026-09-14" },
    });
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: { kind: "follow_up", source: "model", failureReason: null },
      })
    );
  });

  it("D — follow-up failure uses the conservative fallback and marks telemetry", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-1",
        utterance: "Who am I meeting?",
        brief: "Visit The Wilshire.",
        context,
      },
      {
        invokeText: vi.fn().mockRejectedValue(new Error("provider down")),
        recordGeneration,
      }
    );
    expect(result).toContain("does not name a specific person");
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: {
          kind: "follow_up",
          source: "fallback",
          failureReason: "generation_failed",
        },
      })
    );
    expect(log).toHaveBeenCalledWith(
      "[Claire] follow-up generation failed",
      expect.objectContaining({ failureReason: "generation_failed" })
    );
  });

  it("E — post-stop opening falls back to the exact original static line on failure", async () => {
    const result = await writeClairePostStopOpening(
      { tenantId: "tenant-1", operatorUserId: null, accountName: "The Wilshire" },
      { invokeText: vi.fn().mockRejectedValue(new Error("provider down")) }
    );
    expect(result).toBe(
      "You're clear of The Wilshire. Tell me what actually happened. I won't mark anything won, lost, or followed up unless you say it."
    );
  });

  it("E — post-stop opening uses model text and stays grounded to only the account name", async () => {
    const invokeText = vi.fn().mockResolvedValue("Clear of The Wilshire. What happened?");
    const result = await writeClairePostStopOpening(
      { tenantId: "tenant-1", operatorUserId: null, accountName: "The Wilshire" },
      { invokeText }
    );
    expect(result).toBe("Clear of The Wilshire. What happened?");
    expect(invokeText.mock.calls[0][0].messages[0].content).toContain(
      "Never guess or assume an outcome"
    );
  });

  it("F — outcome confirmation falls back to the exact original static line on failure", async () => {
    const result = await writeClaireOutcomeConfirmation(
      { tenantId: "tenant-1", operatorUserId: null, outcome: "won", outcomeLabel: "won" },
      { invokeText: vi.fn().mockRejectedValue(new Error("provider down")) }
    );
    expect(result).toBe(
      "Confirmed. I saved won and left anything you didn't report unresolved."
    );
  });

  it("F — outcome confirmation picks success_review for won and failure_review for lost", async () => {
    const wonInvoke = vi.fn().mockResolvedValue("Confirmed, won.");
    await writeClaireOutcomeConfirmation(
      { tenantId: "tenant-1", operatorUserId: null, outcome: "won", outcomeLabel: "won" },
      { invokeText: wonInvoke }
    );
    expect(wonInvoke.mock.calls[0][0].messages[0].content).toContain(
      "Acknowledge the win briefly without gushing"
    );

    const lostInvoke = vi.fn().mockResolvedValue("Confirmed, lost.");
    await writeClaireOutcomeConfirmation(
      { tenantId: "tenant-1", operatorUserId: null, outcome: "lost", outcomeLabel: "lost" },
      { invokeText: lostInvoke }
    );
    expect(lostInvoke.mock.calls[0][0].messages[0].content).toContain(
      "Own it plainly if relevant, no reassurance, no blame"
    );
  });
});
