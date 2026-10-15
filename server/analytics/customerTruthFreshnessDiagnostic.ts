/**
 * Read-only CleanCloud / customer-truth freshness diagnostic.
 *
 * Built from the canonical coverage snapshot and the importer clocks already
 * stored on that snapshot and on ledger source evidence. It does not import,
 * does not name a customer, and does not treat a missing or failed read as an
 * empty population.
 */
import {
  customerTruthDispositionOf,
  loadBusinessSourceCoverage,
  type BusinessSourceCoverageSnapshot,
  type CustomerTruthDisposition,
} from "./sourceCoverage";

/**
 * Same failure outcomes as `attemptFailedAfterSuccess` in sourceCoverage.
 * A successful or replayed attempt is not a failure. An older failure that
 * predates the last success is not the latest attempt's failure.
 */
const IMPORT_FAILURE_OUTCOMES = new Set([
  "extension_export",
  "extension_failed",
  "extension_parse",
  "extension_import",
  "rejected",
  "conflict",
  "unpaired",
  "failed",
  "unavailable",
]);

const IDENTITY_KEYS = new Set([
  "name",
  "customername",
  "firstname",
  "lastname",
  "displayname",
  "phone",
  "phonedigits",
  "email",
  "identityid",
  "identitykey",
  "customerkey",
  "contacts",
  "members",
  "customers",
]);

export type EligiblePopulationState = "withheld" | "empty_verified" | "not_evaluated";

export type CleanCloudPresence = "absent" | "held" | "unreadable";

/** Importer clocks already recorded. No customer identity. */
export type CustomerTruthImporterStatus = {
  /** Binding or receipt success time, when the existing store has one. */
  lastSuccessfulSyncAt: string | null;
  /** Latest recorded attempt. Null when the attempt log was not read. */
  latestAttempt: { at: string; outcome: string } | null;
};

export type CustomerTruthFreshnessDiagnostic = {
  tenantId: string;
  checkedAt: string;
  /** Existing customer-truth disposition. Never a looser success word. */
  disposition: CustomerTruthDisposition;
  lastSuccessfulSyncAt: string | null;
  /** Customer-truth assimilation time already on the CleanCloud source, if any. */
  lastSuccessfulAssimilationAt: string | null;
  latestAttemptAt: string | null;
  /** Null when no attempt was recorded. False when the latest attempt succeeded. */
  latestAttemptFailed: boolean | null;
  /** Outcome code only. Attempt messages are omitted; they are not identity. */
  latestAttemptOutcome: string | null;
  /**
   * Newest represented orders-created day already on the snapshot
   * (`coveredThrough`). This is the coverage watermark. It is not a new clock
   * and it is not a customer.
   */
  coverageWatermark: string | null;
  /** Claire sentence when personalized outreach is withheld. Null when current. */
  withholdingSentence: string | null;
  eligiblePopulation: EligiblePopulationState;
  cleancloudPresence: CleanCloudPresence;
  cleancloudDisposition: CustomerTruthDisposition;
  /** Copied from the coverage contract. Absence is never "no customers". */
  missingIsNoCustomers: false;
  interpretEmptyAsNoCustomers: boolean;
};

export function claireCustomerTruthWithholdingSentence(
  disposition: CustomerTruthDisposition
): string | null {
  if (disposition === "current") return null;
  return `CleanCloud customer truth is ${disposition}. Personalized outreach is withheld until the book is current.`;
}

function isoOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function attemptFailed(
  attempt: { at: string; outcome: string } | null,
  lastSuccessfulSyncAt: string | null
): boolean | null {
  if (!attempt) return null;
  const outcome = attempt.outcome.trim().toLowerCase();
  if (!outcome || outcome === "imported" || outcome === "replayed") return false;
  const failed =
    IMPORT_FAILURE_OUTCOMES.has(outcome) ||
    outcome.includes("fail") ||
    outcome.includes("reject");
  if (!failed) return false;
  const attemptAt = Date.parse(attempt.at);
  if (!Number.isFinite(attemptAt)) return null;
  const successAt = lastSuccessfulSyncAt ? Date.parse(lastSuccessfulSyncAt) : Number.NaN;
  if (!Number.isFinite(successAt)) return true;
  return attemptAt >= successAt;
}

function assertNoIdentityFields(value: unknown, path = "diagnostic"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoIdentityFields(item, path);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY_KEYS.has(key.toLowerCase())) {
      throw new Error(
        `Customer identity field ${path}.${key} is not allowed on the freshness diagnostic.`
      );
    }
    assertNoIdentityFields(child, `${path}.${key}`);
  }
}

function cleancloudOf(snapshot: BusinessSourceCoverageSnapshot | null) {
  const source = snapshot?.sources.find(item => item.sourceId === "cleancloud");
  if (!snapshot || !source) {
    return {
      presence: "unreadable" as const,
      disposition: "source_unavailable" as const,
      coverageWatermark: null,
      lastSuccessfulAssimilationAt: null,
    };
  }
  const presence: CleanCloudPresence =
    source.availability === "not_held" || source.provenance.bindingState === "absent"
      ? "absent"
      : source.provenance.bindingState === "unknown"
        ? "unreadable"
        : "held";
  return {
    presence,
    disposition: source.customerTruthDisposition ?? "source_unavailable",
    coverageWatermark: source.coveredThrough,
    lastSuccessfulAssimilationAt: isoOrNull(source.lastSuccessfulAssimilationAt),
  };
}

/**
 * Pure diagnostic. `coverage` is the canonical snapshot. `importer` is the
 * sync binding and latest attempt already stored for that tenant. Neither
 * input may carry a customer name, phone, or identity, and the result never
 * adds one.
 */
export function diagnoseCustomerTruthFreshness(input: {
  coverage: BusinessSourceCoverageSnapshot | null;
  importer?: CustomerTruthImporterStatus | null;
  now?: Date;
}): CustomerTruthFreshnessDiagnostic {
  const coverage = input.coverage;
  const disposition = customerTruthDispositionOf(coverage);
  const cleancloud = cleancloudOf(coverage);
  const importerAttempt = input.importer?.latestAttempt ?? null;
  const attemptAt = isoOrNull(importerAttempt?.at);
  const storedSyncAt = isoOrNull(input.importer?.lastSuccessfulSyncAt);
  const lastSuccessfulSyncAt = storedSyncAt ?? cleancloud.lastSuccessfulAssimilationAt;
  const outcome = importerAttempt?.outcome.trim() ?? "";
  const diagnostic: CustomerTruthFreshnessDiagnostic = {
    tenantId: coverage?.tenantId ?? "",
    checkedAt: coverage?.checkedAt ?? (input.now ?? new Date()).toISOString(),
    disposition,
    lastSuccessfulSyncAt,
    lastSuccessfulAssimilationAt: cleancloud.lastSuccessfulAssimilationAt,
    latestAttemptAt: attemptAt,
    latestAttemptFailed: attemptFailed(
      importerAttempt && attemptAt ? { at: attemptAt, outcome: importerAttempt.outcome } : null,
      lastSuccessfulSyncAt
    ),
    latestAttemptOutcome: outcome ? outcome.slice(0, 32) : null,
    coverageWatermark: cleancloud.coverageWatermark,
    withholdingSentence: claireCustomerTruthWithholdingSentence(disposition),
    eligiblePopulation:
      disposition !== "current"
        ? "withheld"
        : coverage?.book.interpretEmptyAsNoCustomers
          ? "empty_verified"
          : "not_evaluated",
    cleancloudPresence: cleancloud.presence,
    cleancloudDisposition: cleancloud.disposition,
    missingIsNoCustomers: false,
    interpretEmptyAsNoCustomers: coverage?.book.interpretEmptyAsNoCustomers ?? false,
  };
  assertNoIdentityFields(diagnostic);
  return diagnostic;
}

async function importerStatusFromEvidence(
  tenantId: string
): Promise<CustomerTruthImporterStatus | null> {
  if (!tenantId.trim()) return null;
  const { loadLedgerSourceEvidence } = await import("./sourceBindings");
  const evidence = await loadLedgerSourceEvidence(tenantId);
  const attempt = evidence.cleancloud.latestAttempt;
  return {
    lastSuccessfulSyncAt: evidence.cleancloud.lastSuccessAt
      ? evidence.cleancloud.lastSuccessAt.toISOString()
      : null,
    latestAttempt: attempt
      ? { at: attempt.at.toISOString(), outcome: attempt.outcome }
      : null,
  };
}

/**
 * Operator read. Uses the canonical coverage loader and the existing ledger
 * evidence clocks. It selects no customer name, phone, or identity column of
 * its own.
 */
export async function loadCustomerTruthFreshnessDiagnostic(
  input: { tenantId: string; now?: Date },
  deps: {
    loadCoverage?: typeof loadBusinessSourceCoverage;
    loadImporterStatus?: (tenantId: string) => Promise<CustomerTruthImporterStatus | null>;
  } = {}
): Promise<CustomerTruthFreshnessDiagnostic> {
  const now = input.now ?? new Date();
  const loadCoverage = deps.loadCoverage ?? loadBusinessSourceCoverage;
  const loadImporterStatus = deps.loadImporterStatus ?? importerStatusFromEvidence;
  const [coverage, importer] = await Promise.all([
    loadCoverage({ tenantId: input.tenantId, now }).catch(() => null),
    loadImporterStatus(input.tenantId).catch(() => null),
  ]);
  return diagnoseCustomerTruthFreshness({ coverage, importer, now });
}
