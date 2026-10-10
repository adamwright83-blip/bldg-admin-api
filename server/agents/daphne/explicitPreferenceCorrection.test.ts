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

  it("captures a direct question-batch preference but not quoted or hypothetical instructions",()=>{
    expect(detectExplicitDaphnePreferenceCorrections("I prefer Claire to ask one question at a time.")).toEqual([
      expect.objectContaining({preferenceKey:"question_batch_size",value:1})]);
    expect(detectExplicitDaphnePreferenceCorrections('Claire said "keep your answers shorter".')).toEqual([]);
    expect(detectExplicitDaphnePreferenceCorrections("Imagine I said give me more detail.")).toEqual([]);
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
        readPreferences: (async () => ({
          avoid_repetition: {
            status: "active", sourceObservationId: "obs-correction-1", value: true,
          },
        })) as any,
      }
    );

    expect(result.status).toBe("persisted");
    expect(result.readbackVerified).toBe(true);
    expect(recordObservation).toHaveBeenCalledTimes(1);
    expect(setPreference).toHaveBeenCalledWith({
      deduplicateSource: true,
      tenantId: "tenant-a",
      canonicalOperatorId: "operator-a",
      preferenceKey: "avoid_repetition",
      value: true,
      sourceObservationId: "obs-correction-1",
    });
  });


  it("never claims success when a stored preference cannot be read back", async () => {
    const result = await captureExplicitDaphnePreferenceCorrections(
      {
        tenantId: "tenant-a", operatorUserId: "adam",
        utterance: "Keep your answers shorter from now on.",
        conversationId: "call-2", turnId: "call-2:1",
      },
      {
        enabled: () => true,
        resolveIdentity: (async () => ({
          ok: true, identity: { tenantId: "tenant-a", canonicalOperatorId: "operator-a" },
        })) as any,
        recordObservation: (async () => ({ id: "obs-short" })) as any,
        setPreference: (async () => ({
          status: "active", value: 0.2, sourceObservationId: "obs-short",
        })) as any,
        readPreferences: (async () => ({})) as any,
      }
    );
    expect(result.status).toBe("readback_failed");
    expect(result.readbackVerified).toBe(false);
    expect(result.corrections[0].value).toBe(0.2);
  });

  it("returns a failure receipt for storage errors, never a standing-rule success", async () => {
    const result = await captureExplicitDaphnePreferenceCorrections(
      {
        tenantId: "tenant-a", operatorUserId: "adam",
        utterance: "Keep your answers shorter from now on.",
        conversationId: "call-3", turnId: "call-3:1",
      },
      {
        enabled: () => true,
        resolveIdentity: (async () => ({
          ok: true, identity: { tenantId: "tenant-a", canonicalOperatorId: "operator-a" },
        })) as any,
        recordObservation: (async () => { throw new Error("storage unavailable"); }) as any,
      }
    );
    expect(result.status).toBe("persistence_failed");
    expect(result.readbackVerified).toBe(false);
  });

  it("preserves correction intent when Daphne is disabled", async () => {
    const result = await captureExplicitDaphnePreferenceCorrections(
      {
        tenantId: "tenant-a", operatorUserId: "adam",
        utterance: "Keep your answers shorter from now on.",
        conversationId: "call-disabled", turnId: "call-disabled:1",
      },
      { enabled: () => false }
    );
    expect(result.status).toBe("disabled");
    expect(result.corrections.map(c => c.preferenceKey)).toEqual(["response_detail"]);
    expect(result.readbackVerified).toBe(false);
  });
});
