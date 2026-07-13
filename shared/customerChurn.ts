export type CustomerChurnGrade = "low" | "medium" | "high";
export type CustomerChurnConfidence = "low" | "medium" | "high";

export type CustomerHistoryObservation = {
  orderId: number;
  serviceAt: string | Date;
  valueCents: number;
  weightLbs: number | null;
  serviceType: "wash_fold" | "dry_cleaning";
};

export type CustomerChurnInput = {
  customerKey: string;
  customerName: string;
  history: CustomerHistoryObservation[];
  activeOrderCount?: number;
  unresolvedIssueSummary?: string | null;
  now?: Date;
};

export type CustomerChurnScore = {
  customerKey: string;
  customerName: string;
  score: number;
  grade: CustomerChurnGrade;
  confidence: CustomerChurnConfidence;
  historyOrderCount: number;
  expectedCadenceDays: number;
  lastServiceAt: string;
  daysSinceLastOrder: number;
  daysLate: number;
  averageOrderValueCents: number;
  estimatedMonthlyImpactCents: number;
  recentVolumeChangePct: number | null;
  activeOrderCount: number;
  reasons: string[];
  recommendedAction: "watch" | "prepare_win_back" | "contact_now";
};

export type ChurnEvidence = {
  kind: "sourced_fact" | "calculation" | "estimate" | "unavailable";
  label: string;
  value: string;
  source: string;
  sourceIds: number[];
};

export type WinBackDraft = {
  channel: "sms";
  message: string;
  internalNote: string;
  requiresHumanApproval: true;
  factsUsed: string[];
};

const UNSOURCED_INCENTIVE_PATTERN =
  /\b(?:coupon|discount|promo(?:\s*code)?|complimentary)\b|(?:\$\s*\d+(?:\.\d{1,2})?|\b\d+(?:\.\d+)?\s*%)\s*off\b|\bfree\s+(?:pickup|delivery|order|service|bag|wash)\b/i;

export function assertGroundedWinBackMessage(message: string): void {
  if (UNSOURCED_INCENTIVE_PATTERN.test(message))
    throw new Error(
      "The recovery message cannot promise an incentive because no promotion is configured for this workflow"
    );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeHistory(
  history: CustomerHistoryObservation[]
): Array<CustomerHistoryObservation & { date: Date }> {
  return history
    .map(item => ({
      ...item,
      date:
        item.serviceAt instanceof Date
          ? item.serviceAt
          : new Date(item.serviceAt),
    }))
    .filter(item => Number.isFinite(item.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function deriveCadenceDays(
  history: Array<CustomerHistoryObservation & { date: Date }>
): number {
  const intervals = history
    .slice(1)
    .map((item, index) =>
      Math.max(
        1,
        Math.round(
          (item.date.getTime() - history[index].date.getTime()) / DAY_MS
        )
      )
    )
    .filter(days => days <= 120);
  return clamp(Math.round(median(intervals) || 30), 3, 60);
}

function recentVolumeChange(
  history: Array<CustomerHistoryObservation & { date: Date }>
): number | null {
  const weights = history
    .map(item => item.weightLbs)
    .filter(
      (value): value is number =>
        value !== null && Number.isFinite(value) && value >= 0
    );
  if (weights.length < 4) return null;
  const split = Math.max(2, Math.floor(weights.length / 2));
  const prior = average(weights.slice(0, split));
  const recent = average(weights.slice(split));
  if (prior <= 0) return null;
  return Math.round(((recent - prior) / prior) * 100);
}

export function scoreCustomerChurn(
  input: CustomerChurnInput
): CustomerChurnScore {
  const now = input.now ?? new Date();
  const history = normalizeHistory(input.history);
  if (history.length < 2)
    throw new Error(
      "At least two completed orders are required to score churn"
    );

  const expectedCadenceDays = deriveCadenceDays(history);
  const lastServiceAt = history.at(-1)!.date;
  const daysSinceLastOrder = Math.max(
    0,
    Math.floor((now.getTime() - lastServiceAt.getTime()) / DAY_MS)
  );
  const daysLate = Math.max(0, daysSinceLastOrder - expectedCadenceDays);
  const orderValues = history
    .map(item => item.valueCents)
    .filter(value => Number.isFinite(value) && value >= 0);
  const averageOrderValueCents = Math.round(average(orderValues));
  const estimatedMonthlyImpactCents = Math.round(
    averageOrderValueCents * (30 / expectedCadenceDays)
  );
  const recentVolumeChangePct = recentVolumeChange(history);
  const activeOrderCount = Math.max(0, input.activeOrderCount ?? 0);
  const reasons: string[] = [];

  const latenessRatio = daysSinceLastOrder / expectedCadenceDays;
  let score = 0;
  if (latenessRatio >= 3) {
    score += 60;
    reasons.push(
      `No completed order for ${daysSinceLastOrder} days, ${latenessRatio.toFixed(1)}× the normal gap`
    );
  } else if (latenessRatio >= 2) {
    score += 38;
    reasons.push(`${daysLate} days beyond the normal order cadence`);
  } else if (latenessRatio >= 1.5) {
    score += 28;
    reasons.push("Order cadence has slowed materially");
  } else if (latenessRatio >= 1.2) {
    score += 16;
    reasons.push("Beginning to drift past the usual order window");
  }

  if (estimatedMonthlyImpactCents >= 200_000) {
    score += 22;
    reasons.push("At least $2,000 in estimated monthly revenue is exposed");
  } else if (estimatedMonthlyImpactCents >= 75_000) {
    score += 16;
    reasons.push("Meaningful recurring-revenue history");
  } else if (estimatedMonthlyImpactCents >= 25_000) {
    score += 10;
  }

  if (history.length >= 12) {
    score += 12;
    reasons.push(`Strong history across ${history.length} completed orders`);
  } else if (history.length >= 5) {
    score += 7;
  }

  if (recentVolumeChangePct !== null && recentVolumeChangePct <= -35) {
    score += 12;
    reasons.push(`Recent poundage is down ${Math.abs(recentVolumeChangePct)}%`);
  } else if (recentVolumeChangePct !== null && recentVolumeChangePct <= -15) {
    score += 6;
    reasons.push("Recent poundage is trending down");
  }

  if (input.unresolvedIssueSummary?.trim()) {
    score += 15;
    reasons.push("A documented unresolved issue may be contributing");
  }

  if (activeOrderCount > 0) {
    score = Math.min(score, 25);
    reasons.unshift("Active order found; win-back outreach is suppressed");
  }

  score = clamp(Math.round(score), 0, 100);
  const grade: CustomerChurnGrade =
    score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  const confidence: CustomerChurnConfidence =
    history.length >= 6 ? "high" : history.length >= 3 ? "medium" : "low";
  const recommendedAction =
    activeOrderCount > 0
      ? "watch"
      : score >= 70
        ? "contact_now"
        : score >= 40
          ? "prepare_win_back"
          : "watch";

  return {
    customerKey: input.customerKey,
    customerName: input.customerName,
    score,
    grade,
    confidence,
    historyOrderCount: history.length,
    expectedCadenceDays,
    lastServiceAt: lastServiceAt.toISOString(),
    daysSinceLastOrder,
    daysLate,
    averageOrderValueCents,
    estimatedMonthlyImpactCents,
    recentVolumeChangePct,
    activeOrderCount,
    reasons: reasons.slice(0, 6),
    recommendedAction,
  };
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function trimSms(text: string): string {
  if (text.length <= 320) return text;
  return `${text.slice(0, 317).trimEnd()}…`;
}

export function buildWinBackDraft(input: {
  score: CustomerChurnScore;
  storeName: string;
  senderName: string;
  lastServiceLabel: string;
  schedulingLink?: string | null;
}): WinBackDraft {
  const serviceDate = new Date(input.score.lastServiceAt).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", timeZone: "UTC" }
  );
  const nextStep = input.schedulingLink?.trim()
    ? ` If you'd like another pickup, you can schedule here: ${input.schedulingLink.trim()}`
    : " If you'd like, I can help schedule your next pickup.";
  const message = trimSms(
    `${firstName(input.score.customerName)}, it's ${input.senderName} from ${input.storeName}. We haven't seen you since your ${input.lastServiceLabel} order on ${serviceDate} and wanted to check in—did everything go well?${nextStep}`
  );
  assertGroundedWinBackMessage(message);
  return {
    channel: "sms",
    message,
    internalNote:
      "Review every fact and the recipient before approval. Do not add an unsupported discount.",
    requiresHumanApproval: true,
    factsUsed: [
      `last completed service: ${serviceDate}`,
      `service type: ${input.lastServiceLabel}`,
      `normal cadence: about ${input.score.expectedCadenceDays} days`,
    ],
  };
}

export function formatChurnMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
