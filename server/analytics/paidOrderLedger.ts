import { and, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { cleancloudPaidOrders, orders } from "../../drizzle/schema";
import { getDb } from "../db";
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
 */

export type LedgerSource = "laundry_butler" | "cleancloud";
export const LEDGER_SOURCES: readonly LedgerSource[] = ["laundry_butler", "cleancloud"];

export type ServiceType = "wash_fold" | "dry_cleaning";

export type PaidOrderEvent = {
  source: LedgerSource;
  eventKey: string;
  occurredAt: Date;
  businessDate: string;
  cents: number;
  /** Only native orders record a service type. */
  serviceType: ServiceType | null;
  customerName: string | null;
  identity: IdentityEvidence;
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
    events.push({
      source: "laundry_butler",
      eventKey,
      occurredAt: row.paidAt,
      businessDate,
      cents,
      serviceType: row.serviceType === "wash_fold" || row.serviceType === "dry_cleaning" ? row.serviceType : null,
      customerName: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null,
      identity: { phone: row.phone, email: row.email, bldgUserId: row.bldgUserId },
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
    events.push({
      source: "cleancloud",
      eventKey: `cleancloud:${row.cleancloudOrderId}`,
      occurredAt,
      businessDate: businessDateOf(occurredAt, timeZone),
      cents: Math.round(Number(row.totalCents ?? 0)),
      serviceType: null,
      customerName: row.customerName?.trim() || null,
      identity: {
        phone: row.customerPhone,
        email: row.customerEmail,
        cleancloudCustomerId: row.cleancloudCustomerId,
      },
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
    return rows;
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
