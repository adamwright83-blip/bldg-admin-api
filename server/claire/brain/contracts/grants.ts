/**
 * Authority objects. Types live here. Minting lives ONLY in
 * `server/claire/brain/executive/grants.ts`. A structurally similar object
 * without the brand is not a grant.
 */

export const EXECUTIVE_ACTION_GRANT_BRAND: unique symbol = Symbol("claire.brain.ExecutiveActionGrant");
export const CALL_CONTROL_GRANT_BRAND: unique symbol = Symbol("claire.brain.CallControlGrant");
export const PERSONAL_DISCLOSURE_GRANT_BRAND: unique symbol = Symbol("claire.brain.PersonalDisclosureGrant");
export const NARRATIVE_REVEAL_GRANT_BRAND: unique symbol = Symbol("claire.brain.NarrativeRevealGrant");

export type ActionClass =
  | "propose_day_line"
  | "propose_briefing"
  | "propose_account_follow_up"
  | "commit_day_line"
  | "commit_briefing"
  | "commit_account_follow_up"
  | "cancel_pending"
  | "revise_pending"
  | "create_weekly_planning_callback"
  | "place_weekly_planning_call"
  | "send_weekly_planning_missed_text";

export type ActionAuthorityBasis =
  | "current_turn_explicit_request"
  | "current_turn_operator_commitment"
  | "pending_lifecycle"
  | "standing_goal_policy"
  | "locked_weekly_intent"
  | "due_authorized_obligation"
  | "authoritative_business_event"
  | "scheduled_operator_appointment";

export type ActionGrantSource =
  | {
      type: "operator_turn";
      assembledText: string;
    }
  | {
      type: "goal_cycle";
      tenantId: string;
      canonicalOperatorId: string;
      goalRunId: string;
      cycleId: string;
      evidenceRefs: string[];
    }
  | {
      type: "pending_lifecycle";
      tenantId: string;
      canonicalOperatorId: string;
      lifecycleId: string;
    }
  | {
      type: "scheduled_operator_appointment";
      tenantId: string;
      canonicalOperatorId: string;
      appointmentId: string;
      appointmentKind: "sunday_weekly_planning" | "weekly_planning_callback";
      standingAuthorizationId: string | null;
    };

export function actionGrantSourceIsBackground(
  source: ActionGrantSource
): source is Exclude<ActionGrantSource, { type: "operator_turn" }> {
  return source.type !== "operator_turn";
}

export type ExecutiveActionGrant = {
  readonly [EXECUTIVE_ACTION_GRANT_BRAND]: true;
  actionClass: ActionClass;
  scope: {
    identity?: string;
    accountId?: number | null;
    titles?: string[];
  };
  authorityBasis: ActionAuthorityBasis;
  sourceTurnAssembledText: string;
  /** Populated by the sole grant minter. Legacy conversational callers may omit the draft source. */
  source?: ActionGrantSource;
  tenantId?: string | null;
  canonicalOperatorId?: string | null;
  expiresAtMs: number;
  constraints: {
    mutationAllowed: boolean;
    shadowOnly: boolean;
  };
};

export type CallControlGrant = {
  readonly [CALL_CONTROL_GRANT_BRAND]: true;
  endCall: true;
  basis: "operator_leave_taking";
  sourceTurnAssembledText: string;
};

export type PersonalDisclosureGrant = {
  readonly [PERSONAL_DISCLOSURE_GRANT_BRAND]: true;
  entitlementId: string;
  basis: string;
  rung: string | null;
};

export type NarrativeRevealGrant = {
  readonly [NARRATIVE_REVEAL_GRANT_BRAND]: true;
  entitlementId: string;
  basis: string;
};

export type ActionGrantDraft = Omit<ExecutiveActionGrant, typeof EXECUTIVE_ACTION_GRANT_BRAND>;
export type CallControlGrantDraft = Omit<CallControlGrant, typeof CALL_CONTROL_GRANT_BRAND>;
export type PersonalDisclosureGrantDraft = Omit<PersonalDisclosureGrant, typeof PERSONAL_DISCLOSURE_GRANT_BRAND>;
export type NarrativeRevealGrantDraft = Omit<NarrativeRevealGrant, typeof NARRATIVE_REVEAL_GRANT_BRAND>;
