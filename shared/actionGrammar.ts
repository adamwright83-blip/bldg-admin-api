/**
 * Action Grammar — Layer 2 of the mission-fiction architecture (Slices
 * 95-102). Answers "what does the player's body actually need to do?" as
 * typed data, with zero narrative content.
 *
 * This is NOT a new source of truth. It is a normalized view derived from
 * the existing, tested action vocabulary in
 * `client/src/game/actions/actionRegistry.ts` (`GoldlineActionDescriptor`,
 * resolved from real mission/business state) and the existing field-move
 * batch (`FieldMoveCandidate[]`, already real, already sourced from
 * `server/field/fieldOpportunityService.ts`). Nothing here creates a
 * business action — `deriveActionGrammar` and `deriveRouteGrammar` only
 * describe one that already exists.
 *
 * Repository truth: there is no Field Kit or physical-placement domain.
 * Production multi-stop fiction therefore represents commercial visits.
 * `deriveAuthoritativeRouteGrammar` consumes an explicitly-started route
 * whose membership is persisted as business events and whose coverage is
 * derived from `commercial_visit_outcomes`. The older `deriveRouteGrammar`
 * remains a pure recommendation-preview helper for deterministic fixtures;
 * production never uses it as authoritative membership.
 */
import type {
  GoldlineActionDescriptor,
  GoldlineActionKind,
} from "../client/src/game/actions/actionRegistry";
import type { FieldMoveCandidate } from "../server/field/types";
import type { AuthoritativeVisitRouteProjection } from "../server/field/types";

export const ACTION_GRAMMAR_KINDS = [
  "CALL_PERSON",
  "VISIT_LOCATION",
  "FOLLOW_UP_PERSON",
  "RECOVER_FAILED_CONTACT",
  "INSPECT_LOCATION",
  "WAIT_FOR_EVENT",
  "PLACE_ITEM_AT_LOCATIONS",
] as const;

export type ActionGrammarKind = (typeof ACTION_GRAMMAR_KINDS)[number];

/** Real-world channel the action occurs over/through, where one applies. */
export type ActionGrammarChannel = "phone" | "in_person" | "none";

/**
 * Pure execution data — deliberately no title, briefing, stakes, or any
 * other narrative field. A `FictionTemplate` (shared/fictionTemplate.ts)
 * consumes this; it never contains one.
 */
export type ActionGrammar = {
  kind: ActionGrammarKind;
  /** Stable id of the underlying authoritative business action, when one exists. */
  businessActionId: string | null;
  /** Immutable occurrence/mission id, when the source provides one. */
  occurrenceId: number | null;
  sourceType: "mission" | "field_move" | "follow_up" | "recovery" | "scout";
  /** How many real physical stops/units this action actually requires. */
  count: number;
  /** Real addresses, when known — never invented. */
  locations: string[];
  channel: ActionGrammarChannel;
  requiresTravel: boolean;
  requiresDriving: boolean;
  /**
   * Whether an attention-demanding countdown is even a candidate here — the
   * Fiction Director still must independently check this at bind time (see
   * fictionTemplate.ts's `assertFictionSafety`), this is not itself a grant.
   */
  timerSafe: boolean;
  /** True for a real human conversation where rushing would hurt the outcome. */
  sensitiveConversation: boolean;
};

/**
 * Maps an already-resolved, business-truth-backed action descriptor onto
 * grammar. `descriptor` is never constructed here — it comes from
 * `resolveGoldlineAction`, which only returns non-null when the underlying
 * mission/business state actually supports that action.
 */
export function deriveActionGrammar(
  descriptor: GoldlineActionDescriptor
): ActionGrammar | null {
  switch (descriptor.kind) {
    case "CALL":
      return {
        kind: "CALL_PERSON",
        businessActionId: `mission:${descriptor.missionId}`,
        occurrenceId: descriptor.missionId,
        sourceType: "mission",
        count: 1,
        locations: [],
        channel: "phone",
        requiresTravel: false,
        requiresDriving: false,
        timerSafe: false, // a real phone call is a sensitive conversation, not a game clock
        sensitiveConversation: true,
      };
    case "VISIT":
      return {
        kind: "VISIT_LOCATION",
        businessActionId: `mission:${descriptor.missionId}`,
        occurrenceId: descriptor.missionId,
        sourceType: "mission",
        count: 1,
        locations: [descriptor.address],
        channel: "in_person",
        requiresTravel: true,
        requiresDriving: true, // a single distant visit is presumed drive-to
        timerSafe: false,
        sensitiveConversation: true,
      };
    case "FOLLOW_UP":
      return {
        kind: "FOLLOW_UP_PERSON",
        businessActionId: `mission:${descriptor.missionId}`,
        occurrenceId: descriptor.missionId,
        sourceType: "follow_up",
        count: 1,
        locations: [],
        channel: descriptor.followUp.channel === "phone" ? "phone" : "none",
        requiresTravel: descriptor.followUp.channel === "in_person",
        requiresDriving: descriptor.followUp.channel === "in_person",
        timerSafe: false,
        sensitiveConversation: true,
      };
    case "RECOVER":
      return {
        kind: "RECOVER_FAILED_CONTACT",
        businessActionId: `mission:${descriptor.missionId}`,
        occurrenceId: descriptor.missionId,
        sourceType: "recovery",
        count: 1,
        locations: [],
        channel: "none",
        requiresTravel: false,
        requiresDriving: false,
        timerSafe: false,
        sensitiveConversation: true,
      };
    case "SCOUT":
      return {
        kind: "INSPECT_LOCATION",
        businessActionId: "scout",
        occurrenceId: null,
        sourceType: "scout",
        count: 1,
        locations: [],
        channel: "none",
        requiresTravel: false,
        requiresDriving: false,
        timerSafe: true,
        sensitiveConversation: false,
      };
    case "REVIEW":
      // Read-only — never a physical action, never fiction-eligible.
      return null;
    case "PICKUP":
    case "DELIVERY":
      // Real order work is presented as a genuine in-world objective
      // directly (see GoldlineGameHome.tsx's handleSelectOrder), not routed
      // through the mission-fiction director — never fiction-eligible.
      return null;
    case "WAIT":
      return {
        kind: "WAIT_FOR_EVENT",
        businessActionId: descriptor.missionId
          ? `mission:${descriptor.missionId}`
          : null,
        occurrenceId: descriptor.missionId,
        sourceType: "mission",
        count: 0,
        locations: [],
        channel: "none",
        requiresTravel: false,
        requiresDriving: false,
        timerSafe: false,
        sensitiveConversation: false,
      };
  }
}

/**
 * A real multi-stop route: N genuinely due `nearby_commercial_visit` field
 * moves batched into one occurrence. Requires at least 2 — a single visit is
 * already `VISIT_LOCATION` via `deriveActionGrammar`; this exists for the
 * case where reality has actually produced a real route to run.
 *
 * `count` and `locations` always reflect exactly how many real moves were
 * passed in — this function has no path that invents, pads, or rounds the
 * number up to any target.
 */
export function deriveRouteGrammar(
  moves: FieldMoveCandidate[]
): ActionGrammar | null {
  const visits = moves.filter(
    move => move.moveType === "nearby_commercial_visit"
  );
  if (visits.length < 2) return null;
  return {
    kind: "PLACE_ITEM_AT_LOCATIONS",
    businessActionId: `route:${visits.map(v => v.id).join(",")}`,
    occurrenceId: null,
    sourceType: "field_move",
    count: visits.length,
    locations: visits.map(v => v.target.name),
    channel: "in_person",
    requiresTravel: true,
    // This legacy preview helper models the deterministic walking fixture.
    // FieldMoveCandidate's moveType "nearby_commercial_visit" and the
    // canonical NEUTRALIZE fixture, which is explicitly a walking route.
    // The deterministic fixture remains walking-only even though production
    // visit routes conservatively require driving between real locations.
    requiresDriving: false,
    timerSafe: true, // a walking multi-stop route is a real candidate for a safe gameplay timer
    sensitiveConversation: false,
  };
}

/**
 * Production route grammar from frozen authoritative membership. Unlike the
 * recommendation-derived preview above, completed visits remain in `count`.
 */
export function deriveAuthoritativeRouteGrammar(
  route: AuthoritativeVisitRouteProjection | null
): ActionGrammar | null {
  if (!route || route.totalStops < 2 || route.stops.length !== route.totalStops)
    return null;
  return {
    kind: "PLACE_ITEM_AT_LOCATIONS",
    businessActionId: `visit-route:${route.occurrenceId}`,
    occurrenceId: null,
    sourceType: "field_move",
    count: route.totalStops,
    locations: route.stops.map(stop => stop.accountName),
    channel: "in_person",
    requiresTravel: true,
    requiresDriving: route.stops.some(stop => stop.requiresDriving),
    timerSafe: true,
    sensitiveConversation: false,
  };
}

export function actionGrammarKindFromMissionKind(
  kind: GoldlineActionKind
): ActionGrammarKind | null {
  switch (kind) {
    case "CALL":
      return "CALL_PERSON";
    case "VISIT":
      return "VISIT_LOCATION";
    case "FOLLOW_UP":
      return "FOLLOW_UP_PERSON";
    case "RECOVER":
      return "RECOVER_FAILED_CONTACT";
    case "SCOUT":
      return "INSPECT_LOCATION";
    case "WAIT":
      return "WAIT_FOR_EVENT";
    case "REVIEW":
      return null;
    case "PICKUP":
    case "DELIVERY":
      return null;
  }
}
