/**
 * Evidence items are the only facts Executive Function may believe for a turn.
 * Model confidence is not evidence. Episodic observation is not current truth.
 */

export type EvidenceType =
  | "business_query"
  | "account_state"
  | "open_orders"
  | "operations"
  | "day_line_read"
  | "field_today"
  | "conversation_turn"
  | "operator_utterance"
  | "claim_receipt"
  | "prior_claim_recheck"
  | "relationship_state"
  | "disclosure_entitlement"
  | "goal_recommendation"
  | "mutation_receipt"
  | "working_memory";

export type EvidenceAuthority =
  | "current_business_truth"
  | "historical_observation"
  | "operator_utterance"
  | "working_memory"
  | "self_state"
  | "goal_recommendation"
  | "mutation_receipt"
  | "provenance_receipt";

export type EvidenceProvenance = {
  reader: string;
  /** Write-path stamps. Display names are not provenance. */
  providerName?: string | null;
  accountType?: string | null;
  identityKey?: string | null;
  fixture?: boolean;
  synthetic?: boolean;
};

export type EvidenceFreshness = {
  completeness: string | null;
  loadedSources: string[];
  failedSources: string[];
};

export type EvidenceCoverage = {
  complete: boolean;
  gaps: string[];
};

export type EvidenceItem = {
  id: string;
  type: EvidenceType;
  source: string;
  provenance: EvidenceProvenance;
  observedAt: string;
  asOf: string;
  freshness: EvidenceFreshness | null;
  coverage: EvidenceCoverage | null;
  authoritativeFor: EvidenceAuthority[];
  payload: unknown;
  /** False items must never enter the authorized operator's evidence bundle. */
  operatorVisible: boolean;
};

export type EvidenceRef = {
  evidenceId: string;
};

export type PriorClaimRecheckResolution = "receipt_only" | "fresh_query" | "not_attempted";

export type PriorClaimRecheckResult = {
  receiptId: string;
  resolution: PriorClaimRecheckResolution;
  outcome:
    | "verified"
    | "grounded_as_stated"
    | "synthesis_grounded"
    | "superseded"
    | "stale_source"
    | "changed"
    | "unsupported"
    | "unverifiable";
  evidenceIds: string[];
};
