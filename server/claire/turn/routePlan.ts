/**
 * ONE route plan, produced from the authoritative interpretation before any
 * lane executor is allowed to choose a path, consult pending state as if it
 * were intent, or terminate the call.
 *
 * Pending state may INFORM this plan. It may not reinterpret the utterance.
 */

import type { InterpretedTurn } from "./interpretTurn";

export type RouteLane = "business" | "action" | "personal" | "narrative" | "conversation" | "call_control";

export type PendingDisposition = "none" | "reject" | "supersede" | "revise" | "confirm";

export type RoutePlan = {
  primary: RouteLane;
  also: RouteLane[];
  /** The global proactive board. Only a semantically broad, unscoped check-in. */
  board: boolean;
  priorClaim: "correctness" | "provenance" | "none";
  pending: PendingDisposition;
  callEnd: boolean;
  /** Continue a prior ordered business query rather than starting a new one. */
  continuePriorQuery: boolean;
};

export type RoutePlanContext = {
  proactiveMorning: boolean;
  holdingBriefing: boolean;
  holdingProposal: boolean;
  holdingFollowUp: boolean;
  pendingHints: string[];
};

const ITEM_EDIT =
  /\b(?:i\s+meant|change|move|switch|make(?:\s+it)?|keep\s+the\s+list)\b[\s\S]{0,80}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|before|after|noon)\b|\bkeep\s+the\s+list\b/i;

function pendingHintsMatch(utterance: string, hints: string[]): boolean {
  const lower = utterance.toLowerCase();
  return hints.some(hint => {
    const token = hint.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)[0];
    return Boolean(token && token.length >= 3 && new RegExp(`\\b${token}\\b`, "i").test(lower));
  });
}

export function planRoute(interpreted: InterpretedTurn, ctx: RoutePlanContext): RoutePlan {
  const also: RouteLane[] = [];
  const callEnd = interpreted.callControl === "end";
  if (callEnd) also.push("call_control");

  const holding = ctx.holdingBriefing || ctx.holdingProposal || ctx.holdingFollowUp;
  let pending: PendingDisposition = "none";
  if (holding) {
    if (interpreted.actionRefused && !interpreted.correctionTarget) pending = "reject";
    else if (interpreted.correctionTarget === "pending_item" || (interpreted.correction && ITEM_EDIT.test(interpreted.rawText) && (ctx.holdingBriefing || pendingHintsMatch(interpreted.rawText, ctx.pendingHints)))) {
      pending = "revise";
    } else if (interpreted.correction || interpreted.queryRefinement || interpreted.priorQueryReference) {
      pending = "supersede";
    } else if (interpreted.acknowledgement) {
      pending = "confirm";
    }
  }

  const board =
    !ctx.proactiveMorning &&
    interpreted.broadBriefingRequest &&
    !interpreted.operatorWorkCommitment &&
    !interpreted.hasExplicitActionRequest &&
    interpreted.entities.length === 0 &&
    !interpreted.correction &&
    !interpreted.actionRefused;

  const priorClaim: RoutePlan["priorClaim"] = interpreted.correctnessChallenge
    ? "correctness"
    : interpreted.provenanceQuestion
      ? "provenance"
      : "none";

  const continuePriorQuery = interpreted.queryRefinement || interpreted.priorQueryReference || Boolean(interpreted.anchorEntity) || interpreted.exclusions.length > 0;

  let primary: RouteLane = "conversation";
  if (callEnd && !interpreted.hasBusinessQuestion && !interpreted.operatorWorkCommitment && !interpreted.hasExplicitActionRequest) {
    primary = "call_control";
  } else if (interpreted.personalProbe) {
    primary = "personal";
    if (interpreted.hasBusinessQuestion) also.push("business");
  } else if (interpreted.narrativeProbe) {
    primary = "narrative";
    if (interpreted.hasBusinessQuestion) also.push("business");
  } else if (interpreted.mayProposeWork || interpreted.hasExplicitActionRequest || interpreted.operatorWorkCommitment) {
    primary = "action";
    if (interpreted.hasBusinessQuestion) also.push("business");
  } else if (interpreted.hasBusinessQuestion || interpreted.listRequest || continuePriorQuery || interpreted.broadBriefingRequest) {
    primary = "business";
  } else if (interpreted.acknowledgement) {
    primary = "conversation";
  }

  if (board) primary = "business";
  if (callEnd && primary !== "call_control") also.push("call_control");

  return { primary, also: Array.from(new Set(also)), board, priorClaim, pending, callEnd, continuePriorQuery };
}

export function routeAllows(route: RoutePlan, lane: RouteLane): boolean {
  return route.primary === lane || route.also.includes(lane);
}
