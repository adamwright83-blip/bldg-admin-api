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
  | CallControlSegment;

export type ResponsePlan = {
  perceivedTurn: PerceivedTurn;
  attention: AttentionPlan;
  segments: ResponseSegment[];
};
