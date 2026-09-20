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
  /** Success language may bypass conversational sanitization only when receipts back it. */
  receiptBacked: boolean;
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

export type ResponseContentLane =
  | "business_fact"
  | "business_judgment"
  | "action_proposal"
  | "personal_disclosure"
  | "narrative_reveal"
  | "conversational";

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
  /** Lane chosen by the executor that actually produced the answer. */
  lane?: ResponseContentLane | null;
  /** Deterministic success language that has already passed mutation receipt construction. */
  receiptBackedCommit?: string | null;
}): ClaireResponsePlan {
  const { interpretation } = input;
  const segments: ClaireResponseSegment[] = [];
  if (input.text.trim()) {
    const inferredLane: ResponseContentLane =
      input.lane ??
      (input.kind === "briefing_proposed" || input.kind === "follow_up_proposed"
        ? "action_proposal"
        : interpretation?.businessJudgment
          ? "business_judgment"
          : interpretation?.hasBusinessQuestion ||
              interpretation?.queryRefinement ||
              interpretation?.correctnessChallenge
            ? "business_fact"
            : "conversational");
    segments.push({ kind: inferredLane, text: input.text } as ClaireResponseSegment);
  }
  if (input.receiptBackedCommit?.trim()) {
    segments.push({
      kind: "action_confirmation",
      text: input.receiptBackedCommit.trim(),
      receiptBacked: true,
    });
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
export function renderClaireResponseChannels(plan: ClaireResponsePlan): {
  conversational: string;
  receiptBackedCommit: string;
} {
  const conversational = plan.segments
    .filter(segment => segment.kind !== "call_control" && !(segment.kind === "action_confirmation" && segment.receiptBacked))
    .map(segment => segment.text)
    .filter(Boolean)
    .join(" ")
    .trim();
  const receiptBackedCommit = plan.segments
    .filter((segment): segment is ActionConfirmationSegment => segment.kind === "action_confirmation" && segment.receiptBacked)
    .map(segment => segment.text)
    .filter(Boolean)
    .join(" ")
    .trim();
  return { conversational, receiptBackedCommit };
}

export function renderClaireResponsePlan(plan: ClaireResponsePlan): string {
  const channels = renderClaireResponseChannels(plan);
  return [channels.conversational, channels.receiptBackedCommit].filter(Boolean).join(" ").trim();
}
