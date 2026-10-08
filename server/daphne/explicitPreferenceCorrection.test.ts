import { describe, expect, it, vi } from "vitest";
import {
  captureExplicitDaphnePreferenceCorrections,
  detectExplicitDaphnePreferenceCorrections,
} from "./explicitPreferenceCorrection";

describe("Daphne V2 explicit preference correction parser", () => {
  it("captures direct natural-language corrections without inference", () => {
    const corrections = detectExplicitDaphnePreferenceCorrections(
      "Claire, stop repeating yourself and keep your answers shorter."
    );
    expect(corrections).toEqual([
      {
        preferenceKey: "avoid_repetition",
        value: true,
        evidenceText: "Claire, stop repeating yourself and keep your answers shorter.",
      },
      {
        preferenceKey: "response_detail",
        value: 0.2,
        evidenceText: "Claire, stop repeating yourself and keep your answers shorter.",
      },
    ]);
  });

  it("captures directness and challenge corrections", () => {
    expect(
      detectExplicitDaphnePreferenceCorrections("Be more direct with me.")
    ).toEqual([
      expect.objectContaining({
        preferenceKey: "response_directness",
        value: 0.9,
      }),
    ]);
    expect(
      detectExplicitDaphnePreferenceCorrections("Don't push me so hard.")
    ).toEqual([
      expect.objectContaining({
        preferenceKey: "challenge_level",
        value: 0.2,
      }),
    ]);
  });

  it("does not turn a hypothetical question into a preference", () => {
    expect(
      detectExplicitDaphnePreferenceCorrections(
        "Would it be better if you were more direct?"
      )
    ).toEqual([]);
  });
  it("persists an explicit correction as both immutable observation and active MetaPreference", async () => {
    const recordObservation = vi.fn(async () => ({
      id: "obs-correction-1",
      tenantId: "tenant-a",
      canonicalOperatorId: "operator-a",
      operatorUserId: "adam",
      sessionId: "call-1",
      actorType: "user" as const,
      actorId: "adam",
      agentId: "claire",
      observationKind: "preference_declaration" as const,
      evidenceChannel: "stated" as const,
      verificationStatus: "attested" as const,
      sourceType: "claire_explicit_preference_correction",
      sourceReference: "turn:call-1:1",
      occurredAt: "2026-10-07T12:00:00.000Z",
      context: null,
      payload: null,
      metadata: null,
      idempotencyKey: "x",
      createdAt: "2026-10-07T12:00:00.000Z",
    }));
    const setPreference = vi.fn(async input => ({
      id: "pref-1",
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      preferenceKey: input.preferenceKey,
      value: input.value,
      version: 1,
      sourceObservationId: input.sourceObservationId,
      status: "active" as const,
      createdAt: "2026-10-07T12:00:00.000Z",
    }));

    const result = await captureExplicitDaphnePreferenceCorrections(
      {
        tenantId: "tenant-a",
        operatorUserId: "adam",
        utterance: "Stop repeating yourself.",
        conversationId: "call-1",
        turnId: "call-1:1",
      },
      {
        enabled: () => true,
        resolveIdentity: async () => ({
          ok: true as const,
          identity: {
            tenantId: "tenant-a",
            canonicalOperatorId: "operator-a",
          },
        }) as any,
        recordObservation: recordObservation as any,
        setPreference: setPreference as any,
      }
    );

    expect(result.status).toBe("persisted");
    expect(recordObservation).toHaveBeenCalledTimes(1);
    expect(setPreference).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      canonicalOperatorId: "operator-a",
      preferenceKey: "avoid_repetition",
      value: true,
      sourceObservationId: "obs-correction-1",
    });
  });

});
