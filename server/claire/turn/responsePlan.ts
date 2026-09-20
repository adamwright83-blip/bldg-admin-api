import type { InterpretedTurn } from "./interpretTurn";

export type BusinessFactSegment = {
  kind: "business_fact";
  text: string;
};

export type BusinessJudgmentSegment = {
  kind: "business_judgment";
  text: string;
};

export type ActionProposalSegment = {
  kind: "action_proposal";
  text: string;
};

export type ActionConfirmationSegment = {
  kind: "action_confirmation";
  text: string;
};

export type PersonalDisclosureSegment = {
  kind: "personal_disclosure";
  text: string;
};

export type NarrativeRevealSegment = {
  kind: "narrative_reveal";
  text: string;
};

export type ConversationalSegment = {
  kind: "conversational";
  text: string;
};

export type CallControlSegment = {
  kind: "call_control";
  text: string;
  endCall: boolean;
};

export type ClaireResponseSegment =
  | BusinessFactSegment
  | BusinessJudgmentSegment
  | ActionProposalSegment
  | ActionConfirmationSegment
  | PersonalDisclosureSegment
  | NarrativeRevealSegment
  | ConversationalSegment
  | CallControlSegment;

export type ClaireResponsePlan = {
  segments: ClaireResponseSegment[];
  /** Business truth and action authority have already been decided before this plan is rendered. */
  truthDecidedUpstream: true;
  actionAuthorityDecidedUpstream: true;
};

export type ResponsePlanTurnKind =
  | "listening"
  | "briefing_proposed"
  | "briefing_saved"
  | "briefing_declined"
  | "follow_up_proposed"
  | "follow_up_saved"
  | "answered"
  | "commitment"
  | "follow_up";

export function planClaireResponse(input: {
  text: string;
  kind: ResponsePlanTurnKind;
  interpretation: InterpretedTurn | null;
  endCall?: boolean;
}): ClaireResponsePlan {
  const { interpretation } = input;
  const segments: ClaireResponseSegment[] = [];
  if (input.text.trim()) {
    if (input.kind === "briefing_proposed" || input.kind === "follow_up_proposed") {
      segments.push({ kind: "action_proposal", text: input.text });
    } else if (input.kind === "briefing_saved" || input.kind === "follow_up_saved" || input.kind === "commitment") {
      segments.push({ kind: "action_confirmation", text: input.text });
    } else if (interpretation?.businessJudgment) {
      segments.push({ kind: "business_judgment", text: input.text });
    } else if (
      interpretation?.hasBusinessQuestion ||
      interpretation?.queryRefinement ||
      interpretation?.correctnessChallenge
    ) {
      segments.push({ kind: "business_fact", text: input.text });
    } else {
      segments.push({ kind: "conversational", text: input.text });
    }
  }
  if (input.endCall || interpretation?.callControl === "end") {
    segments.push({ kind: "call_control", text: "", endCall: true });
  }
  return {
    segments,
    truthDecidedUpstream: true,
    actionAuthorityDecidedUpstream: true,
  };
}

/**
 * Character rendering starts from a typed plan. For now the existing Claire prose is already
 * authored by lane executors, so rendering is intentionally lossless. Narrative OS can later
 * supply personal/narrative segments without being able to rewrite business/action segments.
 */
export function renderClaireResponsePlan(plan: ClaireResponsePlan): string {
  return plan.segments
    .map(segment => segment.text)
    .filter(Boolean)
    .join(" ")
    .trim();
}
