import { and, eq, gte, lt, sql } from "drizzle-orm";
import { format } from "date-fns";
import { cleancloudPaidOrders, clearentDailySummaries, type CleancloudPaidOrder } from "../drizzle/schema";
import { getDashboardTimeZone, zonedDayStartUtc, zonedNextDayYmd } from "./dashboardZoned";
import { getDb } from "./db";
import {
  findDayColumn,
  findRowByLabel,
  getLosAngelesBusinessDate,
  getMonthlyTabName,
  getSheetsContext,
  parseSheetTargetDate,
  setSheetCellValue,
} from "./sheets";

export type LaundryFarmServiceClass = "laundry" | "dry_cleaning" | "mixed_needs_review" | "unknown_needs_review";

export type LaundryFarmSheetSyncWarning =
  | "missing_sheet_tab"
  | "missing_date_column"
  | "unknown_classification"
  | "mixed_classification"
  | "clearent_cleancloud_mismatch"
  | "missing_clearent_daily_summary"
  | "missing_cleancloud_paid_orders"
  | "missing_row_label";

export type LaundryFarmSheetSyncPlan = {
  date: string;
  tabName: string;
  columnIndex0: number | null;
  columnLetter: string | null;
  laundryRow: number;
  dryCleanRow: number;
  laundryRevenueCents: number;
  dryCleanRevenueCents: number;
  unknownCents: number;
  mixedCents: number;
  clearentEnteredTotalCents: number | null;
  cleancloudCandidateTotalCents: number;
  reconciliationStatus: "matched" | "needs_review" | "missing_clearent" | "missing_cleancloud";
  warnings: LaundryFarmSheetSyncWarning[];
  classifiedOrders: Array<{
    cleancloudOrderId: string;
    customerName: string;
    amountCents: number;
    classification: LaundryFarmServiceClass;
    summaryText: string | null;
  }>;
};

export type LaundryFarmSheetSyncResult =
  | ({ ok: true; dryRun: boolean } & LaundryFarmSheetSyncPlan)
  | { ok: false; dryRun: boolean; date: string; reason: string; warnings: LaundryFarmSheetSyncWarning[]; plan?: LaundryFarmSheetSyncPlan };

function centsToSheetNumber(cents: number): string {
  return (cents / 100).toFixed(2);
}

function yesterdayLosAngeles(): Date {
  const today = getLosAngelesBusinessDate();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
}

export function parseLaundryFarmSyncDate(raw?: string | null): Date {
  return parseSheetTargetDate(raw, yesterdayLosAngeles());
}

export function classifyCleanCloudService(order: Pick<CleancloudPaidOrder, "summaryText" | "orderStatus" | "rawJson">): LaundryFarmServiceClass {
  const raw = order.rawJson as Record<string, unknown> | null;
  const haystack = [
    order.summaryText,
    order.orderStatus,
    raw?.Summary,
    raw?.Notes,
    raw?.Pickup,
    raw?.Delivery,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const dry = /\b(dry\s*clean(?:ing|ed)?|drycleaning|press(?:ed)?|laundered shirt|shirt laundry)\b/i.test(haystack);
  const laundry = /\b(wash\s*(?:&|and)\s*fold|fluff|laundry|per\s*lb|pounds?|lbs?|weight)\b/i.test(haystack);
  if (dry && laundry) return "mixed_needs_review";
  if (dry) return "dry_cleaning";
  if (laundry) return "laundry";
  return "unknown_needs_review";
}

function isCleanCloudClearentPaidCard(order: Pick<CleancloudPaidOrder, "paid" | "paymentType" | "cardPaymentType">): boolean {
  return Boolean(
    order.paid &&
      String(order.paymentType ?? "").toLowerCase() === "card" &&
      String(order.cardPaymentType ?? "").toLowerCase().includes("clearent")
  );
}

export function buildLaundryFarmSheetSyncPlan(input: {
  date: string;
  tabName?: string;
  columnIndex0?: number | null;
  columnLetter?: string | null;
  cleancloudOrders: CleancloudPaidOrder[];
  clearentEnteredTotalCents: number | null;
}): LaundryFarmSheetSyncPlan {
  let laundryRevenueCents = 0;
  let dryCleanRevenueCents = 0;
  let unknownCents = 0;
  let mixedCents = 0;
  const warnings = new Set<LaundryFarmSheetSyncWarning>();
  const classifiedOrders: LaundryFarmSheetSyncPlan["classifiedOrders"] = [];
  const cleancloudCandidates = input.cleancloudOrders.filter(isCleanCloudClearentPaidCard);

  for (const order of cleancloudCandidates) {
    const classification = classifyCleanCloudService(order);
    if (classification === "laundry") laundryRevenueCents += order.totalCents;
    else if (classification === "dry_cleaning") dryCleanRevenueCents += order.totalCents;
    else if (classification === "mixed_needs_review") {
      mixedCents += order.totalCents;
      warnings.add("mixed_classification");
    } else {
      unknownCents += order.totalCents;
      warnings.add("unknown_classification");
    }
    classifiedOrders.push({
      cleancloudOrderId: order.cleancloudOrderId,
      customerName: order.customerName,
      amountCents: order.totalCents,
      classification,
      summaryText: order.summaryText,
    });
  }

  const cleancloudCandidateTotalCents = cleancloudCandidates.reduce((sum, order) => sum + order.totalCents, 0);
  if (input.clearentEnteredTotalCents == null) warnings.add("missing_clearent_daily_summary");
  if (!cleancloudCandidates.length) warnings.add("missing_cleancloud_paid_orders");
  if (input.clearentEnteredTotalCents != null && cleancloudCandidateTotalCents > 0 && input.clearentEnteredTotalCents !== cleancloudCandidateTotalCents) {
    warnings.add("clearent_cleancloud_mismatch");
  }

  const reconciliationStatus =
    input.clearentEnteredTotalCents == null
      ? "missing_clearent"
      : cleancloudCandidateTotalCents <= 0
        ? "missing_cleancloud"
        : input.clearentEnteredTotalCents === cleancloudCandidateTotalCents
          ? "matched"
          : "needs_review";

  return {
    date: input.date,
    tabName: input.tabName ?? getMonthlyTabName(parseSheetTargetDate(input.date)),
    columnIndex0: input.columnIndex0 ?? null,
    columnLetter: input.columnLetter ?? null,
    laundryRow: 3,
    dryCleanRow: 4,
    laundryRevenueCents,
    dryCleanRevenueCents,
    unknownCents,
    mixedCents,
    clearentEnteredTotalCents: input.clearentEnteredTotalCents,
    cleancloudCandidateTotalCents,
    reconciliationStatus,
    warnings: Array.from(warnings),
    classifiedOrders,
  };
}

async function loadCleanCloudOrdersForDate(targetDate: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const ymd = format(targetDate, "yyyy-MM-dd");
  const timeZone = getDashboardTimeZone();
  const startUtc = zonedDayStartUtc(ymd, timeZone);
  const endUtc = zonedDayStartUtc(zonedNextDayYmd(ymd, timeZone), timeZone);
  const rows = await db
    .select()
    .from(cleancloudPaidOrders)
    .where(
      and(
        // Prefer Orders Sales for sheet sync, but keep Orders Revenue as a fallback
        // if a Sales row is missing for a CleanCloud order.
        sql`(
          (${cleancloudPaidOrders.sourceReportType} = 'orders_sales' AND ${cleancloudPaidOrders.paymentDateUtc} >= ${startUtc} AND ${cleancloudPaidOrders.paymentDateUtc} < ${endUtc})
          OR (${cleancloudPaidOrders.sourceReportType} = 'orders_revenue' AND ${cleancloudPaidOrders.paidDateUtc} >= ${startUtc} AND ${cleancloudPaidOrders.paidDateUtc} < ${endUtc})
        )`
      )
    );
  const byOrderId = new Map<string, CleancloudPaidOrder>();
  for (const row of rows) {
    const existing = byOrderId.get(row.cleancloudOrderId);
    if (!existing || (existing.sourceReportType === "orders_revenue" && row.sourceReportType === "orders_sales")) {
      byOrderId.set(row.cleancloudOrderId, row);
    }
  }
  return Array.from(byOrderId.values());
}

async function loadClearentEnteredTotalForDate(targetDate: Date): Promise<number | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const ymd = format(targetDate, "yyyy-MM-dd");
  const timeZone = getDashboardTimeZone();
  const startUtc = zonedDayStartUtc(ymd, timeZone);
  const endUtc = zonedDayStartUtc(zonedNextDayYmd(ymd, timeZone), timeZone);
  const rows = await db
    .select()
    .from(clearentDailySummaries)
    .where(
      and(
        eq(clearentDailySummaries.sourceReportBasis, "entered_date"),
        gte(clearentDailySummaries.reportDateUtc, startUtc),
        lt(clearentDailySummaries.reportDateUtc, endUtc)
      )
    );
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + row.totalSalesCents, 0);
}

export async function syncLaundryFarmRevenueSheet(input: {
  date?: string | null;
  dryRun?: boolean;
} = {}): Promise<LaundryFarmSheetSyncResult> {
  const targetDate = parseLaundryFarmSyncDate(input.date);
  const ymd = format(targetDate, "yyyy-MM-dd");
  const dryRun = input.dryRun ?? false;
  const [cleancloudOrders, clearentEnteredTotalCents] = await Promise.all([
    loadCleanCloudOrdersForDate(targetDate),
    loadClearentEnteredTotalForDate(targetDate),
  ]);
  const basePlan = buildLaundryFarmSheetSyncPlan({
    date: ymd,
    cleancloudOrders,
    clearentEnteredTotalCents,
  });

  if (basePlan.warnings.includes("missing_clearent_daily_summary") || basePlan.warnings.includes("missing_cleancloud_paid_orders")) {
    return {
      ok: false,
      dryRun,
      date: ymd,
      reason: "Missing source data — sheet not updated.",
      warnings: basePlan.warnings,
      plan: basePlan,
    };
  }

  const context = await getSheetsContext(targetDate);
  if ("error" in context) {
    const warning = context.error.includes("tab") ? "missing_sheet_tab" : context.error.includes("column") ? "missing_date_column" : "missing_row_label";
    return {
      ok: false,
      dryRun,
      date: ymd,
      reason: context.error,
      warnings: [...basePlan.warnings, warning],
      plan: basePlan,
    };
  }

  const columnA = context.values.map((row) => row?.[0]);
  const laundryRow0 = findRowByLabel(columnA, "LF Laundry Rev");
  const dryCleanRow0 = findRowByLabel(columnA, "LF Dry Clean Rev");
  if (laundryRow0 == null || dryCleanRow0 == null) {
    return {
      ok: false,
      dryRun,
      date: ymd,
      reason: "LF Laundry Rev or LF Dry Clean Rev row label not found",
      warnings: [...basePlan.warnings, "missing_row_label"],
      plan: basePlan,
    };
  }

  const plan: LaundryFarmSheetSyncPlan = {
    ...basePlan,
    tabName: context.tabName,
    columnIndex0: context.dayCol0,
    columnLetter: context.colLetter,
    laundryRow: laundryRow0 + 1,
    dryCleanRow: dryCleanRow0 + 1,
  };

  console.log("[LaundryFarmSheetSync]", {
    date: plan.date,
    tab: plan.tabName,
    column: plan.columnLetter,
    row3Amount: plan.laundryRevenueCents,
    row4Amount: plan.dryCleanRevenueCents,
    unknownAmount: plan.unknownCents,
    mixedAmount: plan.mixedCents,
    clearentTotal: plan.clearentEnteredTotalCents,
    cleancloudTotal: plan.cleancloudCandidateTotalCents,
    reconciliationStatus: plan.reconciliationStatus,
    warnings: plan.warnings,
    dryRun,
  });

  if (!dryRun) {
    await setSheetCellValue(context.auth, context.spreadsheetId, context.tabName, plan.laundryRow, context.col1, centsToSheetNumber(plan.laundryRevenueCents));
    await setSheetCellValue(context.auth, context.spreadsheetId, context.tabName, plan.dryCleanRow, context.col1, centsToSheetNumber(plan.dryCleanRevenueCents));
  }

  return { ok: true, dryRun, ...plan };
}
