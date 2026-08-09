/** Cross-domain truth labels used by every FIELD/HQ projection. */
export const VALUE_PROVENANCE = [
  "SOURCED_FACT",
  "OPERATOR_INPUT",
  "DETERMINISTIC_ESTIMATE",
  "AI_INFERENCE",
  "UNKNOWN",
] as const;

export type ValueProvenance = (typeof VALUE_PROVENANCE)[number];

export const VERIFICATION_CLASSES = ["VERIFIED", "ATTESTED", "CLAIMED"] as const;
export type VerificationClass = (typeof VERIFICATION_CLASSES)[number];

export type DataQualityStatus = "trusted" | "partial" | "insufficient";

export type DataQuality = {
  status: DataQualityStatus;
  warnings: string[];
  sources: string[];
};

export type ProvenancedValue<T> = {
  value: T | null;
  provenance: ValueProvenance;
  sourceReference: string | null;
  confidence: "high" | "medium" | "low" | "unknown";
};

export type BusinessEvent = {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  occurredAt: string;
  actorType: "system" | "operator" | "field" | "customer" | "provider" | "unknown";
  actorId: string | null;
  source: string;
  sourceReference: string;
  verificationClass: VerificationClass;
  confidence: "high" | "medium" | "low" | "unknown";
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export function sourcedFact<T>(value: T, sourceReference: string): ProvenancedValue<T> {
  return { value, provenance: "SOURCED_FACT", sourceReference, confidence: "high" };
}

export function deterministicEstimate<T>(
  value: T,
  sourceReference: string,
  confidence: "high" | "medium" | "low" = "medium"
): ProvenancedValue<T> {
  return { value, provenance: "DETERMINISTIC_ESTIMATE", sourceReference, confidence };
}

export function unknownValue<T>(warning: string): ProvenancedValue<T> {
  return { value: null, provenance: "UNKNOWN", sourceReference: warning, confidence: "unknown" };
}

export function dedupeBusinessEvents(events: readonly BusinessEvent[]): BusinessEvent[] {
  const seen = new Set<string>();
  return events.filter(event => {
    const key = `${event.tenantId}:${event.idempotencyKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
