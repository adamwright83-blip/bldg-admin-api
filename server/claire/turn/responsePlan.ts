/**
 * Typed response plan. Lane executors produce segments; the renderer concatenates
 * speech. The renderer does NOT decide business truth, mutation authority, or
 * narrative eligibility.
 */

import type { MutationReceipt } from "../assertionGuard";
import type { InterpretedTurn } from "./interpretTurn";
import type { RoutePlan } from "./routePlan";

export type BusinessFactSegment = {
  type: "BusinessFactSegment";
  text: string;
  evidence: { source: string; reader?: string | null };
  /** Facts originate in authoritative readers/evidence, never the renderer. */
  origin: "authoritative_reader";
};

export type BusinessJudgmentSegment = {
  type: "BusinessJudgmentSegment";
  text: string;
  accountId: number | null;
  contactName: string | null;
  mutationAuthority: false;
};

export type ActionProposalSegment = {
  type: "ActionProposalSegment";
  text: string;
  /** Must be true — proposals are illegal without explicit action authority. */
  authorized: true;
};

export type ActionConfirmationSegment = {
  type: "ActionConfirmationSegment";
  text: string;
  mutationReceipts: MutationReceipt[];
};

export type PersonalDisclosureSegment = {
  type: "PersonalDisclosureSegment";
  text: string;
};

export type NarrativeRevealSegment = {
  type: "NarrativeRevealSegment";
  text: string;
};

export type ConversationalSegment = {
  type: "ConversationalSegment";
  text: string;
};

export type CallControlSegment = {
  type: "CallControlSegment";
  text: string;
  endCall: boolean;
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
  interpretation: InterpretedTurn;
  route: RoutePlan;
  segments: ResponseSegment[];
};

export function businessFactSegment(text: string, evidence: BusinessFactSegment["evidence"]): BusinessFactSegment {
  return { type: "BusinessFactSegment", text, evidence, origin: "authoritative_reader" };
}

export function businessJudgmentSegment(text: string, accountId: number | null, contactName: string | null): BusinessJudgmentSegment {
  return { type: "BusinessJudgmentSegment", text, accountId, contactName, mutationAuthority: false };
}

export function actionProposalSegment(text: string): ActionProposalSegment {
  return { type: "ActionProposalSegment", text, authorized: true };
}

export function actionConfirmationSegment(text: string, mutationReceipts: MutationReceipt[]): ActionConfirmationSegment {
  return { type: "ActionConfirmationSegment", text, mutationReceipts };
}

export function conversationalSegment(text: string): ConversationalSegment {
  return { type: "ConversationalSegment", text };
}

export function callControlSegment(text: string, endCall: boolean): CallControlSegment {
  return { type: "CallControlSegment", text, endCall };
}

export function personalDisclosureSegment(text: string): PersonalDisclosureSegment {
  return { type: "PersonalDisclosureSegment", text };
}

export function narrativeRevealSegment(text: string): NarrativeRevealSegment {
  return { type: "NarrativeRevealSegment", text };
}

/**
 * Render spoken text. Concatenation only — no truth, authority, or eligibility
 * decisions. Action proposals without authorization cannot appear because the
 * type requires `authorized: true`.
 */
export function renderResponsePlan(plan: ResponsePlan): { speak: string; endCall: boolean } {
  const parts = plan.segments.map(segment => segment.text).filter(text => text.trim().length > 0);
  const endCall = plan.segments.some(segment => segment.type === "CallControlSegment" && segment.endCall) || plan.route.callEnd;
  return { speak: parts.join(" ").replace(/\s+/g, " ").trim(), endCall };
}

export type PlanFromSpeakExtras = {
  endCall?: boolean;
  kind?: string;
  evidence?: BusinessFactSegment["evidence"];
  mutationReceipts?: MutationReceipt[];
  judgment?: { accountId: number | null; contactName: string | null };
};

export function planFromSpeak(
  interpretation: InterpretedTurn,
  route: RoutePlan,
  speak: string,
  extras: PlanFromSpeakExtras = {}
): ResponsePlan {
  const segments: ResponseSegment[] = [];
  const proposed = extras.kind === "briefing_proposed" || extras.kind === "follow_up_proposed";
  if (!speak.trim() && extras.endCall) {
    segments.push(callControlSegment("", true));
  } else if (extras.mutationReceipts?.length) {
    segments.push(actionConfirmationSegment(speak, extras.mutationReceipts));
  } else if (extras.evidence) {
    segments.push(businessFactSegment(speak, extras.evidence));
  } else if (extras.judgment) {
    segments.push(businessJudgmentSegment(speak, extras.judgment.accountId, extras.judgment.contactName));
  } else if ((route.primary === "action" || proposed) && interpretation.mayProposeWork) {
    segments.push(actionProposalSegment(speak));
  } else if (route.primary === "personal") {
    segments.push(personalDisclosureSegment(speak));
  } else if (route.primary === "narrative") {
    segments.push(narrativeRevealSegment(speak));
  } else if (extras.endCall || route.callEnd) {
    segments.push(callControlSegment(speak, true));
  } else {
    segments.push(conversationalSegment(speak));
  }
  if ((extras.endCall || route.callEnd) && !segments.some(segment => segment.type === "CallControlSegment")) {
    segments.push(callControlSegment("", true));
  }
  return { interpretation, route, segments };
}
