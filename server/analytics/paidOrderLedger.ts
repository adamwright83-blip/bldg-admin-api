import { readNativePaidCandidates } from "../domains/orders/orderHistoryReadService";
import { readNativePaymentFacts, nativeCapturedAmountCents } from "../domains/payment/nativePaymentReadService";
import {
  readPaymentAuthorityReceipts,
  paymentAuthorityReceiptMatches,
  type AuthorityReceipt,
  type PaymentAuthorityExpectation,
} from "../authority/authorityReceipt";
import {
  cleanCloudPaidObservationReceiptMatches,
  readCleanCloudPaidObservationReceipts,
  type CleanCloudPaidObservationExpectation,
} from "../cleancloudPaidEvidence";
import {
  loadSalesReconciliationEvidence,
  type SalesReconciliationEvidence,
} from "./salesReconciliationStore";
import { and, eq, gte, inArray, isNotNull, isNull,
  lt, or, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { cleancloudPaidOrders } from "../../drizzle/schema";
import { browserSyncBindings } from "../cleancloudBrowserSync/schema";
import { getDb } from "../db";
import {
  buildingFor,
  cleanCloudBusinessLine,
  cleanCloudProcessor,
  serviceTypeFromCleanCloudClass,
  type BuildingKey,
  type BusinessLine,
  type LedgerSource,
  type PaymentProcessor,
} from "./businessLineage";
import { classifyCleanCloudService, type LaundryFarmServiceClass } from "./cleancloudServiceClass";
import { identityKeysFor, type IdentityEvidence } from "./customerIdentityResolution";

/**
 * The single read path for paid-order revenue in Goldline analytics.
 *
 * Source rules (shared with Tower Wars' economic-event loader):
 * - Native rows require a tenant/subject/source/ref-matching
 *   payment_verified Authority Receipt backed by Stripe.
 * - CleanCloud rows require a separate tenant/subject/source/ref-matching
 *   cleancloud_paid_observed receipt. This is external historical evidence,
 *   not native payment authority.
 * - Native candidates need Stripe payment evidence. Migration 0011
 *   backfilled `paidAt` from `updatedAt` for older paid rows, and manual
 *   "mark paid" writes carry no processor record, so those are held out and
 *   reported as unverified rather than silently added or dropped.
 * - CleanCloud orders can appear in both the Orders (Sales) and Orders
 *   (Revenue) exports; each CleanCloud order counts once, preferring Sales.
 *   The dropped twin is reported as a proven duplicate exclusion.
 * - Native and CleanCloud orders share no order key. Pairs that match on
 *   customer, business day, and amount stay in this ledger and are flagged.
 *   Exact revenue withholding of those suspected copies lives in
 *   `readCanonicalRevenue` (`canonicalRevenue.ts`), not in a second sum.
 *
 * Every event also carries its lineage (business line, processor, building,
 * service class, event time vs. ingestion time) — see businessLineage.ts.
 */

export type { BusinessLine, LedgerSource, PaymentProcessor } from "./businessLineage";
export const LEDGER_SOURCES: readonly LedgerSource[] = ["laundry_butler", "cleancloud"];

export type ServiceType = "wash_fold" | "dry_cleaning";

export type PaidOrderEvent = {
  paymentEvidence?: Omit<PaymentAuthorityExpectation, "tenantId">;
  cleancloudEvidence?: Omit<CleanCloudPaidObservationExpectation, "tenantId">;
  authorityReceiptId?: string;
  company?: "laundry_farm" | null;
  serviceLine?: import("./businessLineage").ServiceLine;
  source: LedgerSource;
  eventKey: string;
  occurredAt: Date;
  businessDate: string;
  cents: number;
  discountCents?: number | null;
  creditCents?: number | null;
  subtotalCents?: number | null;
  /** Native orders record a service type; CleanCloud orders are classified from their summary. */
  serviceType: ServiceType | null;
  customerName: string | null;
  identity: IdentityEvidence;
  /** The order number in its own system ("233", CleanCloud "577"). */
  orderNumber?: string;
  businessLine?: BusinessLine | null;
  processor?: PaymentProcessor;
  building?: BuildingKey | null;
  address?: string | null;
  serviceClass?: LaundryFarmServiceClass | "native";
  /** Short human description of what was ordered, when the source records one. */
  summary?: string | null;
  /** When the order was placed (event time), when known. */
  placedAt?: Date | null;
  /** When Goldline first recorded this row (ingestion time) — for imported sources only. */
  ingestedAt?: Date | null;
};

export type UnverifiedPaidOrder = { eventKey: string; businessDate: string; cents: number };

export type LedgerCompleteness = "complete" | "partial" | "unavailable";

/** A second source row proved to be the same CleanCloud order. Not counted in `events`. */
export type ProvenDuplicateExclusion = {
  keptEventKey: string;
  excludedEventKey: string;
  cents: number;
  reason: "cleancloud_sales_and_revenue_report";
};

export type UndatedEconomicAdjustment = {
  eventKey: string;
  cents: number;
  source: "cleancloud";
  reason: "payment_date_unknown";
};

export type UnverifiedPaymentAuthority = { eventKey: string; businessDate: string; source: LedgerSource; cents: number; reason: "missing_or_invalid_receipt" | "authority_unavailable" | "captured_amount_unknown" };

export type PaidOrderLedger = {
  unverifiedPaymentAuthority?: UnverifiedPaymentAuthority[];
  reconciliationEvidence?: SalesReconciliationEvidence;
  undatedAdjustments?: UndatedEconomicAdjustment[];
  startUtc: Date;
  endExclusiveUtc: Date;
  timeZone: string;
  events: PaidOrderEvent[];
  unverifiedNative: UnverifiedPaidOrder[];
  /** Proven CleanCloud report twins already removed from `events`. */
  provenDuplicateExclusions: ProvenDuplicateExclusion[];
  loadedSources: LedgerSource[];
  failedSources: LedgerSource[];
  completeness: LedgerCompleteness;
};

export class AnalyticsUnavailableError extends Error {
  constructor(message = "Business data is unavailable") {
    super(message);
    this.name = "AnalyticsUnavailableError";
  }
}

export type NativeOrderRow = {
  id: number;
  paid: boolean | number | null;
  paidAt: Date | null;
  total: string | number | null;
  stripePaymentIntentId: string | null;
  serviceType: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  bldgUserId: number | null;
  address?: string | null;
  unit?: string | null;
  buildingSlug?: string | null;
  createdAt?: Date | null;
};

export type CleanCloudOrderRow = {
  importBatchId?: number | null;
  discountCents?: number | null;
  creditCents?: number | null;
  subtotalCents?: number | null;
  cleancloudOrderId: string;
  cleancloudCustomerId: string | null;
  sourceReportType: "orders_sales" | "orders_revenue";
  paymentDateUtc: Date | null;
  paidDateUtc: Date | null;
  paid: boolean | number | null;
  totalCents: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  address?: string | null;
  buildingSlug?: string | null;
  paymentType?: string | null;
  cardPaymentType?: string | null;
  summaryText?: string | null;
  placedAtUtc?: Date | null;
  createdAt?: Date | null;
  /** The tenant's GUMBALL-paired CleanCloud store label, when paired. */
  storeLabel?: string | null;
};

export type LedgerWindow = { tenantId: string; startUtc: Date; endExclusiveUtc: Date };

export type LedgerLoaders = {
  paymentAuthority?: typeof readPaymentAuthorityReceipts;
  cleancloudAuthority?: typeof readCleanCloudPaidObservationReceipts;
  reconciliation?: (tenantId: string) => Promise<SalesReconciliationEvidence>;
  laundry_butler: (window: LedgerWindow) => Promise<NativeOrderRow[]>;
  cleancloud: (window: LedgerWindow) => Promise<CleanCloudOrderRow[]>;
};

function inWindow(value: Date | null, window: { startUtc: Date; endExclusiveUtc: Date }): value is Date {
  return Boolean(value && value >= window.startUtc && value < window.endExclusiveUtc);
}

function businessDateOf(value: Date, timeZone: string): string {
  return formatInTimeZone(value, timeZone, "yyyy-MM-dd");
}

function serviceLabel(serviceType: string | null): string | null {
  if (serviceType === "wash_fold") return "wash and fold";
  if (serviceType === "dry_cleaning") return "dry cleaning";
  return null;
}

/** CleanCloud's order summary as something that reads aloud: items, then pounds, no discount lines. */
export function cleanCloudSummaryText(summaryText: string | null | undefined): string | null {
  const lines = String(summaryText ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .split(/\n+/)
    .map(line => line.trim())
    .filter(line => line && !/^(discount|credit)\b/i.test(line));
  const weights = lines.filter(line => /^\d+(?:\.\d+)?\s*lbs?$/i.test(line)).map(line => Number.parseFloat(line));
  const items = lines
    .filter(line => !/^\d+(?:\.\d+)?\s*lbs?$/i.test(line))
    .map(line => {
      const cleaned = line.replace(/\(\d+\)\s*/g, "").replace(/\(D\)\s*/gi, "").replace(/\s+/g, " ").trim();
      // Pound-priced laundry repeats its weight as the quantity; the weight is said once below.
      return weights.length && /fluff|wash|fold/i.test(cleaned) ? cleaned.replace(/\s+x\s+[\d.]+$/i, "") : cleaned;
    })
    .filter(Boolean);
  if (!items.length) return null;
  const pounds = weights.reduce((sum, value) => sum + value, 0);
  const weight = pounds > 0 ? `, ${Number.isInteger(pounds) ? pounds : pounds.toFixed(1)} lb` : "";
  return `${items.join("; ")}${weight}`.slice(0, 240);
}

export function mapNativeOrders(
  rows: readonly NativeOrderRow[],
  window: { startUtc: Date; endExclusiveUtc: Date },
  timeZone: string
): { events: PaidOrderEvent[]; unverified: UnverifiedPaidOrder[] } {
  const events: PaidOrderEvent[] = [];
  const unverified: UnverifiedPaidOrder[] = [];
  for (const row of rows) {
    if (!row.paid || !inWindow(row.paidAt, window)) continue;
    const cents = Math.round(Number(row.total ?? 0) * 100);
    const businessDate = businessDateOf(row.paidAt, timeZone);
    const eventKey = `order:${row.id}`;
    if (!row.stripePaymentIntentId?.trim()) {
      unverified.push({ eventKey, businessDate, cents });
      continue;
    }
    const serviceType =
      row.serviceType === "wash_fold" || row.serviceType === "dry_cleaning" ? row.serviceType : null;
    events.push({
      source: "laundry_butler",
      paymentEvidence: { subjectType: "order", subjectId: String(row.id), sourceType: "stripe_payment_intent", sourceRef: row.stripePaymentIntentId.trim() },
      eventKey,
      occurredAt: row.paidAt,
      businessDate,
      cents,
      serviceType,
      customerName: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null,
      identity: { phone: row.phone, email: row.email, bldgUserId: row.bldgUserId },
      orderNumber: String(row.id),
      businessLine: "laundry_butler",
      processor: "stripe",
      building: buildingFor({ buildingSlug: row.buildingSlug, address: row.address }),
      address: [row.address, row.unit ? `Unit ${row.unit}` : null].filter(Boolean).join(", ") || null,
      serviceClass: "native",
      summary: serviceLabel(serviceType),
      placedAt: row.createdAt ?? null,
      ingestedAt: null,
    });
  }
  return { events, unverified };
}

export function partitionCleanCloudOrders(
  rows: readonly CleanCloudOrderRow[],
  window: { startUtc: Date; endExclusiveUtc: Date },
  timeZone: string
): { events: PaidOrderEvent[]; provenDuplicateExclusions: ProvenDuplicateExclusion[] } {
  const grouped = new Map<string, CleanCloudOrderRow[]>();
  for (const row of rows) {
    if (!row.paid) continue;
    const list = grouped.get(row.cleancloudOrderId) ?? [];
    list.push(row);
    grouped.set(row.cleancloudOrderId, list);
  }
  const events: PaidOrderEvent[] = [];
  const provenDuplicateExclusions: ProvenDuplicateExclusion[] = [];
  let excludedSeq = 0;
  for (const [cleancloudOrderId, group] of Array.from(grouped.entries())) {
    let preferred = group[0]!;
    for (const row of group.slice(1)) {
      if (preferred.sourceReportType === "orders_revenue" && row.sourceReportType === "orders_sales") {
        preferred = row;
      }
    }
    const occurredAt = preferred.sourceReportType === "orders_sales" ? preferred.paymentDateUtc : preferred.paidDateUtc;
    if (!inWindow(occurredAt, window)) continue;
    const keptEventKey = `cleancloud:${cleancloudOrderId}`;
    const serviceClass = classifyCleanCloudService({ summaryText: preferred.summaryText ?? null });
    events.push({
      source: "cleancloud",
      cleancloudEvidence: { subjectType: "cleancloud_order", subjectId: cleancloudOrderId, sourceType: "cleancloud_paid_order", sourceRef: preferred.importBatchId == null ? null : `cleancloud-import:${preferred.importBatchId}:${cleancloudOrderId}` },
      eventKey: keptEventKey,
      occurredAt,
      businessDate: businessDateOf(occurredAt, timeZone),
      cents: Math.round(Number(preferred.totalCents ?? 0)),
      discountCents: preferred.discountCents ?? null,
      creditCents: preferred.creditCents ?? null,
      subtotalCents: preferred.subtotalCents ?? null,
      serviceType: serviceTypeFromCleanCloudClass(serviceClass),
      customerName: preferred.customerName?.trim() || null,
      identity: {
        phone: preferred.customerPhone,
        email: preferred.customerEmail,
        cleancloudCustomerId: preferred.cleancloudCustomerId,
      },
      orderNumber: cleancloudOrderId,
      businessLine: cleanCloudBusinessLine(preferred.storeLabel),
      processor: cleanCloudProcessor(preferred.paymentType, preferred.cardPaymentType),
      building: buildingFor({ buildingSlug: preferred.buildingSlug, address: preferred.address }),
      address: preferred.address?.trim() || null,
      serviceClass,
      summary: cleanCloudSummaryText(preferred.summaryText),
      placedAt: preferred.placedAtUtc ?? null,
      ingestedAt: preferred.createdAt ?? null,
    });
    for (const row of group) {
      if (row === preferred) continue;
      provenDuplicateExclusions.push({
        keptEventKey,
        excludedEventKey: `cleancloud:${cleancloudOrderId}:excluded:${row.sourceReportType}:${excludedSeq++}`,
        cents: Math.round(Number(row.totalCents ?? 0)),
        reason: "cleancloud_sales_and_revenue_report",
      });
    }
  }
  return { events, provenDuplicateExclusions };
}

export function mapCleanCloudOrders(
  rows: readonly CleanCloudOrderRow[],
  window: { startUtc: Date; endExclusiveUtc: Date },
  timeZone: string
): PaidOrderEvent[] {
  return partitionCleanCloudOrders(rows, window, timeZone).events;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new AnalyticsUnavailableError("Database not available");
  return db;
}

const ID_CHUNK = 500;

async function pairedStoreLabel(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, tenantId: string) {
  try {
    const [binding] = await db
      .select({ storeLabel: browserSyncBindings.storeLabel })
      .from(browserSyncBindings)
      .where(eq(browserSyncBindings.tenantId, tenantId))
      .limit(1);
    return binding?.storeLabel ?? null;
  } catch (error) {
    // Lineage is attribution, not revenue: a missing binding table leaves
    // CleanCloud orders unattributed instead of failing the ledger.
    console.warn("[Analytics] GUMBALL store binding unavailable", error instanceof Error ? error.message : error);
    return null;
  }
}

export const databaseLedgerLoaders: LedgerLoaders = {
  reconciliation: loadSalesReconciliationEvidence,
  async laundry_butler(window) {
    const candidates = await readNativePaidCandidates(window.tenantId);
    const facts = await readNativePaymentFacts(candidates);
    return candidates.map(row => ({ ...row, paidAt: facts.get(row.id)?.occurredAt
      ? new Date(facts.get(row.id)!.occurredAt!) : row.paidAt }));
  },
  async cleancloud(window) {
    const db = await requireDb();
    const columns = {
      importBatchId: cleancloudPaidOrders.importBatchId,
      cleancloudOrderId: cleancloudPaidOrders.cleancloudOrderId,
      cleancloudCustomerId: cleancloudPaidOrders.cleancloudCustomerId,
      sourceReportType: cleancloudPaidOrders.sourceReportType,
      paymentDateUtc: cleancloudPaidOrders.paymentDateUtc,
      paidDateUtc: cleancloudPaidOrders.paidDateUtc,
      paid: cleancloudPaidOrders.paid,
      totalCents: cleancloudPaidOrders.totalCents,
      discountCents: cleancloudPaidOrders.discountCents,
      creditCents: cleancloudPaidOrders.creditCents,
      subtotalCents: cleancloudPaidOrders.subtotalCents,
      customerName: cleancloudPaidOrders.customerName,
      customerPhone: cleancloudPaidOrders.customerPhone,
      customerEmail: cleancloudPaidOrders.customerEmail,
      address: cleancloudPaidOrders.address,
      buildingSlug: cleancloudPaidOrders.buildingSlug,
      paymentType: cleancloudPaidOrders.paymentType,
      cardPaymentType: cleancloudPaidOrders.cardPaymentType,
      summaryText: cleancloudPaidOrders.summaryText,
      placedAtUtc: cleancloudPaidOrders.placedAtUtc,
      createdAt: cleancloudPaidOrders.createdAt,
    };
    const rows: CleanCloudOrderRow[] = await db
      .select(columns)
      .from(cleancloudPaidOrders)
      .where(
        and(
          eq(cleancloudPaidOrders.tenantId, window.tenantId),
          eq(cleancloudPaidOrders.paid, true),
          or(
            and(
              isNull(cleancloudPaidOrders.paymentDateUtc),
              isNull(cleancloudPaidOrders.paidDateUtc),
              lt(cleancloudPaidOrders.totalCents, 0)
            ),
            and(
              eq(cleancloudPaidOrders.sourceReportType, "orders_sales"),
              gte(cleancloudPaidOrders.paymentDateUtc, window.startUtc),
              lt(cleancloudPaidOrders.paymentDateUtc, window.endExclusiveUtc)
            ),
            and(
              eq(cleancloudPaidOrders.sourceReportType, "orders_revenue"),
              gte(cleancloudPaidOrders.paidDateUtc, window.startUtc),
              lt(cleancloudPaidOrders.paidDateUtc, window.endExclusiveUtc)
            )
          )
        )
      );
    // A Revenue-report row in the window may have a Sales-report twin dated
    // outside it; the Sales row wins, so load those twins before deduping.
    const withSales = new Set(rows.filter(r => r.sourceReportType === "orders_sales").map(r => r.cleancloudOrderId));
    const revenueOnly = Array.from(
      new Set(rows.filter(r => r.sourceReportType === "orders_revenue" && !withSales.has(r.cleancloudOrderId)).map(r => r.cleancloudOrderId))
    );
    for (let i = 0; i < revenueOnly.length; i += ID_CHUNK) {
      const twins = await db
        .select(columns)
        .from(cleancloudPaidOrders)
        .where(
          and(
            eq(cleancloudPaidOrders.tenantId, window.tenantId),
            eq(cleancloudPaidOrders.paid, true),
            eq(cleancloudPaidOrders.sourceReportType, "orders_sales"),
            inArray(cleancloudPaidOrders.cleancloudOrderId, revenueOnly.slice(i, i + ID_CHUNK))
          )
        );
      rows.push(...twins);
    }
    const storeLabel = rows.length ? await pairedStoreLabel(db, window.tenantId) : null;
    return rows.map(row => ({ ...row, storeLabel }));
  },
};

export async function loadPaidOrderLedger(
  input: { tenantId: string; startUtc: Date; endExclusiveUtc: Date; timeZone: string },
  loaders: LedgerLoaders = databaseLedgerLoaders
): Promise<PaidOrderLedger> {
  const window: LedgerWindow = {
    tenantId: input.tenantId,
    startUtc: input.startUtc,
    endExclusiveUtc: input.endExclusiveUtc,
  };
  const [native, cleancloud, reconciliation] = await Promise.allSettled([
    loaders.laundry_butler(window),
    loaders.cleancloud(window),
    loaders.reconciliation
      ? loaders.reconciliation(input.tenantId)
      : Promise.resolve({
          decisions: [],
          attributions: [],
        } as SalesReconciliationEvidence),
  ]);
  const loadedSources: LedgerSource[] = [];
  const failedSources: LedgerSource[] = [];
  const events: PaidOrderEvent[] = [];
  let unverifiedNative: UnverifiedPaidOrder[] = [];
  const provenDuplicateExclusions: ProvenDuplicateExclusion[] = [];

  if (native.status === "fulfilled") {
    const mapped = mapNativeOrders(native.value, window, input.timeZone);
    events.push(...mapped.events);
    unverifiedNative = mapped.unverified;
    loadedSources.push("laundry_butler");
  } else {
    console.warn("[Analytics] native paid-order load failed", native.reason);
    failedSources.push("laundry_butler");
  }
  if (cleancloud.status === "fulfilled") {
    const mapped = partitionCleanCloudOrders(cleancloud.value, window, input.timeZone);
    events.push(...mapped.events);
    provenDuplicateExclusions.push(...mapped.provenDuplicateExclusions);
    loadedSources.push("cleancloud");
  } else {
    console.warn("[Analytics] CleanCloud paid-order load failed", cleancloud.reason);
    failedSources.push("cleancloud");
  }

  const unverifiedPaymentAuthority: UnverifiedPaymentAuthority[] = [];
  let authorityUnavailable = false;
  if (events.length) {
    const candidates = [...events];
    try {
      const nativeExpectations = candidates
        .filter(event => event.source === "laundry_butler")
        .map(event => ({
          tenantId: input.tenantId,
          ...event.paymentEvidence!,
        }));
      const cleanCloudExpectations = candidates
        .filter(event => event.source === "cleancloud")
        .map(event => ({
          tenantId: input.tenantId,
          ...event.cleancloudEvidence!,
        }));
      const [nativeReceipts, cleanCloudReceipts] = await Promise.all([
        (loaders.paymentAuthority ?? readPaymentAuthorityReceipts)({
          tenantId: input.tenantId,
          expectations: nativeExpectations,
        }),
        (loaders.cleancloudAuthority ?? readCleanCloudPaidObservationReceipts)({
          tenantId: input.tenantId,
          expectations: cleanCloudExpectations,
        }),
      ]);
      const nativeBySubject = new Map<string, AuthorityReceipt[]>();
      for (const receipt of nativeReceipts) {
        const key = `${receipt.subjectType}:${receipt.subjectId}`;
        nativeBySubject.set(key, [
          ...(nativeBySubject.get(key) ?? []),
          receipt,
        ]);
      }
      const cleanCloudBySubject = new Map<string, AuthorityReceipt[]>();
      for (const receipt of cleanCloudReceipts) {
        const key = `${receipt.subjectType}:${receipt.subjectId}`;
        cleanCloudBySubject.set(key, [
          ...(cleanCloudBySubject.get(key) ?? []),
          receipt,
        ]);
      }

      events.length = 0;
      for (const event of candidates) {
        let receipt: AuthorityReceipt | undefined;
        if (event.source === "laundry_butler") {
          const expected = {
            tenantId: input.tenantId,
            ...event.paymentEvidence!,
          };
          receipt = (
            nativeBySubject.get(
              `${expected.subjectType}:${expected.subjectId}`
            ) ?? []
          ).find(item => paymentAuthorityReceiptMatches(item, expected));
        } else {
          const expected = {
            tenantId: input.tenantId,
            ...event.cleancloudEvidence!,
          };
          receipt = (
            cleanCloudBySubject.get(
              `${expected.subjectType}:${expected.subjectId}`
            ) ?? []
          ).find(item =>
            cleanCloudPaidObservationReceiptMatches(item, expected)
          );
        }

        if (receipt) {
          const capture = event.source === "laundry_butler" ? nativeCapturedAmountCents(receipt) : event.cents;
          if (capture === null) {
            unverifiedPaymentAuthority.push({ eventKey: event.eventKey, businessDate: event.businessDate, source: event.source, cents: 0, reason: "captured_amount_unknown" });
            if (!failedSources.includes(event.source)) failedSources.push(event.source);
            continue;
          }
          const occurredAt = event.source === "laundry_butler" ? (receipt.occurredAt ? new Date(receipt.occurredAt) : null) : event.occurredAt;
          if (!occurredAt || !inWindow(occurredAt, window)) continue;
          events.push({ ...event, occurredAt, businessDate: businessDateOf(occurredAt, input.timeZone), cents: capture, authorityReceiptId: receipt.id });
        } else {
          unverifiedPaymentAuthority.push({
            eventKey: event.eventKey,
            businessDate: event.businessDate,
            source: event.source,
            cents: event.cents,
            reason: "missing_or_invalid_receipt",
          });
          if (!failedSources.includes(event.source))
            failedSources.push(event.source);
        }
      }
    } catch {
      authorityUnavailable = true;
      events.length = 0;
      for (const event of candidates)
        unverifiedPaymentAuthority.push({
          eventKey: event.eventKey,
          businessDate: event.businessDate,
          source: event.source,
          cents: event.cents,
          reason: "authority_unavailable",
        });
      for (const source of loadedSources)
        if (!failedSources.includes(source)) failedSources.push(source);
    }
  }

  if (reconciliation.status === "fulfilled") {
    const attribution = new Map(
      reconciliation.value.attributions
        .filter(row => row.evidenceReference.trim())
        .map(row => [row.eventKey, row.serviceLine])
    );
    for (const event of events) {
      event.company =
        event.source === "laundry_butler" ||
        event.businessLine === "laundry_farm"
          ? "laundry_farm"
          : null;
      event.serviceLine =
        attribution.get(event.eventKey) ??
        (event.source === "laundry_butler" ? "laundry_butler" : "unresolved");
    }
  } else {
    // An unread durable reconciliation store cannot license exact revenue.
    for (const source of loadedSources)
      if (!failedSources.includes(source)) failedSources.push(source);
  }
  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.eventKey.localeCompare(b.eventKey));
  return {
    startUtc: input.startUtc,
    endExclusiveUtc: input.endExclusiveUtc,
    timeZone: input.timeZone,
    events,
    reconciliationEvidence:
      reconciliation.status === "fulfilled" ? reconciliation.value : undefined,
    undatedAdjustments:
      cleancloud.status === "fulfilled"
        ? Array.from(
            new Map(
              cleancloud.value
                .filter(
                  row =>
                    row.paid &&
                    (row.totalCents ?? 0) < 0 &&
                    !row.paymentDateUtc &&
                    !row.paidDateUtc
                )
                .map(row => [
                  row.cleancloudOrderId,
                  {
                    eventKey: `cleancloud:${row.cleancloudOrderId}`,
                    cents: row.totalCents!,
                    source: "cleancloud" as const,
                    reason: "payment_date_unknown" as const,
                  },
                ])
            ).values()
          )
        : [],
    unverifiedPaymentAuthority,
    unverifiedNative,
    provenDuplicateExclusions,
    loadedSources,
    failedSources,
    completeness: authorityUnavailable ? "unavailable" : failedSources.length === 0 ? "complete" : loadedSources.length ? "partial" : "unavailable",
  };
}

export type OverlapProbe = {
  status: "none_detected" | "suspected";
  suspectedPairs: number;
  suspectedCents: number;
};

export type SuspectedCrossSourcePair = {
  native: PaidOrderEvent;
  cleancloud: PaidOrderEvent;
};

/**
 * Native/CleanCloud pairs that share a phone or email, a business day, and an
 * amount within one cent. The systems share no order key, so this is a
 * suspicion, not proof. The ledger keeps both events.
 */
export function findSuspectedCrossSourcePairs(events: readonly PaidOrderEvent[]): SuspectedCrossSourcePair[] {
  const contactKeys = (event: PaidOrderEvent) =>
    identityKeysFor({ phone: event.identity.phone, email: event.identity.email });
  const cleancloudByDayKey = new Map<string, PaidOrderEvent[]>();
  for (const event of events) {
    if (event.source !== "cleancloud") continue;
    for (const key of contactKeys(event)) {
      const bucket = `${event.businessDate}|${key}`;
      cleancloudByDayKey.set(bucket, [...(cleancloudByDayKey.get(bucket) ?? []), event]);
    }
  }
  const used = new Set<string>();
  const pairs: SuspectedCrossSourcePair[] = [];
  for (const event of events) {
    if (event.source !== "laundry_butler") continue;
    for (const key of contactKeys(event)) {
      const match = (cleancloudByDayKey.get(`${event.businessDate}|${key}`) ?? []).find(
        candidate => !used.has(candidate.eventKey) && Math.abs(candidate.cents - event.cents) <= 1
      );
      if (match) {
        used.add(match.eventKey);
        pairs.push({ native: event, cleancloud: match });
        break;
      }
    }
  }
  return pairs;
}

/** Flags suspected cross-source pairs. Nothing is removed from the ledger. */
export function detectCrossSourceOverlap(events: readonly PaidOrderEvent[]): OverlapProbe {
  const pairs = findSuspectedCrossSourcePairs(events);
  const suspectedCents = pairs.reduce((sum, pair) => sum + pair.cleancloud.cents, 0);
  return {
    status: pairs.length ? "suspected" : "none_detected",
    suspectedPairs: pairs.length,
    suspectedCents,
  };
}
