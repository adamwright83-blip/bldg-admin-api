export const DAYFORGE_RETENTION_POLICY_VERSION = "2026-07-13";

export type DayforgeRetentionResource =
  | "anonymous_preview_results"
  | "anonymous_preview_sessions"
  | "product_analytics"
  | "evidence_uploads"
  | "rate_limit_buckets"
  | "game_replays"
  | "provider_diagnostics";

export type RetentionPolicyEntry = {
  category: string;
  resource: DayforgeRetentionResource | "operational_audit" | "operational_evidence";
  lifetimeDays: number | null;
  automatedAction: "delete" | "redact_payload" | "preserve";
  reason: string;
};

/**
 * Product analytics and transient payloads expire. Operational facts remain
 * authoritative and immutable: cleanup never deletes dayforge_audit_events or
 * the evidence attached to a recorded commercial outcome.
 */
export const DAYFORGE_RETENTION_MATRIX: readonly RetentionPolicyEntry[] = [
  {
    category: "Anonymous territory result payload",
    resource: "anonymous_preview_results",
    lifetimeDays: 1,
    automatedAction: "delete",
    reason: "Short-lived preview value; not an operator system of record.",
  },
  {
    category: "Anonymous territory address and session",
    resource: "anonymous_preview_sessions",
    lifetimeDays: 1,
    automatedAction: "delete",
    reason: "Raw store-location input is unnecessary after preview expiry.",
  },
  {
    category: "Privacy-safe product analytics",
    resource: "product_analytics",
    lifetimeDays: 400,
    automatedAction: "delete",
    reason: "Supports annual funnel comparison without indefinite tracking.",
  },
  {
    category: "Private uploaded field evidence",
    resource: "evidence_uploads",
    lifetimeDays: 90,
    automatedAction: "delete",
    reason: "Uploaded binary evidence is more sensitive than the verified outcome fact.",
  },
  {
    category: "Abuse-control rate buckets",
    resource: "rate_limit_buckets",
    lifetimeDays: 1,
    automatedAction: "delete",
    reason: "Expired counters are not durable customer or security history.",
  },
  {
    category: "BORESLAY replay telemetry",
    resource: "game_replays",
    lifetimeDays: 30,
    automatedAction: "preserve",
    reason: "Thirty days is the target after replay payloads are split or hash/redaction proof is added; the current authoritative result row remains immutable.",
  },
  {
    category: "Provider and release diagnostics",
    resource: "provider_diagnostics",
    lifetimeDays: 14,
    automatedAction: "delete",
    reason: "Daily provider-budget and circuit diagnostics are for bounded incident response, not customer history.",
  },
  {
    category: "Commercial operational evidence",
    resource: "operational_evidence",
    lifetimeDays: null,
    automatedAction: "preserve",
    reason: "Evidence supporting a recorded outcome follows the business record.",
  },
  {
    category: "Immutable operational audit",
    resource: "operational_audit",
    lifetimeDays: null,
    automatedAction: "preserve",
    reason: "dayforge_audit_events is excluded from automated cleanup.",
  },
] as const;

export const CLEANABLE_DAYFORGE_RESOURCES = DAYFORGE_RETENTION_MATRIX.filter(
  (
    item
  ): item is RetentionPolicyEntry & { resource: DayforgeRetentionResource; lifetimeDays: number } =>
    item.automatedAction !== "preserve" && item.lifetimeDays !== null
).map(item => item.resource);

export function retentionCutoff(
  resource: DayforgeRetentionResource,
  now: Date
): Date {
  const policy = DAYFORGE_RETENTION_MATRIX.find(item => item.resource === resource);
  if (!policy || policy.lifetimeDays === null || policy.automatedAction === "preserve") {
    throw new Error(`No automated retention policy for ${resource}`);
  }
  return new Date(now.getTime() - policy.lifetimeDays * 24 * 60 * 60 * 1000);
}
