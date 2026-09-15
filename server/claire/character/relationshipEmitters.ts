import { appendClaireRelationshipEvent } from "./relationshipEvents";
import { recomputeClaireRelationshipState } from "./relationshipState";
import type {
  CharacterId,
  ClaireRelationshipEventType,
  ClaireRelationshipState,
} from "./types";

/**
 * Authoritative event-emission surface. This is the ONLY place production
 * code should call to record a relationship event — never let a Claire
 * generation path (reasoning.ts) write one directly. Every function here
 * either (a) fires only from runtime-verified business-truth evidence
 * (a Twilio call actually completing, a mission outcome actually being
 * confirmed and persisted), or (b) requires an explicit human attestation
 * with a confirmation literal, matching the debrief-confirm pattern
 * elsewhere in this codebase. The model never gets to call any of these.
 *
 * Fails closed: if operatorUserId is missing (identity unresolved) or the
 * database is unavailable, no event is written and null is returned —
 * callers must treat that as "no-op", never as an error to surface to the
 * caller mid-call.
 */

async function appendAndRecompute(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  characterId?: CharacterId;
  eventType: ClaireRelationshipEventType;
  summary: string;
  provenance: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  evidenceSource?: string | null;
  occurredAt?: Date;
}): Promise<ClaireRelationshipState | null> {
  if (!input.operatorUserId) return null; // fail closed: unresolved identity, no durable write
  const event = await appendClaireRelationshipEvent({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId: input.characterId,
    eventType: input.eventType,
    summary: input.summary,
    provenance: input.provenance,
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    evidenceSource: input.evidenceSource,
    occurredAt: input.occurredAt,
  });
  if (!event) return null; // DB unavailable — no event was actually persisted
  return recomputeClaireRelationshipState({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    characterId: input.characterId,
  });
}

/**
 * A Claire phone interaction actually ran its course (the operator said a
 * recognizable closing phrase, or the conversation reached its natural
 * turn cap) rather than being abandoned mid-call. This is the "qualifying
 * completed Claire interaction" event from the Pass 1 spec.
 */
export async function recordQualifyingClaireInteraction(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  conversationId: string;
  reason: "closing_phrase" | "turn_cap_reached";
  /** Test-only: the real call flow always uses "now". Never passed from production code. */
  occurredAt?: Date;
}): Promise<ClaireRelationshipState | null> {
  return appendAndRecompute({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    eventType: "call_completed",
    summary: "Completed a pre-drive Claire call.",
    provenance: "pre_drive_call",
    relatedEntityType: "claire_conversation",
    relatedEntityId: input.conversationId,
    evidenceSource: `twilio_pre_drive_${input.reason}`,
    occurredAt: input.occurredAt,
  });
}

/**
 * A real commercial-mission visit outcome was just confirmed by the
 * operator's own voice confirmation and persisted as business truth
 * (recordCommercialMissionVisitOutcome already succeeded by the time this
 * is called — this never runs speculatively). Always a qualifying
 * completed mission/work interaction; additionally a shared_hard_win on a
 * won outcome, or a shared_failure on a lost outcome, since both are real,
 * jointly experienced business events, not model invention.
 */
export async function recordClaireMissionOutcomeEvents(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  missionId: number;
  outcome: string;
  /** Test-only: the real call flow always uses "now". Never passed from production code. */
  occurredAt?: Date;
}): Promise<void> {
  await appendAndRecompute({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    eventType: "operator_follow_through",
    summary: `Confirmed a real visit outcome (${input.outcome}) for mission ${input.missionId}.`,
    provenance: "debrief_confirm",
    relatedEntityType: "commercial_mission",
    relatedEntityId: String(input.missionId),
    evidenceSource: "debrief_confirm",
    occurredAt: input.occurredAt,
  });
  if (input.outcome === "won") {
    await appendAndRecompute({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      eventType: "shared_hard_win",
      summary: `Won mission ${input.missionId} — confirmed business outcome.`,
      provenance: "debrief_confirm",
      relatedEntityType: "commercial_mission",
      relatedEntityId: String(input.missionId),
      evidenceSource: "debrief_confirm",
      occurredAt: input.occurredAt,
    });
  } else if (input.outcome === "lost") {
    await appendAndRecompute({
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      eventType: "shared_failure",
      summary: `Lost mission ${input.missionId} — confirmed business outcome, reviewed together.`,
      provenance: "debrief_confirm",
      relatedEntityType: "commercial_mission",
      relatedEntityId: String(input.missionId),
      evidenceSource: "debrief_confirm",
      occurredAt: input.occurredAt,
    });
  }
}

/**
 * Event types that cannot be truthfully inferred from runtime telemetry
 * alone (a boundary being ignored, Claire owning a mistake, a disclosure
 * being handled well or poorly) and instead require an explicit human
 * attestation — the "operator-confirmed" evidence category from the Pass 1
 * spec. Restricted to a fixed list so this surface can never be used to
 * self-award the automatic categories above (operator_follow_through,
 * shared_hard_win, shared_failure).
 */
export const CLAIRE_ATTESTABLE_EVENT_TYPES = [
  "operator_owned_mistake",
  "operator_respected_boundary",
  "operator_ignored_boundary",
  "claire_admitted_error",
  "claire_disclosure",
  "operator_handled_disclosure_well",
  "operator_handled_disclosure_poorly",
] as const satisfies readonly ClaireRelationshipEventType[];

export type ClaireAttestableEventType = (typeof CLAIRE_ATTESTABLE_EVENT_TYPES)[number];

export async function recordClaireAttestedEvent(input: {
  tenantId: string;
  operatorUserId: string | null | undefined;
  eventType: ClaireAttestableEventType;
  summary: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  attestedByUserId: string;
}): Promise<ClaireRelationshipState | null> {
  return appendAndRecompute({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    eventType: input.eventType,
    summary: input.summary,
    provenance: "operator_attestation",
    relatedEntityType: input.relatedEntityType,
    relatedEntityId: input.relatedEntityId,
    evidenceSource: `attested_by:${input.attestedByUserId}`,
  });
}
