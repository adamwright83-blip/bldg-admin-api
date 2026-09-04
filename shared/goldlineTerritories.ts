/**
 * Goldline territories: the business level.
 *
 * A territory is a published challenge definition over real places. Membership
 * is a list of physicalEntityIds. Progress is never stored as a mutable
 * counter — it is derived from Chronicle evidence every time it is asked.
 *
 * This module is closed to business mutation. It can read event shapes and
 * decide what the game may say about a challenge. It cannot invent a building,
 * a visit, a customer or a coordinate.
 */

import type { GoldlineWorldEvent } from "./goldlineWorld";

export const TERRITORY_GRAMMARS = [
  "visit_hunt",
  "break_the_silence",
  "send_the_standard",
] as const;
export type TerritoryGrammar = (typeof TERRITORY_GRAMMARS)[number];

export const TERRITORY_GEOMETRY_MODES = [
  "corridor",
  "cluster",
  "authoritative_polygon",
] as const;
export type TerritoryGeometryMode = (typeof TERRITORY_GEOMETRY_MODES)[number];

export const MEMBER_ACTION_TYPES = [
  "visited",
  "contact_attempted",
  "proposal_sent",
] as const;
export type TerritoryMemberActionType = (typeof MEMBER_ACTION_TYPES)[number];

export const TERRITORY_READINESS = [
  "veiled",
  "in_progress",
  "confrontation_ready",
  "cleared",
] as const;
export type TerritoryReadiness = (typeof TERRITORY_READINESS)[number];

export const WORLD_INTERACTION_MODES = [
  "world_exploration",
  "guardian_encounter",
  "building_inspect",
  "tower_arcade",
] as const;
export type WorldInteractionMode = (typeof WORLD_INTERACTION_MODES)[number];

/** Game-projection event types this module is allowed to recognise. */
export const TERRITORY_GAME_EVENT_TYPES = [
  "territory_pressure_returned",
  "territory_published",
  "territory_cleared",
  "guardian_defeated",
] as const;
export type TerritoryGameEventType = (typeof TERRITORY_GAME_EVENT_TYPES)[number];

export type GeoPoint = { latitude: number; longitude: number };

export type TerritoryMember = {
  physicalEntityId: string;
  requiredAction: TerritoryMemberActionType;
  order: number;
  sourceReason: string;
};

export type TerritoryDefinition = {
  id: string;
  tenantId: string;
  stableKey: string;
  version: number;
  fantasyTitle: string;
  realGeographyLabel: string | null;
  grammar: TerritoryGrammar;
  guardianId: string;
  members: TerritoryMember[];
  geometryMode: TerritoryGeometryMode;
  createdFrom: string;
  publishedAt: string;
  classification: "game_projection";
};

export type TerritoryMemberProgress = {
  physicalEntityId: string;
  requiredAction: TerritoryMemberActionType;
  completed: boolean;
  evidenceEventId: string | null;
  evidenceOccurredAt: string | null;
};

export type TerritoryDerivedState = {
  territoryId: string;
  stableKey: string;
  version: number;
  readiness: TerritoryReadiness;
  completedMemberIds: string[];
  remainingMemberIds: string[];
  members: TerritoryMemberProgress[];
  confrontationReady: boolean;
  cleared: boolean;
  clearedAt: string | null;
  clearedEventId: string | null;
  guardianId: string;
  /**
   * If evidence that supplied progress was later invalidated, the derived
   * challenge may recede — unless a cleared game-history event already exists.
   */
  evidenceRevisedAfterClear: boolean;
  /** Historical victory is immutable; renewed occupation is a separate projection. */
  pressureReturned?: boolean;
  recurrenceKey?: string | null;
};

export type TerritorySourceOpportunity = {
  physicalEntityId: string;
  displayName: string;
  latitude: number;
  longitude: number;
  /**
   * Real commercial/pipeline stage when known. Used only to pick a grammar,
   * never to invent a place.
   */
  pipelineStage: string | null;
  hasVisitEvidence: boolean;
  hasContactEvidence: boolean;
  hasProposalEvidence: boolean;
  isWonAccount: boolean;
  realGeographyLabel: string | null;
};

const VISIT_EVIDENCE = new Set(["visited", "visit_attempted"]);
const CONTACT_EVIDENCE = new Set([
  "call_completed",
  "text_sent",
  "email_sent",
  "recovery_outreach_completed",
]);
const PROPOSAL_EVIDENCE = new Set(["proposal_sent"]);

/** Viewing, panning, inspecting and boss play are not evidence. */
const NON_PROGRESS_EVENT_TYPES = new Set([
  "territory_published",
  "territory_cleared",
  "guardian_defeated",
  "tower_review_ready",
  "tower_published",
  "field_temporal_signal",
]);

export function isTerritoryGameEventType(eventType: string): eventType is TerritoryGameEventType {
  return (TERRITORY_GAME_EVENT_TYPES as readonly string[]).includes(eventType);
}

export function actionTypesForGrammar(
  grammar: TerritoryGrammar
): TerritoryMemberActionType {
  if (grammar === "break_the_silence") return "contact_attempted";
  if (grammar === "send_the_standard") return "proposal_sent";
  return "visited";
}

export function evidenceTypesForAction(
  action: TerritoryMemberActionType
): ReadonlySet<string> {
  if (action === "contact_attempted") return CONTACT_EVIDENCE;
  if (action === "proposal_sent") return PROPOSAL_EVIDENCE;
  return VISIT_EVIDENCE;
}

export function memberIdsOf(definition: TerritoryDefinition): string[] {
  return definition.members
    .slice()
    .sort((a, b) => a.order - b.order || a.physicalEntityId.localeCompare(b.physicalEntityId))
    .map(member => member.physicalEntityId);
}

export function stableTerritoryKey(input: {
  tenantId: string;
  grammar: TerritoryGrammar;
  physicalEntityIds: readonly string[];
}): string {
  const members = [...input.physicalEntityIds].sort().join(",");
  return `territory:${input.tenantId}:${input.grammar}:${members}`;
}

/**
 * FNV-1a. Deterministic across Node and the browser, no crypto, no Date.
 */
export function stableHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function eventBelongsToMember(
  event: GoldlineWorldEvent,
  physicalEntityId: string
): boolean {
  return event.physicalEntityId === physicalEntityId;
}

function isTruthfulActionEvidence(event: GoldlineWorldEvent): boolean {
  if (event.classification === "game_projection") return false;
  if (event.provenanceClass === "generated_game_fiction") return false;
  if (NON_PROGRESS_EVENT_TYPES.has(event.eventType)) return false;
  return event.classification === "action" || event.classification === "evidence";
}

function latestMatchingEvidence(
  events: readonly GoldlineWorldEvent[],
  physicalEntityId: string,
  action: TerritoryMemberActionType
): GoldlineWorldEvent | null {
  const allowed = evidenceTypesForAction(action);
  let found: GoldlineWorldEvent | null = null;
  for (const event of events) {
    if (!eventBelongsToMember(event, physicalEntityId)) continue;
    if (!isTruthfulActionEvidence(event)) continue;
    if (!allowed.has(event.eventType)) continue;
    if (!found || event.occurredAt > found.occurredAt) found = event;
  }
  return found;
}

function gameHistoryEvent(
  events: readonly GoldlineWorldEvent[],
  territoryId: string,
  eventType: TerritoryGameEventType
): GoldlineWorldEvent | null {
  let found: GoldlineWorldEvent | null = null;
  for (const event of events) {
    if (event.classification !== "game_projection") continue;
    if (event.eventType !== eventType) continue;
    const metaId = String(event.metadata.territoryId ?? "");
    if (metaId !== territoryId && event.sourceId !== territoryId) continue;
    if (!found || event.occurredAt > found.occurredAt) found = event;
  }
  return found;
}

/**
 * Progress is a function of definition + chronicle. There is no stored
 * 4/6 counter that can drift from the evidence that produced it.
 *
 * Viewing a territory, opening an inspector, firing a toy weapon or fighting
 * a guardian cannot complete a member: those events are either absent from
 * the chronicle or classified as game_projection.
 */
export function deriveTerritoryState(input: {
  definition: TerritoryDefinition;
  events: readonly GoldlineWorldEvent[];
}): TerritoryDerivedState {
  const members: TerritoryMemberProgress[] = input.definition.members
    .slice()
    .sort((a, b) => a.order - b.order || a.physicalEntityId.localeCompare(b.physicalEntityId))
    .map(member => {
      const evidence = latestMatchingEvidence(
        input.events,
        member.physicalEntityId,
        member.requiredAction
      );
      return {
        physicalEntityId: member.physicalEntityId,
        requiredAction: member.requiredAction,
        completed: evidence !== null,
        evidenceEventId: evidence?.id ?? null,
        evidenceOccurredAt: evidence?.occurredAt ?? null,
      };
    });

  const completedMemberIds = members
    .filter(member => member.completed)
    .map(member => member.physicalEntityId);
  const remainingMemberIds = members
    .filter(member => !member.completed)
    .map(member => member.physicalEntityId);

  const clearedEvent = [gameHistoryEvent(input.events, input.definition.id, "territory_cleared"),
    gameHistoryEvent(input.events, input.definition.id, "guardian_defeated")]
    .filter((event): event is GoldlineWorldEvent => event !== null)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0] ?? null;

  const challengeComplete = remainingMemberIds.length === 0 && members.length > 0;
  const cleared = clearedEvent !== null;
  const memberIds = new Set(members.map(member => member.physicalEntityId));
  const resurgence = clearedEvent ? input.events
    .filter(event => event.eventType === "customer_became_dormant"
      && event.classification === "outcome"
      && event.provenanceClass !== "generated_game_fiction"
      && event.verificationClass === "VERIFIED"
      && event.physicalEntityId !== null && memberIds.has(event.physicalEntityId)
      && event.occurredAt > clearedEvent.occurredAt)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id))[0] : undefined;
  const projectedReturn = gameHistoryEvent(input.events, input.definition.id, "territory_pressure_returned");
  const recurrence = resurgence ?? (clearedEvent && projectedReturn && projectedReturn.occurredAt > clearedEvent.occurredAt ? projectedReturn : null);
  const pressureReturned = Boolean(recurrence);
  const confrontationReady = challengeComplete && (!cleared || pressureReturned);

  let readiness: TerritoryReadiness = "veiled";
  if (cleared && !pressureReturned) readiness = "cleared";
  else if (confrontationReady) readiness = "confrontation_ready";
  else if (completedMemberIds.length > 0) readiness = "in_progress";

  const evidenceRevisedAfterClear =
    cleared && !challengeComplete && remainingMemberIds.length > 0;

  return {
    territoryId: input.definition.id,
    stableKey: input.definition.stableKey,
    version: input.definition.version,
    readiness,
    completedMemberIds,
    remainingMemberIds,
    members,
    confrontationReady,
    cleared,
    clearedAt: clearedEvent?.occurredAt ?? null,
    clearedEventId: clearedEvent?.id ?? null,
    guardianId: input.definition.guardianId,
    evidenceRevisedAfterClear,
    pressureReturned,
    recurrenceKey: recurrence?.id ?? null,
  };
}

export type PresentedTerritory = {
  definition: TerritoryDefinition;
  state: TerritoryDerivedState;
};

export function viewingCannotAdvance(state: TerritoryDerivedState): boolean {
  return state.completedMemberIds.length === 0 && !state.cleared;
}

/**
 * Guardian defeat is a game-projection fact. It must never be readable as a
 * commercial conversion, a visit, or an obligation resolution.
 */
export function territoryGameEventContract(input: {
  eventType: string;
  classification: GoldlineWorldEvent["classification"];
  provenanceClass: GoldlineWorldEvent["provenanceClass"];
}): boolean {
  if (!isTerritoryGameEventType(input.eventType)) return true;
  return (
    input.classification === "game_projection" &&
    input.provenanceClass === "generated_game_fiction"
  );
}

export function grammarLabel(grammar: TerritoryGrammar): string {
  if (grammar === "break_the_silence") return "Break the Silence";
  if (grammar === "send_the_standard") return "Send the Standard";
  return "Visit Hunt";
}

export function challengeSummary(input: {
  definition: TerritoryDefinition;
  state: TerritoryDerivedState;
}): string {
  const remaining = input.state.remainingMemberIds.length;
  const total = input.definition.members.length;
  if (input.state.cleared) {
    return `${input.definition.fantasyTitle} is excavated. The buildings underneath keep their real stages.`;
  }
  if (input.state.confrontationReady) {
    return `${input.definition.fantasyTitle} is confrontation-ready. The guardian can be cleared.`;
  }
  if (input.definition.grammar === "visit_hunt") {
    return remaining === 1
      ? `One entrance still sleeps in ${input.definition.fantasyTitle}.`
      : `${remaining} of ${total} entrances still sleep in ${input.definition.fantasyTitle}.`;
  }
  if (input.definition.grammar === "break_the_silence") {
    return remaining === 1
      ? `One signal still waits in ${input.definition.fantasyTitle}.`
      : `${remaining} of ${total} signals still wait in ${input.definition.fantasyTitle}.`;
  }
  return remaining === 1
    ? `One standard still furled in ${input.definition.fantasyTitle}.`
    : `${remaining} of ${total} standards still furled in ${input.definition.fantasyTitle}.`;
}
