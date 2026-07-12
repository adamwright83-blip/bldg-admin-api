export type CustomerChurnInput = {
  customerKey: string;
  customerName: string;
  orderDates: Array<string | Date>;
  orderValuesCents: number[];
  orderWeightsLbs?: number[];
  unresolvedIssue?: boolean;
  now?: Date;
};

export type CustomerChurnGrade = "low" | "medium" | "high";

export type CustomerChurnScore = {
  customerKey: string;
  customerName: string;
  score: number;
  grade: CustomerChurnGrade;
  expectedCadenceDays: number;
  daysSinceLastOrder: number;
  daysLate: number;
  averageOrderValueCents: number;
  estimatedMonthlyImpactCents: number;
  recentVolumeChangePct: number | null;
  reasons: string[];
  recommendedAction: "watch" | "prepare_win_back" | "contact_now";
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeDates(values: Array<string | Date>): Date[] {
  return values
    .map(value => (value instanceof Date ? value : new Date(value)))
    .filter(value => Number.isFinite(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
}

function deriveCadenceDays(orderDates: Date[]): number {
  if (orderDates.length < 2) return 30;
  const intervals = orderDates
    .slice(1)
    .map((date, index) =>
      Math.max(
        1,
        Math.round((date.getTime() - orderDates[index].getTime()) / DAY_MS)
      )
    )
    .filter(days => days <= 120);
  return clamp(Math.round(median(intervals) || 30), 3, 60);
}

function recentVolumeChange(weights: number[] | undefined): number | null {
  if (!weights || weights.length < 4) return null;
  const clean = weights.filter(value => Number.isFinite(value) && value >= 0);
  if (clean.length < 4) return null;
  const split = Math.max(2, Math.floor(clean.length / 2));
  const prior = average(clean.slice(0, split));
  const recent = average(clean.slice(split));
  if (prior <= 0) return null;
  return Math.round(((recent - prior) / prior) * 100);
}

export function scoreCustomerChurn(
  input: CustomerChurnInput
): CustomerChurnScore {
  const now = input.now ?? new Date();
  const orderDates = normalizeDates(input.orderDates);
  const expectedCadenceDays = deriveCadenceDays(orderDates);
  const lastOrderAt = orderDates.at(-1) ?? now;
  const daysSinceLastOrder = Math.max(
    0,
    Math.floor((now.getTime() - lastOrderAt.getTime()) / DAY_MS)
  );
  const daysLate = Math.max(0, daysSinceLastOrder - expectedCadenceDays);
  const averageOrderValueCents = Math.round(
    average(
      input.orderValuesCents.filter(
        value => Number.isFinite(value) && value >= 0
      )
    )
  );
  const estimatedOrdersPerMonth = 30 / expectedCadenceDays;
  const estimatedMonthlyImpactCents = Math.round(
    averageOrderValueCents * estimatedOrdersPerMonth
  );
  const recentVolumeChangePct = recentVolumeChange(input.orderWeightsLbs);
  const reasons: string[] = [];

  const latenessRatio = daysSinceLastOrder / expectedCadenceDays;
  let score = 0;
  if (latenessRatio >= 3) {
    score += 60;
    reasons.push(
      `No order for ${daysSinceLastOrder} days, about ${latenessRatio.toFixed(1)}× the normal gap`
    );
  } else if (latenessRatio >= 2) {
    score += 38;
    reasons.push(
      `Customer is ${daysLate} days beyond the normal order cadence`
    );
  } else if (latenessRatio >= 1.5) {
    score += 28;
    reasons.push("Order cadence has slowed materially");
  } else if (latenessRatio >= 1.2) {
    score += 16;
    reasons.push(
      "Customer is beginning to drift past the usual order window"
    );
  }

  if (estimatedMonthlyImpactCents >= 200_000) {
    score += 22;
    reasons.push(
      `About $${Math.round(estimatedMonthlyImpactCents / 100).toLocaleString()} in monthly revenue is exposed`
    );
  } else if (estimatedMonthlyImpactCents >= 75_000) {
    score += 16;
    reasons.push("This is a meaningful recurring-revenue customer");
  } else if (estimatedMonthlyImpactCents >= 25_000) {
    score += 10;
  }

  if (orderDates.length >= 12) {
    score += 12;
    reasons.push(`Strong order history: ${orderDates.length} prior orders`);
  } else if (orderDates.length >= 5) {
    score += 7;
  }

  if (recentVolumeChangePct != null && recentVolumeChangePct <= -35) {
    score += 12;
    reasons.push(
      `Recent poundage is down ${Math.abs(recentVolumeChangePct)}%`
    );
  } else if (recentVolumeChangePct != null && recentVolumeChangePct <= -15) {
    score += 6;
    reasons.push("Recent poundage is trending down");
  }

  if (input.unresolvedIssue) {
    score += 15;
    reasons.push("An unresolved issue may be contributing to the drop-off");
  }

  score = clamp(Math.round(score), 0, 100);
  const grade: CustomerChurnGrade =
    score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  const recommendedAction =
    score >= 70
      ? "contact_now"
      : score >= 40
        ? "prepare_win_back"
        : "watch";

  return {
    customerKey: input.customerKey,
    customerName: input.customerName,
    score,
    grade,
    expectedCadenceDays,
    daysSinceLastOrder,
    daysLate,
    averageOrderValueCents,
    estimatedMonthlyImpactCents,
    recentVolumeChangePct,
    reasons: reasons.slice(0, 6),
    recommendedAction,
  };
}
