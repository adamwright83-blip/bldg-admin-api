import { describe, expect, it, vi } from "vitest";
import { preDriveConversationTwiML } from "./claireTwilio";
import { beginClaireTurnTrace } from "./answerPathTelemetry";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";

/**
 * Claire Intelligence Repair Part 2, Slice F — dead air.
 *
 * speechTimeout "3" on ordinary pre-drive gathers was up to three seconds of
 * silence before Twilio even posted the turn. Opening briefings still wait
 * through list pauses. First-token time is measured when the follow-up path
 * streams; TTS still waits for the full text.
 */

describe("Slice F — voice dead air", () => {
  it("opening briefings still wait three seconds through list pauses", () => {
    const xml = preDriveConversationTwiML({
      text: "Two stops today.",
      token: "t",
      opening: true,
    });
    expect(xml).toContain('speechTimeout="3"');
  });

  it("follow-up gathers use auto, matching debrief and confirm", () => {
    const xml = preDriveConversationTwiML({ text: "The Louise.", token: "t" });
    expect(xml).toContain('speechTimeout="auto"');
  });

  it("follow-up generation forwards onFirstToken to the model invoke", async () => {
    const onFirstToken = vi.fn();
    const invokeText = vi.fn(async (params: { onFirstToken?: () => void }) => {
      params.onFirstToken?.();
      return "Lead with The Louise.";
    });
    await answerClairePreDriveFollowUp(
      {
        tenantId: "default",
        utterance: "What should I say?",
        brief: "The Louise.",
        context: {
          businessDate: "2026-09-15",
          actorId: "adam-admin",
          macroGoalKnown: false,
          blockers: [],
          relevantTimeline: [],
        } as never,
        onFirstToken,
      },
      { invokeText: invokeText as never, recordGeneration: vi.fn() as never }
    );
    expect(invokeText).toHaveBeenCalled();
    expect(onFirstToken).toHaveBeenCalledTimes(1);
  });

  it("a turn trace still records firstTokenMs as null until a token arrives", () => {
    const trace = beginClaireTurnTrace({
      tenantId: "t",
      operatorUserId: "u",
      surface: "voice",
      startedAtMs: 1_000,
    });
    expect(trace.latency.firstTokenMs).toBeNull();
  });
});
