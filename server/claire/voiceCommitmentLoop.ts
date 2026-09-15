import type { DayDirectorProposal } from "../../shared/dayDirector";
import { acceptProposal, proposeCommitment } from "../dayDirector/dayDirectorService";

/**
 * The only place a live Claire phone conversation may cause a durable
 * business commitment. Detection of "the operator wants to add/change
 * work" and interpretation of the confirmation reply are BOTH deterministic
 * (regex) — the model is never trusted to decide whether a mutation
 * happens, only to normalize wording via the existing proposeCommitment
 * boundary. acceptProposal is called only after an unambiguous "yes" to a
 * proposal that was itself read back to the operator first.
 */

const ADD_WORK_TRIGGER =
  /\b(i need to|i have to|we need to|can you add|please add|add (?:a|this) (?:task|to-do|commitment)|make a note|remind me to|put (?:this|that) on (?:my|the) list|i need you to (?:add|track|remember)|(?:need|have) to (?:decide|choose|select) between)\b/i;

const YES_PATTERN = /\b(yes|yeah|yep|confirm|confirmed|correct|do it|go ahead|add it|save it)\b/i;
const NO_PATTERN = /\b(no|nope|nah|cancel|never ?mind|don'?t|do not|stop|not now)\b/i;

export function detectAddWorkIntent(utterance: string): boolean {
  return ADD_WORK_TRIGGER.test(utterance);
}

export function detectConfirmation(utterance: string): "yes" | "no" | "ambiguous" {
  const hasYes = YES_PATTERN.test(utterance);
  const hasNo = NO_PATTERN.test(utterance);
  if (hasYes && !hasNo) return "yes";
  if (hasNo && !hasYes) return "no";
  return "ambiguous";
}

export function describeProposalForReadback(proposal: DayDirectorProposal): string {
  const quantityPart = proposal.quantity ? `, quantity ${proposal.quantity}` : "";
  return `I heard: ${proposal.title}${quantityPart}. Should I add that to today's plan? Say yes or no.`;
}

export type PendingProposalState = { pendingProposal?: DayDirectorProposal | null };

export type VoiceCommitmentTurnResult =
  | { kind: "proposed"; speak: string }
  | { kind: "accepted"; speak: string; proposal: DayDirectorProposal }
  | { kind: "declined"; speak: string }
  | { kind: "reask"; speak: string }
  | { kind: "not_applicable" };

export async function handleVoiceCommitmentTurn(
  input: {
    tenantId: string;
    actorId: string;
    businessDate: string;
    utterance: string;
    state: PendingProposalState;
  },
  dependencies: {
    propose?: typeof proposeCommitment;
    accept?: typeof acceptProposal;
  } = {}
): Promise<VoiceCommitmentTurnResult> {
  const propose = dependencies.propose ?? proposeCommitment;
  const accept = dependencies.accept ?? acceptProposal;

  if (input.state.pendingProposal) {
    const proposal = input.state.pendingProposal;
    const decision = detectConfirmation(input.utterance);
    if (decision === "yes") {
      // Cleared synchronously, before the first await, so a duplicate
      // Twilio delivery arriving for the same turn can never see a
      // pending proposal to re-confirm — it falls through to ordinary
      // conversation instead. acceptProposal's own idempotencyKey
      // (derived from the verbatim source text) is the second,
      // DB-level line of defense against a duplicate commitment.
      input.state.pendingProposal = null;
      await accept({
        tenantId: input.tenantId,
        actorId: input.actorId,
        businessDate: input.businessDate,
        proposal,
      });
      return { kind: "accepted", speak: `Added: ${proposal.title}.`, proposal };
    }
    if (decision === "no") {
      input.state.pendingProposal = null;
      return { kind: "declined", speak: "Okay, I won't add that." };
    }
    return {
      kind: "reask",
      speak: `Sorry — should I add "${proposal.title}"? Say yes or no.`,
    };
  }

  if (!detectAddWorkIntent(input.utterance)) {
    return { kind: "not_applicable" };
  }

  const proposal = await propose({
    tenantId: input.tenantId,
    sourceText: input.utterance,
  });
  input.state.pendingProposal = proposal;
  return { kind: "proposed", speak: describeProposalForReadback(proposal) };
}
