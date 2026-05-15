import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import {
  cleancloudPaidOrders,
  clearentDailySummaries,
  paymentReconciliationMatches,
  type CleancloudPaidOrder,
  type ClearentDailySummary,
  type InsertPaymentReconciliationMatch,
  type PaymentReconciliationMatch,
} from "../drizzle/schema";
import { getDashboardTimeZone, zonedDayStartUtc, zonedNextDayYmd, zonedYmd } from "./dashboardZoned";
import { getDb } from "./db";

const OPERATOR_TIME_ZONE = "America/Los_Angeles";

export type PaymentReconciliationStatusFilter = "matched" | "unmatched" | "possible_duplicate" | "needs_review" | "ignored" | "all";
export type PaymentReconciliationProcessorFilter = "clearent" | "stripe" | "all";
export type PaymentReconciliationBusinessUnitFilter = "laundry_butler" | "laundry_farm" | "all";

export type PaymentReconciliationFilters = {
  startDate?: string | null;
  endDate?: string | null;
  processor?: PaymentReconciliationProcessorFilter;
  businessUnit?: PaymentReconciliationBusinessUnitFilter;
  status?: PaymentReconciliationStatusFilter;
};

export type CleanCloudCandidateOrder = Pick<
  CleancloudPaidOrder,
  | "id"
  | "tenantId"
  | "sourceReportType"
  | "cleancloudOrderId"
  | "cleancloudCustomerId"
  | "customerName"
  | "customerEmail"
  | "customerPhone"
  | "buildingName"
  | "buildingSlug"
  | "tower"
  | "unit"
  | "paymentDateUtc"
  | "paidDateUtc"
  | "paid"
  | "paymentType"
  | "cardPaymentType"
  | "totalCents"
>;

export type DailyDateTotalReconciliation = {
  status: "date_total_match" | "needs_review" | "unmatched";
  confidence: "medium" | "low";
  localBusinessDate: string;
  clearentTotalCents: number;
  cleancloudCandidateOrderCents: number;
  unresolvedDeltaCents: number;
  sourceReportType: "orders_sales" | "orders_revenue" | null;
  candidates: CleanCloudCandidateOrder[];
};

export type SourceCoverageRow = {
  localBusinessDate: string;
  clearentEnteredCents: number | null;
  clearentSettledCents: number | null;
  cleancloudCandidateCents: number;
  comparable: boolean;
  status: "matched" | "needs_review" | "missing_clearent" | "missing_cleancloud" | "no_activity";
  unresolvedDeltaCents: number;
};

export function localBusinessDateForUtc(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return formatInTimeZone(d, OPERATOR_TIME_ZONE, "yyyy-MM-dd");
}

export function isCleanCloudClearentCandidate(order: Pick<CleanCloudCandidateOrder, "paid" | "paymentType" | "cardPaymentType">): boolean {
  return Boolean(
    order.paid &&
      String(order.paymentType ?? "").toLowerCase() === "card" &&
      String(order.cardPaymentType ?? "").toLowerCase().includes("clearent")
  );
}

export function chooseCleanCloudCandidatesForDate(
  localBusinessDate: string,
  rows: CleanCloudCandidateOrder[]
): CleanCloudCandidateOrder[] {
  return dedupeCleanCloudCandidates(
    rows.filter((row) => {
      if (!isCleanCloudClearentCandidate(row)) return false;
      const candidateDate =
        row.sourceReportType === "orders_sales"
          ? localBusinessDateForUtc(row.paymentDateUtc)
          : localBusinessDateForUtc(row.paidDateUtc);
      return candidateDate === localBusinessDate;
    })
  );
}

export function dedupeCleanCloudCandidates(rows: CleanCloudCandidateOrder[]): CleanCloudCandidateOrder[] {
  const byOrderId = new Map<string, CleanCloudCandidateOrder>();
  for (const row of rows.filter(isCleanCloudClearentCandidate)) {
    const existing = byOrderId.get(row.cleancloudOrderId);
    if (!existing || (existing.sourceReportType === "orders_revenue" && row.sourceReportType === "orders_sales")) {
      byOrderId.set(row.cleancloudOrderId, row);
    }
  }
  return Array.from(byOrderId.values()).sort((a, b) => {
    const aDate = a.sourceReportType === "orders_sales" ? a.paymentDateUtc : a.paidDateUtc;
    const bDate = b.sourceReportType === "orders_sales" ? b.paymentDateUtc : b.paidDateUtc;
    return (bDate?.getTime() ?? 0) - (aDate?.getTime() ?? 0) || Number(b.cleancloudOrderId) - Number(a.cleancloudOrderId);
  });
}

export function cleanCloudCandidateDate(row: CleanCloudCandidateOrder): string | null {
  return row.sourceReportType === "orders_sales"
    ? localBusinessDateForUtc(row.paymentDateUtc)
    : localBusinessDateForUtc(row.paidDateUtc);
}

export function buildSourceCoverageRows(input: {
  startDate: string;
  endDate: string;
  clearentDailySummaries: Array<Pick<ClearentDailySummary, "sourceReportBasis" | "reportDateUtc" | "totalSalesCents" | "depositAmountCents" | "netSalesCents">>;
  cleancloudCandidateOrders: CleanCloudCandidateOrder[];
}): SourceCoverageRow[] {
  const clearentEntered = new Map<string, number>();
  const clearentSettled = new Map<string, number>();
  const cleancloud = new Map<string, number>();

  for (const row of input.clearentDailySummaries) {
    const date = localBusinessDateForUtc(row.reportDateUtc);
    if (!date) continue;
    if (row.sourceReportBasis === "entered_date") {
      clearentEntered.set(date, (clearentEntered.get(date) ?? 0) + row.totalSalesCents);
    }
    if (row.sourceReportBasis === "settled_date") {
      clearentSettled.set(date, (clearentSettled.get(date) ?? 0) + (row.depositAmountCents ?? row.netSalesCents ?? row.totalSalesCents));
    }
  }

  for (const row of input.cleancloudCandidateOrders) {
    const date = cleanCloudCandidateDate(row);
    if (!date) continue;
    cleancloud.set(date, (cleancloud.get(date) ?? 0) + row.totalCents);
  }

  const rows: SourceCoverageRow[] = [];
  const cursor = new Date(`${input.startDate}T00:00:00Z`);
  const end = new Date(`${input.endDate}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    const date = cursor.toISOString().slice(0, 10);
    const entered = clearentEntered.get(date) ?? null;
    const settled = clearentSettled.get(date) ?? null;
    const cleancloudCents = cleancloud.get(date) ?? 0;
    const comparable = entered != null && cleancloudCents > 0;
    const unresolvedDeltaCents = comparable ? entered - cleancloudCents : 0;
    let status: SourceCoverageRow["status"] = "no_activity";
    if (comparable) status = unresolvedDeltaCents === 0 ? "matched" : "needs_review";
    else if (entered == null && cleancloudCents > 0) status = "missing_clearent";
    else if (entered != null && cleancloudCents === 0) status = "missing_cleancloud";
    else if (settled != null) status = "no_activity";
    rows.push({
      localBusinessDate: date,
      clearentEnteredCents: entered,
      clearentSettledCents: settled,
      cleancloudCandidateCents: cleancloudCents,
      comparable,
      status,
      unresolvedDeltaCents,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return rows.reverse();
}

export function reconcileClearentDailySummaryWithCleanCloudCandidates(
  summary: Pick<ClearentDailySummary, "reportDateUtc" | "totalSalesCents">,
  candidates: CleanCloudCandidateOrder[]
): DailyDateTotalReconciliation {
  const localBusinessDate = localBusinessDateForUtc(summary.reportDateUtc) ?? "";
  const chosen = chooseCleanCloudCandidatesForDate(localBusinessDate, candidates);
  const cleancloudCandidateOrderCents = chosen.reduce((sum, row) => sum + row.totalCents, 0);
  const unresolvedDeltaCents = summary.totalSalesCents - cleancloudCandidateOrderCents;
  const sourceReportType = chosen[0]?.sourceReportType ?? null;

  if (!chosen.length) {
    return {
      status: "unmatched",
      confidence: "low",
      localBusinessDate,
      clearentTotalCents: summary.totalSalesCents,
      cleancloudCandidateOrderCents,
      unresolvedDeltaCents,
      sourceReportType,
      candidates: chosen,
    };
  }

  return {
    status: unresolvedDeltaCents === 0 ? "date_total_match" : "needs_review",
    confidence: unresolvedDeltaCents === 0 ? "medium" : "low",
    localBusinessDate,
    clearentTotalCents: summary.totalSalesCents,
    cleancloudCandidateOrderCents,
    unresolvedDeltaCents,
    sourceReportType,
    candidates: chosen,
  };
}

export function reconciledCustomerRevenueCents(rows: Array<Pick<PaymentReconciliationMatch, "matchStatus" | "matchedAmountCents">>): number {
  return rows
    .filter((row) => row.matchStatus === "date_total_match" || row.matchStatus === "customer_match" || row.matchStatus === "manual_match")
    .reduce((sum, row) => sum + row.matchedAmountCents, 0);
}

export type ReconciledCleanCloudCustomerRevenue = {
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  cleancloudCustomerId: string | null;
  totalCollected: number;
  orderCount: number;
  firstBusinessDate: string;
  lastBusinessDate: string;
  buildingName: string | null;
  buildingSlug: string | null;
  tower: string | null;
  unit: string | null;
};

function normalizeFilters(input: PaymentReconciliationFilters = {}) {
  const timeZone = getDashboardTimeZone();
  const endDate = input.endDate?.trim() || zonedYmd(new Date(), timeZone);
  const fallbackStart = new Date();
  fallbackStart.setUTCDate(fallbackStart.getUTCDate() - 30);
  const startDate = input.startDate?.trim() || zonedYmd(fallbackStart, timeZone);
  const endExclusiveDate = zonedNextDayYmd(endDate, timeZone);
  return {
    startDate,
    endDate,
    startUtc: zonedDayStartUtc(startDate, timeZone),
    endExclusiveUtc: zonedDayStartUtc(endExclusiveDate, timeZone),
    processor: input.processor ?? "all",
    businessUnit: input.businessUnit ?? "all",
    status: input.status ?? "all",
  };
}

function tenantIdForBusinessUnit(filter: PaymentReconciliationBusinessUnitFilter): string | null {
  if (filter === "laundry_butler") return "default";
  if (filter === "laundry_farm") return "laundry_farm";
  return null;
}

function orderSourceForReportType(sourceReportType: "orders_sales" | "orders_revenue") {
  return sourceReportType === "orders_sales" ? "cleancloud_orders_sales" : "cleancloud_orders_revenue";
}

function buildMatchRows(
  summary: ClearentDailySummary,
  reconciliation: DailyDateTotalReconciliation
): InsertPaymentReconciliationMatch[] {
  const processorSourceId = String(summary.id);
  if (reconciliation.status === "date_total_match") {
    return reconciliation.candidates.map((candidate) => ({
      tenantId: candidate.tenantId,
      processor: "clearent",
      processorSourceType: "clearent_daily_summary",
      processorSourceId,
      orderSource: orderSourceForReportType(candidate.sourceReportType),
      orderId: null,
      cleancloudOrderId: candidate.cleancloudOrderId,
      cleancloudCustomerId: candidate.cleancloudCustomerId,
      customerName: candidate.customerName,
      customerEmail: candidate.customerEmail,
      customerPhone: candidate.customerPhone,
      buildingName: candidate.buildingName,
      buildingSlug: candidate.buildingSlug,
      tower: candidate.tower,
      unit: candidate.unit,
      matchedAmountCents: candidate.totalCents,
      matchStatus: "date_total_match",
      matchConfidence: "medium",
      matchReason: "Clearent daily entered total matches CleanCloud paid card orders for same local date.",
      localBusinessDate: reconciliation.localBusinessDate,
      rawJson: { clearentDailySummaryId: summary.id, cleancloudPaidOrderId: candidate.id },
    }));
  }

  return [
    {
      tenantId: reconciliation.candidates[0]?.tenantId ?? "default",
      processor: "clearent",
      processorSourceType: "clearent_daily_summary",
      processorSourceId,
      orderSource: reconciliation.sourceReportType ? orderSourceForReportType(reconciliation.sourceReportType) : "manual",
      orderId: null,
      cleancloudOrderId: null,
      cleancloudCustomerId: null,
      customerName: null,
      customerEmail: null,
      customerPhone: null,
      buildingName: null,
      buildingSlug: null,
      tower: null,
      unit: null,
      matchedAmountCents: 0,
      matchStatus: reconciliation.status,
      matchConfidence: reconciliation.confidence,
      matchReason:
        reconciliation.status === "needs_review"
          ? "Clearent daily entered total does not match CleanCloud paid card orders for same local date."
          : "No CleanCloud paid Clearent card orders were found for this Clearent daily summary date.",
      localBusinessDate: reconciliation.localBusinessDate,
      rawJson: {
        clearentDailySummaryId: summary.id,
        clearentTotalCents: reconciliation.clearentTotalCents,
        cleancloudCandidateOrderCents: reconciliation.cleancloudCandidateOrderCents,
        unresolvedDeltaCents: reconciliation.unresolvedDeltaCents,
        candidateOrderIds: reconciliation.candidates.map((row) => row.cleancloudOrderId),
      },
    },
  ];
}

async function loadCandidateRows(startUtc: Date, endExclusiveUtc: Date, tenantId: string | null): Promise<CleanCloudCandidateOrder[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const clauses = [
    eq(cleancloudPaidOrders.paid, true),
    sql`LOWER(${cleancloudPaidOrders.paymentType}) = ${"card"}`,
    sql`LOWER(COALESCE(${cleancloudPaidOrders.cardPaymentType}, '')) LIKE ${"%clearent%"}`,
    sql`(
      (${cleancloudPaidOrders.sourceReportType} = 'orders_sales' AND ${cleancloudPaidOrders.paymentDateUtc} >= ${startUtc} AND ${cleancloudPaidOrders.paymentDateUtc} < ${endExclusiveUtc})
      OR (${cleancloudPaidOrders.sourceReportType} = 'orders_revenue' AND ${cleancloudPaidOrders.paidDateUtc} >= ${startUtc} AND ${cleancloudPaidOrders.paidDateUtc} < ${endExclusiveUtc})
    )`,
  ];
  if (tenantId) clauses.push(eq(cleancloudPaidOrders.tenantId, tenantId));
  return db.select().from(cleancloudPaidOrders).where(and(...clauses));
}

export async function reconcileClearentDailySummaries(input: PaymentReconciliationFilters = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const filters = normalizeFilters(input);
  const tenantId = tenantIdForBusinessUnit(filters.businessUnit);
  const rawCandidates = await loadCandidateRows(filters.startUtc, filters.endExclusiveUtc, tenantId);
  const candidates = dedupeCleanCloudCandidates(rawCandidates);
  const summaryRows = await db
    .select()
    .from(clearentDailySummaries)
    .where(
      and(
        eq(clearentDailySummaries.sourceReportBasis, "entered_date"),
        gte(clearentDailySummaries.reportDateUtc, filters.startUtc),
        lt(clearentDailySummaries.reportDateUtc, filters.endExclusiveUtc)
      )
    )
    .orderBy(desc(clearentDailySummaries.reportDateUtc));

  const localDates = Array.from(
    new Set(summaryRows.map((summary) => localBusinessDateForUtc(summary.reportDateUtc)).filter((date): date is string => Boolean(date)))
  );
  for (const localDate of localDates) {
    await db
      .delete(paymentReconciliationMatches)
      .where(
        and(
          eq(paymentReconciliationMatches.processor, "clearent"),
          eq(paymentReconciliationMatches.processorSourceType, "clearent_daily_summary"),
          eq(paymentReconciliationMatches.localBusinessDate, localDate)
        )
      );
  }

  for (const summary of summaryRows) {
    const reconciliation = reconcileClearentDailySummaryWithCleanCloudCandidates(summary, candidates);
    const rows = buildMatchRows(summary, reconciliation);
    if (rows.length) await db.insert(paymentReconciliationMatches).values(rows);
  }

  return { processedSummaryCount: summaryRows.length };
}

function statusWhere(status: PaymentReconciliationStatusFilter) {
  if (status === "matched") {
    return sql`${paymentReconciliationMatches.matchStatus} IN ('customer_match','date_total_match','manual_match')`;
  }
  if (status === "all") return undefined;
  return eq(paymentReconciliationMatches.matchStatus, status);
}

export async function getPaymentReconciliationDashboard(input: PaymentReconciliationFilters = {}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const filters = normalizeFilters(input);
  await reconcileClearentDailySummaries(input);

  const tenantId = tenantIdForBusinessUnit(filters.businessUnit);
  const candidates = dedupeCleanCloudCandidates(await loadCandidateRows(filters.startUtc, filters.endExclusiveUtc, tenantId));
  const clearentDaily = await db
    .select()
    .from(clearentDailySummaries)
    .where(
      and(
        gte(clearentDailySummaries.reportDateUtc, filters.startUtc),
        lt(clearentDailySummaries.reportDateUtc, filters.endExclusiveUtc)
      )
    )
    .orderBy(desc(clearentDailySummaries.reportDateUtc));

  const matchClauses = [
    gte(sql`STR_TO_DATE(${paymentReconciliationMatches.localBusinessDate}, '%Y-%m-%d')`, filters.startDate),
    lt(sql`STR_TO_DATE(${paymentReconciliationMatches.localBusinessDate}, '%Y-%m-%d')`, zonedNextDayYmd(filters.endDate, getDashboardTimeZone())),
  ];
  if (filters.processor !== "all") matchClauses.push(eq(paymentReconciliationMatches.processor, filters.processor));
  if (tenantId) matchClauses.push(eq(paymentReconciliationMatches.tenantId, tenantId));
  const statusClause = statusWhere(filters.status);
  if (statusClause) matchClauses.push(statusClause);

  const matchedRows = await db
    .select()
    .from(paymentReconciliationMatches)
    .where(and(...matchClauses))
    .orderBy(desc(paymentReconciliationMatches.localBusinessDate), desc(paymentReconciliationMatches.id));

  const needsReviewRows = matchedRows.filter((row) => row.matchStatus === "needs_review");
  const unmatchedClearentRows = matchedRows.filter((row) => row.matchStatus === "unmatched");
  const exactMatchedRows = matchedRows.filter((row) => row.matchStatus === "date_total_match" || row.matchStatus === "customer_match" || row.matchStatus === "manual_match");
  const visibleMatchedRows = exactMatchedRows;
  const clearentCollectedCents = clearentDaily
    .filter((row) => row.sourceReportBasis === "entered_date")
    .reduce((sum, row) => sum + row.totalSalesCents, 0);
  const clearentSettledCents = clearentDaily
    .filter((row) => row.sourceReportBasis === "settled_date")
    .reduce((sum, row) => sum + (row.depositAmountCents ?? row.netSalesCents ?? row.totalSalesCents), 0);
  const sourceCoverage = buildSourceCoverageRows({
    startDate: filters.startDate,
    endDate: filters.endDate,
    clearentDailySummaries: clearentDaily,
    cleancloudCandidateOrders: candidates,
  });
  const allCleancloudCandidateOrderCents = candidates.reduce((sum, row) => sum + row.totalCents, 0);
  const comparableCleancloudCandidateOrderCents = sourceCoverage
    .filter((row) => row.clearentEnteredCents != null)
    .reduce((sum, row) => sum + row.cleancloudCandidateCents, 0);
  const reconciledCustomerRevenue = reconciledCustomerRevenueCents(visibleMatchedRows);
  const unresolvedDeltaCents = sourceCoverage
    .filter((row) => row.comparable && row.status === "needs_review")
    .reduce((sum, row) => sum + row.unresolvedDeltaCents, 0);

  return {
    filters,
    totals: {
      clearentCollectedCents,
      clearentSettledCents,
      cleancloudCandidateOrderCents: allCleancloudCandidateOrderCents,
      allCleancloudCandidateOrderCents,
      comparableCleancloudCandidateOrderCents,
      reconciledCustomerRevenueCents: reconciledCustomerRevenue,
      unmatchedClearentCents: unmatchedClearentRows.reduce((sum, row) => {
        const raw = row.rawJson as { clearentTotalCents?: number } | null;
        return sum + Number(raw?.clearentTotalCents ?? 0);
      }, 0),
      unmatchedCleanCloudOrderCents: Math.max(0, comparableCleancloudCandidateOrderCents - reconciledCustomerRevenue),
      possibleDuplicateCents: matchedRows
        .filter((row) => row.matchStatus === "possible_duplicate")
        .reduce((sum, row) => sum + row.matchedAmountCents, 0),
      unresolvedDeltaCents,
    },
    clearentDailySummaries: clearentDaily,
    cleancloudCandidateOrders: candidates,
    matchedRows: visibleMatchedRows,
    needsReviewRows,
    unmatchedClearentRows,
    unmatchedCleanCloudRows: [],
    sourceCoverage,
    warning: "Clearent import currently contains daily aggregate data, not transaction-level customer data.",
  };
}

export async function listReconciledCleanCloudCustomerRevenue(): Promise<ReconciledCleanCloudCustomerRevenue[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(paymentReconciliationMatches)
    .where(
      and(
        eq(paymentReconciliationMatches.processor, "clearent"),
        eq(paymentReconciliationMatches.processorSourceType, "clearent_daily_summary"),
        sql`${paymentReconciliationMatches.matchStatus} IN ('customer_match','date_total_match','manual_match')`
      )
    );

  const byKey = new Map<string, ReconciledCleanCloudCustomerRevenue>();
  for (const row of rows) {
    const key = row.cleancloudCustomerId || row.customerEmail || row.customerPhone || row.customerName || `match:${row.id}`;
    const existing = byKey.get(key) ?? {
      customerName: row.customerName || "CleanCloud customer",
      customerEmail: row.customerEmail,
      customerPhone: row.customerPhone || `cleancloud:${key}`,
      cleancloudCustomerId: row.cleancloudCustomerId,
      totalCollected: 0,
      orderCount: 0,
      firstBusinessDate: row.localBusinessDate,
      lastBusinessDate: row.localBusinessDate,
      buildingName: row.buildingName,
      buildingSlug: row.buildingSlug,
      tower: row.tower,
      unit: row.unit,
    };
    existing.totalCollected = Math.round((existing.totalCollected + row.matchedAmountCents / 100) * 100) / 100;
    existing.orderCount += 1;
    if (row.localBusinessDate < existing.firstBusinessDate) existing.firstBusinessDate = row.localBusinessDate;
    if (row.localBusinessDate > existing.lastBusinessDate) existing.lastBusinessDate = row.localBusinessDate;
    byKey.set(key, existing);
  }
  return Array.from(byKey.values());
}
