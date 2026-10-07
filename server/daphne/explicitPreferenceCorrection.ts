import { createHash } from "node:crypto";
import { resolveCanonicalOperatorIdentity } from "../persistentOperator/identity";
import { isDaphneV2ClaireEnabled } from "./claireAdapter";
import {
  setDaphneMetaPreference,
  type DaphneMetaPreferenceKey,
} from "./goalsPreferences";
import { recordDaphneObservation } from "./observationStore";

export type DaphneExplicitPreferenceCorrection = {
  preferenceKey: DaphneMetaPreferenceKey;
  value: unknown;
  evidenceText: string;
};

export type DaphneExplicitPreferenceCaptureResult = {
  status: "disabled" | "no_match" | "identity_unresolved" | "persisted";
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

  const out: DaphneExplicitPreferenceCorrection[] = [];

  if (
    /(?:stop|don't|do not)s+(?:repeating|repeat)s+(?:yourself|things|questions?|advice)?/i.test(text) ||
    /(?:don't|do not)s+keeps+(?:asking|telling)s+mes+thes+same/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "avoid_repetition",
      value: true,
      evidenceText: text,
    });
  }

  if (
    /(?:keep|make)s+(?:yours+)?(?:answers?|responses?)s+(?:shorter|briefer|more concise)/i.test(text) ||
    /(?:give me|be)s+(?:mores+)?(?:concise|brief|short)/i.test(text) ||
    /(?:less detail|fewer details)/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_detail",
      value: 0.2,
      evidenceText: text,
    });
  }

  if (
    /(?:give me|add|include)s+mores+detail/i.test(text) ||
    /(?:be|make (?:your )?(?:answers?|responses?))s+mores+detailed/i.test(text) ||
    /explains+(?:its+)?more/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_detail",
      value: 0.85,
      evidenceText: text,
    });
  }

  if (
    /(?:be|sound)s+mores+direct/i.test(text) ||
    /(?:tell me straight|be blunt(?:er)?|get to the point)/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_directness",
      value: 0.9,
      evidenceText: text,
    });
  }

  if (
    /(?:be|sound)s+lesss+direct/i.test(text) ||
    /(?:be softer|less blunt)/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "response_directness",
      value: 0.25,
      evidenceText: text,
    });
  }

  if (
    /(?:challenge|push)s+mes+more/i.test(text) ||
    /holds+mes+(?:mores+)?accountable/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "challenge_level",
      value: 0.85,
      evidenceText: text,
    });
  }

  if (
    /(?:challenge|push)s+mes+less/i.test(text) ||
    /(?:don't|do not)s+pushs+mes+(?:sos+)?hard/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "challenge_level",
      value: 0.2,
      evidenceText: text,
    });
  }

  if (
    /(?:be more proactive|take more initiative)/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "proactive_initiative",
      value: "high",
      evidenceText: text,
    });
  }

  if (
    /(?:be less proactive|take less initiative|ask me before you take initiative)/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "proactive_initiative",
      value: "low",
      evidenceText: text,
    });
  }

  if (
    /(?:don't|do not|stop)s+(?:personaliz(?:e|ing)|adapt(?:ing)?)/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "adaptation_enabled",
      value: false,
      evidenceText: text,
    });
  }

  if (
    /(?:don't|do not|stop)s+experiment(?:ing)?s+(?:on|with)s+me/i.test(text)
  ) {
    pushUnique(out, {
      preferenceKey: "safe_experimentation",
      value: false,
      evidenceText: text,
    });
  }

  // Avoid treating a quoted hypothetical/question as an instruction.
  if (
    lower.endsWith("?") &&
    /(?:should|would|could)/.test(lower) &&
    !/(?:please|i want|i need|from now on)/.test(lower)
  ) {
    return [];
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
}): Promise<DaphneExplicitPreferenceCaptureResult> {
  if (!isDaphneV2ClaireEnabled(input.tenantId)) {
    return { status: "disabled", corrections: [], observationIds: [] };
  }

  const corrections = detectExplicitDaphnePreferenceCorrections(input.utterance);
  if (!corrections.length) {
    return { status: "no_match", corrections: [], observationIds: [] };
  }

  const raw = input.operatorUserId.trim();
  const source = /^\d+$/.test(raw)
    ? { type: "user_id" as const, value: Number(raw) }
    : { type: "open_id" as const, value: raw };
  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source,
    subsystem: "daphne_v2_explicit_preference_correction",
  });
  if (!resolution.ok) {
    return { status: "identity_unresolved", corrections, observationIds: [] };
  }

  const observationIds: string[] = [];
  for (const correction of corrections) {
    const idempotencyKey = `explicit-correction:${stableObservationKey({
      conversationId: input.conversationId,
      turnId: input.turnId,
      preferenceKey: correction.preferenceKey,
      value: correction.value,
    })}`;
    const observed = await recordDaphneObservation({
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
    await setDaphneMetaPreference({
      tenantId: input.tenantId,
      canonicalOperatorId: resolution.identity.canonicalOperatorId,
      preferenceKey: correction.preferenceKey,
      value: correction.value,
      sourceObservationId: observed.id,
    });
  }

  return { status: "persisted", corrections, observationIds };
}
