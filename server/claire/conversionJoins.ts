/**
 * Slice 44 — measurable Claire → reality conversion joins.
 * Twilio Conversation Intelligence is not truth authority and is not used here.
 * These joins are internal telemetry, not outcome attribution.
 */

export type ClaireConversionStage =
  | "conversation"
  | "proposal"
  | "accepted"
  | "details_supplied"
  | "completed"
  | "outcome";

export type ClaireConversionJoin = {
  conversationId?: string;
  operatorUserId: string | null;
  tenantId: string;
  stage: ClaireConversionStage;
  actionId?: string | null;
  proposalTitle?: string | null;
  detailState?: "COMPLETE" | "NEEDS_DETAILS" | null;
  outcomeId?: string | null;
  recordedAt: string;
};

const joins: ClaireConversionJoin[] = [];

export function recordClaireConversionJoin(
  join: Omit<ClaireConversionJoin, "recordedAt"> & { recordedAt?: string }
): ClaireConversionJoin {
  const recorded: ClaireConversionJoin = {
    ...join,
    recordedAt: join.recordedAt ?? new Date().toISOString(),
  };
  joins.push(recorded);
  return recorded;
}

export function listClaireConversionJoins(tenantId?: string): ClaireConversionJoin[] {
  return tenantId ? joins.filter(join => join.tenantId === tenantId) : [...joins];
}

export function resetClaireConversionJoinsForTesting(): void {
  joins.length = 0;
}
