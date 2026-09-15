import { and, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { cleancloudPaidOrders, orders } from "../../drizzle/schema";
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
 * - Native orders count only with Stripe payment evidence. Migration 0011
 *   backfilled `paidAt` from `updatedAt` for older paid rows, and manual
 *   "mark paid" writes carry no processor record, so those are held out and
 *   reported as unverified rather than silently added or dropped.
 * - CleanCloud orders can appear in both the Orders (Sales) and Orders
 *   (Revenue) exports; each CleanCloud order counts once, preferring Sales.
 * - Native and CleanCloud orders share no order key, so cross-source overlap
 *   cannot be removed. It is probed (same customer, business day and amount)
 *   and disclosed instead.
 *
 * Every event also carries its lineage (business line, processor, building,
 * service class, event time vs. ingestion time) — see businessLineage.ts.
 */

export type { BusinessLine, LedgerSource, PaymentProcessor } from "./businessLineage";
export const LEDGER_SOURCES: readonly LedgerSource[] = ["laundry_butler", "cleancloud"];

export type ServiceType = "wash_fold" | "dry_cleaning";

export type PaidOrderEvent = {
  source: LedgerSource;
  eventKey: string;
  occurredAt: Date;
  businessDate: string;
  cents: number;
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

export type PaidOrderLedger = {
  startUtc: Date;
  endExclusiveUtc: Date;
  timeZone: string;
  events: PaidOrderEvent[];
  unverifiedNative: UnverifiedPaidOrder[];
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

export function mapCleanCloudOrders(
  rows: readonly CleanCloudOrderRow[],
  window: { startUtc: Date; endExclusiveUtc: Date },
  timeZone: string
): PaidOrderEvent[] {
  const preferred = new Map<string, CleanCloudOrderRow>();
  for (const row of rows) {
    if (!row.paid) continue;
    const current = preferred.get(row.cleancloudOrderId);
    if (!current || (current.sourceReportType === "orders_revenue" && row.sourceReportType === "orders_sales")) {
      preferred.set(row.cleancloudOrderId, row);
    }
  }
  const events: PaidOrderEvent[] = [];
  for (const row of Array.from(preferred.values())) {
    const occurredAt = row.sourceReportType === "orders_sales" ? row.paymentDateUtc : row.paidDateUtc;
    if (!inWindow(occurredAt, window)) continue;
    const serviceClass = classifyCleanCloudService({ summaryText: row.summaryText ?? null });
    events.push({
      source: "cleancloud",
      eventKey: `cleancloud:${row.cleancloudOrderId}`,
      occurredAt,
      businessDate: businessDateOf(occurredAt, timeZone),
      cents: Math.round(Number(row.totalCents ?? 0)),
      serviceType: serviceTypeFromCleanCloudClass(serviceClass),
      customerName: row.customerName?.trim() || null,
      identity: {
        phone: row.customerPhone,
        email: row.customerEmail,
        cleancloudCustomerId: row.cleancloudCustomerId,
      },
      orderNumber: row.cleancloudOrderId,
      businessLine: cleanCloudBusinessLine(row.storeLabel),
      processor: cleanCloudProcessor(row.paymentType, row.cardPaymentType),
      building: buildingFor({ buildingSlug: row.buildingSlug, address: row.address }),
      address: row.address?.trim() || null,
      serviceClass,
      summary: cleanCloudSummaryText(row.summaryText),
      placedAt: row.placedAtUtc ?? null,
      ingestedAt: row.createdAt ?? null,
    });
  }
  return events;
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
  async laundry_butler(window) {
    const db = await requireDb();
    return db
      .select({
        id: orders.id,
        paid: orders.paid,
        paidAt: orders.paidAt,
        total: orders.total,
        stripePaymentIntentId: orders.stripePaymentIntentId,
        serviceType: orders.serviceType,
        firstName: orders.firstName,
        lastName: orders.lastName,
        phone: orders.phone,
        email: orders.email,
        bldgUserId: orders.bldgUserId,
        address: orders.address,
        unit: orders.unit,
        buildingSlug: orders.buildingSlug,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(
        and(
          sql`COALESCE(${orders.tenantId}, 'default') = ${window.tenantId}`,
          eq(orders.paid, true),
          isNotNull(orders.paidAt),
          gte(orders.paidAt, window.startUtc),
          lt(orders.paidAt, window.endExclusiveUtc)
        )
      );
  },
  async cleancloud(window) {
    const db = await requireDb();
    const columns = {
      cleancloudOrderId: cleancloudPaidOrders.cleancloudOrderId,
      cleancloudCustomerId: cleancloudPaidOrders.cleancloudCustomerId,
      sourceReportType: cleancloudPaidOrders.sourceReportType,
      paymentDateUtc: cleancloudPaidOrders.paymentDateUtc,
      paidDateUtc: cleancloudPaidOrders.paidDateUtc,
      paid: cleancloudPaidOrders.paid,
      totalCents: cleancloudPaidOrders.totalCents,
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
  const [native, cleancloud] = await Promise.allSettled([
    loaders.laundry_butler(window),
    loaders.cleancloud(window),
  ]);
  const loadedSources: LedgerSource[] = [];
  const failedSources: LedgerSource[] = [];
  const events: PaidOrderEvent[] = [];
  let unverifiedNative: UnverifiedPaidOrder[] = [];

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
    events.push(...mapCleanCloudOrders(cleancloud.value, window, input.timeZone));
    loadedSources.push("cleancloud");
  } else {
    console.warn("[Analytics] CleanCloud paid-order load failed", cleancloud.reason);
    failedSources.push("cleancloud");
  }

  events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.eventKey.localeCompare(b.eventKey));
  return {
    startUtc: input.startUtc,
    endExclusiveUtc: input.endExclusiveUtc,
    timeZone: input.timeZone,
    events,
    unverifiedNative,
    loadedSources,
    failedSources,
    completeness: failedSources.length === 0 ? "complete" : loadedSources.length ? "partial" : "unavailable",
  };
}

export type OverlapProbe = {
  status: "none_detected" | "suspected";
  suspectedPairs: number;
  suspectedCents: number;
};

/**
 * Flags native/CleanCloud order pairs that look like the same real order:
 * same customer phone or email, same business day, amounts within a cent.
 * Nothing is removed — this only decides whether a combined total needs a
 * caveat.
 */
export function detectCrossSourceOverlap(events: readonly PaidOrderEvent[]): OverlapProbe {
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
  let suspectedPairs = 0;
  let suspectedCents = 0;
  for (const event of events) {
    if (event.source !== "laundry_butler") continue;
    for (const key of contactKeys(event)) {
      const match = (cleancloudByDayKey.get(`${event.businessDate}|${key}`) ?? []).find(
        candidate => !used.has(candidate.eventKey) && Math.abs(candidate.cents - event.cents) <= 1
      );
      if (match) {
        used.add(match.eventKey);
        suspectedPairs += 1;
        suspectedCents += match.cents;
        break;
      }
    }
  }
  return { status: suspectedPairs ? "suspected" : "none_detected", suspectedPairs, suspectedCents };
}
