import { normalizePropertyTower } from "@shared/propertyTowers";
import { and, eq } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import {
  cleancloudImportBatches,
  cleancloudPaidOrders,
  type CleancloudPaidOrder,
  type InsertCleancloudPaidOrder,
} from "../drizzle/schema";
import { getDb } from "./db";
import { parseCsv, type CsvRecord } from "./externalSystems/csvIngestion";

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

export type CleanCloudPaidReportType = "orders_sales" | "orders_revenue";

export const CLEANCLOUD_DATA_EXPORT_PLAYBOOK_NOTES = [
  "Go to cleancloudapp.com/store.",
  "Open Metrics, then Data Export in the left sidebar.",
  "Select Orders (Sales) and Orders (Revenue) for paid-order reconciliation exports.",
  "Use the date-range picker or presets, confirm 1 store selected, then click Export.",
  "Do not use Invoices or Invoice Payments for normal order reconciliation; those cover subscription/monthly-plan customers.",
  "Future Playwright automation should read Export History for the newest matching report title/date range after export.",
] as const;

export type CleanCloudPaidOrderImportSummary = {
  source: "cleancloud_paid_orders";
  sourceFileName: string;
  sourceReportType: CleanCloudPaidReportType;
  importBatchId: number | null;
  parsedRowCount: number;
  importedRowCount: number;
  updatedRowCount: number;
  skippedRowCount: number;
  candidateClearentRowCount: number;
  unresolvedBuildingCount: number;
  importStatus: "completed" | "completed_with_errors" | "failed";
  errors: Array<{ rowNumber?: number; message: string; rawRowPreview?: string }>;
};

const monthByName: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function pick(row: CsvRecord, aliases: string[]): string {
  const exact = aliases.find((alias) => row[alias] != null);
  if (exact) return row[exact] ?? "";
  const normalized = new Map(Object.keys(row).map((key) => [normalizeHeader(key), key]));
  for (const alias of aliases) {
    const key = normalized.get(normalizeHeader(alias));
    if (key) return row[key] ?? "";
  }
  return "";
}

export function parseCleanCloudPaidReportType(value: unknown): CleanCloudPaidReportType {
  const normalized = String(value ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "orders_revenue" || normalized === "revenue") return "orders_revenue";
  return "orders_sales";
}

export function parseCleanCloudMoneyCents(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[,$\s()]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) * (negative ? -1 : 1);
}

function parseCleanCloudBool(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "paid";
}

export function parseCleanCloudPacificDate(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const nameMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (nameMatch) {
    const [, dayRaw, monthRaw, yearRaw, hourRaw = "0", minuteRaw = "0", secondRaw = "0"] = nameMatch;
    const month = monthByName[monthRaw.toLowerCase()];
    if (!month) return null;
    const localIso = `${yearRaw}-${String(month).padStart(2, "0")}-${String(Number(dayRaw)).padStart(2, "0")}T${String(Number(hourRaw)).padStart(2, "0")}:${String(Number(minuteRaw)).padStart(2, "0")}:${String(Number(secondRaw)).padStart(2, "0")}`;
    return fromZonedTime(localIso, PACIFIC_TIME_ZONE);
  }

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?)?$/i);
  if (slashMatch) {
    const [, monthRaw, dayRaw, yearRaw, hourRaw = "0", minuteRaw = "0", meridiemRaw] = slashMatch;
    let hour = Number(hourRaw);
    const meridiem = meridiemRaw?.toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const localIso = `${yearRaw}-${String(Number(monthRaw)).padStart(2, "0")}-${String(Number(dayRaw)).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${minuteRaw}:00`;
    return fromZonedTime(localIso, PACIFIC_TIME_ZONE);
  }

  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (isoDate) {
    const [, year, month, day, hour = "0", minute = "0", second = "0"] = isoDate;
    return fromZonedTime(`${year}-${month}-${day}T${hour}:${minute}:${second}`, PACIFIC_TIME_ZONE);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits || null;
}

function isClearentCandidate(row: Pick<InsertCleancloudPaidOrder, "paid" | "paymentType" | "cardPaymentType">): boolean {
  return Boolean(
    row.paid &&
      String(row.paymentType ?? "").toLowerCase() === "card" &&
      String(row.cardPaymentType ?? "").toLowerCase().includes("clearent")
  );
}

function inferLocation(address: string | null, unit: string | null) {
  const tower = normalizePropertyTower(address);
  if (tower.propertyGroup !== "unknown") {
    return {
      buildingName: tower.propertyDisplayName,
      buildingSlug: tower.propertyGroup === "opus_la" ? "opusla" : "centuryparkeast",
      tower: tower.towerDisplayName === "Unknown Tower" ? null : tower.towerDisplayName,
      unit,
      buildingResolutionStatus: tower.towerKey === "unknown" ? "unresolved_needs_mapping" : "resolved",
    } as const;
  }

  return {
    buildingName: null,
    buildingSlug: null,
    tower: null,
    unit,
    buildingResolutionStatus: address ? "unresolved_needs_mapping" : "not_applicable",
  } as const;
}

export function normalizeCleanCloudPaidOrderRow(
  row: CsvRecord,
  input: {
    sourceReportType: CleanCloudPaidReportType;
    sourceFileName: string;
    importBatchId: number;
    tenantId?: string;
  }
): { normalized: InsertCleancloudPaidOrder | null; error?: string; candidateForClearent: boolean } {
  const cleancloudOrderId = pick(row, ["Order ID", "Order Id", "OrderID"]).trim();
  if (!cleancloudOrderId) {
    return { normalized: null, error: "Missing Order ID", candidateForClearent: false };
  }

  const customerName = pick(row, ["Customer", "Customer Name"]).trim();
  if (!customerName) {
    return { normalized: null, error: "Missing Customer", candidateForClearent: false };
  }

  const address = pick(row, ["Address"]).trim() || null;
  const unitMatch = address?.match(/\b(?:apt|apartment|unit|suite|#)\s*#?([A-Za-z0-9-]+)/i);
  const unit = unitMatch?.[1] ?? null;
  const location = inferLocation(address, unit);
  const totalCents =
    input.sourceReportType === "orders_sales"
      ? parseCleanCloudMoneyCents(pick(row, ["Total after Credit Used"])) ?? parseCleanCloudMoneyCents(pick(row, ["Total"])) ?? 0
      : parseCleanCloudMoneyCents(pick(row, ["Total"])) ?? 0;

  const normalized: InsertCleancloudPaidOrder = {
    tenantId: input.tenantId ?? "default",
    sourceReportType: input.sourceReportType,
    sourceFileName: input.sourceFileName,
    importBatchId: input.importBatchId,
    cleancloudOrderId,
    cleancloudCustomerId: pick(row, ["Customer ID", "Customer Id"]).trim() || null,
    customerName,
    customerEmail: pick(row, ["Email"]).trim() || null,
    customerPhone: normalizePhone(pick(row, ["Phone"])),
    address,
    placedAtUtc: parseCleanCloudPacificDate(pick(row, ["Placed"])),
    paymentDateUtc: input.sourceReportType === "orders_sales" ? parseCleanCloudPacificDate(pick(row, ["Payment Date"])) : null,
    paidDateUtc: input.sourceReportType === "orders_revenue" ? parseCleanCloudPacificDate(pick(row, ["Paid Date"])) : null,
    readyByDateUtc: parseCleanCloudPacificDate(pick(row, ["Ready By"])),
    collectedAtUtc: parseCleanCloudPacificDate(pick(row, ["Collected"])),
    cleanedAtUtc: parseCleanCloudPacificDate(pick(row, ["Cleaned"])),
    orderStatus: pick(row, ["Status"]).trim() || null,
    paid: parseCleanCloudBool(pick(row, ["Paid"])),
    paymentType: pick(row, ["Payment Type"]).trim() || null,
    cardPaymentType: pick(row, ["Card Payment Type"]).trim() || null,
    totalCents,
    subtotalCents: parseCleanCloudMoneyCents(pick(row, ["Subtotal"])),
    discountCents: parseCleanCloudMoneyCents(pick(row, ["Discount"])),
    creditCents: parseCleanCloudMoneyCents(pick(row, ["Credit"])),
    totalWeightLbs: pick(row, ["Total weight", "Total Weight"]).trim() || null,
    summaryText: pick(row, ["Summary"]).trim() || null,
    buildingName: location.buildingName,
    buildingSlug: location.buildingSlug,
    tower: location.tower,
    unit: location.unit,
    buildingResolutionStatus: location.buildingResolutionStatus,
    rawJson: row,
  };

  return { normalized, candidateForClearent: isClearentCandidate(normalized) };
}

export function sumCleanCloudClearentCandidates(rows: Array<Pick<CleancloudPaidOrder, "paid" | "paymentType" | "cardPaymentType" | "totalCents">>): number {
  return rows.filter(isClearentCandidate).reduce((sum, row) => sum + row.totalCents, 0);
}

export async function importCleanCloudPaidOrders(input: {
  csvText: string;
  sourceFileName?: string;
  sourceReportType: CleanCloudPaidReportType;
  tenantId?: string;
}): Promise<CleanCloudPaidOrderImportSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const sourceFileName = input.sourceFileName?.trim() || `cleancloud-${input.sourceReportType}.csv`;
  const rows = parseCsv(input.csvText);
  const [batch] = await db
    .insert(cleancloudImportBatches)
    .values({
      source: `cleancloud_${input.sourceReportType}`,
      sourceFileName,
      importedRowCount: 0,
      skippedRowCount: 0,
      duplicateRowCount: 0,
      importStatus: "completed",
    })
    .$returningId();

  const importBatchId = batch?.id ?? 0;
  let importedRowCount = 0;
  let updatedRowCount = 0;
  let skippedRowCount = 0;
  let candidateClearentRowCount = 0;
  let unresolvedBuildingCount = 0;
  const errors: CleanCloudPaidOrderImportSummary["errors"] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const normalized = normalizeCleanCloudPaidOrderRow(row, {
      sourceReportType: input.sourceReportType,
      sourceFileName,
      importBatchId,
      tenantId: input.tenantId,
    });

    if (!normalized.normalized) {
      skippedRowCount += 1;
      errors.push({ rowNumber: index + 2, message: normalized.error ?? "Skipped row", rawRowPreview: JSON.stringify(row).slice(0, 500) });
      continue;
    }

    if (normalized.candidateForClearent) candidateClearentRowCount += 1;
    if (normalized.normalized.buildingResolutionStatus === "unresolved_needs_mapping") unresolvedBuildingCount += 1;

    const existing = await db
      .select({ id: cleancloudPaidOrders.id })
      .from(cleancloudPaidOrders)
      .where(
        and(
          eq(cleancloudPaidOrders.cleancloudOrderId, normalized.normalized.cleancloudOrderId),
          eq(cleancloudPaidOrders.sourceReportType, normalized.normalized.sourceReportType)
        )
      )
      .limit(1);

    if (existing[0]) {
      await db
        .update(cleancloudPaidOrders)
        .set({ ...normalized.normalized, updatedAt: new Date() })
        .where(eq(cleancloudPaidOrders.id, existing[0].id));
      updatedRowCount += 1;
    } else {
      await db.insert(cleancloudPaidOrders).values(normalized.normalized);
      importedRowCount += 1;
    }
  }

  const importStatus = errors.length ? "completed_with_errors" : "completed";
  await db
    .update(cleancloudImportBatches)
    .set({
      importedRowCount: importedRowCount + updatedRowCount,
      skippedRowCount,
      duplicateRowCount: updatedRowCount,
      importStatus,
      errorJson: errors.length ? errors : null,
    })
    .where(eq(cleancloudImportBatches.id, importBatchId));

  return {
    source: "cleancloud_paid_orders",
    sourceFileName,
    sourceReportType: input.sourceReportType,
    importBatchId,
    parsedRowCount: rows.length,
    importedRowCount,
    updatedRowCount,
    skippedRowCount,
    candidateClearentRowCount,
    unresolvedBuildingCount,
    importStatus,
    errors,
  };
}
