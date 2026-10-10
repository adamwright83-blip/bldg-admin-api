import type { DaphneObservationRecord } from "./observationStore";
import { recordDaphneEpistemicClaim } from "./epistemicStore";
import { recordDaphneMetricEvent } from "./metrics";

export const DAPHNE_RELATIONSHIP_EVENT_KINDS = [
  "expectation_set",
  "correction",
  "repair",
  "disclosure",
  "shared_reference",
  "boundary",
  "preference",
  "rupture",
] as const;

export type DaphneRelationshipEventKind =
  (typeof DAPHNE_RELATIONSHIP_EVENT_KINDS)[number];

export type DaphneRelationship = {
  agentId: string;
  generatedAt: string;
  expectations: string[];
  corrections: string[];
  repairs: string[];
  disclosures: string[];
  sharedReferences: string[];
  boundaries: string[];
  preferences: string[];
  unresolvedRuptures: string[];
  sourceObservationIds: string[];
  relationshipHypothesisStatus: "evidence_only";
};

function strings(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return Array.from(new Set(value.filter((v): v is string => typeof v === "string").map(v => v.trim()).filter(Boolean)));
  }
  return [];
}

function eventKind(item: DaphneObservationRecord): DaphneRelationshipEventKind | null {
  if (item.observationKind !== "relationship_event" || !item.payload) return null;
  const value = item.payload.eventKind;
  return typeof value === "string" && (DAPHNE_RELATIONSHIP_EVENT_KINDS as readonly string[]).includes(value)
    ? (value as DaphneRelationshipEventKind)
    : null;
}

function eventValues(item: DaphneObservationRecord): string[] {
  return strings(item.payload?.value ?? item.payload?.values);
}

/**
 * Relationship is dyadic. Only observations explicitly scoped to this agent
 * enter the compiled object. Cross-agent sharing is handled separately and
 * never happens by accidental global recall.
 */
export function deriveDaphneRelationship(input: {
  observations: DaphneObservationRecord[];
  agentId: string;
  asOf: Date;
}): DaphneRelationship {
  const agentId = input.agentId.trim();
  if (!agentId) throw new Error("Daphne Relationship requires agentId");

  const events = input.observations
    .filter(item =>
      item.agentId === agentId &&
      item.observationKind === "relationship_event" &&
      Date.parse(item.occurredAt) <= input.asOf.getTime()
    )
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  const out = {
    expectation_set: [] as string[],
    correction: [] as string[],
    repair: [] as string[],
    disclosure: [] as string[],
    shared_reference: [] as string[],
    boundary: [] as string[],
    preference: [] as string[],
    rupture: [] as string[],
  };

  const unresolved = new Set<string>();
  for (const event of events) {
    const kind = eventKind(event);
    if (!kind) continue;
    const values = eventValues(event);
    out[kind].push(...values);
    if (kind === "rupture") values.forEach(value => unresolved.add(value));
    if (kind === "repair") values.forEach(value => unresolved.delete(value));
  }

  const unresolvedRuptures = Array.from(unresolved);

  return {
    agentId,
    generatedAt: input.asOf.toISOString(),
    expectations: Array.from(new Set(out.expectation_set)),
    corrections: Array.from(new Set(out.correction)),
    repairs: Array.from(new Set(out.repair)),
    disclosures: Array.from(new Set(out.disclosure)),
    sharedReferences: Array.from(new Set(out.shared_reference)),
    boundaries: Array.from(new Set(out.boundary)),
    preferences: Array.from(new Set(out.preference)),
    unresolvedRuptures,
    sourceObservationIds: events.map(item => item.id),
    relationshipHypothesisStatus: "evidence_only",
  };
}

export async function persistDaphneRelationshipHypothesis(input: {
  tenantId: string;
  canonicalOperatorId: string;
  relationship: DaphneRelationship;
  modelVersion: string;
}): Promise<void> {
  if (!input.relationship.sourceObservationIds.length) return;
  const claim = await recordDaphneEpistemicClaim({
    tenantId: input.tenantId,
    canonicalOperatorId: input.canonicalOperatorId,
    agentId: input.relationship.agentId,
    claimType: "relationship_hypothesis",
    claimKey: `relationship:${input.relationship.agentId}`,
    claim: input.relationship,
    sourceObservationIds: input.relationship.sourceObservationIds,
    uncertainty: {
      epistemic: Number((1 / input.relationship.sourceObservationIds.length).toFixed(4)),
      decisionCost: input.relationship.unresolvedRuptures.length ? "high" : "low",
    },
    epistemicStatus: input.relationship.unresolvedRuptures.length ? "suggestive" : "active",
    causalEvidenceStatus: "none",
    modelVersion: input.modelVersion,
    idempotencyKey: `relationship:${input.relationship.agentId}:${input.relationship.generatedAt}`,
  });
  const eventName = input.relationship.unresolvedRuptures.length
    ? "rupture_detected"
    : input.relationship.repairs.length
      ? "repair_recorded"
      : null;
  if (eventName) {
    await recordDaphneMetricEvent({
      tenantId: input.tenantId,
      canonicalOperatorId: input.canonicalOperatorId,
      agentId: input.relationship.agentId,
      eventName,
      properties: {
        unresolvedRuptureCount: input.relationship.unresolvedRuptures.length,
        repairCount: input.relationship.repairs.length,
      },
      sourceReference: claim.id,
      idempotencyKey: `relationship-metric:${claim.id}:${eventName}`,
    }).catch(() => undefined);
  }
}
