/**
 * The two currencies, kept structurally separate.
 *
 *  - GrowthAction: verified effort under the operator's control. Drives rapport.
 *  - BusinessProgress: verified movement in the external business. Together with
 *    consistency, creates disclosure eligibility. Never changes regard.
 *
 * Neither is ever derived by the model. Neither includes chat/call volume.
 */

export type EvidenceCategory = "growth_action" | "business_progress";

/**
 * LIVE evidence kinds for this policy version: only kinds with trustworthy PERSISTED completion truth.
 * Model/chat text can never create any of these.
 *
 * Growth actions (effort):
 *  - confirmed_field_visit: a debrief-confirmed, persisted commercial-mission visit outcome.
 *  - follow_up_done: a `commercial_follow_ups` row with status "completed", completedAt and completedBy.
 * Deliberately NOT live (no persisted completion proof exists yet, so validation rejects them):
 *  committed sales call, approved outreach sent, door hangers, returned-after-no, other field actions.
 *
 * Business progress:
 *  - target_account_won: a won commercial-mission outcome confirmed at debrief.
 *  - new_paying_customer / dormant_customer_reorder: canonical order truth (native + CleanCloud, canonical identity).
 * Deliberately NOT live: first paid order in a target building (no persisted target-building mapping exists),
 *  attributable revenue, next meeting scheduled, property approval, deal stage advance.
 */
export const GROWTH_ACTION_KINDS = ["confirmed_field_visit", "follow_up_done"] as const;
export type GrowthActionKind = (typeof GROWTH_ACTION_KINDS)[number];

export const STRONG_PROGRESS_KINDS = ["target_account_won", "new_paying_customer", "dormant_customer_reorder"] as const;
export const INTERMEDIATE_PROGRESS_KINDS = [] as const;
export type StrongProgressKind = (typeof STRONG_PROGRESS_KINDS)[number];
export type BusinessProgressKind = StrongProgressKind;

/** Things that must never be counted, in either currency. Used to fail closed. */
export const NON_QUALIFYING_KINDS = [
  "call_completed",
  "chat_turn",
  "good_conversation",
  "seemed_interested",
  "mission_accepted",
  "path_chosen",
  "plan_created",
  "said_yes_to_claire",
  "opened_app",
] as const;

export type ProgressionEvidence = {
  /** Stable id assigned by the store once persisted; simulator assigns its own. */
  id: string;
  category: EvidenceCategory;
  kind: string;
  strength: "strong" | "intermediate" | null;
  /** Where the underlying truth lives, e.g. commercial_mission:42 or order:123. */
  sourceType: string;
  sourceId: string;
  /** Explicit provenance, e.g. debrief_confirm | cleancloud_import | operator_attested. */
  provenance: string;
  /** When the underlying business event actually happened. Governs chronology. */
  occurredAt: string;
  /** When Goldline first learned/verified it. Governs when progression may advance. */
  recognizedAt: string;
};

export function isGrowthActionKind(kind: string): kind is GrowthActionKind {
  return (GROWTH_ACTION_KINDS as readonly string[]).includes(kind);
}

export function progressStrength(kind: string): "strong" | "intermediate" | null {
  if ((STRONG_PROGRESS_KINDS as readonly string[]).includes(kind)) return "strong";
  return null;
}

export type EvidenceValidation = { ok: true } | { ok: false; reason: string };

/** Fail-closed validation applied before any evidence is persisted. */
export function validateEvidenceInput(input: {
  category: EvidenceCategory;
  kind: string;
  occurredAt: string;
  recognizedAt: string;
}): EvidenceValidation {
  if ((NON_QUALIFYING_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, reason: `${input.kind} is never story currency` };
  }
  if (input.category === "growth_action" && !isGrowthActionKind(input.kind)) {
    return { ok: false, reason: `${input.kind} is not a recognized growth action` };
  }
  if (input.category === "business_progress" && !progressStrength(input.kind)) {
    return { ok: false, reason: `${input.kind} is not a recognized business-progress event` };
  }
  const occurred = Date.parse(input.occurredAt);
  const recognized = Date.parse(input.recognizedAt);
  if (!Number.isFinite(occurred) || !Number.isFinite(recognized)) {
    return { ok: false, reason: "timestamps must be valid" };
  }
  if (recognized < occurred) {
    return { ok: false, reason: "recognizedAt cannot precede occurredAt" };
  }
  return { ok: true };
}
