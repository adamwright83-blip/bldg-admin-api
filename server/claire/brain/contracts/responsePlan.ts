/**
 * ResponsePlan is authored BEFORE spoken prose.
 * The renderer consumes the plan. It does not reverse-engineer the plan from a string.
 * There is no planFromSpeak in Brain V2.
 */

import type { EvidenceRef, PriorClaimRecheckResult } from "./evidence";
import type {
  CallControlGrant,
  ExecutiveActionGrant,
  NarrativeRevealGrant,
  PersonalDisclosureGrant,
} from "./grants";
import type { PerceivedTurn } from "./perceivedTurn";
import type { AttentionPlan } from "./attention";

export type BusinessFactSegment = {
  type: "BusinessFactSegment";
  text: string;
  evidence: EvidenceRef[];
  origin: "authoritative_reader";
  /** When this fact is a fresh correctness confirmation. */
  recheck?: PriorClaimRecheckResult;
};

export type BusinessJudgmentSegment = {
  type: "BusinessJudgmentSegment";
  text: string;
  evidence: EvidenceRef[];
  accountId: number | null;
  contactName: string | null;
  mutationAuthority: false;
};

export type ActionProposalSegment = {
  type: "ActionProposalSegment";
  text: string;
  grant: ExecutiveActionGrant;
};

export type ActionConfirmationSegment = {
  type: "ActionConfirmationSegment";
  text: string;
  grant: ExecutiveActionGrant;
  mutationReceipts: Array<{ claimedState: string; entityId: string; statement: string }>;
};

export type PersonalDisclosureSegment = {
  type: "PersonalDisclosureSegment";
  text: string;
  grant: PersonalDisclosureGrant;
};

export type NarrativeRevealSegment = {
  type: "NarrativeRevealSegment";
  text: string;
  grant: NarrativeRevealGrant;
};

export type ConversationalSegment = {
  type: "ConversationalSegment";
  text: string;
};

/**
 * Executive understood something. This segment carries no grant.
 * `durableWrite` is the literal false so a renderer cannot treat understanding as a save.
 */
export type CognitiveAcknowledgementKind =
  | "awaiting_strategic_content"
  | "strategic_content_understood"
  | "operator_intent_understood"
  | "attention_repaired"
  | "pending_reactivated";

export const PLANNING_AUTHORITIES_NOT_TOUCHED = [
  "weekly_intent",
  "daily_command",
  "mission_director",
  "day_line_commit",
  "narrator",
  "mission_completion",
] as const;

export type PlanningAuthorityNotTouched = (typeof PLANNING_AUTHORITIES_NOT_TOUCHED)[number];

export type CognitiveAcknowledgementSegment = {
  type: "CognitiveAcknowledgementSegment";
  kind: CognitiveAcknowledgementKind;
  durableWrite: false;
  /** Present when the turn understood strategic work and did not touch those systems. */
  collisionsAvoided?: readonly PlanningAuthorityNotTouched[];
  text: string;
};

export type CallControlSegment = {
  type: "CallControlSegment";
  text: string;
  endCall: boolean;
  /** Required when endCall is true. */
  grant: CallControlGrant | null;
};

export type ResponseSegment =
  | BusinessFactSegment
  | BusinessJudgmentSegment
  | ActionProposalSegment
  | ActionConfirmationSegment
  | PersonalDisclosureSegment
  | NarrativeRevealSegment
  | ConversationalSegment
  | CognitiveAcknowledgementSegment
  | CallControlSegment;

export type ResponsePlan = {
  perceivedTurn: PerceivedTurn;
  attention: AttentionPlan;
  segments: ResponseSegment[];
};
