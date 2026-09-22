/**
 * Durable, inspectable Brain V2 shadow telemetry.
 *
 * Reuses Claire's existing generation-log infrastructure. The generated-text column is
 * deliberately empty: transcript authority remains the conversation ledger, and this
 * record stores cognition classes only.
 *
 * The inspector mirror is intentionally single-line structured console telemetry. Railway
 * can read it without SQL, so an operator never has to open the database just to inspect
 * a shadow trial. It carries cognition classes only: no utterance text, candidate prose,
 * phone numbers, provider identifiers, tokens, or evidence payloads.
 */

import { appendClaireAnswerPathLog } from "../../character/generationLog";
import type { ShadowObservation } from "../shadow/observeShadowTurn";

type ShadowLogInput = Parameters<typeof appendClaireAnswerPathLog>[0];
export type ShadowLogWriter = (input: ShadowLogInput) => Promise<void>;
export type ShadowInspectorLogger = (line: string) => void;

export type ShadowInspectorRecord = {
  event: "claire_brain_v2_shadow";
  version: "claire-brain-v2";
  conversationKey: string;
  surface: "voice" | "text";
  turnKind: string;
  perceived: ShadowObservation["comparison"]["perceived"];
  control: ShadowObservation["comparison"]["control"];
  attention: ShadowObservation["comparison"]["attention"];
  retrievalKinds: string[];
  evidenceTypes: string[];
  evidenceReaders: string[];
  inhibited: string[];
  conclusions: string[];
  actionClasses: string[];
  segmentTypes: string[];
  cognitiveAcknowledgement: string[];
  verificationInvoked: boolean;
  callEnd: boolean;
  disagreements: ShadowObservation["disagreements"];
  candidateEndCall: boolean;
  candidateActionClasses: string[];
};

export function shadowObservationInspectorRecord(
  observation: ShadowObservation
): ShadowInspectorRecord {
  return {
    event: "claire_brain_v2_shadow",
    version: "claire-brain-v2",
    conversationKey: observation.comparison.conversationKey,
    surface: observation.surface,
    turnKind: observation.comparison.control.mode,
    perceived: observation.comparison.perceived,
    control: observation.comparison.control,
    attention: observation.comparison.attention,
    retrievalKinds: observation.comparison.retrievalKinds,
    evidenceTypes: observation.comparison.evidenceTypes,
    evidenceReaders: observation.comparison.evidenceReaders,
    inhibited: observation.comparison.inhibited,
    conclusions: observation.comparison.conclusions,
    actionClasses: observation.comparison.actionClasses,
    segmentTypes: observation.comparison.segmentTypes,
    cognitiveAcknowledgement: observation.comparison.cognitiveAcknowledgement,
    verificationInvoked: observation.comparison.verificationInvoked,
    callEnd: observation.comparison.callEnd,
    disagreements: observation.disagreements,
    candidateEndCall: observation.candidateEndCall,
    candidateActionClasses: observation.candidateActionClasses,
  };
}

function emitInspectorRecord(
  record: ShadowInspectorRecord | {
    event: "claire_brain_v2_shadow";
    version: "claire-brain-v2";
    conversationKey: string;
    surface: "voice" | "text";
    turnKind: "failure";
    shadowFailureCategory: "observer_error" | "authority_violation";
  },
  log: ShadowInspectorLogger = console.info
): void {
  try {
    // One physical log line so the Railway connector can retrieve a complete turn atomically.
    log(`[ClaireBrainV2] ${JSON.stringify(record)}`);
  } catch {
    // Inspector logging is telemetry only. It must never affect persistence or the live turn.
  }
}

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
  write: ShadowLogWriter = appendClaireAnswerPathLog,
  log: ShadowInspectorLogger = console.info
): Promise<void> {
  emitInspectorRecord(shadowObservationInspectorRecord(observation), log);
  await write(shadowObservationLogInput(observation));
}

export async function persistShadowFailure(input: {
  tenantId: string;
  operatorUserId: string;
  surface: "voice" | "text";
  conversationKey: string;
  category: "observer_error" | "authority_violation";
}): Promise<void> {
  emitInspectorRecord({
    event: "claire_brain_v2_shadow",
    version: "claire-brain-v2",
    conversationKey: input.conversationKey,
    surface: input.surface,
    turnKind: "failure",
    shadowFailureCategory: input.category,
  });
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
