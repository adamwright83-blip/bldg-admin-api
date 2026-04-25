import { and, eq, gte, lt, sql } from "drizzle-orm";
import { adminActionLog, orders, type Order } from "../drizzle/schema";
import { getDb } from "./db";
import { getLevel4OffensiveState } from "./level4Offensive";
import {
  ACTION_LOG_ACTED_STATUSES,
  ACTION_SEND_REMINDER,
  getCollectedTodayCents,
  getDashboardBusinessDayBoundsUtc,
  type DashboardBusinessDayBounds,
} from "./revenueIntervention";
import { zonedYmd } from "./dashboardZoned";

type GateState = "LOCKED" | "UNLOCKED" | "COMPLETE_TODAY" | "COLD_CASE_VISUAL_ONLY";
type GateLaneState = "CLEARED" | "QUIET" | "BLOCKED" | "DEGRADED";
type GateLaneKey = "collections" | "vagueness" | "dispatch";

export type Level4GateLane = {
  key: GateLaneKey;
  title: string;
  count: number;
  warningCount: number;
  state: GateLaneState;
  cta: string;
  path: string;
  orderId?: number;
  target?: string;
  intel?: string;
  warningIntel?: string;
};

export type Level4DailyXpBreakdown = {
  collectedXp: number;
  intakeWithin24hXp: number;
  reminderConvertedXp: number;
  level4ExecuteXp: number;
  buildingIntroSecuredXp: number;
  buildingSignedXp: number;
};

export type Level4GateState = {
  state: GateState;
  lanes: Level4GateLane[];
  dailyXp: number;
  dailyXpTarget: number;
  dailyXpProgressPct: number;
  xpBreakdown: Level4DailyXpBreakdown;
  businessYmd: string;
  timeZone: string;
  dbAvailable: boolean;
  operatorScope: "tenant_proxy";
};

const DAILY_XP_TARGET = 1_500;
const LEVEL4_ACTION_TYPES = ["building_penetration", "referral_request", "market_hole_outreach"] as const;
const MANUAL_INTRO_ACTION = "building_intro_secured";
const MANUAL_SIGNED_ACTION = "building_signed";
const ISO_YMD = /^\d{4}-\d{2}-\d{2}$/;

function orderTotalCents(order: Order): number {
  const n = Number.parseFloat(String(order.total ?? "0"));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

function customerLabel(order: Order): string {
  return `${order.firstName ?? ""} ${order.lastName ?? ""}`.trim() || `Order #${order.id}`;
}

function orderTarget(order: Order): string {
  return `${customerLabel(order)} — Order #${order.id}`;
}

function isKnownDollarOrder(order: Order): boolean {
  return orderTotalCents(order) > 0;
}

function isYmd(value: string | null | undefined): value is string {
  return Boolean(value && ISO_YMD.test(value));
}

function isScheduleToday(value: string | null | undefined, businessYmd: string): boolean {
  return isYmd(value) && value === businessYmd;
}

function isScheduleBeforeToday(value: string | null | undefined, businessYmd: string): boolean {
  return isYmd(value) && value < businessYmd;
}

function isDateInBusinessDay(value: Date | string | null | undefined, bounds: DashboardBusinessDayBounds): boolean {
  if (!value) return false;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  return d >= bounds.startUtc && d < bounds.endUtc;
}

function businessYmdForDate(value: Date | string | null | undefined, bounds: DashboardBusinessDayBounds): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return zonedYmd(d, bounds.timeZone);
}

function orderAgeDays(order: Order): number {
  const d = order.updatedAt ?? order.createdAt;
  if (!d) return 0;
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function decayLabel(kind: "collection" | "vagueness" | "target", days: number): string {
  if (kind === "vagueness") {
    if (days <= 2) return "ACTIVE";
    if (days <= 6) return "DEGRADED";
    if (days <= 13) return "STALE VAGUENESS";
    return "RECKONING";
  }
  if (kind === "collection") {
    if (days <= 2) return "ACTIVE";
    if (days <= 6) return "ASSET COOLING";
    if (days <= 13) return "EXTRACTION WINDOW CLOSING";
    return "ASSET IN THE COLD";
  }
  if (days <= 6) return "ACTIVE TARGET";
  if (days <= 13) return "TARGET COOLING";
  if (days <= 29) return "EXTRACTION WINDOW CLOSING";
  if (days <= 44) return "COLD CASE WARNING";
  return "COLD CASE VISUAL_ONLY";
}

function uniqueOrders(rows: Order[]): Order[] {
  return Array.from(new Map(rows.map((order) => [order.id, order])).values());
}

function xpProgress(dailyXp: number): number {
  return Math.max(0, Math.min(100, Math.round((dailyXp / DAILY_XP_TARGET) * 100)));
}

function emptyGate(bounds: DashboardBusinessDayBounds | null): Level4GateState {
  const businessYmd = bounds?.ymd ?? "";
  const timeZone = bounds?.timeZone ?? "";
  return {
    state: "COMPLETE_TODAY",
    lanes: [
      lane("collections", [], [], false),
      lane("vagueness", [], [], false),
      lane("dispatch", [], [], false),
    ],
    dailyXp: 0,
    dailyXpTarget: DAILY_XP_TARGET,
    dailyXpProgressPct: 0,
    xpBreakdown: {
      collectedXp: 0,
      intakeWithin24hXp: 0,
      reminderConvertedXp: 0,
      level4ExecuteXp: 0,
      buildingIntroSecuredXp: 0,
      buildingSignedXp: 0,
    },
    businessYmd,
    timeZone,
    dbAvailable: false,
    operatorScope: "tenant_proxy",
  };
}

function lane(key: GateLaneKey, blockers: Order[], warnings: Order[], cleared: boolean, failureCount = 0): Level4GateLane {
  const count = blockers.length + failureCount;
  const firstBlocker = blockers[0];
  const firstWarning = warnings[0];
  const state: GateLaneState =
    count > 0 ? "BLOCKED" : warnings.length > 0 ? "DEGRADED" : cleared ? "CLEARED" : "QUIET";

  if (key === "collections") {
    const cents = firstBlocker ? orderTotalCents(firstBlocker) : 0;
    return {
      key,
      title: "LANE 1 · COLLECTIONS",
      count,
      warningCount: warnings.length,
      state,
      cta: "OPEN LIVE →",
      path: "/live",
      orderId: firstBlocker?.id,
      target: firstBlocker ? orderTarget(firstBlocker) : undefined,
      intel: firstBlocker
        ? `${decayLabel("collection", orderAgeDays(firstBlocker))} · ${formatUsdCents(cents)} known exposure`
        : failureCount > 0
          ? "Payment failure logged today."
          : cleared
            ? "Collected cash registered today."
            : "No same-day known-dollar collection blocker.",
      warningIntel: firstWarning
        ? `${decayLabel("collection", orderAgeDays(firstWarning))} · stale collection warning, not today's gate.`
        : undefined,
    };
  }

  if (key === "vagueness") {
    return {
      key,
      title: "LANE 2 · VAGUENESS / INTAKE",
      count,
      warningCount: warnings.length,
      state,
      cta: "RESTORE CLARITY →",
      path: firstBlocker ? `/intake?orderId=${firstBlocker.id}` : "/intake",
      orderId: firstBlocker?.id,
      target: firstBlocker ? orderTarget(firstBlocker) : undefined,
      intel: firstBlocker
        ? `${decayLabel("vagueness", orderAgeDays(firstBlocker))} · Revenue exposure uncomputed.`
        : cleared
          ? "Pricing clarity restored today."
          : "No same-day vague intake blocker.",
      warningIntel: firstWarning
        ? `${decayLabel("vagueness", orderAgeDays(firstWarning))} · Revenue exposure uncomputed.`
        : undefined,
    };
  }

  return {
    key,
    title: "LANE 3 · DISPATCH",
    count,
    warningCount: warnings.length,
    state,
    cta: "OPEN ROUTES →",
    path: "/pickups",
    orderId: firstBlocker?.id,
    target: firstBlocker ? orderTarget(firstBlocker) : undefined,
    intel: firstBlocker
      ? "Today's pickup or return still needs completion."
      : cleared
        ? "Today's physical movement is clear."
        : "No same-day dispatch blocker.",
    warningIntel: firstWarning ? "Stale dispatch warning, not today's gate." : undefined,
  };
}

function formatUsdCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function pickupWasWithin24hProxy(order: Order, bounds: DashboardBusinessDayBounds): boolean {
  if (order.paid || order.status === "new") return false;
  if (!isKnownDollarOrder(order) || !isDateInBusinessDay(order.updatedAt, bounds)) return false;
  if (!isYmd(order.pickupDate)) return false;
  const updatedYmd = businessYmdForDate(order.updatedAt, bounds);
  if (!updatedYmd) return false;
  const pickupTime = Date.UTC(
    Number(order.pickupDate.slice(0, 4)),
    Number(order.pickupDate.slice(5, 7)) - 1,
    Number(order.pickupDate.slice(8, 10))
  );
  const updatedDayTime = Date.UTC(
    Number(updatedYmd.slice(0, 4)),
    Number(updatedYmd.slice(5, 7)) - 1,
    Number(updatedYmd.slice(8, 10))
  );
  const elapsedDays = Math.floor((updatedDayTime - pickupTime) / 86_400_000);
  return elapsedDays >= 0 && elapsedDays <= 1;
}

export async function getLevel4GateState(tenantId: string, now: Date = new Date()): Promise<Level4GateState> {
  const db = await getDb();
  const bounds = getDashboardBusinessDayBoundsUtc(now);
  if (!db) return emptyGate(bounds);

  const [allOrders, todayLogs, reminderWindowLogs, collectedToday, offensive] = await Promise.all([
    db
      .select()
      .from(orders)
      .where(sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`),
    db
      .select({
        actionType: adminActionLog.actionType,
        entityType: adminActionLog.entityType,
        entityId: adminActionLog.entityId,
        status: adminActionLog.status,
        createdAt: adminActionLog.createdAt,
      })
      .from(adminActionLog)
      .where(
        and(
          eq(adminActionLog.tenantId, tenantId),
          gte(adminActionLog.createdAt, bounds.startUtc),
          lt(adminActionLog.createdAt, bounds.endUtc)
        )
      ),
    db
      .select({
        entityId: adminActionLog.entityId,
        status: adminActionLog.status,
        createdAt: adminActionLog.createdAt,
      })
      .from(adminActionLog)
      .where(
        and(
          eq(adminActionLog.tenantId, tenantId),
          eq(adminActionLog.actionType, ACTION_SEND_REMINDER),
          eq(adminActionLog.entityType, "order"),
          gte(adminActionLog.createdAt, new Date(bounds.startUtc.getTime() - 48 * 3_600_000)),
          lt(adminActionLog.createdAt, bounds.endUtc)
        )
      ),
    getCollectedTodayCents(tenantId, now),
    getLevel4OffensiveState(tenantId),
  ]);

  const deliveredTodayUnpaid = allOrders.filter(
    (order) =>
      order.status === "delivered" &&
      !order.paid &&
      isKnownDollarOrder(order) &&
      (isDateInBusinessDay(order.updatedAt, bounds) || isScheduleToday(order.deliveryDate, bounds.ymd))
  );
  const failedPaymentLogsToday = todayLogs.filter((log) => log.status === "failed");

  const staleCollectionWarnings = allOrders.filter(
    (order) =>
      (order.status === "ready" || order.status === "delivered") &&
      !order.paid &&
      isKnownDollarOrder(order) &&
      !deliveredTodayUnpaid.some((blocker) => blocker.id === order.id)
  );

  const vagueToday = uniqueOrders(
    allOrders.filter(
      (order) =>
        !order.paid &&
        (order.status === "collected" || order.status === "processing" || order.status === "ready") &&
        !isKnownDollarOrder(order) &&
        (isScheduleToday(order.pickupDate, bounds.ymd) || isDateInBusinessDay(order.updatedAt, bounds))
    )
  );
  const staleVagueWarnings = allOrders.filter(
    (order) =>
      !order.paid &&
      (order.status === "collected" || order.status === "processing" || order.status === "ready") &&
      !isKnownDollarOrder(order) &&
      !vagueToday.some((blocker) => blocker.id === order.id)
  );

  const dispatchToday = uniqueOrders([
    ...allOrders.filter((order) => order.status === "new" && isScheduleToday(order.pickupDate, bounds.ymd)),
    ...allOrders.filter((order) => order.status === "ready" && isScheduleToday(order.deliveryDate, bounds.ymd)),
  ]);
  const staleDispatchWarnings = uniqueOrders([
    ...allOrders.filter((order) => order.status === "new" && isScheduleBeforeToday(order.pickupDate, bounds.ymd)),
    ...allOrders.filter((order) => order.status === "ready" && isScheduleBeforeToday(order.deliveryDate, bounds.ymd)),
  ]);

  const collectedCents = collectedToday?.cents ?? 0;
  const paidToday = allOrders.filter((order) => order.paid && isDateInBusinessDay(order.paidAt, bounds));
  const reminderConvertedCount = paidToday.filter((order) => {
    if (!order.paidAt) return false;
    const paidAt = order.paidAt instanceof Date ? order.paidAt : new Date(order.paidAt);
    const entityId = String(order.id);
    return reminderWindowLogs.some((log) => {
      const logAt = log.createdAt instanceof Date ? log.createdAt : new Date(log.createdAt);
      return (
        log.entityId === entityId &&
        ACTION_LOG_ACTED_STATUSES.includes(log.status as (typeof ACTION_LOG_ACTED_STATUSES)[number]) &&
        logAt <= paidAt &&
        paidAt.getTime() - logAt.getTime() <= 48 * 3_600_000
      );
    });
  }).length;

  const intakeWithin24hCount = allOrders.filter((order) => pickupWasWithin24hProxy(order, bounds)).length;
  const level4ExecuteCount = todayLogs.filter((log) =>
    LEVEL4_ACTION_TYPES.includes(log.actionType as (typeof LEVEL4_ACTION_TYPES)[number])
  ).length;
  const buildingIntroSecuredCount = todayLogs.filter((log) => log.actionType === MANUAL_INTRO_ACTION).length;
  const buildingSignedCount = todayLogs.filter((log) => log.actionType === MANUAL_SIGNED_ACTION).length;

  const xpBreakdown: Level4DailyXpBreakdown = {
    collectedXp: Math.floor(collectedCents / 100),
    intakeWithin24hXp: intakeWithin24hCount * 50,
    reminderConvertedXp: reminderConvertedCount * 100,
    level4ExecuteXp: level4ExecuteCount * 500,
    buildingIntroSecuredXp: buildingIntroSecuredCount * 2_500,
    buildingSignedXp: buildingSignedCount * 25_000,
  };
  const dailyXp = Object.values(xpBreakdown).reduce((sum, xp) => sum + xp, 0);

  const lanes = [
    lane("collections", deliveredTodayUnpaid, staleCollectionWarnings, collectedCents > 0, failedPaymentLogsToday.length),
    lane("vagueness", vagueToday, staleVagueWarnings, intakeWithin24hCount > 0),
    lane(
      "dispatch",
      dispatchToday,
      staleDispatchWarnings,
      allOrders.some(
        (order) =>
          (isScheduleToday(order.pickupDate, bounds.ymd) && order.status !== "new") ||
          (isScheduleToday(order.deliveryDate, bounds.ymd) && order.status === "delivered")
      )
    ),
  ];

  const locked = lanes.some((gateLane) => gateLane.count > 0);
  const topBuilding = offensive.buildingPenetration[0] ?? null;
  const bossTargetsAvailable = Boolean(
    topBuilding || ("userId" in (offensive.referralRequest ?? {}) && offensive.referralRequest) || offensive.marketHole.status === "stubbed_for_v1"
  );
  const coldCase = (topBuilding?.daysSinceLastTouch ?? 0) >= 45;

  return {
    state: locked
      ? "LOCKED"
      : !bossTargetsAvailable
        ? "COMPLETE_TODAY"
        : coldCase
          ? "COLD_CASE_VISUAL_ONLY"
          : "UNLOCKED",
    lanes,
    dailyXp,
    dailyXpTarget: DAILY_XP_TARGET,
    dailyXpProgressPct: xpProgress(dailyXp),
    xpBreakdown,
    businessYmd: bounds.ymd,
    timeZone: bounds.timeZone,
    dbAvailable: true,
    operatorScope: "tenant_proxy",
  };
}
