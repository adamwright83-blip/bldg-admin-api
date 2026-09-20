import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import {
  writeClaireOutcomeConfirmation,
  writeClairePostStopOpening,
  writeClairePreDriveBrief,
} from "./reasoning";
import { answerClairePreDriveFollowUp } from "./preDriveConversation";
import {
  G4_UNVERIFIED_STATE_VERB_FALLBACK,
  buildClaireVerifiedFactInventory,
} from "./verifiedFactInventoryFromContext";
import { answerClaireBusinessTurn } from "./businessConversation";
import { runClaireTurn } from "./turn/claireTurn";
import { defaultBusinessQuery } from "../analytics/businessQuery";

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

const VERIFIED_SCHEDULED = "The Wilshire visit has been scheduled.";
const UNVERIFIED_SENT = "I have sent the win-back text to Sophie already.";

function silentRecord() {
  return vi.fn().mockResolvedValue(undefined);
}

describe("Slice 3: assertion-guard production wiring", () => {
  it("assembles scheduled claims from Field Today and keeps outreach sent as pending", () => {
    const inventory = buildClaireVerifiedFactInventory(context);
    expect(inventory.hasVerifiedClaim("scheduled", "visit-42")).toBe(true);
    expect(inventory.hasVerifiedClaim("sent")).toBe(false);
    expect(inventory.getClaim("outreach-sent:default")?.status).toBe("pending");
    expect(inventory.toPromptSection()).toContain("VERIFIED FACT INVENTORY");
    expect(inventory.toPromptSection()).toContain("[PENDING]");
    expect(buildClaireVerifiedFactInventory(null).hasVerifiedClaim("scheduled")).toBe(false);
  });

  it("fail-closes on partial drive context without inventing scheduled claims", () => {
    const inventory = buildClaireVerifiedFactInventory({ businessDate: "2026-09-15" } as never);
    expect(inventory.hasVerifiedClaim("scheduled")).toBe(false);
    expect(inventory.hasVerifiedClaim("sent")).toBe(false);
  });

  it("writeClairePreDriveBrief injects G4 inventory and falls back on unverified 'sent'", async () => {
    const invokeText = vi.fn().mockResolvedValue(UNVERIFIED_SENT);
    const recordGeneration = silentRecord();
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, biographyVerifier: async () => true, recordGeneration }
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

  it("writeClairePreDriveBrief keeps a verified scheduled assertion", async () => {
    const result = await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { biographyVerifier: async () => true, invokeText: vi.fn().mockResolvedValue(VERIFIED_SCHEDULED), recordGeneration: silentRecord() }
    );
    expect(result).toBe(VERIFIED_SCHEDULED);
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
        biographyVerifier: async () => true, invokeText: vi.fn().mockResolvedValue("I queued the reminder and it is already out."),
        recordGeneration: silentRecord(),
      }
    );
    // PR1 Claire Intelligence Repair: the fallback line changed from the
    // old canned "I can only clarify..." text to a brief, human, non-
    // deceptive line — the important behavior is that assertion-guard
    // rejection still routes to the deterministic fallback, not the model
    // text that made the unverified claim.
    expect(result).not.toContain("queued");
    expect(result).toContain("Give me a second");
  });

  it("pre-drive follow-up keeps a verified scheduled assertion", async () => {
    const result = await answerClairePreDriveFollowUp(
      {
        tenantId: "tenant-1",
        utterance: "Is the Wilshire visit on the calendar?",
        brief: "Visit The Wilshire.",
        context,
      },
      {
        biographyVerifier: async () => true, invokeText: vi.fn().mockResolvedValue(VERIFIED_SCHEDULED),
        recordGeneration: silentRecord(),
      }
    );
    expect(result).toBe(VERIFIED_SCHEDULED);
  });

  it("post-stop opening without context fail-closes unverified scheduled claims", async () => {
    const result = await writeClairePostStopOpening(
      { tenantId: "tenant-1", operatorUserId: null, accountName: "The Wilshire" },
      {
        biographyVerifier: async () => true, invokeText: vi.fn().mockResolvedValue("The Wilshire visit has been scheduled."),
        recordGeneration: silentRecord(),
      }
    );
    expect(result).toBe(
      "You're clear of The Wilshire. Tell me what actually happened. I won't mark anything won, lost, or followed up unless you say it."
    );
  });

  it("post-stop opening with drive context keeps a verified scheduled assertion", async () => {
    const result = await writeClairePostStopOpening(
      {
        tenantId: "tenant-1",
        operatorUserId: "op-1",
        accountName: "The Wilshire",
        context,
      },
      {
        biographyVerifier: async () => true, invokeText: vi.fn().mockResolvedValue(VERIFIED_SCHEDULED),
        recordGeneration: silentRecord(),
      }
    );
    expect(result).toBe(VERIFIED_SCHEDULED);
  });

  it("outcome confirmation without context fail-closes unverified scheduled claims", async () => {
    const result = await writeClaireOutcomeConfirmation(
      { tenantId: "tenant-1", operatorUserId: null, outcome: "won", outcomeLabel: "won" },
      {
        biographyVerifier: async () => true, invokeText: vi.fn().mockResolvedValue(VERIFIED_SCHEDULED),
        recordGeneration: silentRecord(),
      }
    );
    expect(result).toBe("Confirmed. I saved won and left anything you didn't report unresolved.");
  });

  it("outcome confirmation with drive context keeps a verified scheduled assertion", async () => {
    const result = await writeClaireOutcomeConfirmation(
      {
        tenantId: "tenant-1",
        operatorUserId: "op-1",
        outcome: "won",
        outcomeLabel: "won",
        context,
      },
      {
        biographyVerifier: async () => true, invokeText: vi.fn().mockResolvedValue(VERIFIED_SCHEDULED),
        recordGeneration: silentRecord(),
      }
    );
    expect(result).toBe(VERIFIED_SCHEDULED);
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

  it("business conversation keeps a verified scheduled assertion when context is passed", async () => {
    const query = defaultBusinessQuery("revenue");
    const turn = await answerClaireBusinessTurn(
      {
        tenantId: "tenant-1",
        utterance: "What was revenue in the last 30 days?",
        state: {},
        surface: "voice",
        context,
      },
      {
        plan: async () => query,
        runQuery: async () => ({
          status: "ok",
          query,
          period: {
            kind: "trailing_days",
            days: 30,
            start: "2026-08-15",
            end: "2026-09-14",
            label: "the last 30 days",
          },
          comparisonPeriod: null,
          data: {
            kind: "totals",
            current: { revenueCents: 19000, orderCount: 5, aovCents: 3800 },
            previous: null,
          },
          completeness: { coverage: "complete", notes: [] },
          // Real coverage shape: this test is about the assertion guard, not source coverage.
          coverage: { completeness: "complete", loadedSources: ["laundry_butler", "cleancloud"], failedSources: [] },
        } as never),
        loadBindings: async () => ({ laundry_butler: { state: "bound" as const, lastSuccessAt: new Date(), coverageRanges: [], latestAttempt: null, isSystemOfRecord: true }, cleancloud: { state: "bound" as const, lastSuccessAt: new Date(), coverageRanges: [{ from: "2020-01-01", to: "2099-12-31", completedAt: new Date(), basis: "economic_event" as const, provenance: "test_fixture" as const }], latestAttempt: null, isSystemOfRecord: false } }),
        speakResult: () => ({
          text: VERIFIED_SCHEDULED,
          facts: [],
          disclosures: [],
        }),
      }
    );
    expect(turn.handled).toBe(true);
    if (turn.handled) expect(turn.speak).toBe(VERIFIED_SCHEDULED);
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
        doctrineTurn: async () => UNVERIFIED_SENT,
        now: () => new Date("2026-09-14T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
      }
    );
    expect(result.speak).toBe(G4_UNVERIFIED_STATE_VERB_FALLBACK);
  });

  it("claireTurn finish keeps a verified scheduled assertion", async () => {
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
        doctrineTurn: async () => VERIFIED_SCHEDULED,
        now: () => new Date("2026-09-14T15:00:00.000Z"),
        timeZone: () => "America/Los_Angeles",
      }
    );
    expect(result.speak).toBe(VERIFIED_SCHEDULED);
  });
});
