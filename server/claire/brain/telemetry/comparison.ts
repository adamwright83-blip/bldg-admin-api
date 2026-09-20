/**
 * Safe shadow comparison record. No secrets, phones, tokens, or provider payloads.
 */

import type { AttentionPlan } from "../contracts/attention";
import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { PerceivedTurn } from "../contracts/perceivedTurn";

export type ShadowComparisonRecord = {
  conversationKey: string;
  perceived: {
    businessIntent: PerceivedTurn["businessIntent"];
    callControl: PerceivedTurn["callControl"];
    completeness: PerceivedTurn["completeness"];
    entities: string[];
    temporal: string[];
    cardinality: number | null;
    acknowledgement: boolean;
    refusal: boolean;
    explicitActionRequest: boolean;
    operatorWorkCommitment: boolean;
  };
  attention: {
    lanes: AttentionPlan["lanes"];
    retrieve: AttentionPlan["retrieve"];
    doNotRetrieve: AttentionPlan["doNotRetrieve"];
    boardEligible: boolean;
    pendingDisposition: AttentionPlan["pendingDisposition"];
    priorClaim: AttentionPlan["priorClaim"];
    continueOrderedQuery: boolean;
  };
  /** Which compartments were consulted, and for what. Classes only, never payloads. */
  retrievalKinds: string[];
  evidenceIds: string[];
  evidenceTypes: string[];
  /** Provenance classes (which reader), so a disagreement can be traced to a source. */
  evidenceReaders: string[];
  /** Why a candidate was blocked — the most useful signal when the minds disagree. */
  inhibited: string[];
  conclusions: string[];
  actionClasses: string[];
  segmentTypes: string[];
  callEnd: boolean;
  productionAuthority: false;
};

export function comparisonRecordFromDecision(
  conversationKey: string,
  decision: ExecutiveDecision
): ShadowComparisonRecord {
  return {
    conversationKey,
    perceived: {
      businessIntent: decision.perceivedTurn.businessIntent,
      callControl: decision.perceivedTurn.callControl,
      completeness: decision.perceivedTurn.completeness,
      entities: decision.perceivedTurn.entities.map(entity => entity.raw),
      temporal: decision.perceivedTurn.temporalReferences,
      cardinality: decision.perceivedTurn.cardinality,
      acknowledgement: decision.perceivedTurn.acknowledgement,
      refusal: decision.perceivedTurn.refusal,
      explicitActionRequest: decision.perceivedTurn.explicitActionRequest,
      operatorWorkCommitment: decision.perceivedTurn.operatorWorkCommitment,
    },
    attention: {
      lanes: decision.attention.lanes,
      retrieve: decision.attention.retrieve,
      doNotRetrieve: decision.attention.doNotRetrieve,
      boardEligible: decision.attention.boardEligible,
      pendingDisposition: decision.attention.pendingDisposition,
      priorClaim: decision.attention.priorClaim,
      continueOrderedQuery: decision.attention.continueOrderedQuery,
    },
    retrievalKinds: decision.retrievals.map(request => `${request.compartment}:${request.kind}`),
    evidenceIds: decision.evidence.map(item => item.id),
    evidenceTypes: decision.evidence.map(item => item.type),
    evidenceReaders: Array.from(new Set(decision.evidence.map(item => item.provenance.reader))),
    inhibited: decision.inhibitedCandidates.map(candidate => candidate.kind),
    conclusions: decision.conclusions.map(conclusion => conclusion.kind),
    actionClasses: decision.actionGrants.map(grant => grant.actionClass),
    segmentTypes: decision.responsePlan.segments.map(segment => segment.type),
    callEnd: decision.callControl.endCall,
    productionAuthority: false,
  };
}
