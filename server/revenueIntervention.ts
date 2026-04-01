import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { adminActionLog, orders, type Order } from "../drizzle/schema";
import { getDb } from "./db";
import {
  getDashboardTimeZone,
  zonedDayStartUtc,
  zonedNextDayYmd,
  zonedYmd,
} from "./dashboardZoned";

export const ACTION_SEND_REMINDER = "send_reminder" as const;

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

/** All "today", dedupe, and recovered sums use this window (no mixed TZ). */
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
  | "collected_stale_48h"
  | "manual_risk_override";

export type ScoredInterventionCandidate = {
  order: Order;
  issueLabel: IssueLabel;
  dollarValueCents: number;
  score: number;
};

const REMINDER_WEIGHT = 1.2;

function issueForOrder(row: Order, _now: Date, stale48: Date, stale24: Date): IssueLabel | null {
  if (row.manualRiskFlag) return "manual_risk_override";
  if (row.status === "processing" && row.updatedAt < stale48) return "processing_stale_48h";
  if (row.status === "new" && row.updatedAt < stale48) return "new_stale_48h";
  if (row.status === "collected" && row.updatedAt < stale48) return "collected_stale_48h";
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

function scoreCandidate(row: Order, issueLabel: IssueLabel, now: Date): number {
  const dollarValueCents = orderTotalCents(row);
  const daysOverdue = daysBetween(row.updatedAt, now);
  const isCompletedUninvoiced =
    issueLabel === "ready_unpaid_24h" || issueLabel === "delivered_unpaid_24h";
  const isFailedRetry = false;
  return (
    dollarValueCents * REMINDER_WEIGHT +
    daysOverdue * 0.25 * dollarValueCents +
    (isCompletedUninvoiced ? dollarValueCents * 0.5 : 0) +
    (isFailedRetry ? dollarValueCents * 2.0 : 0)
  );
}

async function orderIdsWithReminderSuccessToday(
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
        eq(adminActionLog.status, "success"),
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
    const issueLabel = issueForOrder(row, now, stale48, stale24);
    if (!issueLabel) continue;
    scored.push({
      order: row,
      issueLabel,
      dollarValueCents: orderTotalCents(row),
      score: scoreCandidate(row, issueLabel, now),
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
  const excluded = await orderIdsWithReminderSuccessToday(tenantId, bounds);
  const candidates = await listInterventionCandidates(tenantId, now);

  for (const c of candidates) {
    if (excluded.has(c.order.id)) continue;
    return { bounds, candidate: c };
  }
  return { bounds, candidate: null };
}

/** Sum successful manual recoveries logged today (dashboard TZ). Includes negative reversal rows. */
export async function getRecoveredTodayCents(
  tenantId: string,
  now: Date = new Date()
): Promise<{ bounds: DashboardBusinessDayBounds; cents: number } | null> {
  const db = await getDb();
  if (!db) return null;

  const bounds = getDashboardBusinessDayBoundsUtc(now);
  const recoveryActions = [ACTION_SEND_REMINDER, "send_invoice"] as const;

  const [row] = await db
    .select({
      cents: sql<number>`COALESCE(SUM(${adminActionLog.dollarValueCents}), 0)`,
    })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        inArray(adminActionLog.actionType, [...recoveryActions]),
        eq(adminActionLog.status, "success"),
        eq(adminActionLog.source, "manual_action"),
        gte(adminActionLog.createdAt, bounds.startUtc),
        lt(adminActionLog.createdAt, bounds.endUtc)
      )
    );

  return { bounds, cents: Number(row?.cents ?? 0) };
}

export type SendReminderResult =
  | { ok: true; deduped: boolean; logId: number | null; recoveredTodayCents: number }
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
    .select({ id: adminActionLog.id })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, params.tenantId),
        eq(adminActionLog.actionType, ACTION_SEND_REMINDER),
        eq(adminActionLog.entityType, "order"),
        eq(adminActionLog.entityId, entityId),
        eq(adminActionLog.status, "success"),
        gte(adminActionLog.createdAt, bounds.startUtc),
        lt(adminActionLog.createdAt, bounds.endUtc)
      )
    )
    .limit(1);

  if (existing) {
    const recovered = await getRecoveredTodayCents(params.tenantId, now);
    return {
      ok: true,
      deduped: true,
      logId: existing.id,
      recoveredTodayCents: recovered?.cents ?? 0,
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
      status: "success",
      source: "manual_action",
      executionTimeMs: Date.now() - t0,
      metadata: { orderId: row.id },
    });
    const logId = Number(ins[0].insertId);
    const recovered = await getRecoveredTodayCents(params.tenantId, now);
    return {
      ok: true,
      deduped: false,
      logId: Number.isFinite(logId) ? logId : null,
      recoveredTodayCents: recovered?.cents ?? dollarValueCents,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
