import { and, eq, gte, lte, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { cleancloudPaidOrders, orders } from "../../drizzle/schema";
import { getDb } from "../db";
const BUSINESS_TIME_ZONE = "America/Los_Angeles";

export const ACTIVE_CUSTOMER_DEFINITION =
  "Distinct customer with at least one paid order whose order date falls within the current business-local calendar day and the preceding 29 calendar days.";

export type ActiveCustomerSource = "laundry_butler" | "cleancloud";
export type ActiveCustomerCompleteness = "complete" | "partial" | "unavailable";
export type ActiveCustomerMetric = {
  value: number | null;
  definition: string;
  windowStart: string;
  windowEnd: string;
  sources: ActiveCustomerSource[];
  unmatchedCount: number;
  completeness: ActiveCustomerCompleteness;
  computedAt: string;
};

export type PaidCustomerObservation = {
  source: ActiveCustomerSource;
  phone: string | null;
  email: string | null;
};

export type ActiveCustomerOrderCandidate = PaidCustomerObservation & {
  paid: boolean;
  orderDate: Date | null;
};

export function qualifiesActiveCustomerOrder(
  candidate: ActiveCustomerOrderCandidate,
  windowStart: Date,
  windowEnd: Date
): boolean {
  return Boolean(candidate.paid && candidate.orderDate && candidate.orderDate >= windowStart && candidate.orderDate <= windowEnd);
}

export type ActiveCustomerLoaders = Record<
  ActiveCustomerSource,
  (input: { tenantId: string; windowStart: Date; windowEnd: Date }) => Promise<PaidCustomerObservation[]>
>;

function normalizePhone(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function normalizeEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized || null;
}

export function countDistinctActiveCustomers(rows: PaidCustomerObservation[]): {
  value: number;
  unmatchedCount: number;
} {
  let nextIdentity = 0;
  const phones = new Map<string, number>();
  const emails = new Map<string, number>();
  let unmatchedCount = 0;
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    const email = normalizeEmail(row.email);
    let identity = phone ? phones.get(phone) : undefined;
    if (identity === undefined && (!phone || !phones.has(phone)) && email) identity = emails.get(email);
    if (identity === undefined) identity = nextIdentity++;
    if (!phone && !email) unmatchedCount += 1;
    if (phone) phones.set(phone, identity);
    if (email && !emails.has(email)) emails.set(email, identity);
  }
  return { value: nextIdentity, unmatchedCount };
}

export function activeCustomerWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now).map(part => [part.type, part.value]));
  const localDate = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - 29, 12));
  const startDate = localDate.toISOString().slice(0, 10);
  return { start: fromZonedTime(`${startDate}T00:00:00`, timeZone), end: now };
}

const databaseLoaders: ActiveCustomerLoaders = {
  async laundry_butler(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db.select({ phone: orders.phone, email: orders.email, paid: orders.paid, orderDate: orders.createdAt }).from(orders).where(and(
      sql`COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}`,
      gte(orders.createdAt, input.windowStart),
      lte(orders.createdAt, input.windowEnd)
    ));
    return rows.map(row => ({ source: "laundry_butler" as const, ...row })).filter(row => qualifiesActiveCustomerOrder(row, input.windowStart, input.windowEnd));
  },
  async cleancloud(input) {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db.select({ phone: cleancloudPaidOrders.customerPhone, email: cleancloudPaidOrders.customerEmail, paid: cleancloudPaidOrders.paid, orderDate: cleancloudPaidOrders.placedAtUtc }).from(cleancloudPaidOrders).where(and(
      eq(cleancloudPaidOrders.tenantId, input.tenantId),
      gte(cleancloudPaidOrders.placedAtUtc, input.windowStart),
      lte(cleancloudPaidOrders.placedAtUtc, input.windowEnd)
    ));
    return rows.map(row => ({ source: "cleancloud" as const, ...row })).filter(row => qualifiesActiveCustomerOrder(row, input.windowStart, input.windowEnd));
  },
};

export async function getActiveCustomerMetric(input: {
  tenantId: string;
  now?: Date;
  timeZone?: string;
}, loaders: ActiveCustomerLoaders = databaseLoaders): Promise<ActiveCustomerMetric> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? BUSINESS_TIME_ZONE;
  const window = activeCustomerWindow(now, timeZone);
  const results = await Promise.allSettled((Object.keys(loaders) as ActiveCustomerSource[]).map(async source => ({
    source,
    rows: await loaders[source]({ tenantId: input.tenantId, windowStart: window.start, windowEnd: window.end }),
  })));
  const available = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const sources = available.map(result => result.source);
  const completeness: ActiveCustomerCompleteness = sources.length === 2 ? "complete" : sources.length ? "partial" : "unavailable";
  const counted = countDistinctActiveCustomers(available.flatMap(result => result.rows));
  return {
    value: completeness === "unavailable" ? null : counted.value,
    definition: ACTIVE_CUSTOMER_DEFINITION,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    sources,
    unmatchedCount: counted.unmatchedCount,
    completeness,
    computedAt: now.toISOString(),
  };
}
