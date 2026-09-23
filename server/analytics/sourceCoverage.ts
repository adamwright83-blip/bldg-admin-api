/**
 * Canonical business source-coverage contract.
 *
 * One read, one vocabulary, one clock. Consumers (revenue, dormant customers,
 * territory visibility) must import this module instead of inventing a freshness
 * rule. Freshness is a deterministic function of authoritative records and the
 * existing Gumball schedule in `sourceBindings.ts`. An LLM does not decide it.
 *
 * Vocabulary, per held source and for the combined book:
 *   fresh       — the source is current for its contract
 *   stale       — a live source missed the checkpoint that is due
 *   partial     — some authoritative records are readable, and the book is not current
 *   unavailable — the source could not be read, or it never connected
 *
 * `not_held` is availability, not a fifth freshness word. A source the tenant
 * does not use is excluded from the combined book.
 *
 * Fail closed. A stale or partial CleanCloud book may still be read. It must
 * not be called exhaustive or current. Stale is not zero. Missing is not
 * "no customers." A fresh Orders (Sales) span is not payment-event completeness
 * and is not a revenue total.
 */
import { desc, eq } from "drizzle-orm";
import { browserSyncReceipts } from "../cleancloudBrowserSync/schema";
import { asGumballAssimilationStatus } from "../cleancloudBrowserSync/gumballOperatorStatus";
import { getDb } from "../db";
import { isMysqlMissingTableError } from "../mysqlErrors";
import {
  expectedCleanCloudCoverageThrough,
  GUMBALL_TIME_ZONE,
  rangesCover,
  UNKNOWN_EVIDENCE,
  type LedgerSourceEvidence,
  type SourceBindingState,
  type SourceCoverageBasis,
  type SourceCoverageRange,
  type SourceEvidence,
} from "./sourceBindings";

export {
  expectedCleanCloudCoverageThrough,
  GUMBALL_DAILY_HOUR,
  GUMBALL_EXECUTION_GRACE_MINUTES,
  GUMBALL_TIME_ZONE,
} from "./sourceBindings";

export const SOURCE_COVERAGE_CONTRACT_VERSION = 1 as const;

export const SOURCE_COVERAGE_STATUSES = [
  "fresh",
  "stale",
  "partial",
  "unavailable",
] as const;
export type SourceCoverageStatus = (typeof SOURCE_COVERAGE_STATUSES)[number];

export type SourceAvailability = "available" | "unavailable" | "not_held";
export type SourceRecordRead = "readable" | "none_proven" | "unknown";
export type BusinessSourceId = "laundry_butler" | "cleancloud";

export type CleanCloudAssimilationReceipt = {
  from: string;
  to: string;
  /** ISO-8601 completion time of the real export/import receipt. */
  completedAt: string;
  customerTruth: "refreshed" | "failed" | "skipped" | "pending" | null;
  basis: SourceCoverageBasis;
  provenance: SourceCoverageRange["provenance"];
};

export type BusinessSourceCoverage = {
  sourceId: BusinessSourceId;
  name: string;
  type: "native_orders" | "cleancloud_paid_book";
  availability: SourceAvailability;
  /** False for `not_held`. Those sources are reported and left out of the combined book. */
  includedInCombinedBook: boolean;
  status: SourceCoverageStatus;
  /**
   * When the real CleanCloud export/import path last assimilated customer truth.
   * Null for native orders (they originate here) and when assimilation has never succeeded.
   * This is not a sale timestamp.
   */
  lastSuccessfulAssimilationAt: string | null;
  assimilationKind: "customer_truth_refreshed" | "not_applicable" | "never";
  /**
   * Latest business-local day present in proven Orders (Sales) ranges.
   * Not a promise that every day back to `provenFrom` is covered. Only
   * `status: "fresh"` means the span is contiguous through `expectedThrough`.
   */
  coveredThrough: string | null;
  /** Earliest business-local day present in those ranges. */
  provenFrom: string | null;
  /** Business-local day the Gumball schedule requires. Null when no schedule applies. */
  expectedThrough: string | null;
  records: SourceRecordRead;
  /** True only when this source's own status is fresh. */
  supportsExhaustiveCurrentClaim: boolean;
  /**
   * True only for a fresh native book with no orders. Never true for a stale,
   * partial, or unavailable source.
   */
  emptyReadMeansNoRecords: boolean;
  reason: string;
  provenance: {
    bindingState: SourceBindingState;
    schedule:
      | "gumball_daily_18_america_los_angeles"
      | "system_of_record"
      | "none";
    coverageBasis: SourceCoverageBasis | null;
    receiptProvenance: SourceCoverageRange["provenance"] | null;
    /**
     * True only when economic-event ranges cover the same checkpoint span.
     * Gumball Orders (Sales) receipts are orders-created and leave this false.
     */
    paymentEventsProven: boolean;
    decidedBy: "deterministic_rules";
  };
};

export type BusinessSourceCoverageSnapshot = {
  contractVersion: typeof SOURCE_COVERAGE_CONTRACT_VERSION;
  tenantId: string;
  checkedAt: string;
  timeZone: typeof GUMBALL_TIME_ZONE;
  sources: BusinessSourceCoverage[];
  book: {
    status: SourceCoverageStatus;
    /** Every held source is fresh. Scoped to `scope`. Not unbounded "all customers". */
    exhaustiveCurrent: boolean;
    /** Same bar as `exhaustiveCurrent`. A stale or partial book is not current. */
    current: boolean;
    scope: {
      native: "system_of_record" | "not_held" | "unavailable";
      cleancloudOrdersCreated: { from: string; through: string } | null;
    };
    /** Orders (Sales) freshness is not payment-dated completeness. */
    paymentEventsProven: boolean;
    knownRecordsReadable: boolean;
    /** True only for a fresh book whose held sources provably contain no records. */
    interpretEmptyAsNoCustomers: boolean;
    /** Days outside a proven CleanCloud span are unknown. They are not empty. */
    outsideProvenSpan: "unknown_not_empty";
    /** This contract does not emit a revenue total. */
    exactRevenueLicensed: false;
    /** Unbounded "all customers" is not licensed, even when the book is fresh. */
    allCustomersLicensed: false;
    staleIsZero: false;
    missingIsNoCustomers: false;
  };
  blockingSources: Array<{
    sourceId: BusinessSourceId;
    status: SourceCoverageStatus;
    reason: string;
  }>;
};

export type DeriveBusinessSourceCoverageInput = {
  tenantId: string;
  now: Date;
  evidence: LedgerSourceEvidence;
  /**
   * Assimilation receipts for this tenant only.
   * `"unreadable"` fails closed: a covered checkpoint cannot become fresh.
   */
  cleancloudReceipts: readonly CleanCloudAssimilationReceipt[] | "unreadable";
};

const NATIVE_NAME = "Laundry Butler";
const CLEANCLOUD_NAME = "CleanCloud";

function parseTime(value: string): number | null {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function ordersCreatedRanges(evidence: SourceEvidence): SourceCoverageRange[] {
  return evidence.coverageRanges.filter(
    range => range.basis === "orders_created"
  );
}

function spanBounds(
  ranges: readonly SourceCoverageRange[],
  basis: SourceCoverageBasis
): { from: string | null; through: string | null } {
  const relevant = ranges.filter(range => range.basis === basis);
  if (!relevant.length) return { from: null, through: null };
  return {
    from: relevant.reduce(
      (min, range) => (range.from < min ? range.from : min),
      relevant[0]!.from
    ),
    through: relevant.reduce(
      (max, range) => (range.to > max ? range.to : max),
      relevant[0]!.to
    ),
  };
}

function coversDay(
  ranges: readonly SourceCoverageRange[],
  day: string,
  basis: SourceCoverageBasis
): boolean {
  return ranges.some(
    range => range.basis === basis && range.from <= day && range.to >= day
  );
}

function receiptAssimilated(
  range: SourceCoverageRange,
  receipts: readonly CleanCloudAssimilationReceipt[]
): boolean {
  const completedAt = range.completedAt.getTime();
  return receipts.some(receipt => {
    const receiptTime = parseTime(receipt.completedAt);
    return (
      receipt.customerTruth === "refreshed" &&
      receipt.basis === range.basis &&
      receipt.from === range.from &&
      receipt.to === range.to &&
      receiptTime === completedAt
    );
  });
}

function latestAssimilation(
  receipts: readonly CleanCloudAssimilationReceipt[]
): string | null {
  let best: number | null = null;
  let isoValue: string | null = null;
  for (const receipt of receipts) {
    if (receipt.customerTruth !== "refreshed") continue;
    const time = parseTime(receipt.completedAt);
    if (time === null) continue;
    if (best === null || time > best) {
      best = time;
      isoValue = new Date(time).toISOString();
    }
  }
  return isoValue;
}

function recordsOf(
  evidence: SourceEvidence,
  ranges: readonly SourceCoverageRange[]
): SourceRecordRead {
  if (ranges.length > 0 || evidence.lastSuccessAt) return "readable";
  if (evidence.state === "legacy_history") return "readable";
  return "unknown";
}

function paymentEventsProven(
  evidence: SourceEvidence,
  expectedThrough: string
): boolean {
  const bounds = spanBounds(evidence.coverageRanges, "economic_event");
  // `rangesCover` treats an inverted interval as covered. A span that starts
  // after the due day does not cover that day.
  if (!bounds.from || bounds.from > expectedThrough) return false;
  return rangesCover(evidence.coverageRanges, {
    from: bounds.from,
    to: expectedThrough,
    basis: "economic_event",
  });
}

function baseProvenance(
  evidence: SourceEvidence,
  schedule: BusinessSourceCoverage["provenance"]["schedule"],
  basis: SourceCoverageBasis | null,
  paymentProven: boolean
): BusinessSourceCoverage["provenance"] {
  const matching = basis
    ? evidence.coverageRanges.find(range => range.basis === basis)
    : undefined;
  return {
    bindingState: evidence.state,
    schedule,
    coverageBasis: basis,
    receiptProvenance: matching?.provenance ?? null,
    paymentEventsProven: paymentProven,
    decidedBy: "deterministic_rules",
  };
}

function nativeCoverage(evidence: SourceEvidence): BusinessSourceCoverage {
  const common = {
    sourceId: "laundry_butler" as const,
    name: NATIVE_NAME,
    type: "native_orders" as const,
    lastSuccessfulAssimilationAt: null,
    assimilationKind: "not_applicable" as const,
    coveredThrough: null,
    provenFrom: null,
    expectedThrough: null,
    provenance: baseProvenance(evidence, "system_of_record", null, false),
  };

  if (evidence.state === "absent") {
    return {
      ...common,
      availability: "not_held",
      includedInCombinedBook: false,
      status: "unavailable",
      records: "unknown",
      supportsExhaustiveCurrentClaim: false,
      emptyReadMeansNoRecords: false,
      reason: "This tenant has no native order source on file.",
    };
  }

  if (evidence.state === "unknown") {
    return {
      ...common,
      availability: "unavailable",
      includedInCombinedBook: true,
      status: "unavailable",
      records: "unknown",
      supportsExhaustiveCurrentClaim: false,
      emptyReadMeansNoRecords: false,
      reason:
        "Native orders could not be read. That is not an empty customer book.",
    };
  }

  if (evidence.state !== "bound") {
    const readable = evidence.lastSuccessAt !== null;
    return {
      ...common,
      availability: readable ? "available" : "unavailable",
      includedInCombinedBook: true,
      status: readable ? "partial" : "unavailable",
      records: readable ? "readable" : "unknown",
      supportsExhaustiveCurrentClaim: false,
      emptyReadMeansNoRecords: false,
      reason: readable
        ? "Native orders are readable without a live system-of-record binding. That is partial, not current."
        : "Native orders are not a readable system of record. That is not an empty customer book.",
    };
  }

  const noneProven = evidence.lastSuccessAt === null;
  return {
    ...common,
    availability: "available",
    includedInCombinedBook: true,
    status: "fresh",
    records: noneProven ? "none_proven" : "readable",
    supportsExhaustiveCurrentClaim: true,
    emptyReadMeansNoRecords: noneProven,
    reason: noneProven
      ? "Native orders were read and the book is empty. That empty read is real because this source is the system of record."
      : "Native orders are the system of record and the read succeeded.",
  };
}

function cleancloudCoverage(
  evidence: SourceEvidence,
  now: Date,
  receipts: readonly CleanCloudAssimilationReceipt[] | "unreadable"
): BusinessSourceCoverage {
  const expectedThrough = expectedCleanCloudCoverageThrough(now);
  const ranges = ordersCreatedRanges(evidence);
  const bounds = spanBounds(ranges, "orders_created");
  const checkpointCovered = coversDay(
    ranges,
    expectedThrough,
    "orders_created"
  );
  const spanReachesCheckpoint =
    bounds.from !== null &&
    bounds.from <= expectedThrough &&
    rangesCover(ranges, {
      from: bounds.from,
      to: expectedThrough,
      basis: "orders_created",
    });
  const receiptList = receipts === "unreadable" ? [] : receipts;
  const assimilatedCheckpoint =
    receipts !== "unreadable" &&
    ranges.some(
      range =>
        range.from <= expectedThrough &&
        range.to >= expectedThrough &&
        receiptAssimilated(range, receiptList)
    );
  const assimilationAt =
    receipts === "unreadable" ? null : latestAssimilation(receiptList);
  const paymentProven = paymentEventsProven(evidence, expectedThrough);
  const records = recordsOf(evidence, ranges);

  const common = {
    sourceId: "cleancloud" as const,
    name: CLEANCLOUD_NAME,
    type: "cleancloud_paid_book" as const,
    lastSuccessfulAssimilationAt: assimilationAt,
    assimilationKind: assimilationAt
      ? ("customer_truth_refreshed" as const)
      : ("never" as const),
    coveredThrough: bounds.through,
    provenFrom: bounds.from,
    expectedThrough,
    records,
    supportsExhaustiveCurrentClaim: false,
    emptyReadMeansNoRecords: false,
    provenance: baseProvenance(
      evidence,
      "gumball_daily_18_america_los_angeles",
      ranges[0]?.basis ?? null,
      paymentProven
    ),
  };

  if (evidence.state === "absent") {
    return {
      ...common,
      availability: "not_held",
      includedInCombinedBook: false,
      status: "unavailable",
      expectedThrough: null,
      records: "unknown",
      reason: "This tenant has no CleanCloud source on file.",
      provenance: {
        ...common.provenance,
        schedule: "none",
        paymentEventsProven: false,
      },
    };
  }

  if (evidence.state === "unknown") {
    return {
      ...common,
      availability: "unavailable",
      includedInCombinedBook: true,
      status: "unavailable",
      records: "unknown",
      reason:
        "CleanCloud coverage could not be read. That is not zero customers.",
    };
  }

  if (evidence.state === "configured") {
    return {
      ...common,
      availability: "unavailable",
      includedInCombinedBook: true,
      status: records === "readable" ? "partial" : "unavailable",
      reason:
        records === "readable"
          ? "CleanCloud is only configured, but older rows are readable. That is partial, not a current book, and not zero customers."
          : "CleanCloud is configured and has never connected. Missing rows are not zero customers.",
    };
  }

  if (evidence.state === "disconnected") {
    return {
      ...common,
      availability: records === "readable" ? "available" : "unavailable",
      includedInCombinedBook: true,
      status: records === "readable" ? "partial" : "unavailable",
      reason:
        records === "readable"
          ? "CleanCloud is disconnected. Known rows are partial history, not a current book."
          : "CleanCloud is disconnected and no rows are proven. That is not zero customers.",
    };
  }

  if (evidence.state === "legacy_history") {
    return {
      ...common,
      availability: "available",
      includedInCombinedBook: true,
      status: "partial",
      records: "readable",
      reason:
        "Historical CleanCloud rows exist without a live Gumball binding. That is partial history, not a current book.",
    };
  }

  if (receipts === "unreadable") {
    return {
      ...common,
      availability: records === "readable" ? "available" : "unavailable",
      includedInCombinedBook: true,
      status: "partial",
      reason:
        "Assimilation receipts could not be read. Freshness stays unproven. That is not zero customers.",
    };
  }

  if (assimilatedCheckpoint && spanReachesCheckpoint) {
    return {
      ...common,
      availability: "available",
      includedInCombinedBook: true,
      status: "fresh",
      supportsExhaustiveCurrentClaim: true,
      reason:
        "Gumball Orders (Sales) receipt covers the due checkpoint and customer truth was assimilated.",
    };
  }

  if (checkpointCovered && !assimilatedCheckpoint) {
    return {
      ...common,
      availability: "available",
      includedInCombinedBook: true,
      status: "partial",
      reason:
        "A receipt covers the due checkpoint, but customer-truth assimilation did not succeed.",
    };
  }

  if (assimilatedCheckpoint && !spanReachesCheckpoint) {
    return {
      ...common,
      availability: "available",
      includedInCombinedBook: true,
      status: "partial",
      reason:
        "The due checkpoint is assimilated, but the proven Orders (Sales) span has a gap. The book is partial.",
    };
  }

  return {
    ...common,
    availability: records === "readable" ? "available" : "unavailable",
    includedInCombinedBook: true,
    status: "stale",
    reason:
      records === "readable"
        ? "The due Gumball checkpoint is not covered. Older CleanCloud records may still be read. This is not zero customers."
        : "The due Gumball checkpoint is not covered, and no CleanCloud rows are proven. This is not zero customers.",
  };
}

function combineBook(
  sources: readonly BusinessSourceCoverage[]
): BusinessSourceCoverageSnapshot["book"] {
  const included = sources.filter(source => source.includedInCombinedBook);
  const statuses = new Set(included.map(source => source.status));
  let status: SourceCoverageStatus;
  if (
    included.length === 0 ||
    (statuses.size === 1 && statuses.has("unavailable"))
  ) {
    status = "unavailable";
  } else if (statuses.size === 1 && statuses.has("fresh")) {
    status = "fresh";
  } else if (statuses.size === 1 && statuses.has("stale")) {
    status = "stale";
  } else {
    status = "partial";
  }

  const native = sources.find(source => source.sourceId === "laundry_butler");
  const cleancloud = sources.find(source => source.sourceId === "cleancloud");
  const cleancloudHeld = Boolean(cleancloud?.includedInCombinedBook);
  const exhaustiveCurrent = status === "fresh";
  const nativeScope: BusinessSourceCoverageSnapshot["book"]["scope"]["native"] =
    native?.availability === "not_held"
      ? "not_held"
      : native?.status === "fresh"
        ? "system_of_record"
        : "unavailable";
  const cleancloudSpan =
    cleancloudHeld && cleancloud?.provenFrom && cleancloud.coveredThrough
      ? { from: cleancloud.provenFrom, through: cleancloud.coveredThrough }
      : null;

  return {
    status,
    exhaustiveCurrent,
    current: exhaustiveCurrent,
    scope: {
      native: nativeScope,
      cleancloudOrdersCreated: cleancloudSpan,
    },
    paymentEventsProven:
      exhaustiveCurrent &&
      (!cleancloudHeld || Boolean(cleancloud?.provenance.paymentEventsProven)),
    knownRecordsReadable: included.some(
      source => source.records === "readable"
    ),
    interpretEmptyAsNoCustomers:
      exhaustiveCurrent &&
      included.length > 0 &&
      included.every(source => source.emptyReadMeansNoRecords),
    outsideProvenSpan: "unknown_not_empty",
    exactRevenueLicensed: false,
    allCustomersLicensed: false,
    staleIsZero: false,
    missingIsNoCustomers: false,
  };
}

/**
 * Pure coverage decision. Same inputs always return the same snapshot.
 * `evidence` and `cleancloudReceipts` must already be scoped to `tenantId`.
 */
export function deriveBusinessSourceCoverage(
  input: DeriveBusinessSourceCoverageInput
): BusinessSourceCoverageSnapshot {
  const sources = [
    nativeCoverage(input.evidence.laundry_butler),
    cleancloudCoverage(
      input.evidence.cleancloud,
      input.now,
      input.cleancloudReceipts
    ),
  ];
  const book = combineBook(sources);
  return {
    contractVersion: SOURCE_COVERAGE_CONTRACT_VERSION,
    tenantId: input.tenantId,
    checkedAt: input.now.toISOString(),
    timeZone: GUMBALL_TIME_ZONE,
    sources,
    book,
    blockingSources: sources
      .filter(
        source => source.includedInCombinedBook && source.status !== "fresh"
      )
      .map(source => ({
        sourceId: source.sourceId,
        status: source.status,
        reason: source.reason,
      })),
  };
}

type ReceiptRow = { receiptJson?: unknown; createdAt?: Date | string | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function validYmd(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Successful Gumball receipts only. Cancelled receipts do not prove coverage. */
export function assimilationReceiptsFromRows(
  rows: readonly ReceiptRow[]
): CleanCloudAssimilationReceipt[] {
  const receipts: CleanCloudAssimilationReceipt[] = [];
  for (const row of rows) {
    const receipt = asRecord(row.receiptJson);
    if (!receipt || receipt.status === "cancelled") continue;
    const from = receipt.from;
    const to = receipt.to;
    const completedAt = toDate(receipt.completedAt ?? row.createdAt);
    if (!validYmd(from) || !validYmd(to) || !completedAt || to < from) continue;
    receipts.push({
      from,
      to,
      completedAt: completedAt.toISOString(),
      customerTruth: asGumballAssimilationStatus(receipt.customerTruth),
      basis: "orders_created",
      provenance: "browser_sync_receipt",
    });
  }
  return receipts;
}

export async function loadCleanCloudAssimilationReceipts(
  tenantId: string
): Promise<CleanCloudAssimilationReceipt[] | "unreadable"> {
  const db = await getDb().catch(() => null);
  if (!db) return "unreadable";
  try {
    const rows = await db
      .select({
        receiptJson: browserSyncReceipts.receiptJson,
        createdAt: browserSyncReceipts.createdAt,
      })
      .from(browserSyncReceipts)
      .where(eq(browserSyncReceipts.tenantId, tenantId))
      .orderBy(desc(browserSyncReceipts.createdAt))
      .limit(2000);
    return assimilationReceiptsFromRows(rows);
  } catch (error) {
    if (isMysqlMissingTableError(error)) return [];
    return "unreadable";
  }
}

export type LoadBusinessSourceCoverageDeps = {
  loadEvidence?: (tenantId: string) => Promise<LedgerSourceEvidence>;
  loadReceipts?: (
    tenantId: string
  ) => Promise<readonly CleanCloudAssimilationReceipt[] | "unreadable">;
};

/**
 * Canonical source-coverage read. Tenant-scoped. Does not calculate revenue
 * and does not rank dormant customers.
 */
export async function loadBusinessSourceCoverage(
  input: { tenantId: string; now?: Date },
  deps: LoadBusinessSourceCoverageDeps = {}
): Promise<BusinessSourceCoverageSnapshot> {
  const now = input.now ?? new Date();
  if (!input.tenantId?.trim()) {
    return deriveBusinessSourceCoverage({
      tenantId: input.tenantId,
      now,
      evidence: UNKNOWN_EVIDENCE,
      cleancloudReceipts: "unreadable",
    });
  }
  const loadEvidence =
    deps.loadEvidence ??
    (async (tenantId: string) => {
      const { loadLedgerSourceEvidence } = await import("./sourceBindings");
      return loadLedgerSourceEvidence(tenantId);
    });
  let evidence: LedgerSourceEvidence;
  try {
    evidence = await loadEvidence(input.tenantId);
  } catch {
    evidence = UNKNOWN_EVIDENCE;
  }
  const loadReceipts = deps.loadReceipts ?? loadCleanCloudAssimilationReceipts;
  let cleancloudReceipts:
    | readonly CleanCloudAssimilationReceipt[]
    | "unreadable";
  try {
    cleancloudReceipts = await loadReceipts(input.tenantId);
  } catch {
    cleancloudReceipts = "unreadable";
  }
  return deriveBusinessSourceCoverage({
    tenantId: input.tenantId,
    now,
    evidence,
    cleancloudReceipts,
  });
}
