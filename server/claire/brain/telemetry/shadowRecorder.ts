/**
 * Durable, inspectable Brain V2 shadow telemetry.
 *
 * Reuses Claire's existing generation-log infrastructure. The generated-text column is
 * deliberately empty: transcript authority remains the conversation ledger, and this
 * record stores cognition classes only.
 */

import { appendClaireAnswerPathLog } from "../../character/generationLog";
import type { ShadowObservation } from "../shadow/observeShadowTurn";

type ShadowLogInput = Parameters<typeof appendClaireAnswerPathLog>[0];
export type ShadowLogWriter = (input: ShadowLogInput) => Promise<void>;

export function shadowObservationLogInput(observation: ShadowObservation): ShadowLogInput {
  return {
    tenantId: observation.tenantId,
    operatorUserId: observation.operatorUserId,
    answerPath: "brain_v2_shadow",
    businessReader: observation.comparison.evidenceReaders.join(",") || null,
    rendererProse: false,
    surface: observation.surface,
    turnKind: observation.comparison.control.mode,
    modelRequested: null,
    modelServed: null,
    promptChars: null,
    fallbackReason: null,
    spokenText: "",
    detail: {
      version: "claire-brain-v2",
      comparison: observation.comparison,
      disagreements: observation.disagreements,
      candidateEndCall: observation.candidateEndCall,
      candidateActionClasses: observation.candidateActionClasses,
      shadowFailureCategory: null,
    },
  };
}

export async function persistShadowObservation(
  observation: ShadowObservation,
  write: ShadowLogWriter = appendClaireAnswerPathLog
): Promise<void> {
  await write(shadowObservationLogInput(observation));
}

export async function persistShadowFailure(input: {
  tenantId: string;
  operatorUserId: string;
  surface: "voice" | "text";
  conversationKey: string;
  category: "observer_error" | "authority_violation";
}): Promise<void> {
  await appendClaireAnswerPathLog({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    answerPath: "brain_v2_shadow",
    businessReader: null,
    rendererProse: false,
    surface: input.surface,
    turnKind: "failure",
    modelRequested: null,
    modelServed: null,
    promptChars: null,
    fallbackReason: input.category,
    spokenText: "",
    detail: {
      version: "claire-brain-v2",
      conversationKey: input.conversationKey,
      shadowFailureCategory: input.category,
    },
  });
}
