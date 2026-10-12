import type { PickupBridgeView } from "./cleancloudPickup";
/**
 * External jobs never imply a native Laundry Butler order, payment or revenue.
 * Manual reconciliation is an operator's statement. The optional pickupBridge
 * separately records a browser worker's verified CleanCloud Detail receipt.
 */
export const EXTERNAL_SOURCE_SYSTEMS = [
  "cleancloud",
  "manual_external",
] as const;
export type ExternalSourceSystem = (typeof EXTERNAL_SOURCE_SYSTEMS)[number];

/**
 * How the record got here. Screenshot extraction and a hand-typed job carry
 * different confidence, and a later audit should be able to tell them apart
 * rather than finding one undifferentiated pile.
 */
export const EXTERNAL_INGESTION_METHODS = [
  "screenshot",
  "manual",
  "voice",
  "browser",
] as const;
export type ExternalIngestionMethod =
  (typeof EXTERNAL_INGESTION_METHODS)[number];

export const EXTERNAL_JOB_KINDS = ["pickup", "dropoff"] as const;
export type ExternalJobKind = (typeof EXTERNAL_JOB_KINDS)[number];

/** Physical truth: has the operator actually done the work. */
export const EXTERNAL_OPERATIONAL_STATUSES = [
  "scheduled",
  "completed",
  "cancelled",
] as const;
export type ExternalOperationalStatus =
  (typeof EXTERNAL_OPERATIONAL_STATUSES)[number];

/**
 * External-system truth. `update_required` is the honest default the moment
 * physical work completes: the bag is in the car, and CleanCloud does not know
 * yet. Manual reconciliation records what the operator states. A verified browser
 * pickup receipt also sets externalLastVerifiedAt in storage.
 */
export const EXTERNAL_RECONCILIATION_STATUSES = [
  "update_required",
  "reconciled",
] as const;
export type ExternalReconciliationStatus =
  (typeof EXTERNAL_RECONCILIATION_STATUSES)[number];

/**
 * Review gate. Nothing a vision model reads off a screenshot is business truth
 * until a human confirms it, so extracted rows land in `pending_review` and
 * only `confirmed` rows are eligible to become playable work.
 */
export const EXTERNAL_REVIEW_STATES = [
  "pending_review",
  "confirmed",
  "discarded",
] as const;
export type ExternalReviewState = (typeof EXTERNAL_REVIEW_STATES)[number];

export type ExternalOperationalOrder = {
  pickupBridge?: PickupBridgeView;
  id: string;
  sourceSystem: ExternalSourceSystem;
  ingestionMethod: ExternalIngestionMethod;
  externalOrderId: string | null;
  jobKind: ExternalJobKind;
  customerName: string;
  address: string | null;
  scheduledDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  notes: string | null;
  operationalStatus: ExternalOperationalStatus;
  completedAt: string | null;
  reconciliationStatus: ExternalReconciliationStatus;
  reconciledAt: string | null;
  reviewState: ExternalReviewState;
  importBatchId: string | null;
  createdAt: string;
};

/**
 * One job as read off a screenshot, BEFORE any human has looked at it.
 *
 * Deliberately a different type from the persisted record. A vision model's
 * reading is a proposal, and giving it the same shape as a stored order would
 * make it far too easy to write one straight through — which is the single
 * failure this whole flow exists to prevent.
 */
export type ExtractedExternalJob = {
  jobKind: ExternalJobKind;
  customerName: string;
  address: string | null;
  scheduledDate: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  notes: string | null;
  externalOrderId: string | null;
};

export type ExternalImportProposal = {
  batchId: string;
  jobs: ExtractedExternalJob[];
  /** Screenshots the model could not read anything from, reported honestly. */
  unreadableImageCount: number;
};

/** A time window, formatted for a person. Null when the source didn't show one. */
export function formatExternalWindow(
  start: string | null,
  end: string | null
): string | null {
  if (start && end) return `${start}–${end}`;
  return start ?? end ?? null;
}

/**
 * The one-line provenance label. Used everywhere the operator could otherwise
 * mistake external work for native Laundry Butler work.
 */
export function externalProvenanceLabel(
  order: Pick<ExternalOperationalOrder, "sourceSystem">
): string {
  return order.sourceSystem === "cleancloud"
    ? "CLEAN CLOUD"
    : "EXTERNAL SOURCE";
}

/**
 * What the operator still owes the other system.
 *
 * Returns null while the physical work is unfinished — an untouched job does
 * not need a CleanCloud update yet, and saying so early would train the
 * operator to ignore the badge.
 */
export function externalReconciliationLabel(
  order: Pick<
    ExternalOperationalOrder,
    "sourceSystem" | "operationalStatus" | "reconciliationStatus"
  >
): string | null {
  if (order.operationalStatus !== "completed") return null;
  const system = externalProvenanceLabel(order);
  return order.reconciliationStatus === "reconciled"
    ? `${system} · RECONCILED`
    : `${system} · UPDATE REQUIRED`;
}

/**
 * Only a confirmed, scheduled job is real work the player can be sent to do.
 * A pending-review extraction is a proposal, and a completed one is done.
 */
export function isPlayableExternalOrder(
  order: Pick<ExternalOperationalOrder, "reviewState" | "operationalStatus">
): boolean {
  return (
    order.reviewState === "confirmed" && order.operationalStatus === "scheduled"
  );
}
