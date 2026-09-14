import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import { writeClairePreDriveBrief } from "./reasoning";

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
    expect(JSON.parse(request.messages[1].content)).toEqual({
      businessDate: context.businessDate,
      nextFixedCommitment: context.nextFixedCommitment,
      blockers: context.blockers,
      relevantTimeline: context.relevantTimeline,
      mission: context.mission,
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
});
