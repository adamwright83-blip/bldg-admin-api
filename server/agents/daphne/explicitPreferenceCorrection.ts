import { createHash } from "node:crypto";
import { resolveCanonicalOperatorIdentity } from "../persistentOperator/identity";
import { isDaphneV2ClaireEnabled } from "./claireAdapter";
import {
  setDaphneMetaPreference,
  loadDaphneMetaPreferences,
  type DaphneMetaPreferenceKey,
} from "./goalsPreferences";
import { recordDaphneObservation } from "./observationStore";

export type DaphneExplicitPreferenceCorrection = {
  preferenceKey: DaphneMetaPreferenceKey;
  value: unknown;
  evidenceText: string;
};

export type DaphneExplicitPreferenceCaptureResult = {
  status: "disabled" | "no_match" | "identity_unresolved" | "persisted" | "persistence_failed" | "readback_failed";
  readbackVerified: boolean;
  corrections: DaphneExplicitPreferenceCorrection[];
  observationIds: string[];
};

function pushUnique(
  out: DaphneExplicitPreferenceCorrection[],
  next: DaphneExplicitPreferenceCorrection
): void {
  if (!out.some(item => item.preferenceKey === next.preferenceKey)) out.push(next);
}

/**
 * Intentionally narrow parser for explicit operator-authored style corrections.
 * This does not infer hidden preference from behavior. It only recognizes
 * direct instructions that are safe to persist as MetaPreferences.
 */
export function detectExplicitDaphnePreferenceCorrections(
  utterance: string
): DaphneExplicitPreferenceCorrection[] {
  const text = utterance.trim();
  const lower = text.toLowerCase();
  if (!text) return [];
  if (/["“”]|\b(?:hypothetical|pretend|imagine|joking|sarcastic|said)\b/i.test(text)) return [];

  // Avoid treating a hypothetical question as a durable instruction.
  if (
    lower.endsWith("?") &&
    /\b(?:should|would|could)\b/.test(lower) &&
    !/\b(?:please|i want|i need|from now on)\b/.test(lower)
  ) {
    return [];
  }

  const out: DaphneExplicitPreferenceCorrection[] = [];

  if (/^(?:I prefer Claire to ask one question at a time|Please ask (?:me )?one question at a time)[.!]?$/i.test(text)) {
    pushUnique(out, { preferenceKey: "question_batch_size", value: 1, evidenceText: text });
  }

  if (
    /\b(?:stop|don't|do not)\s+(?:repeating|repeat)\s+(?:yourself|things|questions?|advice)?\b/i.test(text) ||
    /\b(?:don't|do not)\s+keep\s+(?:asking|telling)\s+me\s+the\s+same\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "avoid_repetition",
      value: true,
      evidenceText: text,
    });
  }

  if (
    /\b(?:keep|make)\s+(?:your\s+)?(?:answers?|responses?)\s+(?:shorter|briefer|more concise)\b/i.test(text) ||
    /\b(?:give me|be)\s+(?:more\s+)?(?:concise|brief|short)\b/i.test(text) ||
    /\b(?:less detail|fewer details)\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_detail",
      value: 0.2,
      evidenceText: text,
    });
  }

  if (
    /\b(?:give me|add|include)\s+more\s+detail\b/i.test(text) ||
    /\b(?:be|make (?:your )?(?:answers?|responses?))\s+more\s+detailed\b/i.test(text) ||
    /\bexplain\s+(?:it\s+)?more\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_detail",
      value: 0.85,
      evidenceText: text,
    });
  }

  if (
    /\b(?:be|sound)\s+more\s+direct\b/i.test(text) ||
    /\b(?:tell me straight|be blunt(?:er)?|get to the point)\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_directness",
      value: 0.9,
      evidenceText: text,
    });
  }

  if (
    /\b(?:be|sound)\s+less\s+direct\b/i.test(text) ||
    /\b(?:be softer|less blunt)\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_directness",
      value: 0.25,
      evidenceText: text,
    });
  }

  if (
    /\b(?:challenge|push)\s+me\s+more\b/i.test(text) ||
    /\bhold\s+me\s+(?:more\s+)?accountable\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "challenge_level",
      value: 0.85,
      evidenceText: text,
    });
  }

  if (
    /\b(?:challenge|push)\s+me\s+less\b/i.test(text) ||
    /\b(?:don't|do not)\s+push\s+me\s+(?:so\s+)?hard\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "challenge_level",
      value: 0.2,
      evidenceText: text,
    });
  }

  if (/\b(?:be more proactive|take more initiative)\b/i.test(text)) {
    pushUnique(out, {
      preferenceKey: "proactive_initiative",
      value: "high",
      evidenceText: text,
    });
  }

  if (
    /\b(?:be less proactive|take less initiative|ask me before you take initiative)\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "proactive_initiative",
      value: "low",
      evidenceText: text,
    });
  }

  if (
    /\b(?:don't|do not|stop)\s+(?:personaliz(?:e|ing)|adapt(?:ing)?)\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "adaptation_enabled",
      value: false,
      evidenceText: text,
    });
  }

  if (
    /\b(?:don't|do not|stop)\s+experiment(?:ing)?\s+(?:on|with)\s+me\b/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "safe_experimentation",
      value: false,
      evidenceText: text,
    });
  }

  return out;
}

function stableObservationKey(input: {
  conversationId: string;
  turnId: string;
  preferenceKey: DaphneMetaPreferenceKey;
  value: unknown;
}): string {
  return createHash("sha256")
    .update(
      [
        input.conversationId,
        input.turnId,
        input.preferenceKey,
        JSON.stringify(input.value),
      ].join("\u0000")
    )
    .digest("hex");
}

export async function captureExplicitDaphnePreferenceCorrections(input: {
  tenantId: string;
  operatorUserId: string;
  utterance: string;
  conversationId: string;
  turnId: string;
}, dependencies: {
  enabled?: (tenantId: string) => boolean;
  resolveIdentity?: typeof resolveCanonicalOperatorIdentity;
  recordObservation?: typeof recordDaphneObservation;
  setPreference?: typeof setDaphneMetaPreference;
  readPreferences?: typeof loadDaphneMetaPreferences;
} = {}): Promise<DaphneExplicitPreferenceCaptureResult> {
  const enabled = dependencies.enabled ?? isDaphneV2ClaireEnabled;
  const resolveIdentity = dependencies.resolveIdentity ?? resolveCanonicalOperatorIdentity;
  const recordObservation = dependencies.recordObservation ?? recordDaphneObservation;
  const setPreference = dependencies.setPreference ?? setDaphneMetaPreference;
  const readPreferences = dependencies.readPreferences ?? loadDaphneMetaPreferences;
  const corrections = detectExplicitDaphnePreferenceCorrections(input.utterance);
  const result = (
    status: DaphneExplicitPreferenceCaptureResult["status"],
    observationIds: string[] = []
  ): DaphneExplicitPreferenceCaptureResult => {
    if (corrections.length) console.info("[DaphnePreference]", JSON.stringify({
      event: "durable_preference_capture", status,
      readbackVerified: status === "persisted",
      preferenceKeys: corrections.map(c => c.preferenceKey),
    }));
    return { status, corrections, observationIds, readbackVerified: status === "persisted" };
  };
  if (!corrections.length) return result("no_match");
  if (!enabled(input.tenantId)) return result("disabled");

  const raw = input.operatorUserId.trim();
  const source = /^\d+$/.test(raw)
    ? { type: "user_id" as const, value: Number(raw) }
    : { type: "open_id" as const, value: raw };
  const resolution = await resolveIdentity({
    tenantId: input.tenantId,
    source,
    subsystem: "daphne_v2_explicit_preference_correction",
  }).catch(() => null);
  if (!resolution?.ok) return result("identity_unresolved");

  const observationIds: string[] = [];
  const sources = new Map<DaphneMetaPreferenceKey, string>();
  try {
  for (const correction of corrections) {
    const idempotencyKey = `explicit-correction:${stableObservationKey({
      conversationId: input.conversationId,
      turnId: input.turnId,
      preferenceKey: correction.preferenceKey,
      value: correction.value,
    })}`;
    const observed = await recordObservation({
      tenantId: input.tenantId,
      canonicalOperatorId: resolution.identity.canonicalOperatorId,
      operatorUserId: raw,
      sessionId: input.conversationId,
      actorType: "user",
      actorId: raw,
      agentId: "claire",
      observationKind: "preference_declaration",
      evidenceChannel: "stated",
      verificationStatus: "attested",
      sourceType: "claire_explicit_preference_correction",
      sourceReference: `turn:${input.turnId}`.slice(0, 191),
      occurredAt: new Date(),
      payload: {
        preferenceKey: correction.preferenceKey,
        value: correction.value,
        correction: true,
        evidenceText: correction.evidenceText.slice(0, 1000),
      },
      idempotencyKey,
    });
    observationIds.push(observed.id);
    sources.set(correction.preferenceKey, observed.id);
    await setPreference({
      tenantId: input.tenantId,
      canonicalOperatorId: resolution.identity.canonicalOperatorId,
      preferenceKey: correction.preferenceKey,
      value: correction.value,
      sourceObservationId: observed.id,
      deduplicateSource: true,
    });
  }
  } catch {
    return result("persistence_failed", observationIds);
  }

  // A successful write is not an acknowledgement. Require a fresh durable
  // read of the latest tenant/operator-scoped preference and its source receipt.
  try {
    const latest = await readPreferences({
      tenantId: input.tenantId,
      canonicalOperatorId: resolution.identity.canonicalOperatorId,
    });
    const verified = corrections.every(correction => {
      const stored = latest[correction.preferenceKey];
      return stored?.status === "active" &&
        stored.sourceObservationId === sources.get(correction.preferenceKey) &&
        JSON.stringify(stored.value) === JSON.stringify(correction.value);
    });
    return result(verified ? "persisted" : "readback_failed", observationIds);
  } catch {
    return result("readback_failed", observationIds);
  }
}
