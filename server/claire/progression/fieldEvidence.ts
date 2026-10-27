import type { Day1TenDoorsPayload } from "../../../shared/day1TenDoors";
import type { Day1EvidencePayloadExtension } from "../../../shared/day1Evidence";
import type { RecordEvidenceInput } from "./service";

/**
 * Field effort derived from PERSISTED field truth. Pure: no I/O, no clock.
 *
 * Two field writers exist and both feed the same live growth-action kind, `confirmed_field_visit`
 * (no new evidence kind; see docs/goldline/EARNED_RAPPORT_DISCLOSURE.md "Live sources"):
 *
 *  - commercial mission visit outcomes (`commercial_visit_outcomes`), which the writer only accepts
 *    after a verified arrival. Effort whatever the result; only `won` is also business progress.
 *  - Day 1 Ten Doors outcomes (`open_channel_mission_tasks.detail`), written only by the operator's
 *    explicit I MADE THE PITCH / COULDN'T REACH THEM tap.
 *
 * Neither ever reads chat, call volume or a model's reading of what was said.
 */

export type DerivedEvidence = Pick<
  RecordEvidenceInput,
  "category" | "kind" | "sourceType" | "sourceId" | "provenance" | "occurredAt" | "recognizedAt"
>;

export type SkippedSource = { sourceType: string; sourceId: string; reason: string };

export type DerivationResult = { evidence: DerivedEvidence[]; skipped: SkippedSource[] };

/** Evidence identity for a Day 1 door is the target: one door is at most one visit, across missions and aliases. */
export const DAY1_SOURCE_TYPE = "day1_ten_doors";

const validIso = (value: string | null | undefined): string | null =>
  value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/**
 * A recorded Day 1 outcome is one field visit when its time is known:
 *  - `pitched`: the operator's explicit tap. occurredAt = when the outcome was recorded.
 *  - `couldnt_reach`: counts only with a recorded arrival (physical presence), because the
 *    tap alone does not say the operator went to the door. occurredAt = the arrival.
 *  - `operator_backfill` outcomes are recorded "now", never "this happened now", so their
 *    recording time is not chronology. They count only with a recorded arrival, dated by it.
 *  - Legacy outcomes with no recorded time are skipped, never guessed.
 */
export function deriveDay1VisitEvidence(input: {
  payload: Day1TenDoorsPayload & Day1EvidencePayloadExtension;
}): DerivationResult {
  const evidence: DerivedEvidence[] = [];
  const skipped: SkippedSource[] = [];
  const visits = input.payload.visitEvidence ?? {};
  for (const [targetId, outcome] of Object.entries(input.payload.outcomes ?? {})) {
    const visit = visits[targetId];
    const arrival = validIso(visit?.arrivalRecordedAt);
    const recorded = validIso(visit?.outcomeRecordedAt);
    const source = visit?.outcomeSource ?? null;
    const skip = (reason: string) => skipped.push({ sourceType: DAY1_SOURCE_TYPE, sourceId: targetId, reason });

    let occurredAt: string | null = null;
    if (!recorded) {
      skip("legacy outcome without a recorded time");
      continue;
    }
    if (source === "operator_backfill") {
      if (!arrival) {
        skip("backfilled outcome without a recorded arrival: its recording time is not when it happened");
        continue;
      }
      occurredAt = arrival;
    } else if (outcome === "pitched") {
      occurredAt = recorded;
    } else {
      if (!arrival) {
        skip("couldnt_reach without a recorded arrival");
        continue;
      }
      occurredAt = arrival;
    }
    // Recognition can never precede occurrence.
    const recognizedAt = Date.parse(recorded) < Date.parse(occurredAt) ? occurredAt : recorded;
    evidence.push({
      category: "growth_action",
      kind: "confirmed_field_visit",
      sourceType: DAY1_SOURCE_TYPE,
      sourceId: targetId,
      provenance: `day1_outcome_${source ?? "operator_confirmed"}:${outcome}`,
      occurredAt,
      recognizedAt,
    });
  }
  return { evidence, skipped };
}

export type CommercialVisitOutcomeRow = {
  missionId: number;
  outcome: string;
  /** When the outcome was persisted (the writer only accepts it after a verified arrival). */
  recordedAt: Date;
};

/** The same identities `recordConfirmedVisitEvidence` writes, so the live hook and a backfill never double count. */
export function deriveCommercialVisitEvidence(rows: readonly CommercialVisitOutcomeRow[]): DerivationResult {
  const evidence: DerivedEvidence[] = [];
  for (const row of rows) {
    const at = row.recordedAt.toISOString();
    evidence.push({
      category: "growth_action",
      kind: "confirmed_field_visit",
      sourceType: "commercial_mission",
      sourceId: String(row.missionId),
      provenance: "debrief_confirm",
      occurredAt: at,
      recognizedAt: at,
    });
    if (row.outcome === "won") {
      evidence.push({
        category: "business_progress",
        kind: "target_account_won",
        sourceType: "commercial_mission",
        sourceId: String(row.missionId),
        provenance: "debrief_confirm",
        occurredAt: at,
        recognizedAt: at,
      });
    }
  }
  return { evidence, skipped: [] };
}
