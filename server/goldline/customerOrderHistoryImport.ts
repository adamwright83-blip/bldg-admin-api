import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { and, eq } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  getGeographicTruth,
  normalizeSourceAddress,
  selectAuthoritativeCustomerOrder,
  syncGeographicEntities,
  geocodePendingLocations,
} from "../geography/geographicTruthService";
import {
  inferCustomerCadence,
  projectLatLngToLanternAtlas,
  type LanternState,
} from "../../shared/lanternCity";
import { computeRecencyStatus } from "../../shared/customerStatus";
import { getDashboardTimeZone, zonedYmd } from "../dashboardZoned";
import { customerIdentityHash } from "../customerAssets/customerIdentity";
import { CANONICAL_BUILDING_GEOGRAPHY } from "../../shared/canonicalGeography";
import { classifyTerritory } from "../../shared/lanternTerritories";
import { ENV } from "../_core/env";

export const EXPECTED_WORKBOOK_CUSTOMERS = 82;
export const EXPECTED_WORKBOOK_ORDER_DATES = 482;
export const WORKBOOK_SHEET_NAME = "customer_order_import";

const IMPORT_SOURCE = "goldline_customer_order_history";
const IDEMPOTENCY_PREFIX = "goldline:cadence:";

export type WorkbookCustomerRow = {
  customer_id: string;
  customer_name: string;
  phone: string;
  email: string;
  address: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  joined_date: string;
  last_order_date: string;
  order_count: string;
  order_dates: string;
};

export type ParsedWorkbookRow = WorkbookCustomerRow & {
  parsedOrderDates: string[];
  discrepancies: string[];
};

export type WorkbookValidation = {
  rowCount: number;
  totalOrderDates: number;
  blankAddressCount: number;
  westwoodOnlyCount: number;
  valid: boolean;
  errors: string[];
};

export type ImportLedgerRow = {
  customer_id: string;
  source_address: string;
  source_unit: string;
  parsed_historical_date_count: number;
  canonical_cadence_state: LanternState | "unknown";
  normalized_building_address: string | null;
  geographic_status: "on-atlas" | "off-atlas" | "unresolved";
  lat: number | null;
  lng: number | null;
  atlas_x: number | null;
  atlas_y: number | null;
  territory_id: string | null;
  cluster_key: string | null;
  cluster_member_count: number | null;
  render_mode:
    | "standalone-lantern"
    | "tower-attached-lantern"
    | "unresolved"
    | "off-atlas";
  reason_if_not_rendered: string | null;
  import_discrepancies: string[];
  orders_inserted: number;
  orders_skipped_existing: number;
};

export type ImportCustomerOrderHistoryResult = {
  dryRun: boolean;
  validation: WorkbookValidation;
  customersProcessed: number;
  ordersInserted: number;
  ordersSkippedExisting: number;
  totalSourceOrderDates: number;
  discrepancies: string[];
  ledger: ImportLedgerRow[];
};

function normalizedCell(value: unknown): string {
  return String(value ?? "").trim();
}

export function parseCustomerOrderWorkbookBuffer(buffer: Buffer): WorkbookCustomerRow[] {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[WORKBOOK_SHEET_NAME];
  if (!sheet) {
    throw new Error(
      `Workbook is missing required sheet "${WORKBOOK_SHEET_NAME}". Found: ${workbook.SheetNames.join(", ")}`
    );
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  return rows.map(row => ({
    customer_id: normalizedCell(row.customer_id),
    customer_name: normalizedCell(row.customer_name),
    phone: normalizedCell(row.phone),
    email: normalizedCell(row.email),
    address: normalizedCell(row.address),
    unit: normalizedCell(row.unit),
    city: normalizedCell(row.city),
    state: normalizedCell(row.state),
    zip: normalizedCell(row.zip),
    joined_date: normalizedCell(row.joined_date),
    last_order_date: normalizedCell(row.last_order_date),
    order_count: normalizedCell(row.order_count),
    order_dates: normalizedCell(row.order_dates),
  }));
}

export function parseCustomerOrderWorkbookFile(path: string): WorkbookCustomerRow[] {
  return parseCustomerOrderWorkbookBuffer(readFileSync(path));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseWorkbookOrderDates(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("order_dates must be a JSON array");
  }
  const dates = parsed.map(item => normalizedCell(item));
  for (const date of dates) {
    if (!isIsoDate(date)) {
      throw new Error(`Invalid ISO date in order_dates: ${date}`);
    }
  }
  return Array.from(new Set(dates)).sort();
}

export function enrichWorkbookRow(row: WorkbookCustomerRow): ParsedWorkbookRow {
  const parsedOrderDates = parseWorkbookOrderDates(row.order_dates);
  const discrepancies: string[] = [];
  const declaredCount = Number(row.order_count);
  if (Number.isFinite(declaredCount) && declaredCount !== parsedOrderDates.length) {
    discrepancies.push(
      `order_count ${declaredCount} != parsed history ${parsedOrderDates.length}`
    );
  }
  const newest = parsedOrderDates.at(-1);
  if (row.last_order_date && newest && row.last_order_date !== newest) {
    discrepancies.push(
      `last_order_date ${row.last_order_date} != newest history ${newest}`
    );
  }
  return { ...row, parsedOrderDates, discrepancies };
}

export function validateCustomerOrderWorkbook(rows: WorkbookCustomerRow[]): WorkbookValidation {
  const errors: string[] = [];
  let totalOrderDates = 0;
  let blankAddressCount = 0;
  let westwoodOnlyCount = 0;
  for (const row of rows) {
    try {
      totalOrderDates += parseWorkbookOrderDates(row.order_dates).length;
    } catch (error) {
      errors.push(
        `customer_id ${row.customer_id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!row.address.trim()) blankAddressCount += 1;
    if (row.address.trim().toLowerCase() === "westwood") westwoodOnlyCount += 1;
  }
  if (rows.length !== EXPECTED_WORKBOOK_CUSTOMERS) {
    errors.push(
      `Expected ${EXPECTED_WORKBOOK_CUSTOMERS} customer rows, got ${rows.length}`
    );
  }
  if (totalOrderDates !== EXPECTED_WORKBOOK_ORDER_DATES) {
    errors.push(
      `Expected ${EXPECTED_WORKBOOK_ORDER_DATES} historical order dates, got ${totalOrderDates}`
    );
  }
  return {
    rowCount: rows.length,
    totalOrderDates,
    blankAddressCount,
    westwoodOnlyCount,
    valid: errors.length === 0,
    errors,
  };
}

export function isCoarseImportAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) return true;
  if (/^westwood$/i.test(trimmed)) return true;
  return !/\d/.test(trimmed);
}

export function buildWorkbookStreetAddress(row: WorkbookCustomerRow): string {
  const street = row.address.trim();
  if (!street) return "";
  const city = row.city.trim();
  const state = row.state.trim() || "CA";
  const zip = row.zip.trim();
  const locality = [city, state, zip].filter(Boolean).join(" ");
  return locality ? `${street}, ${locality}` : street;
}

function splitCustomerName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "Customer", lastName: "Unknown" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function cadenceEvidenceKey(customerId: string, date: string) {
  return `${IDEMPOTENCY_PREFIX}${customerId}:${date}`;
}

type HeldImportMetadata = {
  cleancloudCustomerId: string;
  importSource: typeof IMPORT_SOURCE;
  cadenceEvidenceOnly: true;
  joinedDate?: string;
};

function readImportMetadata(
  value: unknown
): HeldImportMetadata | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as Record<string, unknown>;
  if (meta.importSource !== IMPORT_SOURCE) return null;
  if (typeof meta.cleancloudCustomerId !== "string") return null;
  return {
    cleancloudCustomerId: meta.cleancloudCustomerId,
    importSource: IMPORT_SOURCE,
    cadenceEvidenceOnly: true,
    joinedDate:
      typeof meta.joinedDate === "string" ? meta.joinedDate : undefined,
  };
}

function sparseFallbackFromDates(dates: string[], today: string): LanternState {
  if (dates.length === 0) return "dark";
  const sorted = [...dates].sort();
  const recency = computeRecencyStatus({
    totalOrders: sorted.length,
    firstOrderAt: new Date(`${sorted[0]}T12:00:00.000Z`),
    lastOrderAt: new Date(`${sorted.at(-1)!}T12:00:00.000Z`),
  });
  if (recency === "lapsed") return "dark";
  if (recency === "cooling") return "dimming";
  return "active";
}

function resolveImportAddress(input: {
  row: ParsedWorkbookRow;
  existingOrders: Array<typeof orders.$inferSelect>;
}): { address: string | null; unit: string | null; reason: string | null } {
  const workbookAddress = buildWorkbookStreetAddress(input.row);
  const existingForCustomer = input.existingOrders.filter(order => {
    const meta = readImportMetadata(order.heldMetadataJson);
    return meta?.cleancloudCustomerId === input.row.customer_id;
  });
  const existingByPhone = input.row.phone
    ? input.existingOrders.filter(
        order =>
          order.phone.replace(/\D/g, "") === input.row.phone.replace(/\D/g, "")
      )
    : [];
  const existingPool = [...existingForCustomer, ...existingByPhone];
  const authoritative =
    existingPool.length > 0
      ? selectAuthoritativeCustomerOrder(existingPool)
      : null;

  if (isCoarseImportAddress(workbookAddress)) {
    if (authoritative && !isCoarseImportAddress(authoritative.address)) {
      return {
        address: authoritative.address,
        unit: authoritative.unit ?? (input.row.unit.trim() || null),
        reason: null,
      };
    }
    return {
      address: null,
      unit: null,
      reason: isCoarseImportAddress(input.row.address.trim())
        ? input.row.address.trim().toLowerCase() === "westwood"
          ? "coarse Westwood-only address with no verified precise location"
          : "blank or unusable source address"
        : "address lacks street number",
    };
  }

  if (authoritative && !isCoarseImportAddress(authoritative.address)) {
    return {
      address: authoritative.address,
      unit: authoritative.unit ?? (input.row.unit.trim() || null),
      reason: null,
    };
  }

  return {
    address: workbookAddress,
    unit: input.row.unit.trim() || null,
    reason: null,
  };
}

async function loadTenantOrders(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(orders).where(eq(orders.tenantId, tenantId));
}

export async function importCustomerOrderHistory(input: {
  tenantId: string;
  rows: WorkbookCustomerRow[];
  dryRun?: boolean;
  now?: Date;
}): Promise<ImportCustomerOrderHistoryResult> {
  const validation = validateCustomerOrderWorkbook(input.rows);
  if (!validation.valid) {
    throw new Error(`Workbook validation failed:\n${validation.errors.join("\n")}`);
  }

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const dryRun = input.dryRun === true;
  const now = input.now ?? new Date();
  const timeZone = getDashboardTimeZone();
  const today = zonedYmd(now, timeZone);
  const existingOrders = await loadTenantOrders(input.tenantId);

  let ordersInserted = 0;
  let ordersSkippedExisting = 0;
  const ledger: ImportLedgerRow[] = [];
  const discrepancies: string[] = [];

  for (const rawRow of input.rows) {
    const row = enrichWorkbookRow(rawRow);
    discrepancies.push(...row.discrepancies.map(d => `${row.customer_id}: ${d}`));
    const resolved = resolveImportAddress({ row, existingOrders });
    const { firstName, lastName } = splitCustomerName(row.customer_name);

    let insertedForCustomer = 0;
    let skippedForCustomer = 0;

    if (resolved.address) {
      for (const date of row.parsedOrderDates) {
        const residentClientRequestId = cadenceEvidenceKey(row.customer_id, date);
        const already = existingOrders.some(
          order => order.residentClientRequestId === residentClientRequestId
        );
        if (already) {
          skippedForCustomer += 1;
          ordersSkippedExisting += 1;
          continue;
        }
        if (!dryRun) {
          const createdAt = new Date(`${date}T20:00:00.000Z`);
          await db.insert(orders).values({
            tenantId: input.tenantId,
            firstName,
            lastName,
            phone: row.phone || "0000000000",
            email: row.email || null,
            address: resolved.address,
            unit: resolved.unit,
            serviceType: "wash_fold",
            pickupDate: date,
            pickupTimeWindow: "9:00-11:00",
            deliveryDate: date,
            status: "delivered",
            paid: false,
            total: "0",
            residentClientRequestId,
            heldMetadataJson: {
              cleancloudCustomerId: row.customer_id,
              importSource: IMPORT_SOURCE,
              cadenceEvidenceOnly: true,
              joinedDate: row.joined_date || undefined,
            } satisfies HeldImportMetadata,
            specialInstructions: `${IMPORT_SOURCE}:${row.customer_id}:${date}`,
            createdAt,
            updatedAt: createdAt,
          } as never);
        }
        insertedForCustomer += 1;
        ordersInserted += 1;
      }
    }

    const cadenceState =
      row.parsedOrderDates.length > 0
        ? inferCustomerCadence({
            qualifyingOrderDates: row.parsedOrderDates,
            today,
            sparseFallback: sparseFallbackFromDates(row.parsedOrderDates, today),
          }).state
        : "unknown";

    ledger.push({
      customer_id: row.customer_id,
      source_address: row.address,
      source_unit: row.unit,
      parsed_historical_date_count: row.parsedOrderDates.length,
      canonical_cadence_state: cadenceState,
      normalized_building_address: resolved.address
        ? normalizeSourceAddress(resolved.address)
        : null,
      geographic_status: "unresolved",
      lat: null,
      lng: null,
      atlas_x: null,
      atlas_y: null,
      territory_id: null,
      cluster_key: null,
      cluster_member_count: null,
      render_mode: "unresolved",
      reason_if_not_rendered: resolved.reason,
      import_discrepancies: row.discrepancies,
      orders_inserted: insertedForCustomer,
      orders_skipped_existing: skippedForCustomer,
    });
  }

  if (!dryRun && ordersInserted > 0) {
    await syncGeographicEntities(input.tenantId);
    const providerConfigured = Boolean(
      ENV.googleAddressValidationApiKey ||
        ENV.googleGeocodingApiKey ||
        ENV.googlePlacesApiKey
    );
    if (providerConfigured) {
      await geocodePendingLocations({ tenantId: input.tenantId, batchSize: 50 });
    }
  }

  const atlas = dryRun
    ? null
    : await getGeographicTruth({ tenantId: input.tenantId, now });
  if (atlas) {
    const refreshedOrders = await loadTenantOrders(input.tenantId);
    const customerIdToIdentity = new Map<string, string>();
    for (const order of refreshedOrders) {
      const meta = readImportMetadata(order.heldMetadataJson);
      if (!meta) continue;
      customerIdToIdentity.set(
        meta.cleancloudCustomerId,
        customerIdentityHash(input.tenantId, order)
      );
    }

    type Cluster = {
      key: string;
      total: number;
      x: number;
      y: number;
      members: string[];
    };
    const clusterByIdentity = new Map<string, Cluster>();
    const groups = new Map<string, typeof atlas.customers>();
    for (const customer of atlas.customers) {
      if (!customer.location) continue;
      const address = customer.location.canonicalAddress
        ?.toLowerCase()
        .replace(/(?:\b(?:apartment|apt|unit|suite|ste|floor|fl)\.?\s*|#\s*)[a-z0-9-]+\b/g, "")
        .replace(/(\b\d{5})-\d{4}\b/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
      const key = address
        ? `address:${address}`
        : `coord:${customer.location.latitude.toFixed(5)},${customer.location.longitude.toFixed(5)}`;
      groups.set(key, [...(groups.get(key) ?? []), customer]);
    }
    for (const [key, members] of Array.from(groups.entries())) {
      const anchor = members[0]!.location!;
      const cluster: Cluster = {
        key,
        total: members.length,
        x: anchor.x,
        y: anchor.y,
        members: members.map(member => member.identityKey),
      };
      for (const member of members) clusterByIdentity.set(member.identityKey, cluster);
    }

    const towerPoints = Object.values(CANONICAL_BUILDING_GEOGRAPHY).map(building =>
      projectLatLngToLanternAtlas(building)
    );
    const pursuitPoints = atlas.pursued
      .filter(item => item.location)
      .map(item => item.location!);

    for (const entry of ledger) {
      const identityKey = customerIdToIdentity.get(entry.customer_id);
      const customer =
        identityKey != null
          ? atlas.customers.find(item => item.identityKey === identityKey)
          : atlas.customers.find(
              item =>
                item.phone.replace(/\D/g, "") ===
                (input.rows.find(row => row.customer_id === entry.customer_id)?.phone.replace(/\D/g, "") ??
                  "")
            );
      if (!customer) continue;

      entry.canonical_cadence_state = customer.cadence.state;
      if (!customer.location) {
        entry.geographic_status = "unresolved";
        entry.render_mode = "unresolved";
        entry.reason_if_not_rendered =
          entry.reason_if_not_rendered ?? customer.geocodeStatus;
        continue;
      }
      entry.lat = customer.location.latitude;
      entry.lng = customer.location.longitude;
      entry.atlas_x = customer.location.x;
      entry.atlas_y = customer.location.y;
      entry.geographic_status = customer.location.outOfBounds
        ? "off-atlas"
        : "on-atlas";
      const territory = classifyTerritory(
        customer.location.latitude,
        customer.location.longitude
      );
      entry.territory_id = territory?.id ?? null;
      const cluster = clusterByIdentity.get(customer.identityKey) ?? null;
      entry.cluster_key = cluster?.key ?? null;
      entry.cluster_member_count = cluster?.total ?? null;
      if (customer.location.outOfBounds) {
        entry.render_mode = "off-atlas";
        entry.reason_if_not_rendered =
          "legitimate coordinates outside production atlas bounds";
        continue;
      }
      const coveredByTower = [...towerPoints, ...pursuitPoints].some(point =>
        Math.abs(point.x - customer.location!.x) < 1.2 &&
        Math.abs(point.y - customer.location!.y) < 1.2
      );
      entry.render_mode = coveredByTower
        ? "tower-attached-lantern"
        : "standalone-lantern";
      entry.reason_if_not_rendered = null;
    }
  }

  return {
    dryRun,
    validation,
    customersProcessed: input.rows.length,
    ordersInserted,
    ordersSkippedExisting,
    totalSourceOrderDates: validation.totalOrderDates,
    discrepancies,
    ledger,
  };
}
