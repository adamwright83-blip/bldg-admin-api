import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validatePayload } from "../cleancloudBrowserSync/validation";
import { assimilateImportedCustomerTruth } from "../cleancloudBrowserSync/assimilateCustomerTruth";
import { formatGumballOperatorStatus } from "../cleancloudBrowserSync/gumballOperatorStatus";
import { mapCleanCloudOrders, mapNativeOrders } from "../analytics/paidOrderLedger";
import { inferCustomerCadence } from "../../shared/lanternCity";
import {
  groupCustomerOrderTruth,
  mergeCustomerOrderTruth,
  projectGeographicCustomers,
  type NativeOrderLike,
} from "./customerOrderTruth";

const header =
  "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total";
const importInput = {
  storeId: "123",
  from: "2026-08-15",
  to: "2026-09-03",
  exportUrl:
    "https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=15&m1=08&y1=2026&d2=03&m2=09&y2=2026&stores=[123]&group=",
  csv:
    header +
    "\n1,08/20/2026,Example,7,2170 Century Park East,Yes,09/02/2026,51.00",
};

const TENANT = "example";
const TZ = "America/Los_Angeles";
const TODAY = "2026-09-18";
const WINDOW = {
  startUtc: new Date("2026-01-01T08:00:00.000Z"),
  endExclusiveUtc: new Date("2026-12-31T08:00:00.000Z"),
};

function native(overrides: Partial<NativeOrderLike> & { id: number }): NativeOrderLike {
  return {
    status: "delivered",
    createdAt: new Date("2026-09-10T19:00:00.000Z"),
    firstName: "Ada",
    lastName: "Butler",
    phone: "3105550100",
    email: "ada@example.com",
    address: "10000 Santa Monica Blvd",
    unit: "4",
    buildingSlug: "westview",
    bldgUserId: 42,
    ...overrides,
  };
}

function project(csv: string, extraNative: NativeOrderLike[] = []) {
  const { normalized } = validatePayload({ ...importInput, csv }, TENANT);
  const records = mergeCustomerOrderTruth({
    native: extraNative,
    cleancloud: normalized,
  });
  const groups = groupCustomerOrderTruth(TENANT, records);
  const customers = projectGeographicCustomers({
    groups,
    locationMap: new Map(),
    timeZone: TZ,
    today: TODAY,
  });
  return { normalized, records, groups, customers };
}

describe("Gumball operator status", () => {
  it("names each failure stage without claiming a downstream refresh", () => {
    expect(formatGumballOperatorStatus({})).toBe("GUMBALL · export never captured");
    expect(
      formatGumballOperatorStatus({
        lastAttemptAt: "2026-09-18T01:08:00.000Z",
        lastAttemptOutcome: "extension_export",
      })
    ).toContain("export never captured");
    expect(
      formatGumballOperatorStatus({
        lastAttemptAt: "2026-09-18T01:08:00.000Z",
        lastAttemptOutcome: "extension_parse",
      })
    ).toContain("CSV parse rejected");
    expect(
      formatGumballOperatorStatus({
        lastAttemptAt: "2026-09-18T01:08:00.000Z",
        lastAttemptOutcome: "rejected",
      })
    ).toContain("backend validation rejected");
    expect(
      formatGumballOperatorStatus({
        lastAttemptAt: "2026-09-18T01:08:00.000Z",
        lastAttemptOutcome: "failed",
      })
    ).toContain("database import failed");
    expect(
      formatGumballOperatorStatus({
        lastAttemptAt: "2026-09-18T01:08:00.000Z",
        lastAttemptOutcome: "imported",
        rowsParsed: 14,
        inserted: 3,
        updated: 11,
        customerTruth: "failed",
        map: "failed",
      })
    ).toBe(
      "GUMBALL 6:08 PM · 14 rows parsed · 3 inserted · 11 updated · customer truth failed · map not refreshed"
    );
    expect(
      formatGumballOperatorStatus({
        lastAttemptAt: "2026-09-18T01:08:00.000Z",
        lastAttemptOutcome: "imported",
        rowsParsed: 14,
        inserted: 3,
        updated: 11,
        customerTruth: "refreshed",
        map: "refreshed",
      })
    ).toBe(
      "GUMBALL 6:08 PM · 14 rows parsed · 3 inserted · 11 updated · customer truth refreshed · map refreshed"
    );
  });
});

describe("Gumball import → Goldline customer truth", () => {
  it("imports a valid Orders (Sales) CSV into paid ledger and canonical customers", () => {
    const { normalized, customers } = project(importInput.csv);
    const events = mapCleanCloudOrders(normalized, WINDOW, TZ);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: "cleancloud",
      eventKey: "cleancloud:1",
      cents: 5100,
      identity: { cleancloudCustomerId: "7" },
    });
    expect(customers).toHaveLength(1);
    expect(customers[0]?.displayName).toBe("Example");
    expect(customers[0]?.totalOrders).toBe(1);
    expect(customers[0]?.lastOrderAt).toBe(normalized[0]!.placedAtUtc!.toISOString());
    expect(customers[0]?.sources).toEqual(["cleancloud"]);
    expect(customers[0]?.location).toBeNull();
    expect(customers[0]?.geocodeStatus).toBe("pending");
  });

  it("resolves a known building from source address without inventing coordinates", () => {
    const { normalized, records } = project(importInput.csv);
    expect(normalized[0]?.buildingSlug).toBe("centuryparkeast");
    expect(records[0]?.buildingSlug).toBe("centuryparkeast");
  });

  it("keeps an unknown address unresolved rather than guessing a tower", () => {
    const { normalized, customers } = project(
      importInput.csv.replace("2170 Century Park East", "Unknown alley 1")
    );
    expect(normalized[0]?.buildingResolutionStatus).not.toBe("resolved");
    expect(customers[0]?.location).toBeNull();
    expect(customers[0]?.geocodeStatus).toBe("pending");
  });

  it("is idempotent for a repeated payload and updates rather than duplicating a correction", () => {
    const first = project(importInput.csv);
    const repeat = project(importInput.csv);
    expect(repeat.customers).toHaveLength(first.customers.length);
    expect(repeat.records).toHaveLength(1);
    expect(repeat.customers[0]?.identityKey).toBe(first.customers[0]?.identityKey);
    expect(mapCleanCloudOrders(repeat.normalized, WINDOW, TZ)).toHaveLength(1);

    const renamed = project(importInput.csv.replace("Example", "Renamed Customer"));
    expect(renamed.customers).toHaveLength(1);
    expect(renamed.customers[0]?.displayName).toBe("Renamed Customer");
    expect(renamed.customers[0]?.identityKey).toBe(first.customers[0]?.identityKey);
    expect(renamed.records).toHaveLength(1);

    const corrected = project(importInput.csv.replace("51.00", "61.00"));
    expect(corrected.records).toHaveLength(1);
    expect(mapCleanCloudOrders(corrected.normalized, WINDOW, TZ)[0]?.cents).toBe(6100);
    expect(corrected.customers[0]?.identityKey).toBe(first.customers[0]?.identityKey);
  });

  it("does not key customer identity by display name alone", () => {
    const { customers } = project(
      header +
        "\n1,08/20/2026,Example,7,2170 Century Park East,Yes,09/02/2026,51.00" +
        "\n2,08/21/2026,Example,8,3545 Wilshire Blvd,Yes,09/02/2026,10.00"
    );
    expect(customers).toHaveLength(2);
  });

  it("does not double-count CleanCloud revenue across Sales and Revenue twins", () => {
    const sales = validatePayload(importInput, TENANT).normalized[0]!;
    const events = mapCleanCloudOrders(
      [
        sales,
        {
          ...sales,
          sourceReportType: "orders_revenue",
          paidDateUtc: sales.paymentDateUtc,
          paymentDateUtc: null,
        },
      ],
      WINDOW,
      TZ
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.cents).toBe(5100);
    expect(
      mergeCustomerOrderTruth({
        cleancloud: [
          sales,
          { ...sales, sourceReportType: "orders_revenue", paidDateUtc: sales.paymentDateUtc },
        ],
      })
    ).toHaveLength(1);
  });

  it("still groups native Laundry Butler orders unchanged", () => {
    const nativeOrder = native({ id: 88 });
    const { customers } = project(importInput.csv, [nativeOrder]);
    expect(customers).toHaveLength(2);
    const butler = customers.find(customer =>
      customer.sources.includes("laundry_butler")
    );
    expect(butler?.displayName).toBe("Ada Butler");
    expect(butler?.totalOrders).toBe(1);
    const nativeEvents = mapNativeOrders(
      [
        {
          id: 88,
          paid: true,
          paidAt: nativeOrder.createdAt,
          total: "40.00",
          stripePaymentIntentId: "pi_88",
          serviceType: "wash_fold",
          firstName: "Ada",
          lastName: "Butler",
          phone: "3105550100",
          email: "ada@example.com",
          bldgUserId: 42,
        },
      ],
      WINDOW,
      TZ
    );
    expect(nativeEvents.events).toHaveLength(1);
    expect(nativeEvents.unverified).toEqual([]);
  });

  it("joins a native customer to an imported CleanCloud order by phone, not by inventing a second person", () => {
    const csv =
      header +
      "\n1,08/20/2026,Someone Else,7,2170 Century Park East Unit 4,Yes,09/02/2026,51.00\n";
    // Phone must be in the CSV for the join. The fixture header has no Phone column,
    // so merge with a CleanCloud-shaped row that carries the native phone.
    const { normalized } = validatePayload(importInput, TENANT);
    const records = mergeCustomerOrderTruth({
      native: [native({ id: 12 })],
      cleancloud: [
        {
          ...normalized[0]!,
          customerPhone: "3105550100",
          customerName: "Someone Else",
        },
      ],
    });
    const customers = projectGeographicCustomers({
      groups: groupCustomerOrderTruth(TENANT, records),
      locationMap: new Map(),
      timeZone: TZ,
      today: TODAY,
    });
    expect(csv).toContain("Someone Else");
    expect(customers).toHaveLength(1);
    expect(customers[0]?.totalOrders).toBe(2);
    expect(customers[0]?.sources.sort()).toEqual(["cleancloud", "laundry_butler"]);
  });

  it("updates cadence and lantern state from imported order dates", () => {
    const csv =
      header +
      "\n10,06/01/2026,Cadence,9,2170 Century Park East,Yes,06/01/2026,10.00" +
      "\n11,07/01/2026,Cadence,9,2170 Century Park East,Yes,07/01/2026,10.00" +
      "\n12,08/01/2026,Cadence,9,2170 Century Park East,Yes,08/01/2026,10.00";
    const { customers } = project(csv);
    expect(customers).toHaveLength(1);
    expect(customers[0]?.totalOrders).toBe(3);
    expect(customers[0]?.cadence.confidence).toBe("measured");
    expect(customers[0]?.cadence.state).toBe("dimming");
    const measured = inferCustomerCadence({
      qualifyingOrderDates: ["2026-06-01", "2026-07-01", "2026-08-01"],
      today: TODAY,
      sparseFallback: "active",
    });
    expect(customers[0]?.cadence.state).toBe(measured.state);
  });

  it("does not treat a name-only CleanCloud row as a customer", () => {
    const records = mergeCustomerOrderTruth({
      cleancloud: [
        {
          cleancloudOrderId: "99",
          cleancloudCustomerId: null,
          sourceReportType: "orders_sales",
          customerName: "Anonymous",
          customerPhone: null,
          customerEmail: null,
          address: "Mystery Road",
          placedAtUtc: new Date("2026-09-02T07:00:00.000Z"),
          paymentDateUtc: new Date("2026-09-02T07:00:00.000Z"),
          buildingResolutionStatus: "unresolved_needs_mapping",
        },
      ],
    });
    expect(records).toHaveLength(1);
    expect(groupCustomerOrderTruth(TENANT, records).size).toBe(0);
  });
});

describe("customer-truth assimilation after import", () => {
  it("records a failed customer-truth step without claiming the map refreshed", async () => {
    const result = await assimilateImportedCustomerTruth("tenant", {
      drainOutbox: async () => 1,
      refreshCustomerTruth: async () => {
        throw new Error("atlas unavailable");
      },
      geocode: async () => {
        throw new Error("should not geocode");
      },
      refreshMap: async () => {
        throw new Error("should not refresh map");
      },
    });
    expect(result).toMatchObject({
      customerTruth: "failed",
      map: "failed",
      outboxDrained: true,
      error: "atlas unavailable",
    });
  });

  it("marks both steps refreshed only when they actually complete", async () => {
    const result = await assimilateImportedCustomerTruth("tenant", {
      drainOutbox: async () => 0,
      refreshCustomerTruth: async () => ({
        customers: [{ geocodeStatus: "pending" }, { geocodeStatus: "success" }],
      }),
      geocode: async () => ({ attempted: 1 }),
      refreshMap: async () => [],
    });
    expect(result).toMatchObject({
      customerTruth: "refreshed",
      map: "refreshed",
      customerCount: 2,
      unresolvedGeographyCount: 1,
      outboxDrained: true,
      error: null,
    });
  });
});

describe("digest stability for existing browser-sync tests", () => {
  it("keeps the same payload digest used by production import", () => {
    const first = validatePayload(importInput, TENANT);
    const second = validatePayload({ ...importInput }, TENANT);
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            storeId: importInput.storeId,
            from: importInput.from,
            to: importInput.to,
            csv: importInput.csv,
          })
        )
        .digest("hex")
    );
  });
});
