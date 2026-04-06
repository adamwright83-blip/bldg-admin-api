import { and, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { adminActionLog, orders, type Order } from "../drizzle/schema";
import { getDb } from "./db";
import {
  getDashboardTimeZone,
  zonedDayStartUtc,
  zonedNextDayYmd,
  zonedYmd,
} from "./dashboardZoned";

export const ACTION_SEND_REMINDER = "send_reminder" as const;

/** Log rows that count as a completed operational touch (not cash collection). */
export const ACTION_LOG_ACTED_STATUSES = ["attempted", "delivered"] as const;

/** Canonical entity_id for order-scoped actions (matches locked spec). */
export function orderEntityId(orderId: number): string {
  return String(orderId);
}

export type DashboardBusinessDayBounds = {
  timeZone: string;
  ymd: string;
  startUtc: Date;
  endUtc: Date;
};

/** All dashboard business-day windows (action logs, paid-order “today”, etc.) use this (no mixed TZ). */
export function getDashboardBusinessDayBoundsUtc(now: Date = new Date()): DashboardBusinessDayBounds {
  const timeZone = getDashboardTimeZone();
  const ymd = zonedYmd(now, timeZone);
  const startUtc = zonedDayStartUtc(ymd, timeZone);
  const nextYmd = zonedNextDayYmd(ymd, timeZone);
  const endUtc = zonedDayStartUtc(nextYmd, timeZone);
  return { timeZone, ymd, startUtc, endUtc };
}

function orderTotalCents(row: Order): number {
  const n = parseFloat(String(row.total ?? "0"));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

export type IssueLabel =
  | "processing_stale_48h"
  | "ready_unpaid_24h"
  | "delivered_unpaid_24h"
  | "new_stale_48h"
  | /** Intake queue (`collected`): scheduled pickup/day has passed in dashboard TZ but card not run — not keyed off `updatedAt` */
  "collected_financially_open"
  | "collected_stale_48h"
  | "manual_risk_override";

export type ScoredInterventionCandidate = {
  order: Order;
  issueLabel: IssueLabel;
  dollarValueCents: number;
  score: number;
};

const REMINDER_WEIGHT = 1.2;

const ISO_YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Calendar days from `scheduleYmd` to `businessYmd` (both `yyyy-MM-dd`); invalid → 0 */
function daysYmdElapsed(scheduleYmd: string, businessYmd: string): number {
  const m1 = scheduleYmd.trim().match(ISO_YMD);
  const m2 = businessYmd.match(ISO_YMD);
  if (!m1 || !m2) return 0;
  const t1 = Date.UTC(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]));
  const t2 = Date.UTC(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
  return Math.max(0, Math.floor((t2 - t1) / 86400000));
}

/**
 * Operational schedule is strictly before dashboard "today" (Intake = still `collected` + unpaid in DB).
 * Uses `pickupDate` / `deliveryDate` (ISO from `<input type="date">`), not `updatedAt`.
 */
export function isCollectedFinanciallyOpen(row: Order, businessYmd: string): boolean {
  if (row.status !== "collected" || row.paid) return false;
  const pickup = row.pickupDate?.trim() ?? "";
  const del = row.deliveryDate?.trim() ?? "";
  const pickupElapsed = pickup.match(ISO_YMD) && pickup < businessYmd;
  const delElapsed =
    del.length > 0 &&
    del.match(ISO_YMD) !== null &&
    del < businessYmd;
  return Boolean(pickupElapsed || delElapsed);
}

export function issueForOrder(
  row: Order,
  _now: Date,
  stale48: Date,
  stale24: Date,
  businessYmd: string
): IssueLabel | null {
  if (row.paid) return null;
  if (row.manualRiskFlag) return "manual_risk_override";
  if (row.status === "processing" && row.updatedAt < stale48) return "processing_stale_48h";
  if (row.status === "new" && row.updatedAt < stale48) return "new_stale_48h";
  if (row.status === "collected") {
    if (isCollectedFinanciallyOpen(row, businessYmd)) return "collected_financially_open";
    if (row.updatedAt < stale48) return "collected_stale_48h";
  }
  const owed =
    (row.status === "ready" || row.status === "delivered") &&
    !row.paid &&
    orderTotalCents(row) > 0 &&
    row.updatedAt < stale24;
  if (owed) {
    return row.status === "delivered" ? "delivered_unpaid_24h" : "ready_unpaid_24h";
  }
  return null;
}

function scoreCandidate(
  row: Order,
  issueLabel: IssueLabel,
  now: Date,
  businessYmd: string
): number {
  const dollarValueCents = orderTotalCents(row);
  const daysOverdue = daysBetween(row.updatedAt, now);
  const isCompletedUninvoiced =
    issueLabel === "ready_unpaid_24h" || issueLabel === "delivered_unpaid_24h";
  const isFailedRetry = false;
  let base =
    dollarValueCents * REMINDER_WEIGHT +
    daysOverdue * 0.25 * dollarValueCents +
    (isCompletedUninvoiced ? dollarValueCents * 0.5 : 0) +
    (isFailedRetry ? dollarValueCents * 2.0 : 0);

  if (issueLabel === "collected_financially_open") {
    const pickup = row.pickupDate?.trim() ?? "";
    const del = row.deliveryDate?.trim() ?? "";
    const dPick = pickup.match(ISO_YMD) ? daysYmdElapsed(pickup, businessYmd) : 0;
    const dDel =
      del.length > 0 && del.match(ISO_YMD) ? daysYmdElapsed(del, businessYmd) : 0;
    const scheduleLag = Math.max(dPick, dDel);
    /** Dominates `updatedAt`-based rules so long-standing Intake debt surfaces first */
    base += 2_000_000 + scheduleLag * 25_000 + dollarValueCents * 2;
  }
  return base;
}

async function orderIdsWithReminderActedToday(
  tenantId: string,
  bounds: DashboardBusinessDayBounds
): Promise<Set<number>> {
  const db = await getDb();
  if (!db) return new Set();

  const rows = await db
    .select({ entityId: adminActionLog.entityId })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        eq(adminActionLog.actionType, ACTION_SEND_REMINDER),
        eq(adminActionLog.entityType, "order"),
        inArray(adminActionLog.status, [...ACTION_LOG_ACTED_STATUSES]),
        gte(adminActionLog.createdAt, bounds.startUtc),
        lt(adminActionLog.createdAt, bounds.endUtc)
      )
    );

  const out = new Set<number>();
  for (const r of rows) {
    const id = parseInt(r.entityId, 10);
    if (Number.isFinite(id)) out.add(id);
  }
  return out;
}

/** v1: `updatedAt` is a noisy proxy for payment staleness; migrate to paymentDueAt / invoiceSentAt if needed. */
export async function listInterventionCandidates(
  tenantId: string,
  now: Date = new Date()
): Promise<ScoredInterventionCandidate[]> {
  const db = await getDb();
  if (!db) return [];

  const stale48 = new Date(now.getTime() - 48 * 3600 * 1000);
  const stale24 = new Date(now.getTime() - 24 * 3600 * 1000);
  const businessYmd = zonedYmd(now, getDashboardTimeZone());

  const candidateRows = await db
    .select()
    .from(orders)
    .where(
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        or(
          eq(orders.manualRiskFlag, true),
          and(eq(orders.status, "processing"), lt(orders.updatedAt, stale48)),
          and(eq(orders.status, "new"), lt(orders.updatedAt, stale48)),
          and(eq(orders.status, "collected"), lt(orders.updatedAt, stale48)),
          and(
            eq(orders.status, "collected"),
            eq(orders.paid, false),
            or(
              lt(orders.pickupDate, businessYmd),
              and(
                sql`TRIM(COALESCE(${orders.deliveryDate}, '')) != ''`,
                sql`${orders.deliveryDate} REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`,
                lt(orders.deliveryDate, businessYmd)
              )
            )
          ),
          and(
            eq(orders.status, "ready"),
            eq(orders.paid, false),
            sql`CAST(COALESCE(${orders.total}, '0') AS DECIMAL(14,4)) > 0`,
            lt(orders.updatedAt, stale24)
          ),
          and(
            eq(orders.status, "delivered"),
            eq(orders.paid, false),
            sql`CAST(COALESCE(${orders.total}, '0') AS DECIMAL(14,4)) > 0`,
            lt(orders.updatedAt, stale24)
          )
        )
      )
    )
    .orderBy(desc(orders.updatedAt));

  const scored: ScoredInterventionCandidate[] = [];
  for (const row of candidateRows) {
    const issueLabel = issueForOrder(row, now, stale48, stale24, businessYmd);
    if (!issueLabel) continue;
    scored.push({
      order: row,
      issueLabel,
      dollarValueCents: orderTotalCents(row),
      score: scoreCandidate(row, issueLabel, now, businessYmd),
    });
  }
  scored.sort((a, b) => b.score - a.score || b.order.id - a.order.id);
  return scored;
}

export async function getLevel1ApexCommand(
  tenantId: string,
  now: Date = new Date()
): Promise<{
  bounds: DashboardBusinessDayBounds;
  candidate: ScoredInterventionCandidate | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const bounds = getDashboardBusinessDayBoundsUtc(now);
  const excluded = await orderIdsWithReminderActedToday(tenantId, bounds);
  const candidates = await listInterventionCandidates(tenantId, now);

  for (const c of candidates) {
    if (excluded.has(c.order.id)) continue;
    return { bounds, candidate: c };
  }
  return { bounds, candidate: null };
}

const RECOVERY_ACTION_TYPES = [ACTION_SEND_REMINDER, "send_invoice"] as const;

/**
 * Dollar value tied to manual recovery actions logged today (attempted or delivered — not cash collected).
 */
export async function getActedOnTodayCents(
  tenantId: string,
  now: Date = new Date()
): Promise<{ bounds: DashboardBusinessDayBounds; cents: number } | null> {
  const db = await getDb();
  if (!db) return null;

  const bounds = getDashboardBusinessDayBoundsUtc(now);

  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${adminActionLog.dollarValueCents}), 0)`,
    })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        inArray(adminActionLog.actionType, [...RECOVERY_ACTION_TYPES]),
        inArray(adminActionLog.status, [...ACTION_LOG_ACTED_STATUSES]),
        eq(adminActionLog.source, "manual_action"),
        gte(adminActionLog.createdAt, bounds.startUtc),
        lt(adminActionLog.createdAt, bounds.endUtc)
      )
    );

  return { bounds, cents: Number(row?.cents ?? 0) };
}

/**
 * Unpaid intervention pipeline — sum of order totals currently scored as at-risk for this tenant.
 */
export async function getAwaitingPaymentCents(
  tenantId: string,
  now: Date = new Date()
): Promise<{ bounds: DashboardBusinessDayBounds; cents: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const bounds = getDashboardBusinessDayBoundsUtc(now);
  const candidates = await listInterventionCandidates(tenantId, now);
  let cents = 0;
  for (const c of candidates) {
    cents += c.dollarValueCents;
  }
  return { bounds, cents };
}

/**
 * Actual cash collected: paid orders whose `paidAt` falls in the dashboard business day (tenant-scoped).
 * Does not use manual action logs. Requires `paidAt` set at payment time.
 */
export async function getCollectedTodayCents(
  tenantId: string,
  now: Date = new Date()
): Promise<{ bounds: DashboardBusinessDayBounds; cents: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const bounds = getDashboardBusinessDayBoundsUtc(now);

  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(ROUND(CAST(${orders.total} AS DECIMAL(14,4)) * 100)), 0)`,
    })
    .from(orders)
    .where(
      and(
        sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`,
        eq(orders.paid, true),
        isNotNull(orders.paidAt),
        gte(orders.paidAt, bounds.startUtc),
        lt(orders.paidAt, bounds.endUtc)
      )
    );

  return { bounds, cents: Number(row?.cents ?? 0) };
}

/**
 * Level 2 items: next 2–3 candidates after apex, never including the apex order id (defensive).
 */
export function tacticalClusterItemsAfterApex(
  filtered: ScoredInterventionCandidate[]
): ScoredInterventionCandidate[] {
  if (filtered.length === 0) return [];
  const apexId = filtered[0]!.order.id;
  return filtered.slice(1, 4).filter((c) => c.order.id !== apexId);
}

export type InterventionMutationType = "send_reminder";

export function interventionMutationTypeForCandidate(_c: ScoredInterventionCandidate): InterventionMutationType {
  return "send_reminder";
}

/**
 * Next 2–3 scored items after Level 1 apex, same ordering. Single mutation type in v1 (`send_reminder`).
 */
export async function getLevel2TacticalCluster(
  tenantId: string,
  now: Date = new Date()
): Promise<{
  bounds: DashboardBusinessDayBounds;
  items: ScoredInterventionCandidate[];
  /** When length &gt; 1 and all items share this mutation type, UI may aggregate. */
  aggregateMutationType: InterventionMutationType | null;
} | null> {
  const db = await getDb();
  if (!db) return null;

  const bounds = getDashboardBusinessDayBoundsUtc(now);
  const excluded = await orderIdsWithReminderActedToday(tenantId, bounds);
  const candidates = await listInterventionCandidates(tenantId, now);
  const filtered = candidates.filter((c) => !excluded.has(c.order.id));
  if (filtered.length === 0) {
    return { bounds, items: [], aggregateMutationType: null };
  }
  const items = tacticalClusterItemsAfterApex(filtered);
  const first = items[0];
  const firstType = first ? interventionMutationTypeForCandidate(first) : null;
  const aggregateMutationType =
    items.length > 1 &&
    firstType &&
    items.every((c) => interventionMutationTypeForCandidate(c) === firstType)
      ? firstType
      : null;
  return { bounds, items, aggregateMutationType };
}

export type SendReminderResult =
  | {
      ok: true;
      deduped: boolean;
      logId: number | null;
      logWriteSucceeded: true;
      logStatus: "attempted" | "delivered" | "failed" | "paid" | "reversed";
      /** Outbound comms: true once we record an operational attempt (log row). */
      outboundReminderAttempted: boolean;
      /** Known delivered when log status is `delivered`; `false` for `attempted`; else unknown. */
      outboundReminderDelivered: boolean | null;
      paymentCollected: boolean;
      actedOnTodayCents: number;
    }
  | { ok: false; error: string };

export async function sendPaymentReminderForOrder(params: {
  tenantId: string;
  orderId: number;
  now?: Date;
}): Promise<SendReminderResult> {
  const now = params.now ?? new Date();
  const db = await getDb();
  if (!db) return { ok: false, error: "Database not available" };

  const order = await db.select().from(orders).where(eq(orders.id, params.orderId)).limit(1);
  const row = order[0];
  if (!row) return { ok: false, error: "Order not found" };
  const rowTenant = row.tenantId ?? "default";
  if (rowTenant !== params.tenantId) return { ok: false, error: "Order not in tenant" };

  const bounds = getDashboardBusinessDayBoundsUtc(now);
  const entityId = orderEntityId(row.id);

  const [existing] = await db
    .select({ id: adminActionLog.id, status: adminActionLog.status })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, params.tenantId),
        eq(adminActionLog.actionType, ACTION_SEND_REMINDER),
        eq(adminActionLog.entityType, "order"),
        eq(adminActionLog.entityId, entityId),
        inArray(adminActionLog.status, [...ACTION_LOG_ACTED_STATUSES]),
        gte(adminActionLog.createdAt, bounds.startUtc),
        lt(adminActionLog.createdAt, bounds.endUtc)
      )
    )
    .limit(1);

  function deliveryFromLogStatus(
    s: "attempted" | "delivered" | "failed" | "paid" | "reversed"
  ): boolean | null {
    if (s === "delivered") return true;
    if (s === "attempted") return false;
    return null;
  }

  if (existing) {
    const acted = await getActedOnTodayCents(params.tenantId, now);
    const st = existing.status;
    return {
      ok: true,
      deduped: true,
      logId: existing.id,
      logWriteSucceeded: true,
      logStatus: st,
      outboundReminderAttempted: true,
      outboundReminderDelivered: deliveryFromLogStatus(st),
      paymentCollected: false,
      actedOnTodayCents: acted?.cents ?? 0,
    };
  }

  const t0 = Date.now();
  const dollarValueCents = orderTotalCents(row);

  try {
    const ins = await db.insert(adminActionLog).values({
      tenantId: params.tenantId,
      actionType: ACTION_SEND_REMINDER,
      entityType: "order",
      entityId,
      dollarValueCents,
      status: "attempted",
      source: "manual_action",
      executionTimeMs: Date.now() - t0,
      metadata: {
        orderId: row.id,
        outboundDeliveryConfirmed: false,
        outboundChannel: "not_configured",
        /** Populated when a provider returns an id; `delivered` only via webhook confirmation. */
        providerMessageId: null,
      },
    });
    const logId = Number(ins[0].insertId);
    const acted = await getActedOnTodayCents(params.tenantId, now);
    return {
      ok: true,
      deduped: false,
      logId: Number.isFinite(logId) ? logId : null,
      logWriteSucceeded: true,
      logStatus: "attempted",
      outboundReminderAttempted: true,
      outboundReminderDelivered: false,
      paymentCollected: false,
      actedOnTodayCents: acted?.cents ?? 0,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export type RevenueInterventionOrderDebug =
  | {
      orderId: number;
      paid: boolean;
      paidAt: Date | null;
      issueLabel: IssueLabel | null;
      apexEligible: boolean;
      l2Eligible: boolean;
      lastSendReminderLogStatus: string | null;
    }
  | { error: "order_not_found" | "wrong_tenant" };

/**
 * Dev-only diagnostics for a single order (apex/L2 eligibility, issue label, last reminder log).
 */
export async function getRevenueInterventionOrderDebug(
  tenantId: string,
  orderId: number,
  now: Date = new Date()
): Promise<RevenueInterventionOrderDebug | null> {
  const db = await getDb();
  if (!db) return null;

  const [orderRow] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!orderRow) return { error: "order_not_found" };
  if ((orderRow.tenantId ?? "default") !== tenantId) return { error: "wrong_tenant" };

  const stale48 = new Date(now.getTime() - 48 * 3600 * 1000);
  const stale24 = new Date(now.getTime() - 24 * 3600 * 1000);
  const businessYmd = zonedYmd(now, getDashboardTimeZone());
  const issueLabel = issueForOrder(orderRow, now, stale48, stale24, businessYmd);

  const l1 = await getLevel1ApexCommand(tenantId, now);
  const apexEligible = l1?.candidate?.order.id === orderId;

  const l2 = await getLevel2TacticalCluster(tenantId, now);
  const l2Eligible = l2?.items.some((c) => c.order.id === orderId) ?? false;

  const [log] = await db
    .select({ status: adminActionLog.status })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        eq(adminActionLog.actionType, ACTION_SEND_REMINDER),
        eq(adminActionLog.entityType, "order"),
        eq(adminActionLog.entityId, orderEntityId(orderId))
      )
    )
    .orderBy(desc(adminActionLog.createdAt))
    .limit(1);

  return {
    orderId,
    paid: orderRow.paid,
    paidAt: orderRow.paidAt,
    issueLabel,
    apexEligible,
    l2Eligible,
    lastSendReminderLogStatus: log?.status ?? null,
  };
}
