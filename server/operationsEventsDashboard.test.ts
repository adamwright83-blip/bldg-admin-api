import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { OperationsEvent } from "../drizzle/schema";
import {
  OPERATIONS_EVENTS_CSV_COLUMNS,
  operationEventWithinDashboardDateRange,
  normalizeOperationsEventsFilters,
  operationsEventsCsvFilename,
  operationsEventsToCsv,
  operationsEventsWhere,
  summarizeOperationsEventRows,
} from "./operationsEventsDashboard";

function event(overrides: Partial<OperationsEvent> = {}): OperationsEvent {
  const ts = new Date("2026-05-14T20:15:00.000Z");
  return {
    id: 1,
    tenantId: "default",
    businessUnitLabel: "Laundry Butler",
    source: "driver_app_bldg",
    sourceEventType: "pickup_completed",
    eventStatus: "completed",
    orderId: 42,
    customerName: "Moj Salon",
    customerPhone: "3235550101",
    customerEmail: "moj@example.com",
    serviceType: "wash_fold",
    buildingName: "Opus Los Angeles",
    buildingSlug: "opusla",
    tower: "South Tower",
    buildingResolutionStatus: "resolved",
    unit: "1201",
    scheduledDate: "2026-05-14",
    scheduledWindow: "10:00am-12:00pm",
    actualEventTimestamp: ts,
    actorUserId: "7",
    actorDisplayName: "Adam",
    vendorId: null,
    bagCount: 2,
    garmentCount: null,
    weightLbs: "12.50",
    rawJson: { orderSnapshot: { id: 42, firstName: "Moj" } },
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function whereSql(input: Parameters<typeof normalizeOperationsEventsFilters>[0]) {
  const dialect = new MySqlDialect();
  const where = operationsEventsWhere(normalizeOperationsEventsFilters(input, new Date("2026-05-14T19:00:00.000Z")));
  return dialect.sqlToQuery(where!);
}

describe("operations events dashboard helpers", () => {
  it("defaults dashboard query filters to the last 30 days", () => {
    const filters = normalizeOperationsEventsFilters({}, new Date("2026-05-14T19:00:00.000Z"));
    expect(filters.startDate).toBe("2026-04-14");
    expect(filters.endDate).toBe("2026-05-14");
    expect(filters.page).toBe(1);
    expect(filters.pageSize).toBe(50);
  });

  it("preserves event type, business unit, building, and customer filters", () => {
    const filters = normalizeOperationsEventsFilters({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      eventType: "dropoff_completed",
      businessUnit: "laundry_farm",
      building: "unresolved",
      customerSearch: "Moj",
      page: 2,
    });
    expect(filters).toMatchObject({
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      eventType: "dropoff_completed",
      businessUnit: "laundry_farm",
      building: "unresolved",
      customerSearch: "Moj",
      page: 2,
      pageSize: 50,
    });
  });

  it("interprets displayed dates as Los Angeles local days with an exclusive next-day end", () => {
    const filters = normalizeOperationsEventsFilters({
      startDate: "2026-04-15",
      endDate: "2026-05-15",
    });
    expect(filters.timeZone).toBe("America/Los_Angeles");
    expect(filters.startUtc.toISOString()).toBe("2026-04-15T07:00:00.000Z");
    expect(filters.endExclusiveUtc.toISOString()).toBe("2026-05-16T07:00:00.000Z");

    const query = whereSql({ startDate: "2026-04-15", endDate: "2026-05-15" });
    expect(query.sql).toContain("`operations_events`.`actualEventTimestamp` >= ?");
    expect(query.sql).toContain("`operations_events`.`actualEventTimestamp` < ?");
    expect(query.sql).not.toContain("`operations_events`.`actualEventTimestamp` <= ?");
  });

  it("includes the verified production smoke-test rows when the UI end date is 05/15/2026", () => {
    const filters = normalizeOperationsEventsFilters({
      startDate: "2026-04-15",
      endDate: "2026-05-15",
      businessUnit: "all",
    });
    const rows = [
      event({
        id: 1,
        orderId: 101,
        customerName: "Adam Carlin",
        sourceEventType: "pickup_completed",
        actualEventTimestamp: new Date("2026-05-15T04:51:32.000Z"),
      }),
      event({
        id: 2,
        orderId: 97,
        customerName: "Abe Chung",
        sourceEventType: "dropoff_completed",
        actualEventTimestamp: new Date("2026-05-15T04:53:36.000Z"),
      }),
    ];

    expect(rows.every((row) => operationEventWithinDashboardDateRange(row, filters))).toBe(true);
  });

  it("keeps the displayed end date inclusive but excludes the following Los Angeles local day", () => {
    const filters = normalizeOperationsEventsFilters({
      startDate: "2026-05-15",
      endDate: "2026-05-15",
    });
    expect(operationEventWithinDashboardDateRange(event({ actualEventTimestamp: new Date("2026-05-16T06:59:59.999Z") }), filters)).toBe(true);
    expect(operationEventWithinDashboardDateRange(event({ actualEventTimestamp: new Date("2026-05-16T07:00:00.000Z") }), filters)).toBe(false);
  });

  it("event type filter restricts results to pickup or dropoff events", () => {
    const query = whereSql({ eventType: "pickup_completed" });
    expect(query.sql).toContain("`operations_events`.`sourceEventType` = ?");
    expect(query.params).toContain("pickup_completed");
  });

  it("business unit filter restricts results by tenant id", () => {
    const query = whereSql({ businessUnit: "laundry_farm" });
    expect(query.sql).toContain("`operations_events`.`tenantId` = ?");
    expect(query.params).toContain("laundry_farm");
  });

  it("does not exclude tenantId default rows when business unit filter is All", () => {
    const query = whereSql({ businessUnit: "all" });
    expect(query.sql).not.toContain("`operations_events`.`tenantId` = ?");
    expect(operationEventWithinDashboardDateRange(event({ tenantId: "default" }), normalizeOperationsEventsFilters({}))).toBe(true);
  });

  it("summarizes the verified fixture rows as total 2, pickup 1, dropoff 1", () => {
    const summary = summarizeOperationsEventRows([
      event({
        id: 1,
        customerName: "Adam Carlin",
        sourceEventType: "pickup_completed",
        actualEventTimestamp: new Date("2026-05-15T04:51:32.000Z"),
      }),
      event({
        id: 2,
        customerName: "Abe Chung",
        sourceEventType: "dropoff_completed",
        actualEventTimestamp: new Date("2026-05-15T04:53:36.000Z"),
      }),
    ]);
    expect(summary).toMatchObject({
      totalEvents: 2,
      pickupCount: 1,
      dropoffCount: 1,
    });
  });

  it("building filter handles known and unresolved building buckets", () => {
    const opus = whereSql({ building: "opus_la" });
    expect(opus.sql).toContain("`operations_events`.`buildingSlug` = ?");
    expect(opus.sql).toContain("LOWER(`operations_events`.`buildingName`) LIKE ?");
    expect(opus.params).toContain("opusla");
    expect(opus.params).toContain("%opus%");

    const unresolved = whereSql({ building: "unresolved" });
    expect(unresolved.sql).toContain("`operations_events`.`buildingResolutionStatus` = ?");
    expect(unresolved.params).toContain("unresolved_needs_mapping");
  });

  it("customer search uses MySQL-safe LIKE clauses for name, email, and phone", () => {
    const query = whereSql({ customerSearch: "Moj" });
    expect(query.sql).not.toMatch(/\bILIKE\b/i);
    expect(query.sql).toContain("LOWER(`operations_events`.`customerName`) LIKE ?");
    expect(query.sql).toContain("LOWER(COALESCE(`operations_events`.`customerEmail`, '')) LIKE ?");
    expect(query.sql).toContain("COALESCE(`operations_events`.`customerPhone`, '') LIKE ?");
    expect(query.params).toContain("%moj%");
    expect(query.params).toContain("%Moj%");
  });

  it("CSV export includes expected columns in the required order", () => {
    const csv = operationsEventsToCsv([]);
    expect(csv.trim()).toBe(OPERATIONS_EVENTS_CSV_COLUMNS.join(","));
  });

  it("CSV export serializes dates, numbers, nulls, and rawJson", () => {
    const csv = operationsEventsToCsv([event()]);
    expect(csv).toContain("2026-05-14T20:15:00.000Z");
    expect(csv).toContain("pickup_completed");
    expect(csv).toContain("Moj Salon");
    expect(csv).toContain("12.50");
    expect(csv).toContain('"{""orderSnapshot"":{""id"":42,""firstName"":""Moj""}}"');
  });

  it("CSV filename reflects active filters", () => {
    const filters = normalizeOperationsEventsFilters({
      startDate: "2026-05-01",
      endDate: "2026-05-14",
      businessUnit: "laundry_butler",
      building: "opus_la",
      eventType: "pickup_completed",
      customerSearch: "Moj",
    });
    expect(operationsEventsCsvFilename(filters)).toBe(
      "operations-events-2026-05-01-to-2026-05-14-LB-opus-la-pickup-completed-search.csv"
    );
  });

  it("customer search implementation is MySQL-safe and does not use ILIKE", () => {
    const source = readFileSync(new URL("./operationsEventsDashboard.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\bILIKE\b/i);
    expect(source).toContain("LOWER(${operationsEvents.customerName}) LIKE");
    expect(source).toContain("LOWER(COALESCE(${operationsEvents.customerEmail}, '')) LIKE");
    expect(source).toContain("COALESCE(${operationsEvents.customerPhone}, '') LIKE");
  });
});
