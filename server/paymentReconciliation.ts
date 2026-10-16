import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import {
  adminActionLog,
  cleancloudPaidOrders,
  clearentDailySummaries,
  clearentTransactions,
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
  const preservedByDate = new Map<string, PaymentReconciliationMatch[]>();
  for (const localDate of localDates) {
    const preserved = await db
      .select()
      .from(paymentReconciliationMatches)
      .where(
        and(
          eq(paymentReconciliationMatches.processor, "clearent"),
          eq(paymentReconciliationMatches.processorSourceType, "clearent_daily_summary"),
          eq(paymentReconciliationMatches.localBusinessDate, localDate),
          sql`${paymentReconciliationMatches.matchStatus} IN ('manual_match','ignored')`
        )
      );
    preservedByDate.set(localDate, preserved);
    await db
      .delete(paymentReconciliationMatches)
      .where(
        and(
          eq(paymentReconciliationMatches.processor, "clearent"),
          eq(paymentReconciliationMatches.processorSourceType, "clearent_daily_summary"),
          eq(paymentReconciliationMatches.localBusinessDate, localDate),
          sql`${paymentReconciliationMatches.matchStatus} NOT IN ('manual_match','ignored')`
        )
      );
  }

  for (const summary of summaryRows) {
    const localDate = localBusinessDateForUtc(summary.reportDateUtc) ?? "";
    const rows = automaticRowsRespectingOperatorDecisions({
      summary,
      candidates,
      preserved: preservedByDate.get(localDate) ?? [],
    });
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
  const ignoredRows = matchedRows.filter((row) => row.matchStatus === "ignored");
  const clearentTransactionRows = await db
    .select({
      id: clearentTransactions.id,
      clearentTransactionId: clearentTransactions.clearentTransactionId,
      grossAmountCents: clearentTransactions.grossAmountCents,
      enteredDateUtc: clearentTransactions.enteredDateUtc,
      customerName: clearentTransactions.customerName,
      sourceReportBasis: clearentTransactions.sourceReportBasis,
    })
    .from(clearentTransactions)
    .where(
      and(
        gte(clearentTransactions.enteredDateUtc, filters.startUtc),
        lt(clearentTransactions.enteredDateUtc, filters.endExclusiveUtc)
      )
    )
    .orderBy(desc(clearentTransactions.enteredDateUtc));
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
    ignoredRows,
    clearentTransactions: clearentTransactionRows,
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

const COUNTED_MATCH_STATUSES = new Set(["date_total_match", "customer_match", "manual_match"]);

export function isCountedReconciliationStatus(status: string): boolean {
  return COUNTED_MATCH_STATUSES.has(status);
}

export type ReconciliationAuditReceipt = {
  ok: true;
  outcome: "recorded" | "already_recorded";
  action: "manual_match" | "ignore";
  matchId: number;
  requestId: string;
  tenantId: string;
  matchedAmountCents: number;
  amountSource: "clearent_transaction_gross" | "unchanged";
  reconciledRevenueChanged: boolean;
  reason: string;
  auditLogId: number | null;
  sources: {
    clearentTransactionId: number | null;
    clearentDailySummaryId: number | null;
    cleancloudPaidOrderId: number | null;
    cleancloudOrderId: string | null;
  };
};

export type ReconciliationDecision =
  | {
      ok: true;
      outcome: "record" | "already_recorded";
      matchedAmountCents: number;
      amountSource: "clearent_transaction_gross" | "unchanged";
      reason: string;
      existingMatchId: number | null;
    }
  | { ok: false; reason: string };

function storedRequestId(rawJson: unknown): string | null {
  if (!rawJson || typeof rawJson !== "object") return null;
  const value = (rawJson as { requestId?: unknown }).requestId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function evaluateManualMatch(input: {
  tenantId: string;
  confirmed: boolean;
  requestId: string;
  candidate: CleanCloudCandidateOrder | null;
  transaction: {
    id: number;
    grossAmountCents: number | null;
    enteredDateUtc: Date | null;
  } | null;
  existing: Array<{
    id: number;
    tenantId: string;
    matchStatus: string;
    matchedAmountCents: number;
    processorSourceId: string | null;
    cleancloudOrderId: string | null;
    requestId: string | null;
  }>;
}): ReconciliationDecision {
  const requestId = input.requestId.trim();
  if (!requestId) return { ok: false, reason: "A request id is required so a repeated confirmation does not create a second match." };
  if (input.confirmed !== true) return { ok: false, reason: "Operator confirmation is required before a match is recorded." };
  if (input.tenantId !== "default") return { ok: false, reason: "Clearent transactions are not authorized for this tenant." };
  if (!input.transaction) return { ok: false, reason: "That Clearent transaction does not exist. A daily summary is not this order's captured money." };
  if (!input.candidate) return { ok: false, reason: "That CleanCloud order does not exist." };
  if (input.candidate.tenantId !== input.tenantId) return { ok: false, reason: "That CleanCloud order belongs to a different tenant." };
  if (!isCleanCloudClearentCandidate(input.candidate)) {
    return { ok: false, reason: "This order is not a paid Clearent card candidate, so it cannot be matched." };
  }
  const repeated = input.existing.find(row => row.requestId === requestId);
  if (repeated) {
    return {
      ok: true,
      outcome: "already_recorded",
      matchedAmountCents: repeated.matchedAmountCents,
      amountSource: "unchanged",
      reason: "This confirmation was already recorded. The stored amount was left unchanged.",
      existingMatchId: repeated.id,
    };
  }
  const transactionDate = localBusinessDateForUtc(input.transaction.enteredDateUtc);
  if (!transactionDate) return { ok: false, reason: "This Clearent transaction has no entered date, so it cannot be matched to an order date." };
  const orderDate = cleanCloudCandidateDate(input.candidate);
  if (orderDate !== transactionDate) {
    return { ok: false, reason: `The order date (${orderDate ?? "unknown"}) is not the Clearent transaction's entered date (${transactionDate}).` };
  }
  const captured = input.transaction.grossAmountCents;
  if (captured == null || !Number.isSafeInteger(captured) || captured < 0) {
    return { ok: false, reason: "This Clearent transaction has no stored gross amount. The order total was not used as captured money." };
  }
  if (captured !== input.candidate.totalCents) {
    return {
      ok: false,
      reason: `The Clearent transaction is ${captured} cents. The order total is ${input.candidate.totalCents} cents. Those are different facts, so no match was recorded and the order total was not treated as captured money.`,
    };
  }
  const sameTransaction = input.existing.find(
    row => row.processorSourceId === String(input.transaction!.id) && isCountedReconciliationStatus(row.matchStatus)
  );
  if (sameTransaction && sameTransaction.cleancloudOrderId === input.candidate.cleancloudOrderId) {
    return {
      ok: true,
      outcome: "already_recorded",
      matchedAmountCents: sameTransaction.matchedAmountCents,
      amountSource: "unchanged",
      reason: "This transaction is already matched to that order. The stored amount was left unchanged.",
      existingMatchId: sameTransaction.id,
    };
  }
  if (sameTransaction) return { ok: false, reason: "This Clearent transaction is already matched to a different order." };
  const sameOrder = input.existing.find(
    row => row.cleancloudOrderId === input.candidate!.cleancloudOrderId && isCountedReconciliationStatus(row.matchStatus)
  );
  if (sameOrder) return { ok: false, reason: "This order is already matched to a different Clearent source." };
  return {
    ok: true,
    outcome: "record",
    matchedAmountCents: captured,
    amountSource: "clearent_transaction_gross",
    reason: "Matched the stored Clearent transaction gross amount. The order total was not copied.",
    existingMatchId: null,
  };
}

export function evaluateIgnore(input: {
  tenantId: string;
  confirmed: boolean;
  requestId: string;
  reason: string;
  match: {
    id: number;
    tenantId: string;
    matchStatus: string;
    matchedAmountCents: number;
    requestId: string | null;
  } | null;
}): ReconciliationDecision {
  const requestId = input.requestId.trim();
  const reason = input.reason.trim();
  if (!requestId) return { ok: false, reason: "A request id is required so a repeated ignore does not create a second receipt." };
  if (input.confirmed !== true) return { ok: false, reason: "Operator confirmation is required before a row is ignored." };
  if (!reason) return { ok: false, reason: "Say why this row is being ignored." };
  if (input.tenantId !== "default") return { ok: false, reason: "Clearent reconciliation rows are not authorized for this tenant." };
  if (!input.match) return { ok: false, reason: "That reconciliation row does not exist." };
  if (input.match.tenantId !== input.tenantId) return { ok: false, reason: "That reconciliation row belongs to a different tenant." };
  if (input.match.requestId === requestId || input.match.matchStatus === "ignored") {
    return {
      ok: true,
      outcome: "already_recorded",
      matchedAmountCents: input.match.matchedAmountCents,
      amountSource: "unchanged",
      reason: "This row is already ignored. Captured revenue was not changed.",
      existingMatchId: input.match.id,
    };
  }
  if (isCountedReconciliationStatus(input.match.matchStatus)) {
    return { ok: false, reason: "This row is already counted as reconciled revenue. Ignoring it would change that claim without a reversing source fact." };
  }
  if (!["needs_review", "unmatched", "possible_duplicate"].includes(input.match.matchStatus)) {
    return { ok: false, reason: `A ${input.match.matchStatus} row cannot be ignored from this page.` };
  }
  return {
    ok: true,
    outcome: "record",
    matchedAmountCents: input.match.matchedAmountCents,
    amountSource: "unchanged",
    reason,
    existingMatchId: input.match.id,
  };
}

export function automaticRowsRespectingOperatorDecisions(input: {
  summary: ClearentDailySummary;
  candidates: CleanCloudCandidateOrder[];
  preserved: PaymentReconciliationMatch[];
}): InsertPaymentReconciliationMatch[] {
  const summaryId = String(input.summary.id);
  const preservedForSummary = input.preserved.filter(row => row.processorSourceId === summaryId);
  if (preservedForSummary.some(row => row.matchStatus === "ignored")) return [];
  const manual = preservedForSummary.filter(row => row.matchStatus === "manual_match");
  const excluded = new Set(manual.map(row => row.cleancloudOrderId).filter((id): id is string => Boolean(id)));
  const reservedCents = manual.reduce((sum, row) => sum + row.matchedAmountCents, 0);
  const remainingCents = input.summary.totalSalesCents - reservedCents;
  const remainingCandidates = input.candidates.filter(row => !excluded.has(row.cleancloudOrderId));
  if (remainingCents < 0) return [];
  if (remainingCandidates.length === 0 && remainingCents === 0) return [];
  const virtualSummary = { ...input.summary, totalSalesCents: remainingCents };
  return buildMatchRows(
    virtualSummary,
    reconcileClearentDailySummaryWithCleanCloudCandidates(virtualSummary, remainingCandidates)
  );
}

async function writeReconciliationReceipt(input: {
  tenantId: string;
  actionType: "payment_reconciliation_manual_match" | "payment_reconciliation_ignore";
  entityId: string;
  dollarValueCents: number;
  metadata: Record<string, unknown>;
}): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const inserted = await db.insert(adminActionLog).values({
    tenantId: input.tenantId,
    actionType: input.actionType,
    entityType: "order",
    entityId: input.entityId,
    dollarValueCents: input.dollarValueCents,
    status: "delivered",
    source: "manual_action",
    metadata: input.metadata,
  });
  return Number(inserted[0]?.insertId ?? 0) || null;
}

export async function recordManualReconciliationMatch(input: {
  tenantId: string;
  actorUserId: string;
  confirmed: boolean;
  requestId: string;
  clearentTransactionId: number;
  cleancloudPaidOrderId: number;
}): Promise<ReconciliationAuditReceipt | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "Database unavailable. No match was recorded." };
  const [transaction] = await db
    .select()
    .from(clearentTransactions)
    .where(eq(clearentTransactions.id, input.clearentTransactionId))
    .limit(1);
  const [candidate] = await db
    .select()
    .from(cleancloudPaidOrders)
    .where(eq(cleancloudPaidOrders.id, input.cleancloudPaidOrderId))
    .limit(1);
  const existingRows = await db
    .select()
    .from(paymentReconciliationMatches)
    .where(eq(paymentReconciliationMatches.tenantId, input.tenantId));
  const existing = existingRows.map(row => ({
    id: row.id,
    tenantId: row.tenantId,
    matchStatus: row.matchStatus,
    matchedAmountCents: row.matchedAmountCents,
    processorSourceId: row.processorSourceId,
    cleancloudOrderId: row.cleancloudOrderId,
    requestId: storedRequestId(row.rawJson),
  }));
  const decision = evaluateManualMatch({
    tenantId: input.tenantId,
    confirmed: input.confirmed,
    requestId: input.requestId,
    candidate: candidate ?? null,
    transaction: transaction
      ? { id: transaction.id, grossAmountCents: transaction.grossAmountCents, enteredDateUtc: transaction.enteredDateUtc }
      : null,
    existing,
  });
  if (!decision.ok) return decision;
  if (decision.outcome === "already_recorded" && decision.existingMatchId) {
    const prior = existingRows.find(row => row.id === decision.existingMatchId);
    return {
      ok: true,
      outcome: "already_recorded",
      action: "manual_match",
      matchId: decision.existingMatchId,
      requestId: storedRequestId(prior?.rawJson) ?? input.requestId.trim(),
      tenantId: input.tenantId,
      matchedAmountCents: decision.matchedAmountCents,
      amountSource: "unchanged",
      reconciledRevenueChanged: false,
      reason: decision.reason,
      auditLogId: null,
      sources: {
        clearentTransactionId: transaction?.id ?? null,
        clearentDailySummaryId: null,
        cleancloudPaidOrderId: candidate?.id ?? null,
        cleancloudOrderId: candidate?.cleancloudOrderId ?? prior?.cleancloudOrderId ?? null,
      },
    };
  }
  if (!candidate || !transaction) return { ok: false, reason: "The source rows disappeared before the match could be recorded." };
  const localBusinessDate = localBusinessDateForUtc(transaction.enteredDateUtc) ?? "";
  const inserted = await db.insert(paymentReconciliationMatches).values({
    tenantId: input.tenantId,
    processor: "clearent",
    processorSourceType: "clearent_transaction",
    processorSourceId: String(transaction.id),
    orderSource: candidate.sourceReportType === "orders_sales" ? "cleancloud_orders_sales" : "cleancloud_orders_revenue",
    orderId: null,
    cleancloudOrderId: candidate.cleancloudOrderId,
    cleancloudCustomerId: candidate.cleancloudCustomerId,
    customerName: transaction.customerName ?? candidate.customerName,
    customerEmail: candidate.customerEmail,
    customerPhone: candidate.customerPhone,
    buildingName: candidate.buildingName,
    buildingSlug: candidate.buildingSlug,
    tower: candidate.tower,
    unit: candidate.unit,
    matchedAmountCents: decision.matchedAmountCents,
    matchStatus: "manual_match",
    matchConfidence: "high",
    matchReason: decision.reason,
    localBusinessDate,
    rawJson: {
      operatorDecision: true,
      requestId: input.requestId.trim(),
      actorUserId: input.actorUserId,
      confirmed: true,
      amountSource: "clearent_transaction_gross",
      clearentTransactionRowId: transaction.id,
      clearentTransactionId: transaction.clearentTransactionId,
      cleancloudPaidOrderId: candidate.id,
      orderTotalCents: candidate.totalCents,
    },
  });
  const matchId = Number(inserted[0]?.insertId ?? 0);
  const auditLogId = await writeReconciliationReceipt({
    tenantId: input.tenantId,
    actionType: "payment_reconciliation_manual_match",
    entityId: candidate.cleancloudOrderId,
    dollarValueCents: decision.matchedAmountCents,
    metadata: {
      requestId: input.requestId.trim(),
      matchId,
      amountSource: "clearent_transaction_gross",
      clearentTransactionRowId: transaction.id,
      cleancloudPaidOrderId: candidate.id,
      orderTotalCentsNotUsedAsCaptured: candidate.totalCents,
    },
  });
  return {
    ok: true,
    outcome: "recorded",
    action: "manual_match",
    matchId,
    requestId: input.requestId.trim(),
    tenantId: input.tenantId,
    matchedAmountCents: decision.matchedAmountCents,
    amountSource: "clearent_transaction_gross",
    reconciledRevenueChanged: true,
    reason: decision.reason,
    auditLogId,
    sources: {
      clearentTransactionId: transaction.id,
      clearentDailySummaryId: null,
      cleancloudPaidOrderId: candidate.id,
      cleancloudOrderId: candidate.cleancloudOrderId,
    },
  };
}

export async function ignoreReconciliationRow(input: {
  tenantId: string;
  actorUserId: string;
  confirmed: boolean;
  requestId: string;
  reason: string;
  matchId: number;
}): Promise<ReconciliationAuditReceipt | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "Database unavailable. Nothing was ignored." };
  const [match] = await db
    .select()
    .from(paymentReconciliationMatches)
    .where(and(eq(paymentReconciliationMatches.id, input.matchId), eq(paymentReconciliationMatches.tenantId, input.tenantId)))
    .limit(1);
  const decision = evaluateIgnore({
    tenantId: input.tenantId,
    confirmed: input.confirmed,
    requestId: input.requestId,
    reason: input.reason,
    match: match
      ? {
          id: match.id,
          tenantId: match.tenantId,
          matchStatus: match.matchStatus,
          matchedAmountCents: match.matchedAmountCents,
          requestId: storedRequestId(match.rawJson),
        }
      : null,
  });
  if (!decision.ok) return decision;
  if (decision.outcome === "already_recorded") {
    return {
      ok: true,
      outcome: "already_recorded",
      action: "ignore",
      matchId: match?.id ?? input.matchId,
      requestId: storedRequestId(match?.rawJson) ?? input.requestId.trim(),
      tenantId: input.tenantId,
      matchedAmountCents: decision.matchedAmountCents,
      amountSource: "unchanged",
      reconciledRevenueChanged: false,
      reason: decision.reason,
      auditLogId: null,
      sources: {
        clearentTransactionId: null,
        clearentDailySummaryId: match?.processorSourceId ? Number(match.processorSourceId) : null,
        cleancloudPaidOrderId: null,
        cleancloudOrderId: match?.cleancloudOrderId ?? null,
      },
    };
  }
  if (!match) return { ok: false, reason: "That reconciliation row does not exist." };
  const previousRaw = match.rawJson && typeof match.rawJson === "object" ? match.rawJson : {};
  await db
    .update(paymentReconciliationMatches)
    .set({
      matchStatus: "ignored",
      matchedAmountCents: match.matchedAmountCents,
      matchReason: decision.reason,
      rawJson: {
        ...(previousRaw as Record<string, unknown>),
        operatorDecision: true,
        requestId: input.requestId.trim(),
        actorUserId: input.actorUserId,
        confirmed: true,
        ignoredFromStatus: match.matchStatus,
      },
    })
    .where(and(eq(paymentReconciliationMatches.id, match.id), eq(paymentReconciliationMatches.tenantId, input.tenantId)));
  const auditLogId = await writeReconciliationReceipt({
    tenantId: input.tenantId,
    actionType: "payment_reconciliation_ignore",
    entityId: match.cleancloudOrderId || `payment-reconciliation-match:${match.id}`,
    dollarValueCents: 0,
    metadata: {
      requestId: input.requestId.trim(),
      matchId: match.id,
      previousStatus: match.matchStatus,
      reason: decision.reason,
      capturedRevenueUnchanged: true,
    },
  });
  return {
    ok: true,
    outcome: "recorded",
    action: "ignore",
    matchId: match.id,
    requestId: input.requestId.trim(),
    tenantId: input.tenantId,
    matchedAmountCents: match.matchedAmountCents,
    amountSource: "unchanged",
    reconciledRevenueChanged: false,
    reason: decision.reason,
    auditLogId,
    sources: {
      clearentTransactionId: null,
      clearentDailySummaryId: match.processorSourceId ? Number(match.processorSourceId) : null,
      cleancloudPaidOrderId: null,
      cleancloudOrderId: match.cleancloudOrderId,
    },
  };
}
