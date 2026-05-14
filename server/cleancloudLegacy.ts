import {
  normalizePropertyTower,
  type PropertyGroup,
  type PropertyTowerMatch,
  type TowerKey,
} from "@shared/propertyTowers";
import { and, desc, eq, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { cleancloudImportBatches, cleancloudLegacyOrders, type InsertCleancloudLegacyOrder } from "../drizzle/schema";
import { getDb } from "./db";
import { parseCsv, type CsvRecord, type ExternalImportSummary } from "./externalSystems/csvIngestion";

export const CLEANCLOUD_LEGACY_NOTE =
  "Pre-Laundry Butler checkout order/customer imported from CleanCloud. Not visible in Stripe.";

export type CleanCloudLegacyCustomer = PropertyTowerMatch & {
  source: "cleancloud_legacy";
  paymentProcessor: "cleancloud";
  includedInStripe: false;
  includedInOperationalRevenue: true;
  stripePaymentIntentId: null;
  legacyImportNote: string;
  cleancloudCustomerId: number | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  address: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  totalSpend: number;
  orderCount: number;
  firstOrderDate: string;
  lastOrderDate: string;
  note?: string;
};

type Seed = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  unit?: string;
  city?: string;
  state?: string;
  zip?: string;
  cleancloudCustomerId?: number;
  totalSpend: number;
  orderCount?: number;
  firstOrderDate?: string;
  lastOrderDate?: string;
  propertyGroup?: PropertyGroup;
  towerKey?: TowerKey;
  note?: string;
};

const seeds: Seed[] = [
  {
    name: "Miso Chon",
    unit: "529",
    totalSpend: 29.75,
    orderCount: 2,
    propertyGroup: "opus_la",
    towerKey: "unknown",
    note: "OPUS LA unit 529. Tower unknown until address is confirmed.",
  },
  {
    name: "Forrest Forte",
    email: "Forte.forrest@gmail.com",
    phone: "567543880",
    address: "2160 Century Park East",
    unit: "302",
    city: "Century City",
    state: "CA",
    zip: "90067",
    cleancloudCustomerId: 89,
    totalSpend: 85.1,
    firstOrderDate: "2026-02-10",
    lastOrderDate: "2026-02-10",
  },
  {
    name: "Angie Redpath",
    email: "Ga954@hotmail.com",
    phone: "4243557032",
    address: "2170 Century Park East",
    unit: "1408",
    city: "Century City",
    state: "CA",
    zip: "90067",
    cleancloudCustomerId: 87,
    totalSpend: 20.75,
    firstOrderDate: "2026-02-05",
    lastOrderDate: "2026-02-09",
  },
  {
    name: "George Lee",
    email: "91george.lee@gmail.com",
    phone: "2133278787",
    address: "3545 Wilshire Boulevard",
    unit: "1519",
    city: "Koreatown",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 86,
    totalSpend: 95.25,
    firstOrderDate: "2026-01-28",
    lastOrderDate: "2026-02-12",
  },
  {
    name: "Ben Chon",
    email: "benchon27@gmail.com",
    phone: "8186138800",
    address: "3650 West 6th Street",
    unit: "1210",
    city: "Koreatown",
    state: "CA",
    zip: "90020",
    cleancloudCustomerId: 85,
    totalSpend: 184.5,
    firstOrderDate: "2026-01-28",
    lastOrderDate: "2026-01-30",
  },
  {
    name: "Charles Kwong",
    email: "charleskwong@gmail.com",
    phone: "6266737711",
    address: "3545 Wilshire Boulevard",
    unit: "1917",
    city: "Koreatown",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 81,
    totalSpend: 96.5,
    firstOrderDate: "2026-01-19",
    lastOrderDate: "2026-01-19",
  },
  {
    name: "Raymond Ra",
    email: "ray.kyooyung.ra@gmail.com",
    phone: "2137064733",
    address: "3545 Wilshire Boulevard",
    unit: "1425",
    city: "Koreatown",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 80,
    totalSpend: 46,
    firstOrderDate: "2026-01-18",
    lastOrderDate: "2026-01-18",
  },
  {
    name: "Richard Lee",
    email: "rlee8517@gmail.com",
    phone: "4109348563",
    address: "3545 Wilshire Boulevard",
    unit: "905",
    city: "Los Angeles",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 78,
    totalSpend: 49.6,
    firstOrderDate: "2026-01-12",
    lastOrderDate: "2026-01-12",
  },
  {
    name: "Abe",
    email: "abectunes@gmail.com",
    phone: "5165871292",
    address: "3545 Wilshire Boulevard",
    unit: "PH23",
    city: "Los Angeles",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 77,
    totalSpend: 94.05,
    firstOrderDate: "2026-01-06",
    lastOrderDate: "2026-02-12",
    note: "Deduplicate/link by email and/or phone. Do not create duplicate customer if matched.",
  },
  {
    name: "Joo Lee",
    email: "joo.lee13@yahoo.com",
    phone: "5626775705",
    address: "3545 Wilshire Boulevard",
    unit: "2109",
    city: "Los Angeles",
    state: "CA",
    zip: "90010",
    cleancloudCustomerId: 76,
    totalSpend: 34.43,
    firstOrderDate: "2026-01-05",
    lastOrderDate: "2026-01-05",
  },
];

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts.shift() || "",
    lastName: parts.join(" "),
  };
}

export const cleanCloudLegacyCustomers: CleanCloudLegacyCustomer[] = seeds.map((seed) => {
  const tower = normalizePropertyTower(seed.address, {
    propertyGroup: seed.propertyGroup,
    towerKey: seed.towerKey,
  });
  const name = splitName(seed.name);
  return {
    ...tower,
    source: "cleancloud_legacy",
    paymentProcessor: "cleancloud",
    includedInStripe: false,
    includedInOperationalRevenue: true,
    stripePaymentIntentId: null,
    legacyImportNote: CLEANCLOUD_LEGACY_NOTE,
    cleancloudCustomerId: seed.cleancloudCustomerId ?? null,
    firstName: name.firstName,
    lastName: name.lastName,
    email: seed.email ?? null,
    phone: seed.phone ?? `cleancloud:${seed.name.toLowerCase().replace(/\s+/g, "-")}`,
    address: tower.buildingAddressCanonical ?? seed.address ?? "",
    unit: seed.unit ?? null,
    city: seed.city ?? null,
    state: seed.state ?? null,
    zip: seed.zip ?? null,
    totalSpend: seed.totalSpend,
    orderCount: seed.orderCount ?? 1,
    firstOrderDate: seed.firstOrderDate ?? seed.lastOrderDate ?? "2026-01-01",
    lastOrderDate: seed.lastOrderDate ?? seed.firstOrderDate ?? "2026-01-01",
    note: seed.note,
  };
});

export function cents(amount: number): number {
  return Math.round(amount * 100);
}

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const fieldAliases = {
  cleancloudOrderId: ["Order ID", "Order Id", "OrderID", "CleanCloud Order ID", "ID", "id"],
  customerName: ["Customer", "Customer Name", "Name", "Client", "Client Name"],
  customerEmail: ["Email", "Customer Email", "E-mail"],
  customerPhone: ["Phone", "Customer Phone", "Mobile", "Telephone"],
  orderDate: ["Order Date", "Date", "Created", "Created Date", "Created At", "Pickup Date"],
  completedDate: ["Completed Date", "Completed", "Completed At", "Delivery Date"],
  orderStatus: ["Status", "Order Status"],
  orderTotal: ["Total", "Order Total", "Amount", "Grand Total", "Sales"],
  paymentStatus: ["Payment Status", "Paid Status", "Payment"],
  serviceType: ["Service", "Service Type", "Type"],
  address: ["Address", "Customer Address", "Building Address"],
  buildingName: ["Building", "Building Name", "Property"],
  tower: ["Tower"],
  unit: ["Unit", "Apt", "Apartment", "Suite"],
} as const;

function pick(row: CsvRecord, aliases: readonly string[]): string {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const direct = row[alias];
    if (direct?.trim()) return direct.trim();
    const lower = alias.toLowerCase();
    const found = entries.find(([key]) => key.trim().toLowerCase() === lower)?.[1];
    if (found?.trim()) return found.trim();
  }
  return "";
}

function parseMoneyCents(value: string): number {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function parsePacificDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const datePartOnly = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed);
  const local = datePartOnly ? `${trimmed} 12:00:00` : trimmed;
  const utc = fromZonedTime(local, PACIFIC_TIME_ZONE);
  return Number.isNaN(utc.getTime()) ? null : utc;
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits || null;
}

function splitLegacyName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "CleanCloud",
    lastName: parts.join(" ") || "Customer",
  };
}

function normalizeCleanCloudCsvRow(row: CsvRecord, sourceFileName: string, importBatchId: number) {
  const customerName = pick(row, fieldAliases.customerName);
  const orderDateUtc = parsePacificDate(pick(row, fieldAliases.orderDate));
  const completedDateUtc = parsePacificDate(pick(row, fieldAliases.completedDate));
  const address = pick(row, fieldAliases.address);
  const explicitBuilding = pick(row, fieldAliases.buildingName);
  const explicitTower = pick(row, fieldAliases.tower);
  const tower = normalizePropertyTower(address || explicitBuilding, {
    propertyGroup: explicitBuilding.toLowerCase().includes("opus")
      ? "opus_la"
      : explicitBuilding.toLowerCase().includes("century park")
        ? "century_park_east"
        : undefined,
  });
  const needsBuildingResolution = tower.propertyGroup === "unknown" || tower.towerKey === "unknown";

  if (!customerName) throw new Error("Missing customer name");
  if (!orderDateUtc) throw new Error("Missing or invalid order date");

  const cleancloudOrderId = pick(row, fieldAliases.cleancloudOrderId) || null;
  const orderTotalCents = parseMoneyCents(pick(row, fieldAliases.orderTotal));

  const normalized: InsertCleancloudLegacyOrder = {
    cleancloudOrderId,
    sourceFileName,
    importBatchId,
    customerName,
    customerEmail: pick(row, fieldAliases.customerEmail) || null,
    customerPhone: normalizePhone(pick(row, fieldAliases.customerPhone)),
    orderDateUtc,
    completedDateUtc,
    orderStatus: pick(row, fieldAliases.orderStatus) || "unknown",
    orderTotalCents,
    paymentStatus: pick(row, fieldAliases.paymentStatus) || "unknown",
    serviceType: pick(row, fieldAliases.serviceType) || "unknown",
    buildingName: tower.propertyGroup === "unknown" ? null : tower.propertyDisplayName,
    tower: tower.towerKey === "unknown" ? null : tower.towerDisplayName,
    unit: pick(row, fieldAliases.unit) || null,
    rawJson: {
      source: "cleancloud",
      sourceFileName,
      originalRow: row,
      normalizedAt: new Date().toISOString(),
      timezone: PACIFIC_TIME_ZONE,
      needsBuildingResolution,
      propertyGroup: tower.propertyGroup,
      towerKey: tower.towerKey,
      buildingAddressCanonical: tower.buildingAddressCanonical,
    },
  };

  return { normalized, needsBuildingResolution };
}

function fallbackDedupeKey(row: Pick<InsertCleancloudLegacyOrder, "customerName" | "orderDateUtc" | "orderTotalCents">): string {
  return [
    row.customerName.trim().toLowerCase(),
    row.orderDateUtc instanceof Date ? row.orderDateUtc.toISOString() : new Date(row.orderDateUtc).toISOString(),
    String(row.orderTotalCents),
  ].join("|");
}

async function cleanCloudOrderExists(row: InsertCleancloudLegacyOrder): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  if (row.cleancloudOrderId) {
    const existing = await db
      .select({ id: cleancloudLegacyOrders.id })
      .from(cleancloudLegacyOrders)
      .where(eq(cleancloudLegacyOrders.cleancloudOrderId, row.cleancloudOrderId))
      .limit(1);
    if (existing.length > 0) return true;
  }

  const existing = await db
    .select({ id: cleancloudLegacyOrders.id })
    .from(cleancloudLegacyOrders)
    .where(
      and(
        sql`LOWER(${cleancloudLegacyOrders.customerName}) = ${row.customerName.trim().toLowerCase()}`,
        eq(cleancloudLegacyOrders.orderDateUtc, row.orderDateUtc as Date),
        eq(cleancloudLegacyOrders.orderTotalCents, row.orderTotalCents ?? 0)
      )
    )
    .limit(1);
  return existing.length > 0;
}

export async function importCleanCloudLegacyOrders(input: {
  csvText: string;
  sourceFileName?: string | null;
}): Promise<ExternalImportSummary> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database is not configured");
  }

  const sourceFileName = input.sourceFileName?.trim() || `cleancloud-import-${new Date().toISOString()}.csv`;
  const errors: ExternalImportSummary["errors"] = [];
  const parsedRows = parseCsv(input.csvText);

  const [batch] = await db
    .insert(cleancloudImportBatches)
    .values({
      source: "cleancloud",
      sourceFileName,
      importedRowCount: 0,
      skippedRowCount: 0,
      duplicateRowCount: 0,
      importStatus: "completed",
      errorJson: null,
    })
    .$returningId();

  const importBatchId = batch.id;
  let importedRowCount = 0;
  let skippedRowCount = 0;
  let duplicateRowCount = 0;
  let unresolvedBuildingCount = 0;
  const seen = new Set<string>();

  for (let i = 0; i < parsedRows.length; i++) {
    try {
      const { normalized, needsBuildingResolution } = normalizeCleanCloudCsvRow(parsedRows[i], sourceFileName, importBatchId);
      const key = normalized.cleancloudOrderId
        ? `id:${normalized.cleancloudOrderId}`
        : `fallback:${fallbackDedupeKey(normalized)}`;

      if (seen.has(key) || await cleanCloudOrderExists(normalized)) {
        skippedRowCount += 1;
        duplicateRowCount += 1;
        continue;
      }
      seen.add(key);

      await db.insert(cleancloudLegacyOrders).values(normalized);
      importedRowCount += 1;
      if (needsBuildingResolution) unresolvedBuildingCount += 1;
    } catch (error) {
      skippedRowCount += 1;
      errors.push({
        rowNumber: i + 2,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const importStatus = errors.length > 0 ? "completed_with_errors" : "completed";
  await db
    .update(cleancloudImportBatches)
    .set({
      importedRowCount,
      skippedRowCount,
      duplicateRowCount,
      importStatus,
      errorJson: errors.length > 0 ? errors : null,
    })
    .where(eq(cleancloudImportBatches.id, importBatchId));

  return {
    source: "cleancloud",
    sourceFileName,
    importBatchId,
    parsedRowCount: parsedRows.length,
    importedRowCount,
    skippedRowCount,
    duplicateRowCount,
    unresolvedBuildingCount,
    importStatus,
    errors,
  };
}

export async function listImportedCleanCloudLegacyCustomers(): Promise<CleanCloudLegacyCustomer[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(cleancloudLegacyOrders)
    .orderBy(desc(cleancloudLegacyOrders.orderDateUtc), desc(cleancloudLegacyOrders.id));
  const grouped = new Map<string, typeof rows>();

  for (const row of rows) {
    const phone = row.customerPhone?.replace(/\D/g, "") ?? "";
    const email = row.customerEmail?.trim().toLowerCase() ?? "";
    const key =
      phone.length >= 7
        ? `phone:${phone}`
        : email
          ? `email:${email}`
          : `customer:${row.customerName.trim().toLowerCase()}|${row.unit ?? ""}|${row.buildingName ?? ""}`;
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }

  return Array.from(grouped.values()).map((group) => {
    const latest = group[0];
    const first = group[group.length - 1];
    const name = splitLegacyName(latest.customerName);
    const raw = latest.rawJson as any;
    const tower = normalizePropertyTower(raw?.buildingAddressCanonical ?? latest.buildingName, {
      propertyGroup: raw?.propertyGroup,
      towerKey: raw?.towerKey,
    });
    const totalSpend = centsToDollars(group.reduce((sum, row) => sum + row.orderTotalCents, 0));
    return {
      ...tower,
      source: "cleancloud_legacy",
      paymentProcessor: "cleancloud",
      includedInStripe: false,
      includedInOperationalRevenue: true,
      stripePaymentIntentId: null,
      legacyImportNote: CLEANCLOUD_LEGACY_NOTE,
      cleancloudCustomerId: null,
      firstName: name.firstName,
      lastName: name.lastName,
      email: latest.customerEmail,
      phone: latest.customerPhone ?? `cleancloud:${latest.customerName.toLowerCase().replace(/\s+/g, "-")}`,
      address: tower.buildingAddressCanonical ?? latest.buildingName ?? "",
      unit: latest.unit,
      city: null,
      state: null,
      zip: null,
      totalSpend,
      orderCount: group.length,
      firstOrderDate: first.orderDateUtc.toISOString().slice(0, 10),
      lastOrderDate: latest.orderDateUtc.toISOString().slice(0, 10),
      note: raw?.needsBuildingResolution ? "Needs building resolution" : undefined,
    };
  });
}

function centsToDollars(value: number): number {
  return Math.round(value) / 100;
}
