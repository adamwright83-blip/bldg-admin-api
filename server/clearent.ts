import { normalizePropertyTower, type PropertyTowerMatch } from "@shared/propertyTowers";
import { and, desc, eq, gte, isNotNull, lt, or, sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import {
  clearentImportBatches,
  clearentDailySummaries,
  clearentTransactions,
  orders,
  type ClearentTransaction,
  type InsertClearentDailySummary,
  type InsertClearentTransaction,
} from "../drizzle/schema";
import { getDb } from "./db";
import { getDashboardBusinessDayBoundsUtc, type DashboardBusinessDayBounds } from "./revenueIntervention";
import { parseTabularRows, type TabularFileInput } from "./externalSystems/tabularIngestion";
import type { CsvRecord, ExternalImportSummary } from "./externalSystems/csvIngestion";

export const CLEARENT_PAYMENT_NOTE =
  "Payment imported from Clearent / XplorPay. Not a Stripe transaction and not a CleanCloud order.";

export type ClearentReportBasis = "settled_date" | "entered_date" | "unknown";

export type ClearentImportSummary = ExternalImportSummary & {
  sourceReportBasis: ClearentReportBasis;
  mergedRowCount: number;
  importedSummaryRowCount: number;
  updatedSummaryRowCount: number;
  skippedSummaryRowCount: number;
  importedTransactionRowCount: number;
};

export type ClearentRevenueSummary = {
  bounds: DashboardBusinessDayBounds;
  collectedCents: number;
  settledCents: number;
};

export type ClearentCustomerAggregate = PropertyTowerMatch & {
  source: "clearent_xplorpay";
  paymentProcessor: "clearent_xplorpay";
  includedInStripe: false;
  includedInCleanCloud: false;
  includedInOperationalRevenue: true;
  clearentPaymentNote: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  address: string;
  unit: string | null;
  totalCollected: number;
  transactionCount: number;
  firstTransactionDate: string;
  lastTransactionDate: string;
  note?: string;
};

const PACIFIC_TIME_ZONE = "America/Los_Angeles";

const fieldAliases = {
  clearentTransactionId: ["Transaction ID", "Transaction Id", "Trans ID", "Txn ID", "XplorPay Transaction ID", "ID"],
  merchantId: ["Merchant ID", "MID", "Merchant Number"],
  merchantName: ["Merchant", "Merchant Name", "DBA"],
  transactionDate: ["Transaction Date", "Date", "Txn Date", "Payment Date"],
  enteredDate: ["Entered Date", "Date Entered", "Entry Date", "Entered"],
  settledDate: ["Settled Date", "Settlement Date", "Settle Date", "Settled"],
  depositDate: ["Deposit Date", "Funded Date", "Funding Date"],
  cardType: ["Card Type", "Card", "Payment Type", "Brand"],
  lastFour: ["Last 4", "Last Four", "Card Last 4", "Acct Last 4", "Account Last 4"],
  customerName: ["Customer", "Customer Name", "Name", "Cardholder", "Cardholder Name"],
  customerEmail: ["Email", "Customer Email"],
  customerPhone: ["Phone", "Customer Phone"],
  grossAmount: ["Amount", "Gross Amount", "Transaction Amount", "Sale Amount", "Total"],
  netAmount: ["Net Amount", "Net"],
  feeAmount: ["Fee", "Fees", "Fee Amount"],
  depositAmount: ["Deposit Amount", "Funded Amount", "Funding Amount"],
  transactionStatus: ["Status", "Transaction Status"],
  transactionType: ["Type", "Transaction Type"],
  authCode: ["Auth Code", "Authorization Code", "Approval Code", "Auth"],
  batchId: ["Batch ID", "Batch Id", "Batch"],
  notes: ["Notes", "Description", "Memo", "Invoice", "Order", "Reference"],
  buildingName: ["Building", "Building Name", "Property"],
  tower: ["Tower"],
  unit: ["Unit", "Apt", "Apartment", "Suite"],
} as const;

const dailySummaryAliases = {
  settleDate: ["Settle Date", "Settled Date", "Settlement Date"],
  transactionDate: ["Transaction Date", "Date"],
  totalSales: ["Total Sales", "Sales"],
  netSales: ["Net Sales"],
  totalTransactions: ["Total Transactions", "Transactions"],
  interchange: ["Interchange"],
  discount: ["Discount"],
  depositAmount: ["Deposit Amount"],
} as const;

function pick(row: CsvRecord, aliases: readonly string[]): string {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const direct = row[alias];
    if (direct?.trim()) return direct.trim();
    const lower = alias.toLowerCase().replace(/\s+/g, " ");
    const found = entries.find(([key]) => key.trim().toLowerCase().replace(/\s+/g, " ") === lower)?.[1];
    if (found?.trim()) return found.trim();
  }
  return "";
}

function hasAny(row: CsvRecord, aliases: readonly string[]): boolean {
  return Boolean(pick(row, aliases));
}

export function parseClearentReportBasis(value: unknown): ClearentReportBasis {
  if (value === "settled_date" || value === "entered_date" || value === "unknown") return value;
  return "unknown";
}

function parseMoneyCents(value: unknown): number {
  const raw = String(value ?? "").trim();
  const parenNegative = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[,$\s()]/g, "");
  if (!cleaned) return 0;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round((parenNegative ? -n : n) * 100);
}

function parsePacificDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const mdy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  const ymd = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  let local = trimmed;
  if (mdy || ymd) {
    const match = mdy ?? ymd!;
    const yearRaw = mdy ? match[3] : match[1];
    const monthRaw = mdy ? match[1] : match[2];
    const dayRaw = mdy ? match[2] : match[3];
    const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
    const month = String(Number(monthRaw)).padStart(2, "0");
    const day = String(Number(dayRaw)).padStart(2, "0");
    let hour = Number(match[4] ?? 12);
    const minute = String(Number(match[5] ?? 0)).padStart(2, "0");
    const second = String(Number(match[6] ?? 0)).padStart(2, "0");
    const ampm = match[7]?.toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    local = `${year}-${month}-${day} ${String(hour).padStart(2, "0")}:${minute}:${second}`;
  }
  const utc = fromZonedTime(local, PACIFIC_TIME_ZONE);
  return Number.isNaN(utc.getTime()) ? null : utc;
}

function parseInteger(value: string): number | null {
  const cleaned = value.replace(/[,\s]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  return digits || null;
}

function normalizeLastFour(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || "Clearent",
    lastName: parts.join(" ") || "Customer",
  };
}

function rowFingerprint(row: CsvRecord): string {
  return Object.entries(row)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key.trim().toLowerCase()}=${String(value).trim().toLowerCase()}`)
    .join("|");
}

function isTotalRow(row: CsvRecord): boolean {
  return Object.values(row).some((value) => String(value ?? "").trim().toLowerCase() === "total");
}

function looksLikeDailySummaryRow(row: CsvRecord): boolean {
  if (isTotalRow(row)) return false;
  const hasDepositDate = hasAny(row, dailySummaryAliases.settleDate);
  const hasDailyActivityDate = hasAny(row, dailySummaryAliases.transactionDate);
  const hasAggregateSales = hasAny(row, dailySummaryAliases.totalSales);
  const hasAggregateCount = hasAny(row, dailySummaryAliases.totalTransactions);
  const hasTransactionIdentity =
    hasAny(row, fieldAliases.clearentTransactionId) ||
    hasAny(row, fieldAliases.authCode) ||
    hasAny(row, fieldAliases.lastFour) ||
    hasAny(row, fieldAliases.customerName);
  return hasAggregateSales && (hasDepositDate || (hasDailyActivityDate && hasAggregateCount)) && !hasTransactionIdentity;
}

function inferReportBasis(input: {
  requested: ClearentReportBasis;
  sourceFileName: string;
  rows: CsvRecord[];
}): ClearentReportBasis {
  if (input.requested !== "unknown") return input.requested;
  const name = input.sourceFileName.toLowerCase();
  if (name.includes("depositdetails") || name.includes("deposit")) return "settled_date";
  if (name.includes("dailycardactivity") || name.includes("dailycard")) return "entered_date";
  const sample = input.rows.find((row) => Object.values(row).some((value) => String(value).trim()));
  if (sample && hasAny(sample, dailySummaryAliases.settleDate)) return "settled_date";
  if (sample && hasAny(sample, dailySummaryAliases.transactionDate) && hasAny(sample, dailySummaryAliases.totalSales)) return "entered_date";
  return "unknown";
}

function firstKnownDate(row: Pick<InsertClearentTransaction, "transactionDateUtc" | "enteredDateUtc" | "settledDateUtc" | "depositDateUtc">): Date | null {
  return row.transactionDateUtc ?? row.enteredDateUtc ?? row.settledDateUtc ?? row.depositDateUtc ?? null;
}

export function clearentFallbackKey(row: InsertClearentTransaction): string {
  const date = firstKnownDate(row)?.toISOString().slice(0, 10) ?? "unknown-date";
  if (row.authCode && row.lastFour && row.grossAmountCents !== undefined) {
    return `auth:${row.authCode.trim().toLowerCase()}|amount:${row.grossAmountCents}|last4:${row.lastFour}|date:${date}`;
  }
  const raw = row.rawJson as Record<string, unknown> | null;
  return [
    "fingerprint",
    date,
    row.grossAmountCents ?? 0,
    row.cardType?.trim().toLowerCase() ?? "",
    raw?.rowFingerprint ?? "",
  ].join("|");
}

function reportDateForBasis(input: {
  basis: ClearentReportBasis;
  transactionDateUtc: Date | null;
  enteredDateUtc: Date | null;
  settledDateUtc: Date | null;
}): Date | null {
  if (input.basis === "entered_date") return input.enteredDateUtc ?? input.transactionDateUtc;
  if (input.basis === "settled_date") return input.settledDateUtc ?? input.transactionDateUtc;
  return input.transactionDateUtc;
}

export function normalizeClearentRow(row: CsvRecord, input: {
  sourceFileName: string;
  importBatchId: number;
  sourceReportBasis: ClearentReportBasis;
}): { normalized: InsertClearentTransaction; needsBuildingResolution: boolean } {
  const explicitBuilding = pick(row, fieldAliases.buildingName);
  const explicitTower = pick(row, fieldAliases.tower);
  const notes = pick(row, fieldAliases.notes);
  const unit = pick(row, fieldAliases.unit) || null;
  const addressContext = [explicitBuilding, explicitTower, notes, unit].filter(Boolean).join(" ");
  const tower = normalizePropertyTower(addressContext, {
    propertyGroup: explicitBuilding.toLowerCase().includes("opus")
      ? "opus_la"
      : explicitBuilding.toLowerCase().includes("century park")
        ? "century_park_east"
        : undefined,
  });
  const needsBuildingResolution = tower.propertyGroup === "unknown" || tower.towerKey === "unknown";
  const transactionDateUtc = parsePacificDate(pick(row, fieldAliases.transactionDate));
  const enteredDateUtc = parsePacificDate(pick(row, fieldAliases.enteredDate));
  const settledDateUtc = parsePacificDate(pick(row, fieldAliases.settledDate));
  const depositDateUtc = parsePacificDate(pick(row, fieldAliases.depositDate));
  const reportDate = reportDateForBasis({
    basis: input.sourceReportBasis,
    transactionDateUtc,
    enteredDateUtc,
    settledDateUtc,
  });

  const normalized: InsertClearentTransaction = {
    clearentTransactionId: pick(row, fieldAliases.clearentTransactionId) || null,
    sourceFileName: input.sourceFileName,
    importBatchId: input.importBatchId,
    sourceReportBasis: input.sourceReportBasis,
    merchantId: pick(row, fieldAliases.merchantId) || null,
    merchantName: pick(row, fieldAliases.merchantName) || null,
    transactionDateUtc: transactionDateUtc ?? reportDate,
    enteredDateUtc: enteredDateUtc ?? (input.sourceReportBasis === "entered_date" ? reportDate : null),
    settledDateUtc: settledDateUtc ?? (input.sourceReportBasis === "settled_date" ? reportDate : null),
    depositDateUtc,
    cardType: pick(row, fieldAliases.cardType) || null,
    lastFour: normalizeLastFour(pick(row, fieldAliases.lastFour)),
    customerName: pick(row, fieldAliases.customerName) || null,
    customerEmail: pick(row, fieldAliases.customerEmail) || null,
    customerPhone: normalizePhone(pick(row, fieldAliases.customerPhone)),
    grossAmountCents: parseMoneyCents(pick(row, fieldAliases.grossAmount)),
    netAmountCents: pick(row, fieldAliases.netAmount) ? parseMoneyCents(pick(row, fieldAliases.netAmount)) : null,
    feeAmountCents: pick(row, fieldAliases.feeAmount) ? parseMoneyCents(pick(row, fieldAliases.feeAmount)) : null,
    depositAmountCents: pick(row, fieldAliases.depositAmount) ? parseMoneyCents(pick(row, fieldAliases.depositAmount)) : null,
    transactionStatus: pick(row, fieldAliases.transactionStatus) || "unknown",
    transactionType: pick(row, fieldAliases.transactionType) || "unknown",
    authCode: pick(row, fieldAliases.authCode) || null,
    batchId: pick(row, fieldAliases.batchId) || null,
    buildingName: tower.propertyGroup === "unknown" ? null : tower.propertyDisplayName,
    tower: tower.towerKey === "unknown" ? null : tower.towerDisplayName,
    unit,
    matchedOrderId: null,
    matchedCustomerId: null,
    rawJson: {
      source: "clearent_xplorpay",
      sourceFileName: input.sourceFileName,
      originalRow: row,
      rowFingerprint: rowFingerprint(row),
      normalizedAt: new Date().toISOString(),
      timezone: PACIFIC_TIME_ZONE,
      needsBuildingResolution,
      propertyGroup: tower.propertyGroup,
      towerKey: tower.towerKey,
      buildingAddressCanonical: tower.buildingAddressCanonical,
      depositsPhase1Deferred: "Clearent Deposits section has no export CTA; future automation may read the page table into a separate deposit ingestion path.",
    },
  };

  return { normalized, needsBuildingResolution };
}

export function normalizeClearentDailySummaryRow(row: CsvRecord, input: {
  sourceFileName: string;
  importBatchId: number;
  sourceReportBasis: ClearentReportBasis;
}): InsertClearentDailySummary | null {
  if (isTotalRow(row)) return null;
  const reportDateRaw =
    input.sourceReportBasis === "settled_date"
      ? pick(row, dailySummaryAliases.settleDate)
      : pick(row, dailySummaryAliases.transactionDate) || pick(row, dailySummaryAliases.settleDate);
  const reportDateUtc = parsePacificDate(reportDateRaw);
  if (!reportDateUtc) return null;
  const totalSalesCents = parseMoneyCents(pick(row, dailySummaryAliases.totalSales));
  if (!totalSalesCents) return null;

  return {
    sourceFileName: input.sourceFileName,
    importBatchId: input.importBatchId,
    sourceReportBasis: input.sourceReportBasis,
    reportDateUtc,
    totalSalesCents,
    netSalesCents: pick(row, dailySummaryAliases.netSales) ? parseMoneyCents(pick(row, dailySummaryAliases.netSales)) : null,
    totalTransactions: parseInteger(pick(row, dailySummaryAliases.totalTransactions)),
    interchangeCents: pick(row, dailySummaryAliases.interchange) ? parseMoneyCents(pick(row, dailySummaryAliases.interchange)) : null,
    discountCents: pick(row, dailySummaryAliases.discount) ? parseMoneyCents(pick(row, dailySummaryAliases.discount)) : null,
    depositAmountCents: pick(row, dailySummaryAliases.depositAmount) ? parseMoneyCents(pick(row, dailySummaryAliases.depositAmount)) : null,
    rawJson: {
      source: "clearent_xplorpay",
      dataType: "daily_summary",
      sourceFileName: input.sourceFileName,
      originalRow: row,
      rowFingerprint: rowFingerprint(row),
      normalizedAt: new Date().toISOString(),
      timezone: PACIFIC_TIME_ZONE,
      totalRowSkipped: false,
    },
  };
}

function mergePatch(existing: ClearentTransaction, incoming: InsertClearentTransaction): Partial<InsertClearentTransaction> {
  const raw = existing.rawJson as Record<string, unknown> | null;
  return {
    sourceFileName: existing.sourceFileName,
    sourceReportBasis: existing.sourceReportBasis === "unknown" ? incoming.sourceReportBasis : existing.sourceReportBasis,
    merchantId: existing.merchantId ?? incoming.merchantId,
    merchantName: existing.merchantName ?? incoming.merchantName,
    transactionDateUtc: existing.transactionDateUtc ?? incoming.transactionDateUtc,
    enteredDateUtc: existing.enteredDateUtc ?? incoming.enteredDateUtc,
    settledDateUtc: existing.settledDateUtc ?? incoming.settledDateUtc,
    depositDateUtc: existing.depositDateUtc ?? incoming.depositDateUtc,
    cardType: existing.cardType ?? incoming.cardType,
    lastFour: existing.lastFour ?? incoming.lastFour,
    customerName: existing.customerName ?? incoming.customerName,
    customerEmail: existing.customerEmail ?? incoming.customerEmail,
    customerPhone: existing.customerPhone ?? incoming.customerPhone,
    netAmountCents: existing.netAmountCents ?? incoming.netAmountCents,
    feeAmountCents: existing.feeAmountCents ?? incoming.feeAmountCents,
    depositAmountCents: existing.depositAmountCents ?? incoming.depositAmountCents,
    transactionStatus: existing.transactionStatus === "unknown" ? incoming.transactionStatus : existing.transactionStatus,
    transactionType: existing.transactionType === "unknown" ? incoming.transactionType : existing.transactionType,
    authCode: existing.authCode ?? incoming.authCode,
    batchId: existing.batchId ?? incoming.batchId,
    buildingName: existing.buildingName ?? incoming.buildingName,
    tower: existing.tower ?? incoming.tower,
    unit: existing.unit ?? incoming.unit,
    rawJson: {
      ...(raw ?? {}),
      mergedReportBases: Array.from(new Set([existing.sourceReportBasis, incoming.sourceReportBasis])),
      lastMergedAt: new Date().toISOString(),
    },
  };
}

async function findExistingClearentTransaction(row: InsertClearentTransaction): Promise<ClearentTransaction | null> {
  const db = await getDb();
  if (!db) return null;

  if (row.clearentTransactionId) {
    const existing = await db
      .select()
      .from(clearentTransactions)
      .where(eq(clearentTransactions.clearentTransactionId, row.clearentTransactionId))
      .limit(1);
    if (existing[0]) return existing[0];
  }

  const date = firstKnownDate(row);
  if (row.authCode && row.lastFour && date) {
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const existing = await db
      .select()
      .from(clearentTransactions)
      .where(
        and(
          sql`LOWER(${clearentTransactions.authCode}) = ${row.authCode.trim().toLowerCase()}`,
          eq(clearentTransactions.grossAmountCents, row.grossAmountCents ?? 0),
          eq(clearentTransactions.lastFour, row.lastFour),
          or(
            and(isNotNull(clearentTransactions.transactionDateUtc), gte(clearentTransactions.transactionDateUtc, dayStart), lt(clearentTransactions.transactionDateUtc, dayEnd)),
            and(isNotNull(clearentTransactions.enteredDateUtc), gte(clearentTransactions.enteredDateUtc, dayStart), lt(clearentTransactions.enteredDateUtc, dayEnd)),
            and(isNotNull(clearentTransactions.settledDateUtc), gte(clearentTransactions.settledDateUtc, dayStart), lt(clearentTransactions.settledDateUtc, dayEnd))
          )
        )
      )
      .limit(1);
    if (existing[0]) return existing[0];
  }

  if (row.authCode && row.lastFour) {
    const existing = await db
      .select()
      .from(clearentTransactions)
      .where(
        and(
          sql`LOWER(${clearentTransactions.authCode}) = ${row.authCode.trim().toLowerCase()}`,
          eq(clearentTransactions.grossAmountCents, row.grossAmountCents ?? 0),
          eq(clearentTransactions.lastFour, row.lastFour)
        )
      )
      .limit(2);
    if (existing.length === 1) return existing[0];
  }

  return null;
}

async function matchOrderId(row: InsertClearentTransaction): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const clauses = [eq(orders.paid, true), sql`ROUND(CAST(${orders.total} AS DECIMAL(14,4)) * 100) = ${row.grossAmountCents ?? 0}`];
  const email = row.customerEmail?.trim().toLowerCase();
  const phone = row.customerPhone?.replace(/\D/g, "");
  if (email) clauses.push(sql`LOWER(${orders.email}) = ${email}`);
  else if (phone) clauses.push(sql`REPLACE(REPLACE(REPLACE(REPLACE(${orders.phone}, '(', ''), ')', ''), '-', ''), ' ', '') = ${phone}`);
  else return null;

  const existing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(...clauses))
    .orderBy(desc(orders.paidAt), desc(orders.id))
    .limit(1);
  return existing[0]?.id ?? null;
}

export async function importClearentTransactions(input: TabularFileInput & {
  sourceReportBasis?: ClearentReportBasis;
}): Promise<ClearentImportSummary> {
  const db = await getDb();
  if (!db) throw new Error("Database is not configured");

  const requestedReportBasis = parseClearentReportBasis(input.sourceReportBasis);
  const sourceFileName = input.fileName?.trim() || `clearent-import-${new Date().toISOString()}.csv`;
  const parsedRows = parseTabularRows(input);
  const sourceReportBasis = inferReportBasis({ requested: requestedReportBasis, sourceFileName, rows: parsedRows });
  const errors: ClearentImportSummary["errors"] = [];

  const [batch] = await db
    .insert(clearentImportBatches)
    .values({
      source: "clearent_xplorpay",
      sourceFileName,
      sourceReportBasis,
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
  let mergedRowCount = 0;
  let importedSummaryRowCount = 0;
  let updatedSummaryRowCount = 0;
  let skippedSummaryRowCount = 0;
  let importedTransactionRowCount = 0;
  const seen = new Set<string>();

  for (let i = 0; i < parsedRows.length; i++) {
    try {
      if (isTotalRow(parsedRows[i])) {
        skippedRowCount += 1;
        skippedSummaryRowCount += 1;
        continue;
      }

      if (looksLikeDailySummaryRow(parsedRows[i])) {
        const normalizedSummary = normalizeClearentDailySummaryRow(parsedRows[i], {
          sourceFileName,
          importBatchId,
          sourceReportBasis,
        });
        if (!normalizedSummary) {
          skippedRowCount += 1;
          skippedSummaryRowCount += 1;
          continue;
        }
        const existing = await db
          .select({ id: clearentDailySummaries.id })
          .from(clearentDailySummaries)
          .where(
            and(
              eq(clearentDailySummaries.sourceReportBasis, normalizedSummary.sourceReportBasis),
              eq(clearentDailySummaries.reportDateUtc, normalizedSummary.reportDateUtc)
            )
          )
          .limit(1);
        if (existing[0]) {
          await db
            .update(clearentDailySummaries)
            .set({
              sourceFileName: normalizedSummary.sourceFileName,
              importBatchId,
              totalSalesCents: normalizedSummary.totalSalesCents,
              netSalesCents: normalizedSummary.netSalesCents,
              totalTransactions: normalizedSummary.totalTransactions,
              interchangeCents: normalizedSummary.interchangeCents,
              discountCents: normalizedSummary.discountCents,
              depositAmountCents: normalizedSummary.depositAmountCents,
              rawJson: {
                ...(normalizedSummary.rawJson as Record<string, unknown>),
                updatedExistingSummaryId: existing[0].id,
              },
            })
            .where(eq(clearentDailySummaries.id, existing[0].id));
          updatedSummaryRowCount += 1;
        } else {
          await db.insert(clearentDailySummaries).values(normalizedSummary);
          importedSummaryRowCount += 1;
        }
        continue;
      }

      const { normalized, needsBuildingResolution } = normalizeClearentRow(parsedRows[i], {
        sourceFileName,
        importBatchId,
        sourceReportBasis,
      });
      if (!normalized.grossAmountCents) throw new Error("Missing or invalid transaction amount");
      normalized.matchedOrderId = await matchOrderId(normalized);

      const key = normalized.clearentTransactionId
        ? `id:${normalized.clearentTransactionId}`
        : clearentFallbackKey(normalized);
      if (seen.has(key)) {
        skippedRowCount += 1;
        duplicateRowCount += 1;
        continue;
      }
      seen.add(key);

      const existing = await findExistingClearentTransaction(normalized);
      if (existing) {
        const patch = mergePatch(existing, normalized);
        await db.update(clearentTransactions).set(patch).where(eq(clearentTransactions.id, existing.id));
        skippedRowCount += 1;
        duplicateRowCount += 1;
        mergedRowCount += 1;
        continue;
      }

      await db.insert(clearentTransactions).values(normalized);
      importedRowCount += 1;
      importedTransactionRowCount += 1;
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
    .update(clearentImportBatches)
    .set({
      importedRowCount: importedRowCount + importedSummaryRowCount,
      skippedRowCount,
      duplicateRowCount,
      importStatus,
      errorJson: errors.length > 0 ? errors : null,
    })
    .where(eq(clearentImportBatches.id, importBatchId));

  return {
    source: "clearent_xplorpay",
    sourceFileName,
    sourceReportBasis,
    importBatchId,
    parsedRowCount: parsedRows.length,
    importedRowCount: importedRowCount + importedSummaryRowCount,
    skippedRowCount,
    duplicateRowCount,
    unresolvedBuildingCount,
    mergedRowCount,
    importedSummaryRowCount,
    updatedSummaryRowCount,
    skippedSummaryRowCount,
    importedTransactionRowCount,
    importStatus,
    errors,
  };
}

export async function getClearentRevenueForBounds(bounds: DashboardBusinessDayBounds): Promise<ClearentRevenueSummary | null> {
  const db = await getDb();
  if (!db) return null;

  const [collectedRow, settledRow, collectedSummaryRow, settledSummaryRow] = await Promise.all([
    db
      .select({
        cents: sql<number>`COALESCE(SUM(${clearentTransactions.grossAmountCents}), 0)`,
      })
      .from(clearentTransactions)
      .where(
        and(
          isNotNull(clearentTransactions.enteredDateUtc),
          gte(clearentTransactions.enteredDateUtc, bounds.startUtc),
          lt(clearentTransactions.enteredDateUtc, bounds.endUtc)
        )
      ),
    db
      .select({
        cents: sql<number>`COALESCE(SUM(COALESCE(${clearentTransactions.depositAmountCents}, ${clearentTransactions.netAmountCents}, ${clearentTransactions.grossAmountCents})), 0)`,
      })
      .from(clearentTransactions)
      .where(
        or(
          and(isNotNull(clearentTransactions.depositDateUtc), gte(clearentTransactions.depositDateUtc, bounds.startUtc), lt(clearentTransactions.depositDateUtc, bounds.endUtc)),
          and(isNotNull(clearentTransactions.settledDateUtc), gte(clearentTransactions.settledDateUtc, bounds.startUtc), lt(clearentTransactions.settledDateUtc, bounds.endUtc))
        )
      ),
    db
      .select({
        cents: sql<number>`COALESCE(SUM(${clearentDailySummaries.totalSalesCents}), 0)`,
      })
      .from(clearentDailySummaries)
      .where(
        and(
          eq(clearentDailySummaries.sourceReportBasis, "entered_date"),
          gte(clearentDailySummaries.reportDateUtc, bounds.startUtc),
          lt(clearentDailySummaries.reportDateUtc, bounds.endUtc)
        )
      ),
    db
      .select({
        cents: sql<number>`COALESCE(SUM(COALESCE(${clearentDailySummaries.depositAmountCents}, ${clearentDailySummaries.netSalesCents}, ${clearentDailySummaries.totalSalesCents})), 0)`,
      })
      .from(clearentDailySummaries)
      .where(
        and(
          eq(clearentDailySummaries.sourceReportBasis, "settled_date"),
          gte(clearentDailySummaries.reportDateUtc, bounds.startUtc),
          lt(clearentDailySummaries.reportDateUtc, bounds.endUtc)
        )
      ),
  ]);

  const transactionCollected = Number(collectedRow[0]?.cents ?? 0);
  const transactionSettled = Number(settledRow[0]?.cents ?? 0);
  return {
    bounds,
    collectedCents: transactionCollected || Number(collectedSummaryRow[0]?.cents ?? 0),
    settledCents: transactionSettled || Number(settledSummaryRow[0]?.cents ?? 0),
  };
}

export function buildClearentRevenueSummaryFromRows(
  rows: Array<Pick<InsertClearentTransaction, "grossAmountCents" | "netAmountCents" | "depositAmountCents" | "enteredDateUtc" | "transactionDateUtc" | "settledDateUtc" | "depositDateUtc">>,
  bounds: DashboardBusinessDayBounds
): ClearentRevenueSummary {
  let collectedCents = 0;
  let settledCents = 0;
  for (const row of rows) {
    const entered = row.enteredDateUtc ?? row.transactionDateUtc;
    if (entered && entered >= bounds.startUtc && entered < bounds.endUtc) {
      collectedCents += row.grossAmountCents ?? 0;
    }
    const settled = row.depositDateUtc ?? row.settledDateUtc;
    if (settled && settled >= bounds.startUtc && settled < bounds.endUtc) {
      settledCents += row.depositAmountCents ?? row.netAmountCents ?? row.grossAmountCents ?? 0;
    }
  }
  return { bounds, collectedCents, settledCents };
}

export function buildClearentRevenueSummaryFromDailyRows(
  rows: Array<Pick<InsertClearentDailySummary, "sourceReportBasis" | "reportDateUtc" | "totalSalesCents" | "netSalesCents" | "depositAmountCents">>,
  bounds: DashboardBusinessDayBounds
): ClearentRevenueSummary {
  let collectedCents = 0;
  let settledCents = 0;
  for (const row of rows) {
    if (row.reportDateUtc < bounds.startUtc || row.reportDateUtc >= bounds.endUtc) continue;
    if (row.sourceReportBasis === "entered_date") collectedCents += row.totalSalesCents;
    if (row.sourceReportBasis === "settled_date") {
      settledCents += row.depositAmountCents ?? row.netSalesCents ?? row.totalSalesCents;
    }
  }
  return { bounds, collectedCents, settledCents };
}

export async function getClearentCollectedTodayCents(now = new Date()) {
  const bounds = getDashboardBusinessDayBoundsUtc(now);
  return getClearentRevenueForBounds(bounds);
}

export async function getClearentOperationalRevenueCents(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [transactionRow, summaryRow] = await Promise.all([
    db.select({ cents: sql<number>`COALESCE(SUM(${clearentTransactions.grossAmountCents}), 0)` }).from(clearentTransactions),
    db
      .select({ cents: sql<number>`COALESCE(SUM(${clearentDailySummaries.totalSalesCents}), 0)` })
      .from(clearentDailySummaries)
      .where(eq(clearentDailySummaries.sourceReportBasis, "entered_date")),
  ]);
  const transactionCents = Number(transactionRow[0]?.cents ?? 0);
  return transactionCents || Number(summaryRow[0]?.cents ?? 0);
}

export async function listImportedClearentCustomers(): Promise<ClearentCustomerAggregate[]> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(clearentTransactions)
    .orderBy(desc(clearentTransactions.enteredDateUtc), desc(clearentTransactions.transactionDateUtc), desc(clearentTransactions.id));
  const grouped = new Map<string, typeof rows>();

  for (const row of rows) {
    const phone = row.customerPhone?.replace(/\D/g, "") ?? "";
    const email = row.customerEmail?.trim().toLowerCase() ?? "";
    const key =
      phone.length >= 7
        ? `phone:${phone}`
        : email
          ? `email:${email}`
          : `customer:${row.customerName?.trim().toLowerCase() ?? ""}|${row.unit ?? ""}|${row.lastFour ?? ""}`;
    const group = grouped.get(key);
    if (group) group.push(row);
    else grouped.set(key, [row]);
  }

  return Array.from(grouped.values()).map((group) => {
    const latest = group[0];
    const first = group[group.length - 1];
    const name = splitName(latest.customerName ?? "Clearent Customer");
    const raw = latest.rawJson as any;
    const tower = normalizePropertyTower(raw?.buildingAddressCanonical ?? latest.buildingName, {
      propertyGroup: raw?.propertyGroup,
      towerKey: raw?.towerKey,
    });
    const dateOf = (row: ClearentTransaction) => row.enteredDateUtc ?? row.transactionDateUtc ?? row.settledDateUtc ?? row.createdAt;
    return {
      ...tower,
      source: "clearent_xplorpay",
      paymentProcessor: "clearent_xplorpay",
      includedInStripe: false,
      includedInCleanCloud: false,
      includedInOperationalRevenue: true,
      clearentPaymentNote: CLEARENT_PAYMENT_NOTE,
      firstName: name.firstName,
      lastName: name.lastName,
      email: latest.customerEmail,
      phone: latest.customerPhone ?? `clearent:${latest.id}`,
      address: tower.buildingAddressCanonical ?? latest.buildingName ?? "",
      unit: latest.unit,
      totalCollected: group.reduce((sum, row) => sum + row.grossAmountCents, 0) / 100,
      transactionCount: group.length,
      firstTransactionDate: dateOf(first).toISOString().slice(0, 10),
      lastTransactionDate: dateOf(latest).toISOString().slice(0, 10),
      note: raw?.needsBuildingResolution ? "Needs building resolution" : undefined,
    };
  });
}
