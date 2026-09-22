import type { EvidenceItem } from "./evidence";

/**
 * Working memory is the current conversational thread — not a second database.
 * Pending objects answer "what is yes referring to?" They do not interpret new speech.
 */

export type PendingDispositionHint = "none" | "confirm" | "reject" | "revise" | "supersede";

export type OrderedQueryMember = {
  id: string;
  label: string | null;
};

/**
 * QUERY RESULT is not WHAT CLAIRE ACTUALLY PRESENTED.
 * Continuation ("the other four") walks unresolved members of the same result,
 * never a fresh window of records 6–9.
 */
export type OrderedQueryMemory = {
  /**
   * The evidence item that licensed this result. A continuation re-cites it, so
   * "the other four" carries the original read's as-of time — it is the same read,
   * a different slice, never a fresh claim about now.
   */
  sourceEvidence: EvidenceItem | null;
  queryFingerprint: string;
  parameters: unknown;
  requestedCardinality: number | null;
  ordering: "last" | "first" | "before_anchor" | "after_anchor" | null;
  anchorEntity: string | null;
  /** Exclusions live on this query thread only. A new unrelated query resets them. */
  exclusions: string[];
  resolved: OrderedQueryMember[];
  presented: OrderedQueryMember[];
};

export type FocusEntity = {
  mentioned: string;
  contactName: string | null;
  accountId: number | null;
  accountName: string | null;
};

export type PendingProposalSnapshot = {
  identity: string;
  kind: "day_line" | "briefing" | "account_follow_up" | "other";
  createdAtMs: number;
  reminded: boolean;
  hints: string[];
};

export type PriorClaimRef = {
  receiptId: string;
  claireTurnOrdinal: number;
  claimType: string;
  recheckable: boolean;
};

/**
 * Cognitive strategic-work frame. Understanding a declaration is not a write.
 * `durability` is fixed so this object cannot be mistaken for a mission receipt.
 */
export type StrategicWorkMemory = {
  durability: "cognitive_only";
  status: "unresolved" | "content_held";
  /** Short semantic label. Not a copy of the turn transcript. */
  contentLabel: string | null;
  openedAtMs: number;
};

export type WorkingMemorySnapshot = {
  threadId: string;
  focusEntities: FocusEntity[];
  pendingProposal: PendingProposalSnapshot | null;
  pendingBriefing: PendingProposalSnapshot | null;
  pendingAccountFollowUp: PendingProposalSnapshot | null;
  orderedQuery: OrderedQueryMemory | null;
  priorClaims: PriorClaimRef[];
  unresolvedReferences: string[];
  /** Mission/strategic thread. Null when no such frame is open. */
  activeWorkFrame: StrategicWorkMemory | null;
  pendingFragment: string | null;
  fragmentHolds: number;
  currentCallContext: {
    surface: "voice" | "text";
    conversationKey: string;
    tenantId: string;
    operatorUserId: string;
  };
};
