import { buildingFromSlug } from "@shared/buildings";
import { buildAdminCustomerAggregatesFromTruth } from "../adminCustomerAggregate";
import {
  loadCustomerOrderTruth,
  type CustomerOrderSource,
  type CustomerOrderTruthRecord,
} from "../geography/customerOrderTruth";
import {
  daysSince,
  DORMANT_INACTIVITY_DAYS,
  strategyCustomerSnapshotId,
} from "../strategy/snapshotDormantCustomers";
import {
  loadBusinessSourceCoverage,
  SOURCE_COVERAGE_CONTRACT_VERSION,
  type BusinessSourceCoverageSnapshot,
  type SourceCoverageStatus,
} from "./sourceCoverage";

/**
 * Canonical dormant-customer queue for JOYSTICK.
 *
 * One read of the existing unified book: native orders plus CleanCloud paid
 * orders, grouped by `groupCustomerOrderTruth` inside
 * `buildAdminCustomerAggregatesFromTruth`. This module does not open a third
 * customer book.
 *
 * Freshness is B1's snapshot only. This module does not decide fresh, stale,
 * partial, or unavailable, and it does not add a clock.
 *
 * Dormancy is the existing paid-customer rule: at least one paid order, and
 * the last order on that book is at least `DORMANT_INACTIVITY_DAYS` before
 * `now`. Churn scores, outreach, and Claire's prompt budget are not this queue.
 *
 * A partial or stale book may still return the customers the read actually
 * holds. That list is `known_candidates`. It is exhaustive only when B1's
 * book is exhaustive and current and this read succeeded. `allCustomersLicensed`
 * stays false.
 *
 * Spirit Human rescue Challenge wiring depends on pull request 230. This
 * module does not import the rescue mission service. The public Objective
 * payload has no phone, email, or street address.
 */

export const DORMANT_QUEUE_CONTRACT_VERSION = 1 as const;

export const DORMANT_QUEUE_RESCUE_INTEGRATION = {
  status: "dependent_on_pr_230",
  pullRequest: 230,
  wired: false,
} as const;

export type DormantQueueClaim =
  | "current_held_book"
  | "known_candidates"
  | "unreadable";

export type CanonicalDormantCustomer = {
  id: string;
  firstName: string;
  buildingName?: string;
  lastOrderAt: string;
  daysSinceLastOrder: number;
  paidOrderCount: number;
  sources: CustomerOrderSource[];
  reason: string;
};

export type CanonicalDormantCoverage = {
  contractVersion: typeof SOURCE_COVERAGE_CONTRACT_VERSION | null;
  /** False when B1's snapshot could not be read for this tenant. That is not a fresh book. */
  snapshotRead: boolean;
  bookStatus: SourceCoverageStatus | null;
  exhaustiveCurrent: boolean;
  /** True unless the held book is exhaustive and current. */
  incomplete: boolean;
  knownRecordsReadable: boolean;
  interpretEmptyAsNoCustomers: boolean;
  blockingSources: BusinessSourceCoverageSnapshot["blockingSources"];
};

export type CanonicalDormantQueue = {
  contractVersion: typeof DORMANT_QUEUE_CONTRACT_VERSION;
  tenantId: string;
  checkedAt: string;
  inactivityDays: typeof DORMANT_INACTIVITY_DAYS;
  decidedBy: "deterministic_rules";
  claim: DormantQueueClaim;
  /**
   * True only for `current_held_book`: B1 `book.exhaustiveCurrent` and
   * `book.current`, and the customer book was read. A known-candidate list
   * is not exhaustive.
   */
  exhaustive: boolean;
  /** Copied constraint from B1. This read never sets it true. */
  allCustomersLicensed: false;
  staleIsZero: false;
  missingIsNoCustomers: false;
  /**
   * True only when the current held book was read and no paid customer is
   * inactive. An unreadable or incomplete book is not an empty queue.
   */
  emptyMeansNoDormantCustomers: boolean;
  /**
   * Length of `customers`, or null when the book could not be read.
   * This is not a population total unless `exhaustive` is true.
   */
  customerCount: number | null;
  customers: CanonicalDormantCustomer[];
  listReason: string;
  coverage: CanonicalDormantCoverage;
  rescueIntegration: typeof DORMANT_QUEUE_RESCUE_INTEGRATION;
};

export type PublicDormantObjectivePayload = {
  kind: "challenge";
  objective: "dormant_customer_queue";
  contractVersion: typeof DORMANT_QUEUE_CONTRACT_VERSION;
  tenantId: string;
  checkedAt: string;
  decidedBy: "deterministic_rules";
  claim: DormantQueueClaim;
  exhaustive: boolean;
  allCustomersLicensed: false;
  emptyMeansNoDormantCustomers: boolean;
  customerCount: number | null;
  customers: CanonicalDormantCustomer[];
  listReason: string;
  coverage: CanonicalDormantCoverage;
  rescueIntegration: typeof DORMANT_QUEUE_RESCUE_INTEGRATION;
};

const FORBIDDEN_PUBLIC_KEYS = [
  "phone",
  "email",
  "address",
  "unit",
  "street",
  "streetAddress",
  "customerPhone",
  "customerEmail",
] as const;

export type LoadDormantSourceCoverage = (input: {
  tenantId: string;
  now?: Date;
}) => Promise<BusinessSourceCoverageSnapshot | null>;

export type LoadDormantCustomerBook = (
  tenantId: string
) => Promise<CustomerOrderTruthRecord[]>;

/** Loads B1's snapshot. Returns null when the contract cannot be read. Does not invent a status. */
export async function loadDormantSourceCoverage(input: {
  tenantId: string;
  now?: Date;
}): Promise<BusinessSourceCoverageSnapshot | null> {
  try {
    const snapshot = await loadBusinessSourceCoverage({
      tenantId: input.tenantId,
      now: input.now,
    });
    return acceptCoverage(input.tenantId, snapshot);
  } catch (error) {
    console.warn(
      "[DormantQueue] source coverage contract unavailable",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export function dormantQualificationReason(input: {
  daysSinceLastOrder: number;
  paidOrderCount: number;
  sources: readonly CustomerOrderSource[];
  lastOrderAt: string;
}): string {
  const sources = [...input.sources].sort().join("+");
  return [
    "paid_customer_inactive",
    `days_since_last_order=${input.daysSinceLastOrder}`,
    `threshold_days=${DORMANT_INACTIVITY_DAYS}`,
    `paid_orders=${input.paidOrderCount}`,
    `sources=${sources}`,
    `last_order_at=${input.lastOrderAt}`,
  ].join(" ");
}

function acceptCoverage(
  tenantId: string,
  snapshot: BusinessSourceCoverageSnapshot | null | undefined
): BusinessSourceCoverageSnapshot | null {
  if (!snapshot) return null;
  if (snapshot.contractVersion !== SOURCE_COVERAGE_CONTRACT_VERSION) return null;
  if (snapshot.tenantId !== tenantId) return null;
  const book = snapshot.book;
  // Customer completeness is these three closed flags. Exact revenue is not a
  // customer-book gate, and B1 does not publish exactRevenueLicensed.
  if (book.allCustomersLicensed !== false) return null;
  if (book.staleIsZero !== false) return null;
  if (book.missingIsNoCustomers !== false) return null;
  return snapshot;
}

function coverageView(
  snapshot: BusinessSourceCoverageSnapshot | null
): CanonicalDormantCoverage {
  if (!snapshot) {
    return {
      contractVersion: null,
      snapshotRead: false,
      bookStatus: null,
      exhaustiveCurrent: false,
      incomplete: true,
      knownRecordsReadable: false,
      interpretEmptyAsNoCustomers: false,
      blockingSources: [],
    };
  }
  const current = snapshot.book.exhaustiveCurrent && snapshot.book.current;
  return {
    contractVersion: snapshot.contractVersion,
    snapshotRead: true,
    bookStatus: snapshot.book.status,
    exhaustiveCurrent: snapshot.book.exhaustiveCurrent,
    incomplete: !current,
    knownRecordsReadable: snapshot.book.knownRecordsReadable,
    interpretEmptyAsNoCustomers: snapshot.book.interpretEmptyAsNoCustomers,
    blockingSources: snapshot.blockingSources.map(source => ({ ...source })),
  };
}

function listReason(
  claim: DormantQueueClaim,
  bookStatus: SourceCoverageStatus | null
): string {
  if (claim === "unreadable") {
    return "The customer book could not be read. This is not an empty dormant queue.";
  }
  if (claim === "known_candidates") {
    const status = bookStatus ?? "unreadable";
    return `Known dormant customers from readable rows. Source coverage is ${status}, so this list is not exhaustive.`;
  }
  return "Dormant customers in the current held book. allCustomersLicensed remains false.";
}

function heldSources(
  snapshot: BusinessSourceCoverageSnapshot | null
): ReadonlySet<CustomerOrderSource> | null {
  if (!snapshot) return null;
  return new Set(
    snapshot.sources
      .filter(source => source.includedInCombinedBook)
      .map(source => source.sourceId)
  );
}

function qualifyCustomers(input: {
  tenantId: string;
  now: Date;
  records: readonly CustomerOrderTruthRecord[];
  held: ReadonlySet<CustomerOrderSource> | null;
}): CanonicalDormantCustomer[] {
  const records = input.records.filter(record => {
    if (record.cancelled) return false;
    if (input.held && !input.held.has(record.source)) return false;
    return true;
  });
  const aggregates = buildAdminCustomerAggregatesFromTruth(input.tenantId, [
    ...records,
  ]);
  const customers: CanonicalDormantCustomer[] = [];
  for (const row of aggregates) {
    if (row.paidOrderCount < 1) continue;
    const elapsed = daysSince(row.lastOrderAt, input.now);
    if (elapsed < DORMANT_INACTIVITY_DAYS) continue;
    const sources = [...(row.sources ?? [])].sort();
    const lastOrderAt = row.lastOrderAt.toISOString();
    const buildingName = buildingFromSlug(row.buildingSlug)?.name;
    const customer: CanonicalDormantCustomer = {
      id: strategyCustomerSnapshotId(input.tenantId, row),
      firstName: row.firstName.trim(),
      lastOrderAt,
      daysSinceLastOrder: elapsed,
      paidOrderCount: row.paidOrderCount,
      sources,
      reason: dormantQualificationReason({
        daysSinceLastOrder: elapsed,
        paidOrderCount: row.paidOrderCount,
        sources,
        lastOrderAt,
      }),
    };
    if (buildingName) customer.buildingName = buildingName;
    customers.push(customer);
  }
  customers.sort((left, right) => {
    if (right.daysSinceLastOrder !== left.daysSinceLastOrder) {
      return right.daysSinceLastOrder - left.daysSinceLastOrder;
    }
    return left.id.localeCompare(right.id);
  });
  return customers;
}

export function deriveCanonicalDormantQueue(input: {
  tenantId: string;
  now: Date;
  /** Null when the unified book could not be read. An empty array is a real read. */
  records: readonly CustomerOrderTruthRecord[] | null;
  coverage?: BusinessSourceCoverageSnapshot | null;
}): CanonicalDormantQueue {
  const snapshot = acceptCoverage(input.tenantId, input.coverage);
  const coverage = coverageView(snapshot);
  const bookReadable = input.records !== null;
  const currentHeldBook =
    bookReadable && coverage.snapshotRead && !coverage.incomplete;
  const claim: DormantQueueClaim = !bookReadable
    ? "unreadable"
    : currentHeldBook
      ? "current_held_book"
      : "known_candidates";
  const customers = bookReadable
    ? qualifyCustomers({
        tenantId: input.tenantId,
        now: input.now,
        records: input.records ?? [],
        held: heldSources(snapshot),
      })
    : [];
  const customerCount = bookReadable ? customers.length : null;
  return {
    contractVersion: DORMANT_QUEUE_CONTRACT_VERSION,
    tenantId: input.tenantId,
    checkedAt: input.now.toISOString(),
    inactivityDays: DORMANT_INACTIVITY_DAYS,
    decidedBy: "deterministic_rules",
    claim,
    exhaustive: claim === "current_held_book",
    allCustomersLicensed: false,
    staleIsZero: false,
    missingIsNoCustomers: false,
    emptyMeansNoDormantCustomers:
      claim === "current_held_book" && customerCount === 0,
    customerCount,
    customers,
    listReason: listReason(claim, coverage.bookStatus),
    coverage,
    rescueIntegration: DORMANT_QUEUE_RESCUE_INTEGRATION,
  };
}

function forbiddenPublicKey(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if ((FORBIDDEN_PUBLIC_KEYS as readonly string[]).includes(key)) return key;
    const nested = forbiddenPublicKey(child);
    if (nested) return nested;
  }
  return null;
}

/** Remote Objective view of the queue. Contact fields stay off this object. */
export function toPublicDormantObjectivePayload(
  queue: CanonicalDormantQueue
): PublicDormantObjectivePayload {
  const payload: PublicDormantObjectivePayload = {
    kind: "challenge",
    objective: "dormant_customer_queue",
    contractVersion: queue.contractVersion,
    tenantId: queue.tenantId,
    checkedAt: queue.checkedAt,
    decidedBy: queue.decidedBy,
    claim: queue.claim,
    exhaustive: queue.exhaustive,
    allCustomersLicensed: false,
    emptyMeansNoDormantCustomers: queue.emptyMeansNoDormantCustomers,
    customerCount: queue.customerCount,
    customers: queue.customers.map(customer => {
      const copy: CanonicalDormantCustomer = {
        id: customer.id,
        firstName: customer.firstName,
        lastOrderAt: customer.lastOrderAt,
        daysSinceLastOrder: customer.daysSinceLastOrder,
        paidOrderCount: customer.paidOrderCount,
        sources: [...customer.sources],
        reason: customer.reason,
      };
      if (customer.buildingName) copy.buildingName = customer.buildingName;
      return copy;
    }),
    listReason: queue.listReason,
    coverage: {
      ...queue.coverage,
      blockingSources: queue.coverage.blockingSources.map(source => ({
        ...source,
      })),
    },
    rescueIntegration: DORMANT_QUEUE_RESCUE_INTEGRATION,
  };
  const leaked = forbiddenPublicKey(payload);
  if (leaked) {
    throw new Error(
      `Public dormant Objective payload included forbidden field ${leaked}.`
    );
  }
  return payload;
}

export async function readCanonicalDormantQueue(input: {
  tenantId: string;
  now?: Date;
  coverage?: BusinessSourceCoverageSnapshot | null;
  loaders?: {
    loadCoverage?: LoadDormantSourceCoverage;
    loadTruth?: LoadDormantCustomerBook;
  };
}): Promise<CanonicalDormantQueue> {
  const now = input.now ?? new Date();
  if (!input.tenantId.trim()) {
    return deriveCanonicalDormantQueue({
      tenantId: input.tenantId,
      now,
      records: null,
      coverage: null,
    });
  }

  const loadCoverage = input.loaders?.loadCoverage ?? loadDormantSourceCoverage;
  const loadTruth =
    input.loaders?.loadTruth ??
    ((tenantId: string) => loadCustomerOrderTruth(tenantId));

  const coverage =
    input.coverage !== undefined
      ? input.coverage
      : await loadCoverage({ tenantId: input.tenantId, now });

  let records: CustomerOrderTruthRecord[] | null;
  try {
    records = await loadTruth(input.tenantId);
  } catch (error) {
    console.warn(
      "[DormantQueue] unified customer book unavailable",
      error instanceof Error ? error.message : error
    );
    records = null;
  }

  return deriveCanonicalDormantQueue({
    tenantId: input.tenantId,
    now,
    records,
    coverage,
  });
}
