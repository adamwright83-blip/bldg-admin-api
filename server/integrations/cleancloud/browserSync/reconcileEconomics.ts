/**
 * Three control totals for one period. None of them is allowed to stand in
 * for a missing one. A sales import is not a revenue report.
 */
import { createHash } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import {
  partitionCleanCloudOrders,
  type CleanCloudOrderRow,
} from "../../../analytics/paidOrderLedger";

export const RECONCILIATION_STATUSES = [
  "reconciled",
  "mismatch",
  "insufficient_evidence",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const VERIFIED_EVENT_TYPES = [
  "economic.mom_revenue_gain_verified",
  "economic.revenue_drop_verified",
  "economic.monthly_revenue_record_verified",
] as const;
export type VerifiedEventType = (typeof VERIFIED_EVENT_TYPES)[number];

/** Named so a future change cannot emit them by accident. Evidence does not exist yet. */
export const UNEVIDENCED_EVENT_TYPES = [
  "economic.customer_reactivated_verified",
  "economic.new_recurring_customer_verified",
] as const;

const ZONE = "America/Los_Angeles";

export type WitnessControl = {
  id: string;
  rangeFrom: string;
  rangeTo: string;
  revenueCents: number;
  comparisonFrom: string | null;
  comparisonTo: string | null;
  comparisonRevenueCents: number | null;
};

export type ReconciliationDraft = {
  status: ReconciliationStatus;
  dashboardWitnessId: string | null;
  dashboardRevenueCents: number | null;
  revenueReportCents: number | null;
  bookCents: number | null;
  discrepancyCents: number | null;
  evidenceIds: string[];
  coverage: {
    orderCreatedCoverage: boolean;
    paymentEventCoverage: boolean;
    dashboardControlCoverage: boolean;
    reconciliation: ReconciliationStatus;
  };
};

export type VerifiedEconomicEvent = {
  eventType: VerifiedEventType;
  periodFrom: string;
  periodTo: string;
  comparisonFrom: string | null;
  comparisonTo: string | null;
  currentRevenueCents: number;
  comparisonRevenueCents: number | null;
  deltaCents: number;
  deltaPercentHundredths: number | null;
  evidenceIds: string[];
  idempotencyKey: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function reconciliationEvidenceHash(draft: ReconciliationDraft): string {
  return sha256(
    [
      draft.status,
      draft.dashboardRevenueCents ?? "",
      draft.revenueReportCents ?? "",
      draft.bookCents ?? "",
      draft.discrepancyCents ?? "",
      ...draft.evidenceIds,
    ].join("|")
  );
}

function businessDate(value: Date): string {
  return formatInTimeZone(value, ZONE, "yyyy-MM-dd");
}

function inPeriod(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function gap(left: number, right: number): number {
  return Math.abs(left - right);
}

export function revenueReportEvidence(
  rows: readonly CleanCloudOrderRow[],
  period: { from: string; to: string },
  covered: boolean
): { cents: number; evidenceId: string } | null {
  // Rows alone do not prove the report was complete. Direct CSV imports can
  // write paid CleanCloud rows without an exact browser-sync receipt, so even
  // a non-empty matching subtotal is insufficient unless this exact period is
  // receipt-covered.
  if (!covered) return null;
  const revenue = rows.filter(row => row.sourceReportType === "orders_revenue" && row.paid);
  if (revenue.some(row => !row.paidDateUtc)) return null;
  const placed = new Map<string, number>();
  for (const row of revenue) {
    const date = businessDate(row.paidDateUtc!);
    if (!inPeriod(date, period.from, period.to)) continue;
    const cents = Math.round(Number(row.totalCents ?? 0));
    const prior = placed.get(row.cleancloudOrderId);
    if (prior !== undefined && prior !== cents) return null;
    placed.set(row.cleancloudOrderId, cents);
  }
  if (placed.size === 0 && !covered) return null;
  const orderIds = [...placed.keys()].sort();
  const cents = orderIds.reduce((sum, id) => sum + (placed.get(id) ?? 0), 0);
  return {
    cents,
    evidenceId: `revenue-report:${sha256(`${period.from}|${period.to}|${cents}|${orderIds.join(",")}`)}`,
  };
}

export function economicBookEvidence(
  rows: readonly CleanCloudOrderRow[],
  period: { from: string; to: string }
): { cents: number; evidenceId: string } | null {
  const paid = rows.filter(row => row.paid);
  if (paid.some(row => !row.paymentDateUtc && !row.paidDateUtc)) return null;
  const window = {
    startUtc: new Date("2000-01-01T00:00:00.000Z"),
    endExclusiveUtc: new Date("2100-01-01T00:00:00.000Z"),
  };
  const { events } = partitionCleanCloudOrders(paid, window, ZONE);
  const kept = events.filter(event => inPeriod(event.businessDate, period.from, period.to));
  const eventKeys = kept.map(event => event.eventKey).sort();
  const cents = kept.reduce((sum, event) => sum + event.cents, 0);
  return {
    cents,
    evidenceId: `book:${sha256(`${period.from}|${period.to}|${cents}|${eventKeys.join(",")}`)}`,
  };
}

export function reconcileControlTotals(input: {
  periodFrom: string;
  periodTo: string;
  witness: WitnessControl | null;
  rows: readonly CleanCloudOrderRow[] | null;
  /** True only when an Orders (Revenue) receipt proves this period was exported. */
  revenueReportCovered: boolean;
  orderCreatedCoverage: boolean;
}): ReconciliationDraft {
  const witness =
    input.witness &&
    input.witness.rangeFrom === input.periodFrom &&
    input.witness.rangeTo === input.periodTo
      ? input.witness
      : null;
  const report = input.rows
    ? revenueReportEvidence(
        input.rows,
        { from: input.periodFrom, to: input.periodTo },
        input.revenueReportCovered
      )
    : null;
  const book = input.rows
    ? economicBookEvidence(input.rows, { from: input.periodFrom, to: input.periodTo })
    : null;
  const dashboardControlCoverage = witness !== null;
  const paymentEventCoverage = report !== null;
  const evidenceIds = [
    witness ? `witness:${witness.id}` : null,
    report?.evidenceId ?? null,
    book?.evidenceId ?? null,
  ].filter((id): id is string => Boolean(id));
  const base = {
    dashboardWitnessId: witness?.id ?? null,
    dashboardRevenueCents: witness?.revenueCents ?? null,
    revenueReportCents: report?.cents ?? null,
    bookCents: book?.cents ?? null,
    evidenceIds,
  };
  if (!witness || !report || !book) {
    return {
      ...base,
      status: "insufficient_evidence",
      discrepancyCents: null,
      coverage: {
        orderCreatedCoverage: input.orderCreatedCoverage,
        paymentEventCoverage,
        dashboardControlCoverage,
        reconciliation: "insufficient_evidence",
      },
    };
  }
  const same =
    witness.revenueCents === report.cents && report.cents === book.cents;
  const discrepancyCents = same
    ? 0
    : Math.max(
        gap(witness.revenueCents, report.cents),
        gap(witness.revenueCents, book.cents),
        gap(report.cents, book.cents)
      );
  const status: ReconciliationStatus = same ? "reconciled" : "mismatch";
  return {
    ...base,
    status,
    discrepancyCents,
    coverage: {
      orderCreatedCoverage: input.orderCreatedCoverage,
      paymentEventCoverage: true,
      dashboardControlCoverage: true,
      reconciliation: status,
    },
  };
}

function percentHundredths(current: number, prior: number): number | null {
  if (prior === 0) return null;
  const hundredths = Math.round(((current - prior) / prior) * 10000);
  return Number.isSafeInteger(hundredths) ? hundredths : null;
}

function isCalendarMonth(from: string, to: string): boolean {
  if (!from.endsWith("-01")) return false;
  const [year, month] = from.split("-").map(Number);
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  return to === `${from.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

function eventKey(event: Omit<VerifiedEconomicEvent, "idempotencyKey">, tenantId: string): string {
  return sha256(
    [
      tenantId,
      event.eventType,
      event.periodFrom,
      event.periodTo,
      event.comparisonFrom ?? "",
      event.comparisonTo ?? "",
      [...event.evidenceIds].sort().join(","),
    ].join("|")
  );
}

export type PriorReconciliation = {
  id: string;
  rangeFrom: string;
  rangeTo: string;
  status: ReconciliationStatus;
  dashboardRevenueCents: number | null;
  evidenceIds: string[];
};

export function verifiedEventsFromReconciliation(input: {
  tenantId: string;
  current: ReconciliationDraft;
  witness: WitnessControl | null;
  prior: readonly PriorReconciliation[];
}): VerifiedEconomicEvent[] {
  if (input.current.status !== "reconciled" || input.current.dashboardRevenueCents === null) {
    return [];
  }
  const events: Omit<VerifiedEconomicEvent, "idempotencyKey">[] = [];
  const witness = input.witness;
  const comparison = input.prior.find(
    row =>
      witness?.comparisonFrom &&
      witness.comparisonTo &&
      row.rangeFrom === witness.comparisonFrom &&
      row.rangeTo === witness.comparisonTo
  );
  if (
    witness &&
    witness.comparisonFrom &&
    witness.comparisonTo &&
    witness.comparisonTo < witness.rangeFrom &&
    witness.comparisonRevenueCents !== null &&
    comparison?.status === "reconciled" &&
    comparison.dashboardRevenueCents === witness.comparisonRevenueCents &&
    input.current.dashboardRevenueCents === witness.revenueCents
  ) {
    const deltaCents = witness.revenueCents - witness.comparisonRevenueCents;
    if (deltaCents !== 0) {
      events.push({
        eventType:
          deltaCents > 0
            ? "economic.mom_revenue_gain_verified"
            : "economic.revenue_drop_verified",
        periodFrom: witness.rangeFrom,
        periodTo: witness.rangeTo,
        comparisonFrom: witness.comparisonFrom,
        comparisonTo: witness.comparisonTo,
        currentRevenueCents: witness.revenueCents,
        comparisonRevenueCents: witness.comparisonRevenueCents,
        deltaCents,
        deltaPercentHundredths: percentHundredths(
          witness.revenueCents,
          witness.comparisonRevenueCents
        ),
        evidenceIds: [...input.current.evidenceIds, ...comparison.evidenceIds].sort(),
      });
    }
  }

  const currentCents = input.current.dashboardRevenueCents;
  if (isCalendarMonth(input.current.dashboardWitnessId ? (witness?.rangeFrom ?? "") : "", witness?.rangeTo ?? "")) {
    const priors = input.prior.filter(
      row => row.rangeTo < (witness?.rangeFrom ?? "") && isCalendarMonth(row.rangeFrom, row.rangeTo)
    );
    const reconciledPriors = priors.filter(row => row.status === "reconciled" && row.dashboardRevenueCents !== null);
    if (
      witness &&
      reconciledPriors.length > 0 &&
      reconciledPriors.length === priors.length &&
      reconciledPriors.every(row => row.dashboardRevenueCents! < currentCents)
    ) {
      const earliest = reconciledPriors.map(row => row.rangeFrom).sort()[0]!;
      const cursor = new Date(`${earliest}T00:00:00.000Z`);
      const end = new Date(`${witness.rangeFrom}T00:00:00.000Z`);
      let complete = true;
      for (let month = cursor; month < end; month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))) {
        const from = month.toISOString().slice(0, 10);
        if (!reconciledPriors.some(row => row.rangeFrom === from) && from !== witness.rangeFrom) {
          complete = false;
          break;
        }
      }
      if (complete) {
        events.push({
          eventType: "economic.monthly_revenue_record_verified",
          periodFrom: witness.rangeFrom,
          periodTo: witness.rangeTo,
          comparisonFrom: null,
          comparisonTo: null,
          currentRevenueCents: currentCents,
          comparisonRevenueCents: null,
          deltaCents: currentCents - Math.max(...reconciledPriors.map(row => row.dashboardRevenueCents!)),
          deltaPercentHundredths: null,
          evidenceIds: [
            ...input.current.evidenceIds,
            ...reconciledPriors.flatMap(row => row.evidenceIds),
          ].sort(),
        });
      }
    }
  }

  return events
    .filter(event => !UNEVIDENCED_EVENT_TYPES.includes(event.eventType as never))
    .map(event => ({ ...event, idempotencyKey: eventKey(event, input.tenantId) }));
}
