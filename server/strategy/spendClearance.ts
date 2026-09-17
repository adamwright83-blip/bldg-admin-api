import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { strategySpendLedger, type StrategySpendLedgerRow } from "../../drizzle/schema";
import { getDb } from "../db";
import { getDashboardTimeZone } from "../dashboardZoned";
import { getActivePlaygroundRules } from "./playgroundRulesService";

export type SpendReservationStatus = "cleared" | "needs_approval" | "over_ceiling";

export type SpendClearanceResult = {
  cleared: boolean;
  status: SpendReservationStatus;
  reason: string;
  reservationId?: string;
  category: string;
  amountCents: number;
  remainingCents?: number;
  ceilingCents?: number;
};

export type SpendClearanceInput = {
  tenantId: string;
  category: string;
  amountCents: number;
  sourcePlayId?: string;
  sourceMissionId?: string;
  sourceRef?: string;
  dedupeKey?: string;
  businessMonth?: string;
};

export type SpendSummary = {
  tenantId: string;
  businessMonth: string;
  ceilingCents: number;
  plannedCents: number;
  committedCents: number;
  remainingCents: number;
  currency: string;
};

export function getBusinessMonth(date: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
    })
      .formatToParts(date)
      .map(p => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}`;
}

// In-memory ledger store for test fixtures and DB-independent execution
type InMemoryReservation = {
  id: string;
  tenantId: string;
  businessMonth: string;
  category: string;
  amountCents: number;
  currency: string;
  status: "planned" | "committed" | "released";
  sourcePlayId?: string | null;
  sourceMissionId?: string | null;
  sourceRef?: string | null;
  dedupeKey: string;
  createdAt: Date;
  updatedAt: Date;
};

const inMemoryLedger = new Map<string, InMemoryReservation[]>();
const tenantMonthLocks = new Map<string, Promise<void>>();

async function withTenantLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (tenantMonthLocks.has(key)) {
    await tenantMonthLocks.get(key);
  }
  let resolveLock!: () => void;
  const lockPromise = new Promise<void>(res => {
    resolveLock = res;
  });
  tenantMonthLocks.set(key, lockPromise);
  try {
    return await fn();
  } finally {
    tenantMonthLocks.delete(key);
    resolveLock();
  }
}

export function resetInMemorySpendLedgerForTesting(): void {
  inMemoryLedger.clear();
}

/**
 * Reserve spend under Guardrail G6.
 * Checks approval categories and atomic monthly ceiling.
 */
export async function reserveSpend(
  input: SpendClearanceInput
): Promise<SpendClearanceResult> {
  const timeZone = getDashboardTimeZone();
  const currentMonth = input.businessMonth ?? getBusinessMonth(new Date(), timeZone);
  const dedupeKey = input.dedupeKey ?? `spend:${input.tenantId}:${randomUUID()}`;
  const lockKey = `${input.tenantId}:${currentMonth}`;

  return withTenantLock(lockKey, async () => {
    const rules = await getActivePlaygroundRules(input.tenantId);
    const ceilingCents = rules.monthlySpendCeilingCents;
    const isApprovalCategory = rules.approvalCategories.includes(input.category);

    const db = await getDb();
    if (db) {
      try {
        return await db.transaction(
          async tx => {
            // Check for existing dedupeKey
            const [existing] = await tx
              .select()
              .from(strategySpendLedger)
              .where(
                and(
                  eq(strategySpendLedger.tenantId, input.tenantId),
                  eq(strategySpendLedger.dedupeKey, dedupeKey)
                )
              )
              .limit(1);

            if (existing) {
              return {
                cleared: existing.status === "planned" || existing.status === "committed",
                status: existing.status === "committed" || existing.status === "planned" ? "cleared" : "needs_approval",
                reason: "idempotent_existing_reservation",
                reservationId: existing.id,
                category: existing.category,
                amountCents: existing.amountCents,
                ceilingCents,
              };
            }

            // If category requires approval, create in needs_approval / planned
            if (isApprovalCategory) {
              const resId = randomUUID();
              await tx.insert(strategySpendLedger).values({
                id: resId,
                tenantId: input.tenantId,
                businessMonth: currentMonth,
                category: input.category,
                amountCents: input.amountCents,
                currency: rules.currency,
                status: "planned",
                sourcePlayId: input.sourcePlayId ?? null,
                sourceMissionId: input.sourceMissionId ?? null,
                sourceRef: input.sourceRef ?? null,
                dedupeKey,
              });

              return {
                cleared: false,
                status: "needs_approval",
                reason: "approval_category_blocks_even_under_ceiling",
                reservationId: resId,
                category: input.category,
                amountCents: input.amountCents,
                ceilingCents,
              };
            }

            // Month-to-date active spend (planned + committed)
            const activeRows = await tx
              .select({ amountCents: strategySpendLedger.amountCents })
              .from(strategySpendLedger)
              .where(
                and(
                  eq(strategySpendLedger.tenantId, input.tenantId),
                  eq(strategySpendLedger.businessMonth, currentMonth),
                  inArray(strategySpendLedger.status, ["planned", "committed"])
                )
              );

            const currentActiveCents = activeRows.reduce((sum, r) => sum + r.amountCents, 0);

            if (currentActiveCents + input.amountCents > ceilingCents) {
              return {
                cleared: false,
                status: "over_ceiling",
                reason: "over_monthly_spend_ceiling",
                category: input.category,
                amountCents: input.amountCents,
                remainingCents: Math.max(0, ceilingCents - currentActiveCents),
                ceilingCents,
              };
            }

            // Cleared! Insert planned reservation
            const resId = randomUUID();
            await tx.insert(strategySpendLedger).values({
              id: resId,
              tenantId: input.tenantId,
              businessMonth: currentMonth,
              category: input.category,
              amountCents: input.amountCents,
              currency: rules.currency,
              status: "planned",
              sourcePlayId: input.sourcePlayId ?? null,
              sourceMissionId: input.sourceMissionId ?? null,
              sourceRef: input.sourceRef ?? null,
              dedupeKey,
            });

            return {
              cleared: true,
              status: "cleared",
              reason: "cleared_under_ceiling",
              reservationId: resId,
              category: input.category,
              amountCents: input.amountCents,
              remainingCents: ceilingCents - (currentActiveCents + input.amountCents),
              ceilingCents,
            };
          },
          { isolationLevel: "serializable" }
        );
      } catch (err) {
        // G6 fail-closed: on database error, do NOT silently fall back to in-memory.
        // Fail closed immediately by rejecting spend clearance.
        console.error("[SpendClearance] G6 fail-closed on database error:", err);
        return {
          cleared: false,
          status: "over_ceiling",
          reason: `database_error: ${err instanceof Error ? err.message : String(err)}`,
          category: input.category,
          amountCents: input.amountCents,
          remainingCents: 0,
          ceilingCents,
        };
      }
    }

    // In production, if database is unavailable, fail closed
    if (process.env.NODE_ENV === "production") {
      return {
        cleared: false,
        status: "over_ceiling",
        reason: "database_unavailable_in_production",
        category: input.category,
        amountCents: input.amountCents,
        remainingCents: 0,
        ceilingCents,
      };
    }

    // In-memory fallback (only for non-production environments without a configured database)
    const list = inMemoryLedger.get(input.tenantId) ?? [];
    const existing = list.find(r => r.dedupeKey === dedupeKey);
    if (existing) {
      return {
        cleared: existing.status === "planned" || existing.status === "committed",
        status: existing.status === "committed" || existing.status === "planned" ? "cleared" : "needs_approval",
        reason: "idempotent_existing_reservation",
        reservationId: existing.id,
        category: existing.category,
        amountCents: existing.amountCents,
        ceilingCents,
      };
    }

    if (isApprovalCategory) {
      const resId = randomUUID();
      const res: InMemoryReservation = {
        id: resId,
        tenantId: input.tenantId,
        businessMonth: currentMonth,
        category: input.category,
        amountCents: input.amountCents,
        currency: rules.currency,
        status: "planned",
        sourcePlayId: input.sourcePlayId ?? null,
        sourceMissionId: input.sourceMissionId ?? null,
        sourceRef: input.sourceRef ?? null,
        dedupeKey,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      list.push(res);
      inMemoryLedger.set(input.tenantId, list);
      return {
        cleared: false,
        status: "needs_approval",
        reason: "approval_category_blocks_even_under_ceiling",
        reservationId: resId,
        category: input.category,
        amountCents: input.amountCents,
        ceilingCents,
      };
    }

    const currentActiveCents = list
      .filter(r => r.businessMonth === currentMonth && (r.status === "planned" || r.status === "committed"))
      .reduce((sum, r) => sum + r.amountCents, 0);

    if (currentActiveCents + input.amountCents > ceilingCents) {
      return {
        cleared: false,
        status: "over_ceiling",
        reason: "over_monthly_spend_ceiling",
        category: input.category,
        amountCents: input.amountCents,
        remainingCents: Math.max(0, ceilingCents - currentActiveCents),
        ceilingCents,
      };
    }

    const resId = randomUUID();
    const res: InMemoryReservation = {
      id: resId,
      tenantId: input.tenantId,
      businessMonth: currentMonth,
      category: input.category,
      amountCents: input.amountCents,
      currency: rules.currency,
      status: "planned",
      sourcePlayId: input.sourcePlayId ?? null,
      sourceMissionId: input.sourceMissionId ?? null,
      sourceRef: input.sourceRef ?? null,
      dedupeKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    list.push(res);
    inMemoryLedger.set(input.tenantId, list);

    return {
      cleared: true,
      status: "cleared",
      reason: "cleared_under_ceiling",
      reservationId: resId,
      category: input.category,
      amountCents: input.amountCents,
      remainingCents: ceilingCents - (currentActiveCents + input.amountCents),
      ceilingCents,
    };
  });
}

/**
 * Commit a planned reservation when spend actually occurs.
 */
export async function commitSpend(input: {
  tenantId: string;
  dedupeKey: string;
  approvedByUserId?: string;
}): Promise<boolean> {
  const db = await getDb();
  if (db) {
    try {
      const res = await db
        .update(strategySpendLedger)
        .set({
          status: "committed",
          approvedByUserId: input.approvedByUserId ?? null,
        })
        .where(
          and(
            eq(strategySpendLedger.tenantId, input.tenantId),
            eq(strategySpendLedger.dedupeKey, input.dedupeKey),
            eq(strategySpendLedger.status, "planned")
          )
        );
      return true;
    } catch (err) {
      console.error("[SpendClearance] Database error during commitSpend:", err);
      if (process.env.NODE_ENV === "production") {
        return false;
      }
    }
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const list = inMemoryLedger.get(input.tenantId) ?? [];
  const found = list.find(r => r.dedupeKey === input.dedupeKey && r.status === "planned");
  if (found) {
    found.status = "committed";
    found.updatedAt = new Date();
    return true;
  }
  return false;
}

/**
 * Release a planned reservation when a mission is dropped or approval is denied.
 */
export async function releaseSpend(input: {
  tenantId: string;
  dedupeKey: string;
  reason?: string;
}): Promise<boolean> {
  const db = await getDb();
  if (db) {
    try {
      await db
        .update(strategySpendLedger)
        .set({
          status: "released",
        })
        .where(
          and(
            eq(strategySpendLedger.tenantId, input.tenantId),
            eq(strategySpendLedger.dedupeKey, input.dedupeKey),
            eq(strategySpendLedger.status, "planned")
          )
        );
      return true;
    } catch (err) {
      console.error("[SpendClearance] Database error during releaseSpend:", err);
      if (process.env.NODE_ENV === "production") {
        return false;
      }
    }
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  const list = inMemoryLedger.get(input.tenantId) ?? [];
  const found = list.find(r => r.dedupeKey === input.dedupeKey && r.status === "planned");
  if (found) {
    found.status = "released";
    found.updatedAt = new Date();
    return true;
  }
  return false;
}

/**
 * Clean up stale planned reservations from prior months so they do not consume new month's ceiling.
 */
export async function cleanupStalePlannedReservations(
  tenantId: string,
  currentBusinessMonth: string
): Promise<number> {
  let cleaned = 0;
  const db = await getDb();
  if (db) {
    try {
      const res = await db
        .update(strategySpendLedger)
        .set({ status: "released" })
        .where(
          and(
            eq(strategySpendLedger.tenantId, tenantId),
            eq(strategySpendLedger.status, "planned"),
            sql`${strategySpendLedger.businessMonth} < ${currentBusinessMonth}`
          )
        );
      return 1;
    } catch (err) {
      console.error("[SpendClearance] Database error during cleanupStalePlannedReservations:", err);
      if (process.env.NODE_ENV === "production") {
        return 0;
      }
    }
  }

  if (process.env.NODE_ENV === "production") {
    return 0;
  }

  const list = inMemoryLedger.get(tenantId) ?? [];
  for (const item of list) {
    if (item.status === "planned" && item.businessMonth < currentBusinessMonth) {
      item.status = "released";
      item.updatedAt = new Date();
      cleaned += 1;
    }
  }
  return cleaned;
}

/**
 * Returns month-to-date planned and committed spend summary.
 */
export async function getMonthToDateSpend(
  tenantId: string,
  businessMonth?: string
): Promise<SpendSummary> {
  const timeZone = getDashboardTimeZone();
  const currentMonth = businessMonth ?? getBusinessMonth(new Date(), timeZone);
  const rules = await getActivePlaygroundRules(tenantId);
  const ceilingCents = rules.monthlySpendCeilingCents;

  const db = await getDb();
  if (db) {
    try {
      const rows = await db
        .select({
          amountCents: strategySpendLedger.amountCents,
          status: strategySpendLedger.status,
        })
        .from(strategySpendLedger)
        .where(
          and(
            eq(strategySpendLedger.tenantId, tenantId),
            eq(strategySpendLedger.businessMonth, currentMonth),
            inArray(strategySpendLedger.status, ["planned", "committed"])
          )
        );

      let plannedCents = 0;
      let committedCents = 0;
      for (const row of rows) {
        if (row.status === "planned") plannedCents += row.amountCents;
        else if (row.status === "committed") committedCents += row.amountCents;
      }
      return {
        tenantId,
        businessMonth: currentMonth,
        ceilingCents,
        plannedCents,
        committedCents,
        remainingCents: Math.max(0, ceilingCents - (plannedCents + committedCents)),
        currency: rules.currency,
      };
    } catch (err) {
      console.error("[SpendClearance] Database error during getMonthToDateSpend:", err);
      if (process.env.NODE_ENV === "production") {
        throw new Error(`Spend ledger database unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Spend ledger database unavailable in production");
  }

  const list = inMemoryLedger.get(tenantId) ?? [];
  let plannedCents = 0;
  let committedCents = 0;
  for (const item of list) {
    if (item.businessMonth === currentMonth) {
      if (item.status === "planned") plannedCents += item.amountCents;
      else if (item.status === "committed") committedCents += item.amountCents;
    }
  }

  return {
    tenantId,
    businessMonth: currentMonth,
    ceilingCents,
    plannedCents,
    committedCents,
    remainingCents: Math.max(0, ceilingCents - (plannedCents + committedCents)),
    currency: rules.currency,
  };
}

/**
 * Backward-compatible requiresSpendClearance calling reserveSpend.
 */
export async function requiresSpendClearance(
  input: SpendClearanceInput
): Promise<SpendClearanceResult> {
  if (input.amountCents <= 0) {
    return {
      cleared: true,
      status: "cleared",
      reason: "zero_spend_internal_task",
      category: input.category,
      amountCents: 0,
    };
  }
  return reserveSpend(input);
}
