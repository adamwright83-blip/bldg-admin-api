import type { CleanCloudOrderRow, LedgerLoaders, NativeOrderRow } from "../../analytics/paidOrderLedger";
import type { DataFreshness } from "../../analytics/dataFreshness";
import { ALWAYS_MISSING_SOURCES, type DataCompleteness } from "../../analytics/analyticsQueries";

/**
 * A Laundry Butler + Laundry Farm business shaped like production on the
 * morning of Tuesday September 15, 2026 (9:40 AM in Los Angeles):
 *
 * - Laundry Butler: Goldline's own Stripe-paid orders, mostly OPUS LA and
 *   Century Park East residents (Carol, Spencer, Todd, Rebecca).
 * - Laundry Farm: CleanCloud orders from the GUMBALL-paired "Laundry Farm"
 *   store, paid on Clearent saved cards or cash (John on Clarissa Avenue,
 *   Sophie and Sean in Los Feliz, two different Marias, one OPUS resident).
 * - One native order marked paid with no Stripe record (never counted).
 * - GUMBALL last imported on September 11 at 7:03 AM (orders for Sept 10).
 */

export const BUSINESS_NOW = new Date("2026-09-15T16:40:00.000Z");
export const BUSINESS_TZ = "America/Los_Angeles";

const at = (iso: string) => new Date(iso);
/** Noon in Los Angeles on a business date. */
const noon = (ymd: string) => new Date(`${ymd}T19:00:00.000Z`);

type NativePerson = { first: string; last: string; phone: string; address: string; unit?: string; building: string | null };

const CAROL: NativePerson = { first: "Carol", last: "Wexler", phone: "3105550201", address: "3545 Wilshire Blvd, Los Angeles, CA 90010", unit: "1802", building: "opusla" };
const SPENCER: NativePerson = { first: "Spencer", last: "Hale", phone: "3105550202", address: "3650 W 6th St, Los Angeles, CA 90020", unit: "905", building: "3650" };
const TODD: NativePerson = { first: "Todd", last: "Ames", phone: "3105550203", address: "2170 Century Park E, Los Angeles, CA 90067", unit: "1510", building: "centuryparkeast" };
const REBECCA: NativePerson = { first: "Rebecca", last: "Stone", phone: "3105550204", address: "2160 Century Park E, Los Angeles, CA 90067", unit: "702", building: "centuryparkeast" };

function native(id: number, paidAt: Date, total: string, person: NativePerson, serviceType: "wash_fold" | "dry_cleaning", extra: Partial<NativeOrderRow> = {}): NativeOrderRow {
  return {
    id,
    paid: true,
    paidAt,
    total,
    stripePaymentIntentId: `pi_${id}`,
    serviceType,
    firstName: person.first,
    lastName: person.last,
    phone: person.phone,
    email: null,
    bldgUserId: null,
    address: person.address,
    unit: person.unit ?? null,
    buildingSlug: person.building,
    createdAt: new Date(paidAt.getTime() - 26 * 3600 * 1000),
    ...extra,
  };
}

export const businessNativeRows: NativeOrderRow[] = [
  native(201, noon("2026-03-16"), "30.00", TODD, "dry_cleaning"),
  native(210, noon("2026-06-10"), "40.00", REBECCA, "wash_fold"),
  native(214, noon("2026-07-08"), "45.00", REBECCA, "wash_fold"),
  native(218, noon("2026-08-05"), "50.00", REBECCA, "wash_fold"),
  native(222, at("2026-08-21T22:02:48.000Z"), "12.00", CAROL, "dry_cleaning"),
  native(228, at("2026-08-21T22:01:59.000Z"), "42.00", SPENCER, "wash_fold"),
  native(231, at("2026-09-01T21:55:35.000Z"), "61.18", TODD, "dry_cleaning"),
  native(229, noon("2026-09-02"), "55.00", REBECCA, "wash_fold"),
  native(232, at("2026-09-04T08:09:38.000Z"), "19.00", CAROL, "dry_cleaning"),
  native(233, at("2026-09-05T01:34:55.000Z"), "42.00", SPENCER, "wash_fold"),
  native(299, noon("2026-09-01"), "70.00", { first: "Zed", last: "Proxy", phone: "3105550777", address: "1 Test St", building: null }, "wash_fold", {
    stripePaymentIntentId: null,
  }),
];

type CloudPerson = { name: string; phone: string | null; id: string; address: string; building?: string | null };

const JOHN: CloudPerson = { name: "John Cunningham", phone: "3235550301", id: "cc-john", address: "2140 Clarissa Ave, Los Angeles, CA 90027" };
const SOPHIE: CloudPerson = { name: "Sophie Tran", phone: "3235550302", id: "cc-sophie", address: "4800 Hollywood Blvd, Los Angeles, CA 90027" };
const SEAN: CloudPerson = { name: "Sean Cohen", phone: "3235550303", id: "cc-sean", address: "1500 N Vermont Ave, Los Angeles, CA 90027" };
const MARIA_LOPEZ: CloudPerson = { name: "Maria Lopez", phone: "3235550304", id: "cc-mlopez", address: "1200 Echo Park Ave, Los Angeles, CA 90026" };
const MARIA_CHEN: CloudPerson = { name: "Maria Chen", phone: "3235550305", id: "cc-mchen", address: "3545 Wilshire Blvd Apt 1204, Los Angeles, CA 90010", building: "opusla" };

const FLUFF = (lbs: number) => `Fluff & Fold SAME DAY / DELIVERY x ${lbs}<br>  ${lbs.toFixed(2)}lb<br><br>Discount: $5`;

function cloud(
  id: string,
  paidAt: Date,
  totalCents: number,
  person: CloudPerson,
  summaryText: string,
  ingestedAt: Date,
  extra: Partial<CleanCloudOrderRow> = {}
): CleanCloudOrderRow {
  return {
    cleancloudOrderId: id,
    cleancloudCustomerId: person.id,
    sourceReportType: "orders_sales",
    paymentDateUtc: paidAt,
    paidDateUtc: null,
    paid: true,
    totalCents,
    customerName: person.name,
    customerPhone: person.phone,
    customerEmail: null,
    address: person.address,
    buildingSlug: person.building ?? null,
    paymentType: "Card",
    cardPaymentType: "Clearent Saved Card",
    summaryText,
    placedAtUtc: new Date(paidAt.getTime() - 20 * 3600 * 1000),
    createdAt: ingestedAt,
    storeLabel: "Laundry Farm",
    ...extra,
  };
}

const MAY_IMPORT = at("2026-05-15T14:21:27.000Z");
const SEPT4_IMPORT = at("2026-09-04T14:40:25.000Z");
const SEPT11_IMPORT = at("2026-09-11T14:03:12.000Z");

export const businessCleanCloudRows: CleanCloudOrderRow[] = [
  cloud("480", noon("2026-05-10"), 3000, MARIA_LOPEZ, FLUFF(10), MAY_IMPORT, { paymentType: "Cash", cardPaymentType: null }),
  cloud("500", noon("2026-06-01"), 6000, JOHN, FLUFF(24), SEPT4_IMPORT),
  cloud("505", noon("2026-06-15"), 6200, JOHN, FLUFF(25), SEPT4_IMPORT),
  cloud("512", noon("2026-07-01"), 7000, JOHN, FLUFF(28), SEPT4_IMPORT),
  cloud("518", noon("2026-07-15"), 6400, JOHN, FLUFF(26), SEPT4_IMPORT),
  cloud("521", noon("2026-07-20"), 4800, SOPHIE, "Dress Shirt (1) (D) x 4", SEPT4_IMPORT),
  cloud("530", noon("2026-08-01"), 6600, JOHN, FLUFF(26), SEPT4_IMPORT),
  cloud("541", noon("2026-08-18"), 7100, JOHN, FLUFF(28), SEPT4_IMPORT),
  cloud("548", noon("2026-08-25"), 5200, SOPHIE, "Pants (1) (D) x 3", SEPT4_IMPORT),
  cloud("552", noon("2026-08-28"), 3500, MARIA_LOPEZ, FLUFF(10), SEPT4_IMPORT, { paymentType: "Cash", cardPaymentType: null }),
  cloud("562", at("2026-09-04T11:32:00.000Z"), 8310, JOHN, FLUFF(33), SEPT4_IMPORT),
  cloud("562", at("2026-09-04T11:32:00.000Z"), 8310, JOHN, FLUFF(33), SEPT4_IMPORT, {
    sourceReportType: "orders_revenue",
    paymentDateUtc: null,
    paidDateUtc: at("2026-09-04T11:32:00.000Z"),
  }),
  cloud("576", at("2026-09-10T03:53:00.000Z"), 7941, MARIA_CHEN, "Fluff & Fold x 10<br>Dress Shirt (1) (D) x 2", SEPT11_IMPORT),
  cloud("577", at("2026-09-11T02:35:00.000Z"), 5200, SEAN, FLUFF(20), SEPT11_IMPORT),
];

export function businessLoaders(overrides: Partial<LedgerLoaders> = {}): LedgerLoaders {
  return {
    laundry_butler: overrides.laundry_butler ?? (async () => businessNativeRows),
    cleancloud: overrides.cleancloud ?? (async () => businessCleanCloudRows),
  };
}

export const businessCompleteness: DataCompleteness = {
  connected: [
    { source: "Stripe-paid orders", description: "Native Goldline orders with Stripe payment evidence" },
    { source: "CleanCloud import", description: "Paid CleanCloud orders, counted once per order" },
    { source: "Clearent / XplorPay", description: "Card-reader transactions imported (platform-level, reconciliation only)" },
  ],
  missing: ALWAYS_MISSING_SOURCES,
};

export function businessFreshness(options: { attemptsLogged?: boolean; importedToday?: boolean } = {}): DataFreshness {
  const receipts: DataFreshness["gumball"]["receipts"] = [
    { at: "2026-09-11T14:03:12.000Z", status: "imported", inserted: 4, updated: 0, unchanged: 0, rangeFrom: "2026-09-10", rangeTo: "2026-09-10", batchId: 4 },
    { at: "2026-09-07T13:19:24.000Z", status: "cancelled", inserted: null, updated: null, unchanged: null, rangeFrom: null, rangeTo: null, batchId: null },
    { at: "2026-09-04T14:40:25.000Z", status: "imported", inserted: 36, updated: 0, unchanged: 0, rangeFrom: "2026-08-06", rangeTo: "2026-09-04", batchId: 3 },
  ];
  if (options.importedToday) {
    receipts.unshift({ at: "2026-09-15T15:42:00.000Z", status: "imported", inserted: 3, updated: 0, unchanged: 1, rangeFrom: "2026-09-15", rangeTo: "2026-09-15", batchId: 5 });
  }
  return {
    checkedAt: BUSINESS_NOW.toISOString(),
    timeZone: BUSINESS_TZ,
    today: "2026-09-15",
    cleancloud: {
      latestSale: {
        orderNumber: "577",
        customerName: "Sean Cohen",
        cents: 5200,
        paidAt: "2026-09-11T02:35:00.000Z",
        placedAt: "2026-09-10T06:35:00.000Z",
        ingestedAt: "2026-09-11T14:03:12.000Z",
        paymentType: "Card",
        cardPaymentType: "Clearent Saved Card",
      },
      previousSale: {
        orderNumber: "576",
        customerName: "Maria Chen",
        cents: 7941,
        paidAt: "2026-09-10T03:53:00.000Z",
        placedAt: "2026-09-09T07:53:00.000Z",
        ingestedAt: "2026-09-11T14:03:12.000Z",
        paymentType: "Card",
        cardPaymentType: "Clearent Saved Card",
      },
      latestIngestedAt: options.importedToday ? "2026-09-15T15:42:00.000Z" : "2026-09-11T14:03:12.000Z",
      salesToday: options.importedToday ? 3 : 0,
      rowsIngestedToday: options.importedToday ? 4 : 0,
      latestBatch: { id: 4, source: "cleancloud_orders_sales", at: "2026-09-11T14:03:12.000Z", importedRows: 4, duplicateRows: 0, status: "completed" },
    },
    gumball: {
      paired: true,
      storeLabel: "Laundry Farm",
      lastSuccessAt: options.importedToday ? "2026-09-15T15:42:00.000Z" : "2026-09-11T14:03:12.000Z",
      receipts,
      attempts: options.attemptsLogged === false ? null : [],
    },
    native: {
      latestSale: {
        orderNumber: "233",
        customerName: "Spencer Hale",
        cents: 4200,
        paidAt: "2026-09-05T01:34:55.000Z",
        placedAt: null,
        ingestedAt: null,
        paymentType: "Stripe",
        cardPaymentType: null,
      },
    },
    clearent: {
      applicable: true,
      transactionCount: 0,
      dailySummaryFirstDate: "2026-05-01",
      dailySummaryLastDate: "2026-05-14",
      latestImportAt: "2026-05-15T08:48:08.000Z",
    },
  };
}
