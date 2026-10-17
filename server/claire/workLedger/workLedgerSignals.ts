/**
 * Operator signals the work ledger noticed, written to Daphne as observations.
 *
 * Before this, Daphne's conversation ingestion matched about seven exact
 * sentences ("You misunderstood me"), so "I just told you a lot", "I just told
 * you something" and "I don't wanna talk about it" taught her nothing.
 *
 * Each signal is recorded as what the operator said (the quote, attested,
 * stated channel) with the ledger's label carried separately as an
 * interpretation with provenance, per BEHAVIORAL_SCIENCE_FOUNDATION's
 * permanent law. Mapping onto Daphne's existing relationship vocabulary:
 *   complaint_about_claire / repeated_instruction → rupture "instruction_misunderstanding"
 *   confirmed_understanding                        → repair  "instruction_misunderstanding"
 *   declined_topic                                 → boundary (dated, scoped to the conversation)
 *   stated_preference                              → correction (how the operator wants Claire to work)
 * Daphne's card already turns ruptures, boundaries and corrections into
 * Claire's prompt on the next turn; nothing here invents a new channel.
 */
import { createHash } from "node:crypto";
import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { isDaphneV2ClaireEnabled } from "../../agents/daphne/claireAdapter";
import { isDaphneConversationIngestionEnabled } from "../../agents/daphne/releaseSafety";
import { daphneAdaptationAllowed, loadDaphneMetaPreferences } from "../../agents/daphne/goalsPreferences";
import { recordDaphneObservation } from "../../agents/daphne/observationStore";
import type { LedgerOperatorSignal } from "./workLedgerPlanner";

export const WORK_LEDGER_SIGNAL_INTERPRETER_VERSION = "claire_work_ledger_signal_v1";

export function daphneRelationshipEventFor(
  signal: LedgerOperatorSignal,
  occurredAt: Date,
  businessDate: string = occurredAt.toISOString().slice(0, 10)
): { eventKind: "rupture" | "repair" | "boundary" | "correction"; value: string } | null {
  const about = signal.about.replace(/\s+/g, " ").trim();
  switch (signal.kind) {
    case "repeated_instruction":
      return { eventKind: "rupture", value: "instruction_misunderstanding" };
    case "complaint_about_claire":
      return { eventKind: "rupture", value: about ? `operator_complaint: ${about.slice(0, 160)}` : "operator_complaint" };
    case "confirmed_understanding":
      return { eventKind: "repair", value: "instruction_misunderstanding" };
    case "declined_topic":
      return about
        ? {
            eventKind: "boundary",
            value: `On ${businessDate} the operator declined to discuss ${about}; do not raise it again that day unless they bring it up.`,
          }
        : null;
    case "stated_preference":
      return about ? { eventKind: "correction", value: about.slice(0, 240) } : null;
    default:
      return null;
  }
}

export async function recordWorkLedgerOperatorSignal(input: {
  tenantId: string;
  operatorUserId: string;
  conversationKey: string;
  sourceEventId: string;
  signal: LedgerOperatorSignal;
  surface: "voice" | "text";
  occurredAt?: Date;
  /** Business-local date, so "that day" means the operator's day. */
  businessDate?: string;
}): Promise<{ status: "persisted" | "ineligible" | "disabled" | "identity_unresolved"; observationId?: string }> {
  const occurredAt = input.occurredAt ?? new Date();
  const event = daphneRelationshipEventFor(input.signal, occurredAt, input.businessDate);
  if (!event) return { status: "ineligible" };
  if (!isDaphneConversationIngestionEnabled(input.tenantId) || !isDaphneV2ClaireEnabled(input.tenantId)) {
    return { status: "ineligible" };
  }
  const raw = input.operatorUserId.trim();
  if (!raw) return { status: "identity_unresolved" };
  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: /^\d+$/.test(raw) ? { type: "user_id", value: Number(raw) } : { type: "open_id", value: raw },
    subsystem: "daphne_conversation_ingestion",
  });
  if (!resolution.ok) return { status: "identity_unresolved" };
  const scope = { tenantId: input.tenantId, canonicalOperatorId: resolution.identity.canonicalOperatorId };
  const preferences = await loadDaphneMetaPreferences(scope);
  if (
    !daphneAdaptationAllowed(preferences) ||
    preferences.memory_recall?.value === false ||
    preferences.memory_recall?.status === "revoked"
  ) {
    return { status: "disabled" };
  }
  const key = createHash("sha256")
    .update(JSON.stringify([input.conversationKey, input.sourceEventId, input.signal.kind]))
    .digest("hex");
  const observation = await recordDaphneObservation({
    ...scope,
    operatorUserId: raw,
    sessionId: input.conversationKey,
    actorType: "user",
    actorId: raw,
    agentId: "claire",
    observationKind: "relationship_event",
    evidenceChannel: "stated",
    verificationStatus: "attested",
    sourceType: "claire_work_ledger",
    sourceReference: `turn:${input.sourceEventId}`.slice(0, 191),
    occurredAt,
    context: null,
    payload: {
      schemaVersion: 1,
      eventKind: event.eventKind,
      value: event.value,
      operatorWords: input.signal.quote,
      surface: input.surface,
      interpretation: {
        label: input.signal.kind,
        about: input.signal.about,
        provenance: WORK_LEDGER_SIGNAL_INTERPRETER_VERSION,
        status: "proposed",
      },
    },
    idempotencyKey: `work-ledger-signal:${key}`,
  });
  return { status: "persisted", observationId: observation.id };
}
