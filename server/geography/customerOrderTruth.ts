import { eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { cleancloudPaidOrders, orders } from "../../drizzle/schema";
import { computeRecencyStatus } from "../../shared/customerStatus";
import {
  inferCustomerCadence,
  projectLatLngToLanternAtlas,
  type LanternState,
} from "../../shared/lanternCity";
import {
  groupCustomerRecords,
  unidentifiedCustomerKey,
  type CustomerIdentityInput,
} from "../customerAssets/customerIdentity";
import { getDb } from "../db";
import { queryOptionalMysqlTable } from "../mysqlErrors";

export type CustomerOrderSource = "laundry_butler" | "cleancloud";

export type NativeOrderLike = {
  id: number;
  status: string | null;
  createdAt: Date;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  unit: string | null;
  buildingSlug: string | null;
  bldgUserId: number | null;
  paid?: boolean | number | null;
  total?: string | number | null;
};

export type CleanCloudOrderLike = {
  cleancloudOrderId: string;
  cleancloudCustomerId?: string | null;
  sourceReportType: "orders_sales" | "orders_revenue";
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  address?: string | null;
  unit?: string | null;
  buildingSlug?: string | null;
  buildingResolutionStatus?:
    | "resolved"
    | "unresolved_needs_mapping"
    | "not_applicable"
    | null;
  placedAtUtc?: Date | null;
  paymentDateUtc?: Date | null;
  paidDateUtc?: Date | null;
  createdAt?: Date | null;
  paid?: boolean | number | null;
  totalCents?: number | null;
};

export type CustomerOrderTruthRecord = {
  source: CustomerOrderSource;
  sourceOrderId: string;
  id: number;
  createdAt: Date;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  address: string;
  unit: string | null;
  buildingSlug: string | null;
  bldgUserId: number | null;
  cleancloudCustomerId: string | null;
  buildingResolutionStatus:
    | "resolved"
    | "unresolved_needs_mapping"
    | "not_applicable"
    | null;
  allowNameComposite: boolean;
  paid: boolean;
  totalCents: number;
  cancelled: boolean;
};

export type GeographicLocationSnapshot = {
  sourceAddress?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  geocodeStatus?: string | null;
  canonicalAddress?: string | null;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function splitCustomerDisplayName(name: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { firstName: "", lastName: "" };
  const index = trimmed.lastIndexOf(" ");
  if (index <= 0) return { firstName: trimmed, lastName: "" };
  return {
    firstName: trimmed.slice(0, index).trim(),
    lastName: trimmed.slice(index + 1).trim(),
  };
}

export function preferCleanCloudOrders<T extends CleanCloudOrderLike>(
  rows: readonly T[]
): T[] {
  const preferred = new Map<string, T>();
  for (const row of rows) {
    const current = preferred.get(row.cleancloudOrderId);
    if (
      !current ||
      (current.sourceReportType === "orders_revenue" &&
        row.sourceReportType === "orders_sales")
    ) {
      preferred.set(row.cleancloudOrderId, row);
    }
  }
  return Array.from(preferred.values());
}

export function cleanCloudOrderOccurredAt(row: CleanCloudOrderLike): Date | null {
  return (
    asDate(row.placedAtUtc) ??
    asDate(row.paymentDateUtc) ??
    asDate(row.paidDateUtc) ??
    asDate(row.createdAt)
  );
}

function cleancloudSortId(orderId: string): number {
  const numeric = Number(orderId);
  if (Number.isSafeInteger(numeric) && numeric >= 0) {
    return 1_000_000_000 + (numeric % 1_000_000_000);
  }
  let hash = 0;
  for (const char of orderId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return 1_000_000_000 + (Math.abs(hash) % 1_000_000_000);
}

function dollarsToCents(total: string | number | null | undefined): number {
  const amount = parseFloat(String(total ?? "0"));
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function isPaidFlag(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

export function nativeOrderToTruth(
  row: NativeOrderLike,
  options?: { includeCancelled?: boolean }
): CustomerOrderTruthRecord | null {
  const cancelled = row.status === "cancelled";
  if (cancelled && !options?.includeCancelled) return null;
  const createdAt = asDate(row.createdAt);
  if (!createdAt) return null;
  return {
    source: "laundry_butler",
    sourceOrderId: String(row.id),
    id: row.id,
    createdAt,
    firstName: String(row.firstName ?? ""),
    lastName: String(row.lastName ?? ""),
    phone: String(row.phone ?? ""),
    email: row.email?.trim() ? row.email.trim() : null,
    address: String(row.address ?? ""),
    unit: row.unit?.trim() ? row.unit.trim() : null,
    buildingSlug: row.buildingSlug?.trim() ? row.buildingSlug.trim() : null,
    bldgUserId: row.bldgUserId ?? null,
    cleancloudCustomerId: null,
    buildingResolutionStatus: row.buildingSlug?.trim() ? "resolved" : null,
    allowNameComposite: true,
    paid: isPaidFlag(row.paid),
    totalCents: dollarsToCents(row.total),
    cancelled,
  };
}

export function cleanCloudOrderToTruth(
  row: CleanCloudOrderLike
): CustomerOrderTruthRecord | null {
  const createdAt = cleanCloudOrderOccurredAt(row);
  if (!createdAt) return null;
  const name = splitCustomerDisplayName(row.customerName);
  return {
    source: "cleancloud",
    sourceOrderId: row.cleancloudOrderId,
    id: cleancloudSortId(row.cleancloudOrderId),
    createdAt,
    firstName: name.firstName,
    lastName: name.lastName,
    phone: String(row.customerPhone ?? ""),
    email: row.customerEmail?.trim() ? row.customerEmail.trim() : null,
    address: String(row.address ?? ""),
    unit: row.unit?.trim() ? row.unit.trim() : null,
    buildingSlug: row.buildingSlug?.trim() ? row.buildingSlug.trim() : null,
    bldgUserId: null,
    cleancloudCustomerId: row.cleancloudCustomerId?.trim()
      ? row.cleancloudCustomerId.trim()
      : null,
    buildingResolutionStatus: row.buildingResolutionStatus ?? null,
    allowNameComposite: false,
    paid: row.paid == null ? true : isPaidFlag(row.paid),
    totalCents: Number.isFinite(row.totalCents) ? Number(row.totalCents) : 0,
    cancelled: false,
  };
}

export function mergeCustomerOrderTruth(input: {
  native?: readonly NativeOrderLike[];
  cleancloud?: readonly CleanCloudOrderLike[];
  includeCancelledNative?: boolean;
}): CustomerOrderTruthRecord[] {
  const records = [
    ...(input.native ?? []).map(row =>
      nativeOrderToTruth(row, {
        includeCancelled: input.includeCancelledNative,
      })
    ),
    ...preferCleanCloudOrders(input.cleancloud ?? []).map(cleanCloudOrderToTruth),
  ].filter((row): row is CustomerOrderTruthRecord => row != null);
  records.sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id - right.id ||
      left.source.localeCompare(right.source) ||
      left.sourceOrderId.localeCompare(right.sourceOrderId)
  );
  return records;
}

export function identityInputFromOrderTruth(
  record: CustomerOrderTruthRecord
): CustomerIdentityInput {
  return {
    phone: record.phone,
    email: record.email,
    bldgUserId: record.bldgUserId,
    firstName: record.firstName,
    lastName: record.lastName,
    unit: record.unit,
    buildingSlug: record.buildingSlug,
    address: record.address,
    cleancloudCustomerId: record.cleancloudCustomerId,
    verifiedNormalizedAddress:
      record.buildingResolutionStatus === "resolved" && record.unit
        ? record.address
        : null,
    allowNameComposite: record.allowNameComposite,
  };
}

export function groupCustomerOrderTruth(
  tenantId: string,
  records: readonly CustomerOrderTruthRecord[]
): Map<string, CustomerOrderTruthRecord[]> {
  return new Map(
    groupCustomerRecords(
      tenantId,
      records,
      identityInputFromOrderTruth,
      record => unidentifiedCustomerKey(record.source, record.sourceOrderId)
    ).map(group => [group.key, group.records])
  );
}

function sparseFallback(
  status: ReturnType<typeof computeRecencyStatus>
): LanternState {
  if (status === "lapsed") return "dark";
  if (status === "cooling") return "dimming";
  return "active";
}

export function projectGeographicCustomers(input: {
  groups: Map<string, CustomerOrderTruthRecord[]>;
  locationMap: Map<string, GeographicLocationSnapshot>;
  timeZone: string;
  today: string;
}) {
  return Array.from(input.groups.entries()).map(([identityKey, group]) => {
    const sorted = [...group].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id
    );
    const latest = sorted.at(-1)!;
    const recency = computeRecencyStatus({
      totalOrders: sorted.length,
      firstOrderAt: sorted[0]!.createdAt,
      lastOrderAt: latest.createdAt,
    });
    const cadence = inferCustomerCadence({
      qualifyingOrderDates: sorted.map(order =>
        formatInTimeZone(order.createdAt, input.timeZone, "yyyy-MM-dd")
      ),
      today: input.today,
      sparseFallback: sparseFallback(recency),
    });
    const location = input.locationMap.get(`customer:${identityKey}`);
    const latitude =
      location?.latitude == null ? null : Number(location.latitude);
    const longitude =
      location?.longitude == null ? null : Number(location.longitude);
    const sources = Array.from(new Set(sorted.map(order => order.source)));
    return {
      identityKey,
      phone: latest.phone,
      displayName:
        `${latest.firstName} ${latest.lastName}`.trim() ||
        "Customer name unavailable",
      address: location?.sourceAddress ?? latest.address,
      unit: latest.unit,
      cadence,
      totalOrders: sorted.length,
      firstOrderAt: sorted[0]!.createdAt.toISOString(),
      lastOrderAt: latest.createdAt.toISOString(),
      sources,
      location:
        latitude != null &&
        longitude != null &&
        location?.geocodeStatus === "success"
          ? {
              latitude,
              longitude,
              canonicalAddress: location.canonicalAddress ?? null,
              ...projectLatLngToLanternAtlas({ latitude, longitude }),
            }
          : null,
      geocodeStatus: location?.geocodeStatus ?? "pending",
    };
  });
}

/** Narrow read-model projection. Do not select the full `orders` schema. */
export const NATIVE_ORDER_TRUTH_COLUMNS = {
  id: orders.id,
  status: orders.status,
  createdAt: orders.createdAt,
  firstName: orders.firstName,
  lastName: orders.lastName,
  phone: orders.phone,
  email: orders.email,
  address: orders.address,
  unit: orders.unit,
  buildingSlug: orders.buildingSlug,
  bldgUserId: orders.bldgUserId,
  paid: orders.paid,
  total: orders.total,
} as const;

/** Narrow read-model projection. Do not select the full CleanCloud schema. */
export const CLEANCLOUD_ORDER_TRUTH_COLUMNS = {
  cleancloudOrderId: cleancloudPaidOrders.cleancloudOrderId,
  cleancloudCustomerId: cleancloudPaidOrders.cleancloudCustomerId,
  sourceReportType: cleancloudPaidOrders.sourceReportType,
  customerName: cleancloudPaidOrders.customerName,
  customerPhone: cleancloudPaidOrders.customerPhone,
  customerEmail: cleancloudPaidOrders.customerEmail,
  address: cleancloudPaidOrders.address,
  unit: cleancloudPaidOrders.unit,
  buildingSlug: cleancloudPaidOrders.buildingSlug,
  buildingResolutionStatus: cleancloudPaidOrders.buildingResolutionStatus,
  placedAtUtc: cleancloudPaidOrders.placedAtUtc,
  paymentDateUtc: cleancloudPaidOrders.paymentDateUtc,
  paidDateUtc: cleancloudPaidOrders.paidDateUtc,
  createdAt: cleancloudPaidOrders.createdAt,
  paid: cleancloudPaidOrders.paid,
  totalCents: cleancloudPaidOrders.totalCents,
} as const;

type TruthDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function loadNativeOrderTruthRows(
  db: TruthDb,
  tenantId?: string
): Promise<NativeOrderLike[]> {
  const query = db.select(NATIVE_ORDER_TRUTH_COLUMNS).from(orders);
  return tenantId ? query.where(eq(orders.tenantId, tenantId)) : query;
}

async function loadCleanCloudOrderTruthRows(
  db: TruthDb,
  tenantId?: string
): Promise<CleanCloudOrderLike[]> {
  return queryOptionalMysqlTable(async () => {
    const query = db
      .select(CLEANCLOUD_ORDER_TRUTH_COLUMNS)
      .from(cleancloudPaidOrders);
    return tenantId
      ? query.where(eq(cleancloudPaidOrders.tenantId, tenantId))
      : query;
  });
}

export async function loadCustomerOrderTruth(
  tenantId?: string,
  options?: { includeCancelledNative?: boolean }
): Promise<CustomerOrderTruthRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const nativeRows = await loadNativeOrderTruthRows(db, tenantId);
  const cleancloudRows = await loadCleanCloudOrderTruthRows(db, tenantId);
  return mergeCustomerOrderTruth({
    native: nativeRows,
    cleancloud: cleancloudRows,
    includeCancelledNative: options?.includeCancelledNative,
  });
}

export async function loadCustomerGroups(tenantId: string) {
  const records = await loadCustomerOrderTruth(tenantId);
  return groupCustomerOrderTruth(tenantId, records);
}
