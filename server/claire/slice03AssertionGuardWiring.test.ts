import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { writeClairePreDriveBrief } from "./reasoning";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import {
  G4_UNVERIFIED_STATE_VERB_FALLBACK,
  buildClaireVerifiedFactInventory,
} from "./verifiedFactInventoryFromContext";
import { answerClaireBusinessTurn } from "./businessConversation";
import { runClaireTurn } from "./turn/claireTurn";

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

describe("Slice 3: assertion-guard production wiring", () => {
  it("assembles scheduled claims from Field Today and keeps outreach sent as pending", () => {
    const inventory = buildClaireVerifiedFactInventory(context);
    expect(inventory.hasVerifiedClaim("scheduled", "visit-42")).toBe(true);
    expect(inventory.hasVerifiedClaim("sent")).toBe(false);
    expect(inventory.getClaim("outreach-sent:default")?.status).toBe("pending");
    expect(inventory.toPromptSection()).toContain("VERIFIED FACT INVENTORY");
    expect(inventory.toPromptSection()).toContain("[PENDING]");
  });

  it("writeClairePreDriveBrief injects G4 inventory and falls back on unverified 'sent'", async () => {
    const invokeText = vi.fn().mockResolvedValue("I have sent the win-back text to Sophie already.");
    const recordGeneration = vi.fn().mockResolvedValue(undefined);
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration }
    );
    expect(invokeText.mock.calls[0][0].messages[0].content).toContain("VERIFIED FACT INVENTORY");
    expect(JSON.parse(invokeText.mock.calls[0][0].messages[1].content).factInventory).toContain(
      "GUARDRAIL G4"
    );
    expect(result).toContain("Your next field commitment is The Wilshire");
    expect(recordGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        diagnostic: expect.objectContaining({ source: "fallback" }),
      })
    );
  });

  it("writeClairePreDriveBrief keeps compliant speech when no unverified state verbs", async () => {
    const invokeText = vi.fn().mockResolvedValue("The Wilshire visit is on the calendar this afternoon.");
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    expect(result).toBe("The Wilshire visit is on the calendar this afternoon.");
  });

  it("pre-drive follow-up falls back when the model claims a queued send", async () => {
    const result = await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-1",
        utterance: "Did you message them?",
        brief: "Visit The Wilshire.",
        context,
      },
      {
        invokeText: vi.fn().mockResolvedValue("I queued the reminder and it is already out."),
        recordGeneration: vi.fn().mockResolvedValue(undefined),
      }
    );
    expect(result).toContain("I can only clarify today's field brief");
  });

  it("business conversation replaces unverified sent claims", async () => {
    const turn = await answerClaireBusinessTurn(
      { tenantId: "tenant-1", utterance: "I sent the invoice already right", state: {}, surface: "voice" },
      {
        plan: async () => null,
        runQuery: async () => {
          throw new Error("should not query");
        },
      }
    );
    if (turn.handled) {
      expect(turn.speak).not.toMatch(/\bI(?:'ve|\s+have)?\s+sent\b/i);
    }
  });

  it("claireTurn finish sanitizes unverified sent speech from doctrine", async () => {
    const result = await runClaireTurn(
      {
        tenantId: "tenant-1",
        operatorUserId: "op-1",
        dayDirectorActorId: "actor-1",
        utterance: "good morning",
        surface: "voice",
        state: {},
        context,
        conversationKey: "test-thread",
      },
      {
        doctrineTurn: async () => "I have sent the message to Sophie already.",
        now: () => new Date("2026-09-14T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
      }
    );
    expect(result.speak).toBe(G4_UNVERIFIED_STATE_VERB_FALLBACK);
  });
});
