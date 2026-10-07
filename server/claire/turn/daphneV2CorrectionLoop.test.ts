import { describe, expect, it, vi } from "vitest";
import { runClaireTurn, type ClaireTurnState } from "./claireTurn";

function safeOverrides() {
  return {
    now: () => new Date("2026-10-07T10:00:00.000-07:00"),
    timeZone: () => "America/Los_Angeles",
    brainV3: null,
    operatorContextShadowEnabled: () => false,
    doctrineTurn: async () => null,
    accounts: async () => [],
    vocabulary: async () => [],
    loadExisting: async () => [],
    campaign: async () => null,
    extractModel: null,
    encyclopedia: null,
    loadOperatorAdaptationDecision: async () => null,
  } as const;
}

describe("Daphne V2 explicit correction -> Claire guidance runtime order", () => {
  it("persists a completed-turn correction before loading the guidance used by Claire", async () => {
    const order: string[] = [];
    let corrected = false;

    const capture = vi.fn(async input => {
      order.push("capture");
      expect(input.utterance).toBe("Claire, keep your answers shorter.");
      corrected = true;
      return {
        status: "persisted" as const,
        corrections: [
          {
            preferenceKey: "response_detail" as const,
            value: 0.2,
            evidenceText: input.utterance,
          },
        ],
        observationIds: ["dobs_test"],
      };
    });

    const load = vi.fn(async () => {
      order.push("load");
      expect(corrected).toBe(true);
      return {
        cardGeneratedAt: "2026-10-07T17:00:00.000Z",
        evidenceCount: 1,
        promptSection:
          "STYLE INSTRUCTION: keep the response concise; give one main point or action unless the operator asks for more.",
      };
    });

    const state: ClaireTurnState = {};
    await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "text",
        utterance: "Claire, keep your answers shorter.",
        state,
        conversationKey: "conversation-daphne-correction",
      },
      {
        ...safeOverrides(),
        captureDaphneV2PreferenceCorrections: capture,
        loadDaphneV2Guidance: load,
      }
    );

    expect(capture).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(order.slice(0, 2)).toEqual(["capture", "load"]);
  });

  it("does not persist an incomplete voice fragment", async () => {
    const capture = vi.fn();
    const load = vi.fn();

    const result = await runClaireTurn(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        dayDirectorActorId: "1",
        surface: "voice",
        utterance: "Claire I want you to",
        state: {},
        conversationKey: "conversation-daphne-fragment",
      },
      {
        ...safeOverrides(),
        captureDaphneV2PreferenceCorrections: capture,
        loadDaphneV2Guidance: load,
      }
    );

    expect(result.listenOnly).toBe(true);
    expect(capture).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });
});
