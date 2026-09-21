/**
 * Deterministic Executive Governor.
 * Model output is not authority. This module validates an ExecutiveDecision.
 */

import { BUSINESS_ANSWER_UNAVAILABLE, type ExecutiveDecision } from "../contracts/executiveDecision";
import type { EvidenceItem } from "../contracts/evidence";
import type { ResponseSegment } from "../contracts/responsePlan";
import { isNarratorBusinessContamination } from "../businessMemory/narratorFirewall";
import { isCallControlGrant, isExecutiveActionGrant, isNarrativeRevealGrant, isPersonalDisclosureGrant } from "./grants";

export class ExecutiveGovernorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutiveGovernorError";
  }
}

function evidenceById(decision: ExecutiveDecision): Map<string, EvidenceItem> {
  return new Map(decision.evidence.map(item => [item.id, item]));
}

function refsExist(segment: ResponseSegment, index: Map<string, EvidenceItem>): void {
  if (!("evidence" in segment)) return;
  if (!segment.evidence.length) {
    throw new ExecutiveGovernorError(`${segment.type} requires EvidenceRef[]`);
  }
  for (const ref of segment.evidence) {
    const item = index.get(ref.evidenceId);
    if (!item) throw new ExecutiveGovernorError(`${segment.type} references missing evidence ${ref.evidenceId}`);
    if (!item.operatorVisible) {
      throw new ExecutiveGovernorError(`synthetic or hidden evidence ${ref.evidenceId} entered the operator bundle`);
    }
  }
}

export function assertGovernedDecision(decision: ExecutiveDecision): void {
  if (decision.productionAuthority !== false) {
    throw new ExecutiveGovernorError("Brain V2 productionAuthority must be false until authorized cutover");
  }
  if (decision.responseSegments !== decision.responsePlan.segments) {
    throw new ExecutiveGovernorError("responseSegments must be the same array as responsePlan.segments");
  }

  const index = evidenceById(decision);

  for (const item of decision.evidence) {
    if (!item.operatorVisible) {
      throw new ExecutiveGovernorError(`synthetic evidence ${item.id} entered the operator bundle`);
    }
    if (item.type === "conversation_turn" && item.authoritativeFor.includes("current_business_truth")) {
      throw new ExecutiveGovernorError("episodic memory cannot be current business truth");
    }
    if (isNarratorBusinessContamination(item)) {
      throw new ExecutiveGovernorError("authored narrative material cannot become a business fact");
    }
  }

  for (const segment of decision.responsePlan.segments) {
    switch (segment.type) {
      case "BusinessFactSegment": {
        refsExist(segment, index);
        for (const ref of segment.evidence) {
          const item = index.get(ref.evidenceId)!;
          if (!item.authoritativeFor.includes("current_business_truth") && !item.authoritativeFor.includes("provenance_receipt")) {
            throw new ExecutiveGovernorError("BusinessFactSegment requires current_business_truth or provenance_receipt evidence");
          }
        }
        if (decision.attention.priorClaim === "correctness") {
          if (!segment.recheck || (segment.recheck.resolution !== "fresh_query" && segment.recheck.outcome !== "unverifiable")) {
            throw new ExecutiveGovernorError("correctness challenge requires a fresh reread when recheckable, or unverifiable");
          }
        }
        break;
      }
      case "BusinessJudgmentSegment": {
        refsExist(segment, index);
        if (segment.mutationAuthority !== false) {
          throw new ExecutiveGovernorError("BusinessJudgmentSegment must not carry mutation authority");
        }
        break;
      }
      case "ActionProposalSegment":
      case "ActionConfirmationSegment": {
        if (!isExecutiveActionGrant(segment.grant)) {
          throw new ExecutiveGovernorError(`${segment.type} requires a branded ExecutiveActionGrant`);
        }
        if (!decision.actionGrants.includes(segment.grant)) {
          throw new ExecutiveGovernorError(`${segment.type} grant is not listed on ExecutiveDecision.actionGrants`);
        }
        break;
      }
      case "PersonalDisclosureSegment": {
        if (!isPersonalDisclosureGrant(segment.grant)) {
          throw new ExecutiveGovernorError("PersonalDisclosureSegment requires a branded disclosure grant");
        }
        break;
      }
      case "NarrativeRevealSegment": {
        if (!isNarrativeRevealGrant(segment.grant)) {
          throw new ExecutiveGovernorError("NarrativeRevealSegment requires a branded narrative grant");
        }
        break;
      }
      case "CallControlSegment": {
        if (segment.endCall) {
          if (!isCallControlGrant(segment.grant)) {
            throw new ExecutiveGovernorError("CallControlSegment(endCall) requires a branded CallControlGrant");
          }
          if (decision.callControl.endCall !== true || decision.callControl.grant !== segment.grant) {
            throw new ExecutiveGovernorError("call-end segment does not match ExecutiveDecision.callControl");
          }
        }
        break;
      }
      default:
        break;
    }
  }

  if (decision.callControl.endCall && !isCallControlGrant(decision.callControl.grant)) {
    throw new ExecutiveGovernorError("call end requires a branded CallControlGrant");
  }

  const withheld = decision.inhibitedCandidates.some(candidate => candidate.kind === "narrative_withholds_business");
  if (withheld) {
    throw new ExecutiveGovernorError("personal/narrative must not withhold a business answer");
  }

  /**
   * Mixed business + personal/narrative firewall — ENFORCED, not merely computed.
   *
   * A turn that opened a business lane must not silently lose its business answer because a
   * personal or narrative lane also ran. The executive has exactly two honest outcomes:
   * render a business segment, or state on the record that business produced nothing.
   * Dropping it quietly is the failure this check exists to make impossible.
   */
  const personalLane =
    decision.attention.lanes.includes("personal") || decision.attention.lanes.includes("narrative");
  if (decision.attention.lanes.includes("business") && personalLane) {
    const hasBusiness = decision.responsePlan.segments.some(
      segment => segment.type === "BusinessFactSegment" || segment.type === "BusinessJudgmentSegment"
    );
    const declaredUnavailable = decision.conclusions.some(
      conclusion => conclusion.kind === BUSINESS_ANSWER_UNAVAILABLE
    );
    if (!hasBusiness && !declaredUnavailable) {
      throw new ExecutiveGovernorError(
        "mixed business + personal turn lost its business answer: render a business segment " +
          `or record a "${BUSINESS_ANSWER_UNAVAILABLE}" conclusion`
      );
    }
    const personalSegments = decision.responsePlan.segments.filter(
      segment => segment.type === "PersonalDisclosureSegment" || segment.type === "NarrativeRevealSegment"
    );
    if (!hasBusiness && personalSegments.some(segment => segment.text.trim().length > 0)) {
      throw new ExecutiveGovernorError(
        "personal/narrative spoke while the business lane produced nothing: business facts " +
          "may not be traded away for a personal answer"
      );
    }
  }

  for (const grant of decision.actionGrants) {
    if (!isExecutiveActionGrant(grant)) {
      throw new ExecutiveGovernorError("unbranded object listed as an action grant");
    }
    if (!grant.constraints.shadowOnly) {
      throw new ExecutiveGovernorError("live action grants are prohibited while Brain V2 has no production authority");
    }
  }
}
