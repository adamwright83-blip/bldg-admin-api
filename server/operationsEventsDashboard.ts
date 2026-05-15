import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { operationsEvents, type OperationsEvent } from "../drizzle/schema";
import { getDashboardTimeZone, zonedDayStartUtc, zonedNextDayYmd, zonedYmd } from "./dashboardZoned";
import { getDb } from "./db";

export type OperationsEventsBusinessUnit = "all" | "laundry_butler" | "laundry_farm";
export type OperationsEventsBuilding = "all" | "opus_la" | "century_park_east" | "other" | "unresolved";
export type OperationsEventsEventType = "all" | "pickup_completed" | "dropoff_completed";

export type OperationsEventsFilters = {
  startDate?: string | null;
  endDate?: string | null;
  businessUnit?: OperationsEventsBusinessUnit;
  building?: OperationsEventsBuilding;
  eventType?: OperationsEventsEventType;
  customerSearch?: string | null;
  page?: number;
  pageSize?: number;
};

export type NormalizedOperationsEventsFilters = Required<Omit<OperationsEventsFilters, "customerSearch">> & {
  customerSearch: string;
  startUtc: Date;
  endExclusiveUtc: Date;
  timeZone: string;
};

export const OPERATIONS_EVENTS_CSV_COLUMNS = [
  "event_id",
  "event_timestamp_utc",
  "event_type",
  "business_unit_label",
  "tenant_id",
  "order_id",
  "customer_name",
  "customer_phone",
  "customer_email",
  "service_type",
  "building_name",
  "building_slug",
  "tower",
  "unit",
  "building_resolution_status",
  "scheduled_date",
  "scheduled_window",
  "actual_event_timestamp",
  "actor_user_id",
  "actor_display_name",
  "vendor_id",
  "bag_count",
  "garment_count",
  "weight_lbs",
  "source",
  "raw_json",
  "created_at",
  "updated_at",
] as const;

const DEFAULT_PAGE_SIZE = 50;

export function normalizeOperationsEventsFilters(
  input: OperationsEventsFilters = {},
  now = new Date()
): NormalizedOperationsEventsFilters {
  const timeZone = getDashboardTimeZone();
  const endDate = input.endDate?.trim() || zonedYmd(now, timeZone);
  const fallbackStart = new Date(now);
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 30);
  const startDate = input.startDate?.trim() || zonedYmd(fallbackStart, timeZone);
  const endExclusiveDate = zonedNextDayYmd(endDate, timeZone);
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const pageSize = Math.min(Math.max(1, Math.trunc(input.pageSize ?? DEFAULT_PAGE_SIZE)), 200);
  return {
    startDate,
    endDate,
    businessUnit: input.businessUnit ?? "all",
    building: input.building ?? "all",
    eventType: input.eventType ?? "all",
    customerSearch: input.customerSearch?.trim() ?? "",
    page,
    pageSize,
    startUtc: zonedDayStartUtc(startDate, timeZone),
    endExclusiveUtc: zonedDayStartUtc(endExclusiveDate, timeZone),
    timeZone,
  };
}

function knownBuildingWhere(building: "opus_la" | "century_park_east"): SQL {
  if (building === "opus_la") {
    return or(
      eq(operationsEvents.buildingSlug, "opusla"),
      sql`LOWER(${operationsEvents.buildingName}) LIKE ${"%opus%"}`
    ) as SQL;
  }
  return or(
    eq(operationsEvents.buildingSlug, "centuryparkeast"),
    sql`LOWER(${operationsEvents.buildingName}) LIKE ${"%century%"}`
  ) as SQL;
}

export function operationsEventsWhere(filters: NormalizedOperationsEventsFilters): SQL | undefined {
  const clauses: SQL[] = [
    gte(operationsEvents.actualEventTimestamp, filters.startUtc),
    lt(operationsEvents.actualEventTimestamp, filters.endExclusiveUtc),
  ];

  if (filters.businessUnit === "laundry_butler") clauses.push(eq(operationsEvents.tenantId, "default"));
  if (filters.businessUnit === "laundry_farm") clauses.push(eq(operationsEvents.tenantId, "laundry_farm"));
  if (filters.eventType !== "all") clauses.push(eq(operationsEvents.sourceEventType, filters.eventType));
  if (filters.building === "unresolved") {
    clauses.push(eq(operationsEvents.buildingResolutionStatus, "unresolved_needs_mapping"));
  } else if (filters.building === "opus_la" || filters.building === "century_park_east") {
    clauses.push(knownBuildingWhere(filters.building));
  } else if (filters.building === "other") {
    clauses.push(
      and(
        sql`COALESCE(${operationsEvents.buildingResolutionStatus}, '') != ${"unresolved_needs_mapping"}`,
        sql`COALESCE(LOWER(${operationsEvents.buildingSlug}), '') NOT IN ('opusla', 'centuryparkeast')`,
        sql`COALESCE(LOWER(${operationsEvents.buildingName}), '') NOT LIKE ${"%opus%"}`,
        sql`COALESCE(LOWER(${operationsEvents.buildingName}), '') NOT LIKE ${"%century%"}`
      ) as SQL
    );
  }

  if (filters.customerSearch) {
    const q = `%${filters.customerSearch.toLowerCase()}%`;
    clauses.push(
      or(
        sql`LOWER(${operationsEvents.customerName}) LIKE ${q}`,
        sql`LOWER(COALESCE(${operationsEvents.customerEmail}, '')) LIKE ${q}`,
        sql`COALESCE(${operationsEvents.customerPhone}, '') LIKE ${`%${filters.customerSearch}%`}`
      ) as SQL
    );
  }

  return clauses.length ? and(...clauses) : undefined;
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const raw = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function operationsEventsToCsv(rows: OperationsEvent[]): string {
  const lines = [OPERATIONS_EVENTS_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    const values = [
      row.id,
      row.actualEventTimestamp,
      row.sourceEventType,
      row.businessUnitLabel,
      row.tenantId,
      row.orderId,
      row.customerName,
      row.customerPhone,
      row.customerEmail,
      row.serviceType,
      row.buildingName,
      row.buildingSlug,
      row.tower,
      row.unit,
      row.buildingResolutionStatus,
      row.scheduledDate,
      row.scheduledWindow,
      row.actualEventTimestamp,
      row.actorUserId,
      row.actorDisplayName,
      row.vendorId,
      row.bagCount,
      row.garmentCount,
      row.weightLbs,
      row.source,
      row.rawJson,
      row.createdAt,
      row.updatedAt,
    ];
    lines.push(values.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export function summarizeOperationsEventRows(rows: OperationsEvent[]) {
  return {
    totalEvents: rows.length,
    pickupCount: rows.filter((row) => row.sourceEventType === "pickup_completed").length,
    dropoffCount: rows.filter((row) => row.sourceEventType === "dropoff_completed").length,
    unresolvedBuildingCount: rows.filter((row) => row.buildingResolutionStatus === "unresolved_needs_mapping").length,
  };
}

export function operationEventWithinDashboardDateRange(
  row: OperationsEvent,
  filters: Pick<NormalizedOperationsEventsFilters, "startUtc" | "endExclusiveUtc">
): boolean {
  const ts = row.actualEventTimestamp.getTime();
  return ts >= filters.startUtc.getTime() && ts < filters.endExclusiveUtc.getTime();
}

export function operationsEventsCsvFilename(filters: NormalizedOperationsEventsFilters): string {
  const parts = ["operations-events", `${filters.startDate}-to-${filters.endDate}`];
  if (filters.businessUnit !== "all") parts.push(filters.businessUnit === "laundry_butler" ? "LB" : "LF");
  if (filters.building !== "all") parts.push(filters.building.replace(/_/g, "-"));
  if (filters.eventType !== "all") parts.push(filters.eventType.replace(/_/g, "-"));
  if (filters.customerSearch) parts.push("search");
  return `${parts.join("-")}.csv`;
}

export async function listOperationsEvents(input: OperationsEventsFilters = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const filters = normalizeOperationsEventsFilters(input);
  const where = operationsEventsWhere(filters);
  const offset = (filters.page - 1) * filters.pageSize;

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(operationsEvents)
      .where(where)
      .orderBy(desc(operationsEvents.actualEventTimestamp), desc(operationsEvents.id))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({
        totalEvents: sql<number>`COUNT(*)`,
        pickupCount: sql<number>`SUM(CASE WHEN ${operationsEvents.sourceEventType} = 'pickup_completed' THEN 1 ELSE 0 END)`,
        dropoffCount: sql<number>`SUM(CASE WHEN ${operationsEvents.sourceEventType} = 'dropoff_completed' THEN 1 ELSE 0 END)`,
        unresolvedBuildingCount: sql<number>`SUM(CASE WHEN ${operationsEvents.buildingResolutionStatus} = 'unresolved_needs_mapping' THEN 1 ELSE 0 END)`,
      })
      .from(operationsEvents)
      .where(where),
  ]);

  const summary = totals[0] ?? { totalEvents: 0, pickupCount: 0, dropoffCount: 0, unresolvedBuildingCount: 0 };
  return {
    filters,
    rows,
    page: filters.page,
    pageSize: filters.pageSize,
    totalRows: Number(summary.totalEvents ?? 0),
    totalPages: Math.max(1, Math.ceil(Number(summary.totalEvents ?? 0) / filters.pageSize)),
    summary: {
      totalEvents: Number(summary.totalEvents ?? 0),
      pickupCount: Number(summary.pickupCount ?? 0),
      dropoffCount: Number(summary.dropoffCount ?? 0),
      unresolvedBuildingCount: Number(summary.unresolvedBuildingCount ?? 0),
    },
  };
}

export async function exportOperationsEventsCsv(input: OperationsEventsFilters = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const filters = normalizeOperationsEventsFilters(input);
  const rows = await db
    .select()
    .from(operationsEvents)
    .where(operationsEventsWhere(filters))
    .orderBy(desc(operationsEvents.actualEventTimestamp), desc(operationsEvents.id));
  return {
    filename: operationsEventsCsvFilename(filters),
    csv: operationsEventsToCsv(rows),
    rowCount: rows.length,
  };
}
