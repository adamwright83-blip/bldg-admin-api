import { createHash } from "node:crypto";
import { resolveCanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import { recordDaphneObservation } from "../agents/daphne/observationStore";
import { setDaphneMetaPreference } from "../agents/daphne/goalsPreferences";
import { productionExperimentPolicyEnabled } from "../../shared/behavioralExperimentPolicy";
import { loadPresentationConsent, type PresentationConsent, type PresentationScope } from "./presentationRuntime";

/**
 * The exact words the operator agrees to. Versioned: a change to either text is a new
 * version, and the version is stored on every consent observation.
 */
export const PRESENTATION_CONSENT_TEXT = {
  version: "presentation-consent-v1",
  adaptation:
    "Let Daphne adapt how missions are shown to me, using what I tell Claire and what I start and finish. It never changes the work itself.",
  experimentation:
    "Let Daphne compare ways of showing my missions: for some missions it picks plain or story framing at random and records whether I start and finish, to learn what works for me. It never changes what a mission is, never contacts anyone, and I can stop at any time.",
} as const;

export type PresentationConsentChoice = "adaptation" | "experimentation";
export type PresentationConsentView = PresentationConsent & { experimentsRunning: boolean; textVersion: string };

export type PresentationConsentPorts = {
  resolveIdentity: typeof resolveCanonicalOperatorIdentity;
  recordObservation: typeof recordDaphneObservation;
  setPreference: typeof setDaphneMetaPreference;
  loadConsent: typeof loadPresentationConsent;
  experimentsRunning: () => boolean;
  now: () => Date;
};
const defaults: PresentationConsentPorts = {
  resolveIdentity: resolveCanonicalOperatorIdentity,
  recordObservation: recordDaphneObservation,
  setPreference: setDaphneMetaPreference,
  loadConsent: loadPresentationConsent,
  experimentsRunning: productionExperimentPolicyEnabled,
  now: () => new Date(),
};

export async function readPresentationConsent(scope: PresentationScope, ports: PresentationConsentPorts = defaults): Promise<PresentationConsentView> {
  const consent = await ports.loadConsent(scope);
  return { ...consent, experimentsRunning: ports.experimentsRunning(), textVersion: PRESENTATION_CONSENT_TEXT.version };
}

/**
 * Records the operator's own choice from the authenticated app and reads it back.
 * Experimentation is a separate affirmative choice and needs adaptation first; turning
 * adaptation off also turns experimentation off, so re-allowing adaptation never
 * silently resumes experiments.
 */
export async function setPresentationConsent(
  input: PresentationScope & { choice: PresentationConsentChoice; granted: boolean },
  ports: PresentationConsentPorts = defaults
): Promise<PresentationConsentView> {
  const resolved = await ports.resolveIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: input.operatorUserId },
    subsystem: "daphne.presentation_consent",
  });
  if (!resolved.ok) throw new Error("Your operator identity could not be confirmed, so nothing was changed.");
  const before = await ports.loadConsent(input);
  if (input.choice === "experimentation" && input.granted && !before.adaptationAllowed)
    throw new Error("Allow Daphne to adapt how missions are shown first; nothing was changed.");

  // The writes are separate, so their order is the safety property: experimentation
  // is revoked before adaptation changes. A failure part-way can leave experiments
  // off with adaptation unchanged, never experiments latent behind a later re-allow.
  // Re-allowing adaptation from off also clears an experimentation choice left
  // behind (a partial write or a racing grant), so experiments need a fresh choice.
  const resetExperimentation =
    input.choice === "adaptation" &&
    (!input.granted || (!before.adaptationAllowed && before.experimentationChoiceStored === true));
  const changes: Array<{ preferenceKey: "adaptation_enabled" | "safe_experimentation"; value: boolean }> =
    input.choice === "adaptation"
      ? [
          ...(resetExperimentation ? [{ preferenceKey: "safe_experimentation" as const, value: false }] : []),
          { preferenceKey: "adaptation_enabled", value: input.granted },
        ]
      : [{ preferenceKey: "safe_experimentation", value: input.granted }];
  const at = ports.now();
  for (const change of changes) {
    const observed = await ports.recordObservation({
      tenantId: input.tenantId,
      canonicalOperatorId: resolved.identity.canonicalOperatorId,
      operatorUserId: input.operatorUserId,
      actorType: "user",
      actorId: input.operatorUserId,
      agentId: "daphne",
      observationKind: "preference_declaration",
      evidenceChannel: "stated",
      verificationStatus: "attested",
      sourceType: "authenticated_app_presentation_consent",
      sourceReference: `${PRESENTATION_CONSENT_TEXT.version}:${input.choice}`,
      occurredAt: at,
      payload: {
        preferenceKey: change.preferenceKey,
        value: change.value,
        consentTextVersion: PRESENTATION_CONSENT_TEXT.version,
        consentText: change.preferenceKey === "adaptation_enabled" ? PRESENTATION_CONSENT_TEXT.adaptation : PRESENTATION_CONSENT_TEXT.experimentation,
      },
      idempotencyKey: `presentation-consent:${createHash("sha256")
        .update([input.tenantId, resolved.identity.canonicalOperatorId, change.preferenceKey, String(change.value), at.toISOString()].join("\u0000"))
        .digest("hex")}`,
    });
    await ports.setPreference({
      tenantId: input.tenantId,
      canonicalOperatorId: resolved.identity.canonicalOperatorId,
      preferenceKey: change.preferenceKey,
      value: change.value,
      sourceObservationId: observed.id,
    });
  }

  // A write is not a receipt: report only what a fresh read shows.
  const after = await readPresentationConsent(input, ports);
  const intended = input.choice === "adaptation" ? after.adaptationAllowed : after.experimentationAllowed;
  if (intended !== input.granted) throw new Error("Your choice could not be confirmed on read-back. Nothing is assumed; try again.");
  return after;
}
