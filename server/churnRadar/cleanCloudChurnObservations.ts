/**
 * CleanCloud rows are observations for churn, not native orders.
 *
 * Sales and revenue exports can both describe the same cleancloudOrderId.
 * Churn keeps one observation per order. It prefers the revenue row's
 * paidDateUtc when that row exists, and otherwise the sales row's
 * paymentDateUtc ?? paidDateUtc. Totals are never added together.
 *
 * Identity is phone, else email, else cleancloudCustomerId. Display names
 * are not identity. allowNameComposite stays false.
 */
import {
  classifyCleanCloudService,
  cleanCloudServiceLines,
  normalizeCleanCloudServiceName,
} from "../analytics/cleancloudServiceClass";
import {
  groupCustomerRecords,
  identityCandidateKeys,
} from "../customerAssets/customerIdentity";
import {
  scoreCustomerChurn,
  serviceLabel,
  type CustomerChurnScore,
  type CustomerHistoryObservation,
} from "@shared/customerChurn";

export type CleanCloudChurnSourceRow = {
  cleancloudOrderId: string;
  sourceReportType: "orders_sales" | "orders_revenue";
  paid: boolean;
  customerPhone: string | null;
  customerEmail: string | null;
  cleancloudCustomerId: string | null;
  customerName: string | null;
  totalCents: number | null;
  totalWeightLbs: string | number | null;
  summaryText: string | null;
  paidDateUtc: Date | null;
  paymentDateUtc: Date | null;
};

export type CleanCloudChurnObservation = {
  externalOrderId: string;
  serviceAt: Date | null;
  valueCents: number;
  weightLbs: number | null;
  serviceType: "wash_fold" | "dry_cleaning" | null;
  customerName: string;
  phone: string | null;
  email: string | null;
  cleancloudCustomerId: string | null;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isRealDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function provenCents(value: number | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
}

/** A stored weight is used. A missing weight stays null. Nothing is invented. */
export function provenWeightLbs(
  value: string | number | null | undefined
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function lineProvesDryCleaning(line: string): boolean {
  const normalized = normalizeCleanCloudServiceName(line);
  return (
    /\bdry clean(?:ing)?\b/.test(normalized) ||
    normalized.includes("drycleaning")
  );
}

/**
 * Wash & fold only when every summary line is a known laundry catalog item.
 * Dry cleaning only when every line explicitly says dry cleaning.
 * The shared classifier treats any other line as dry cleaning. Churn does not.
 */
export function provenCleanCloudServiceType(
  summaryText: string | null | undefined
): "wash_fold" | "dry_cleaning" | null {
  const text = summaryText ?? null;
  const classified = classifyCleanCloudService({ summaryText: text });
  if (classified === "laundry") return "wash_fold";
  if (classified !== "dry_cleaning") return null;
  const lines = cleanCloudServiceLines(text);
  if (lines.length === 0 || !lines.every(lineProvesDryCleaning)) return null;
  return "dry_cleaning";
}

function provenServiceType(
  revenue: CleanCloudChurnSourceRow | undefined,
  sales: CleanCloudChurnSourceRow | undefined
): "wash_fold" | "dry_cleaning" | null {
  const fromRevenue = revenue
    ? provenCleanCloudServiceType(revenue.summaryText)
    : null;
  const fromSales = sales ? provenCleanCloudServiceType(sales.summaryText) : null;
  if (fromRevenue && fromSales && fromRevenue !== fromSales) return null;
  return fromRevenue ?? fromSales;
}

function serviceAtFor(
  revenue: CleanCloudChurnSourceRow | undefined,
  sales: CleanCloudChurnSourceRow | undefined
): Date | null {
  if (revenue) {
    if (isRealDate(revenue.paidDateUtc)) return revenue.paidDateUtc;
    // Same order, other export. Not a second observation and not a guessed date.
    if (isRealDate(sales?.paymentDateUtc)) return sales.paymentDateUtc;
    if (isRealDate(sales?.paidDateUtc)) return sales.paidDateUtc;
    return null;
  }
  if (isRealDate(sales?.paymentDateUtc)) return sales.paymentDateUtc;
  if (isRealDate(sales?.paidDateUtc)) return sales.paidDateUtc;
  return null;
}

function firstPresent(
  revenue: string | null | undefined,
  sales: string | null | undefined
): string | null {
  return blankToNull(revenue) ?? blankToNull(sales);
}

/**
 * One paid observation per cleancloudOrderId. Unpaid rows are ignored.
 * Sales + revenue for the same id contribute one value, not a sum.
 */
export function partitionCleanCloudChurnOrders(
  rows: readonly CleanCloudChurnSourceRow[]
): CleanCloudChurnObservation[] {
  const grouped = new Map<string, CleanCloudChurnSourceRow[]>();
  for (const row of rows) {
    if (!row.paid) continue;
    const orderId = row.cleancloudOrderId.trim();
    if (!orderId) continue;
    const list = grouped.get(orderId) ?? [];
    list.push(row);
    grouped.set(orderId, list);
  }

  const observations: CleanCloudChurnObservation[] = [];
  for (const [externalOrderId, group] of grouped) {
    const revenue = group.find(row => row.sourceReportType === "orders_revenue");
    const sales = group.find(row => row.sourceReportType === "orders_sales");
    const carrier = revenue ?? sales;
    if (!carrier) continue;
    observations.push({
      externalOrderId,
      serviceAt: serviceAtFor(revenue, sales),
      valueCents: revenue
        ? provenCents(revenue.totalCents)
        : provenCents(sales?.totalCents),
      weightLbs:
        provenWeightLbs(revenue?.totalWeightLbs) ??
        provenWeightLbs(sales?.totalWeightLbs),
      serviceType: provenServiceType(revenue, sales),
      customerName:
        firstPresent(revenue?.customerName, sales?.customerName) ?? "Customer",
      phone: firstPresent(revenue?.customerPhone, sales?.customerPhone),
      email: firstPresent(revenue?.customerEmail, sales?.customerEmail),
      cleancloudCustomerId: firstPresent(
        revenue?.cleancloudCustomerId,
        sales?.cleancloudCustomerId
      ),
    });
  }
  return observations;
}

export function cleanCloudIdentityInput(observation: {
  phone: string | null;
  email: string | null;
  cleancloudCustomerId: string | null;
}) {
  return {
    phone: observation.phone,
    email: observation.email,
    cleancloudCustomerId: observation.cleancloudCustomerId,
    allowNameComposite: false as const,
  };
}

export function hasCleanCloudChurnIdentity(observation: {
  phone: string | null;
  email: string | null;
  cleancloudCustomerId: string | null;
}): boolean {
  return identityCandidateKeys(cleanCloudIdentityInput(observation)).length > 0;
}

/** Skips rows with no phone, email, or CleanCloud customer id. Never groups on name. */
export function groupCleanCloudChurnCustomers<T extends CleanCloudChurnObservation>(
  tenantId: string,
  observations: readonly T[]
) {
  const identifiable = observations.filter(hasCleanCloudChurnIdentity);
  return groupCustomerRecords(tenantId, identifiable, cleanCloudIdentityInput);
}

function datedObservations(
  observations: readonly CleanCloudChurnObservation[]
): Array<CleanCloudChurnObservation & { serviceAt: Date }> {
  return observations
    .filter(
      (
        observation
      ): observation is CleanCloudChurnObservation & { serviceAt: Date } =>
        isRealDate(observation.serviceAt)
    )
    .sort((left, right) => left.serviceAt.getTime() - right.serviceAt.getTime());
}

export function cleanCloudHistory(
  observations: readonly CleanCloudChurnObservation[]
): CustomerHistoryObservation[] {
  return datedObservations(observations).map(observation => ({
    orderId: null,
    externalOrderId: observation.externalOrderId,
    serviceAt: observation.serviceAt,
    valueCents: observation.valueCents,
    weightLbs: observation.weightLbs,
    serviceType: observation.serviceType,
  }));
}

export function describeCleanCloudChurnCustomer(input: {
  customerKey: string;
  observations: readonly CleanCloudChurnObservation[];
  activeOrderCount?: number;
  now?: Date;
}): {
  customerKey: string;
  customerName: string;
  customerPhone: string | null;
  lastOrderId: null;
  externalOrderRef: string;
  orderSource: "cleancloud";
  lastServiceLabel: string;
  history: CustomerHistoryObservation[];
  score: CustomerChurnScore;
} | null {
  const dated = datedObservations(input.observations);
  if (dated.length < 2) return null;
  const latest = dated.at(-1)!;
  const history = cleanCloudHistory(dated);
  const phone = [...dated]
    .reverse()
    .map(observation => blankToNull(observation.phone))
    .find((value): value is string => Boolean(value)) ?? null;
  const score = scoreCustomerChurn({
    customerKey: input.customerKey,
    customerName: latest.customerName.trim() || "Customer",
    history,
    activeOrderCount: input.activeOrderCount ?? 0,
    now: input.now,
  });
  return {
    customerKey: input.customerKey,
    customerName: latest.customerName.trim() || "Customer",
    customerPhone: phone,
    lastOrderId: null,
    externalOrderRef: latest.externalOrderId,
    orderSource: "cleancloud",
    lastServiceLabel: serviceLabel(latest.serviceType),
    history,
    score,
  };
}
