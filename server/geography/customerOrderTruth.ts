import { eq } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import {
  cleancloudPaidOrders,
  orders,
  type CleancloudPaidOrder,
} from "../../drizzle/schema";
import { computeRecencyStatus } from "../../shared/customerStatus";
import {
  inferCustomerCadence,
  projectLatLngToLanternAtlas,
  type LanternState,
} from "../../shared/lanternCity";
import {
  groupCustomerRecords,
  type CustomerIdentityInput,
} from "../customerAssets/customerIdentity";
import { getDb } from "../db";

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

export function nativeOrderToTruth(
  row: NativeOrderLike
): CustomerOrderTruthRecord | null {
  if (row.status === "cancelled") return null;
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
  };
}

export function mergeCustomerOrderTruth(input: {
  native?: readonly NativeOrderLike[];
  cleancloud?: readonly CleanCloudOrderLike[];
}): CustomerOrderTruthRecord[] {
  const records = [
    ...(input.native ?? []).map(nativeOrderToTruth),
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
    groupCustomerRecords(tenantId, records, identityInputFromOrderTruth).map(
      group => [group.key, group.records]
    )
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

export async function loadCustomerOrderTruth(
  tenantId: string
): Promise<CustomerOrderTruthRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [nativeRows, cleancloudRows] = await Promise.all([
    db.select().from(orders).where(eq(orders.tenantId, tenantId)),
    db
      .select()
      .from(cleancloudPaidOrders)
      .where(eq(cleancloudPaidOrders.tenantId, tenantId)),
  ]);
  return mergeCustomerOrderTruth({
    native: nativeRows,
    cleancloud: cleancloudRows as CleancloudPaidOrder[],
  });
}

export async function loadCustomerGroups(tenantId: string) {
  const records = await loadCustomerOrderTruth(tenantId);
  return groupCustomerOrderTruth(tenantId, records);
}
