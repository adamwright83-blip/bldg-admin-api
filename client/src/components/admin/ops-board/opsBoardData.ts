import type { AdminHomeData, AtRiskAccount } from "./types";

type DashboardSummaryLike = {
  revenueMonth?: number | null;
};

type CollectedTodayLike = {
  cents?: number | null;
  businessYmd?: string | null;
  dbAvailable?: boolean | null;
};

type AwaitingPaymentLike = {
  cents?: number | null;
  dbAvailable?: boolean | null;
};

type InterventionCandidateLike = {
  dollarValueCents?: number | null;
  issueLabel?: string | null;
  order?: {
    id?: number | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    total?: unknown;
    updatedAt?: string | Date | null;
  } | null;
};

type ApexLike = {
  candidate?: InterventionCandidateLike | null;
  dbAvailable?: boolean | null;
};

type Level2Like = {
  items?: ReadonlyArray<InterventionCandidateLike> | null;
  dbAvailable?: boolean | null;
};

type Level4GateLike = {
  dailyXp?: number | null;
  dailyXpTarget?: number | null;
  dailyXpProgressPct?: number | null;
  dbAvailable?: boolean | null;
};

type Level4MissionLike = {
  boardState?: "none" | "locked" | "unlocked" | "completed" | null;
  accessible?: boolean | null;
  xpReward?: number | null;
  progress?: {
    percent?: number | null;
    message?: string | null;
  } | null;
  mission?: {
    xpAwarded?: number | null;
  } | null;
  task?: {
    title?: string | null;
    revenueAtRiskCents?: number | null;
  } | null;
};

export type BuildOpsBoardDataInput = {
  dashboard?: DashboardSummaryLike | null;
  collected?: CollectedTodayLike | null;
  awaiting?: AwaitingPaymentLike | null;
  apex?: ApexLike | null;
  level2?: Level2Like | null;
  level4Gate?: Level4GateLike | null;
  level4Mission?: Level4MissionLike | null;
  now?: Date;
};

const FALLBACK_RISK_ACCOUNTS: AtRiskAccount[] = [
  {
    customerId: "fallback-daniel",
    orderId: 54,
    name: "Daniel Cha",
    amount: 86.46,
    daysOverdue: 14,
    phone: undefined,
    suggestedSms:
      "Hey Daniel, circling back on the $86.46 from your last order. Want me to run the card on file, or is there a better one to use? Happy to sort this out quickly.",
    isLive: false,
  },
  {
    customerId: "fallback-maya",
    name: "Maya Chen",
    amount: 593.54,
    daysOverdue: 9,
    phone: undefined,
    suggestedSms:
      "Hey Maya, quick follow-up on the open balance from your last Laundry Butler order. Want me to run the card on file, or is there a better one to use?",
    isLive: false,
  },
  {
    customerId: "fallback-marcus",
    name: "Marcus Lee",
    amount: 560,
    daysOverdue: 6,
    phone: undefined,
    suggestedSms:
      "Hey Marcus, circling back on the open Laundry Butler balance. Want me to run the card on file, or should I use a different one?",
    isLive: false,
  },
];

const FALLBACK_SPARKLINE = [
  { date: "THU", value: 420 },
  { date: "FRI", value: 640 },
  { date: "SAT", value: 520 },
  { date: "SUN", value: 760 },
  { date: "MON", value: 680 },
  { date: "TUE", value: 1_020 },
  { date: "WED", value: 1_240 },
];

function centsToDollars(cents: number | null | undefined): number {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return 0;
  return Math.round(cents) / 100;
}

function orderTotalToDollars(total: unknown): number {
  const n = parseFloat(String(total ?? "0"));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function displayName(firstName?: string | null, lastName?: string | null): string {
  const full = `${firstName ?? ""} ${lastName ?? ""}`.trim();
  return full || "Customer";
}

function daysSince(updatedAt: string | Date | null | undefined, now: Date): number {
  if (!updatedAt) return 14;
  const d = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return 14;
  return Math.max(1, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

function buildSmsFor(name: string, amount: number): string {
  const firstName = name.split(" ")[0] || name;
  return `Hey ${firstName}, circling back on the ${formatUsd(amount)} from your last order. Want me to run the card on file, or is there a better one to use? Happy to sort this out quickly.`;
}

function candidateToRiskAccount(candidate: InterventionCandidateLike, now: Date): AtRiskAccount | null {
  const order = candidate.order;
  if (!order?.id) return null;
  const amount = centsToDollars(candidate.dollarValueCents) || orderTotalToDollars(order.total);
  if (amount <= 0) return null;
  const name = displayName(order.firstName, order.lastName);
  return {
    customerId: `order-${order.id}`,
    orderId: order.id,
    name,
    amount,
    daysOverdue: daysSince(order.updatedAt, now),
    phone: order.phone ?? undefined,
    suggestedSms: buildSmsFor(name, amount),
    isLive: true,
  };
}

function buildRiskAccounts(input: BuildOpsBoardDataInput, now: Date): AtRiskAccount[] {
  const liveCandidates = [
    input.apex?.candidate ?? null,
    ...(input.level2?.items ?? []),
  ].filter(Boolean) as InterventionCandidateLike[];

  const live = liveCandidates
    .map((candidate) => candidateToRiskAccount(candidate, now))
    .filter(Boolean) as AtRiskAccount[];

  const seen = new Set(live.map((account) => account.customerId));
  const filled = [...live];
  for (const fallback of FALLBACK_RISK_ACCOUNTS) {
    if (filled.length >= 3) break;
    if (seen.has(fallback.customerId)) continue;
    filled.push(fallback);
  }
  return filled.slice(0, 3);
}

function businessDateParts(businessYmd: string | null | undefined, now: Date) {
  const date = businessYmd ? new Date(`${businessYmd}T09:41:00`) : now;
  const businessDay = date
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    })
    .toUpperCase()
    .replace(",", "");
  const businessTime = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { businessDay, businessTime };
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function formatCompactUsd(value: number): string {
  if (Math.abs(value) >= 1_000) {
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  return formatUsd(value);
}

export function buildOpsBoardData(input: BuildOpsBoardDataInput): AdminHomeData {
  const now = input.now ?? new Date();
  const { businessDay, businessTime } = businessDateParts(input.collected?.businessYmd, now);
  const riskAccounts = buildRiskAccounts(input, now);

  const liveRiskTotal = centsToDollars(input.awaiting?.cents);
  const riskTotal = liveRiskTotal > 0 ? liveRiskTotal : 1_240;
  const riskIsLive = Boolean(input.awaiting?.dbAvailable && liveRiskTotal > 0);
  const liveCollected = centsToDollars(input.collected?.cents);
  const collectedIsLive = Boolean(input.collected?.dbAvailable);
  const monthlyLive = Number(input.dashboard?.revenueMonth ?? 0);
  const monthlyRunRate = Number.isFinite(monthlyLive) && monthlyLive > 0 ? monthlyLive : 18_400;
  const runRateTarget = 24_000;
  const runRatePercent = Math.max(0, Math.min(100, Math.floor((monthlyRunRate / runRateTarget) * 100)));
  const dailyXp = Math.max(0, Number(input.level4Gate?.dailyXp ?? 0));
  const dailyXpTarget = Math.max(1, Number(input.level4Gate?.dailyXpTarget ?? 1_500));
  const dailyXpPercent = Math.max(
    0,
    Math.min(100, Math.round(Number(input.level4Gate?.dailyXpProgressPct ?? (dailyXp / dailyXpTarget) * 100)))
  );

  const danielLive = riskAccounts.find((account) => account.name.toLowerCase().includes("daniel"));
  const danielAccount = danielLive ?? FALLBACK_RISK_ACCOUNTS[0];
  const danielAmount = danielAccount.amount > 0 ? danielAccount.amount : 86.46;
  const missionState = input.level4Mission?.boardState ?? "none";
  const missionTitle = input.level4Mission?.task?.title?.trim() || "No Active Level 4 Mission";
  const missionReward = Number(input.level4Mission?.xpReward ?? 500);
  const missionAwarded = Number(input.level4Mission?.mission?.xpAwarded ?? 0);

  return {
    businessDay,
    businessTime,
    businessLocation: "LOS ANGELES, CA",
    // TODO: Replace fallback score with a computed operator health score when the metric exists.
    butlerRating: {
      level: 4,
      score: 782,
      band: "STRONG",
      dailyXp: {
        value: dailyXp,
        target: dailyXpTarget,
        percent: dailyXpPercent,
      },
    },
    runRate: {
      monthly: monthlyRunRate,
      target: runRateTarget,
      percentToTarget: runRatePercent,
    },
    kpis: {
      collectedToday: {
        value: collectedIsLive ? liveCollected : 176.76,
        deltaPct: 22,
        isLive: collectedIsLive,
      },
      awaitingPayment: {
        value: riskTotal,
        invoiceCount: riskAccounts.length,
        isLive: riskIsLive,
      },
      // TODO: Wire an exact active-route count if the backend exposes a single home metric.
      activeRoutes: {
        value: 8,
        completingToday: 2,
        isLive: false,
      },
      // TODO: Replace fallback exposure with a dedicated risk classification when available.
      atRisk: {
        count: 2,
        exposure: 560,
        isLive: false,
      },
    },
    oneThingRightNow: {
      type: "building_intro",
      contactName: "Christopher",
      contactContext: "Christopher @ OPUS LA",
      buildingTarget: "Building 3",
      daysSinceLastAsk: 14,
      lastAskLabel: "14 days ago",
      suggestedText:
        "Hey Christopher — quick follow-up on the Building 3 intro you mentioned. Would you be comfortable connecting me with the GM this week? We’re ready to support another Greystar property.",
    },
    level4Mission: {
      state: missionState,
      title: missionTitle,
      statusLabel:
        missionState === "locked"
          ? "Locked"
          : missionState === "unlocked"
            ? "Unlocked"
            : missionState === "completed"
              ? "Mission Completed"
              : "No Active Level 4 Mission",
      subhead:
        missionState === "none"
          ? "Add a Lane 4 task to activate one"
          : missionState === "completed"
            ? `${(missionAwarded || missionReward).toLocaleString("en-US")} XP earned. This stays visible for a bit.`
            : missionState === "unlocked"
              ? "Ready for focused execution."
              : input.level4Mission?.progress?.message ?? "Complete Lane 1-3 work to unlock.",
      revenueImpact: centsToDollars(input.level4Mission?.task?.revenueAtRiskCents),
      xpReward: missionReward,
      xpAwarded: missionAwarded,
      progressPercent: Math.max(0, Math.min(100, Math.round(Number(input.level4Mission?.progress?.percent ?? 0)))),
      canEnter: Boolean(input.level4Mission?.accessible && missionState === "unlocked"),
    },
    collectionPriority: {
      type: "collected_unpaid",
      customerName: danielAccount.name,
      firstName: danielAccount.name.split(" ")[0] || "Daniel",
      orderId: danielAccount.orderId,
      orderNumber: danielAccount.orderId ? `#${danielAccount.orderId}` : "#54",
      phone: danielAccount.phone,
      amount: danielAmount,
      daysOverdue: danielAccount.daysOverdue || 14,
      priorAttempts: 3,
      suggestedSms:
        danielAccount.name.toLowerCase().includes("daniel")
          ? `Hey Daniel, circling back on the ${formatUsd(danielAmount)} from your last order. Want me to run the card on file, or is there a better one to use? Happy to sort this out quickly.`
          : danielAccount.suggestedSms,
      isLive: danielAccount.isLive,
    },
    territory: {
      liveCount: 2,
      targetCount: 5,
      seedPitchPercent: 40,
      sectorLabel: "SECTOR 04 · LOS ANGELES LUXURY HIGH-RISE",
      buildings: [
        { position: 1, name: "OPUS LA", status: "live" },
        { position: 2, name: "CENTURY PARK EAST", status: "live" },
        { position: 3, name: "BUILDING 3", status: "pursuing" },
        { position: 4, name: "PROSPECT", status: "prospect" },
        { position: 5, name: "PROSPECT", status: "prospect" },
      ],
    },
    revenueAtRisk: {
      total: riskTotal,
      accountCount: Math.max(3, riskAccounts.length),
      sparkline: FALLBACK_SPARKLINE,
      accounts: riskAccounts,
      isLive: riskIsLive,
    },
    // TODO: Replace these fallbacks when route efficiency, queue depth, lead velocity,
    // and conversion are exposed as first-class home metrics.
    gauges: {
      routeEfficiency: { value: 92, deltaPct: 6 },
      queue: { value: 14 },
      leadVelocity: { value: 28 },
      conversion: { value: 38, deltaPct: 8 },
    },
  };
}
