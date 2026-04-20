/**
 * Level 4 Offensive Growth — "execute action" writer.
 *
 * Dispatches the admin's click on a Level 4 lane into an admin_action_log row
 * of the canonical actionType (building_penetration | referral_request |
 * market_hole_outreach). No outbound delivery yet — v1 logs the decision so
 * the dashboard can retire the card; outbound channels are future work.
 *
 * Dedup rules:
 *   - building_penetration : per (tenant, building slug, business day)
 *   - referral_request     : per (tenant, bldg_users.id) — matches the read-side
 *                            exclusion in getLevel4OffensiveState.
 *   - market_hole_outreach : per (tenant, business day) — Block C is stubbed
 *                            and fires at most once per day regardless of copy.
 */

import { and, eq, gte, lt } from "drizzle-orm";
import { adminActionLog } from "../drizzle/schema";
import type { TenantId } from "@shared/tenantConfig";
import { getDb } from "./db";
import { getDashboardBusinessDayBoundsUtc } from "./revenueIntervention";

const ACTION_BUILDING_PENETRATION = "building_penetration" as const;
const ACTION_REFERRAL_REQUEST = "referral_request" as const;
const ACTION_MARKET_HOLE = "market_hole_outreach" as const;

/**
 * Admin-reviewed copy captured in the preview modal.
 * `deliverable` and `brandId` are present from the brand-selection pass forward.
 * Historical rows written before that may contain only the four text fields;
 * readers should tolerate the missing discriminators.
 */
export type GeneratedCopyForExec = {
  headline: string;
  body: string;
  primaryCopy: string;
  internalNote: string;
  deliverable: "sms" | "card";
  brandId: TenantId;
};

export type ExecuteOffensiveInput =
  | {
      block: "building_penetration";
      buildingSlug: string;
      buildingName: string;
      /** Snapshot of scoring inputs at click time — audit trail, not rehydrated. */
      metadata?: {
        convertedUsers?: number;
        convertedPaidUsers?: number;
        total?: number;
        unconverted?: number;
        penetrationPct?: number;
        paidPenetrationPct?: number;
      };
      generatedCopy: GeneratedCopyForExec;
    }
  | {
      block: "referral_request";
      userId: number;
      firstName: string;
      lastInitial: string;
      orderCount: number;
      ltvCents: number;
      generatedCopy: GeneratedCopyForExec;
    }
  | {
      block: "market_hole_outreach";
      /** Block C is stubbed for v1 — no LLM call — but the admin click still logs. */
      note?: string;
    };

/**
 * Reads the primary-copy text from either the new `primaryCopy` field or the
 * legacy `smsCopy` field. Historical admin_action_log rows serialized the
 * latter; no migration is planned, so every reader that inspects stored copy
 * metadata should route through this helper.
 */
export function readPrimaryCopyField(
  stored: { primaryCopy?: unknown; smsCopy?: unknown } | null | undefined
): string | null {
  if (!stored) return null;
  if (typeof stored.primaryCopy === "string" && stored.primaryCopy.length > 0) {
    return stored.primaryCopy;
  }
  if (typeof stored.smsCopy === "string" && stored.smsCopy.length > 0) {
    return stored.smsCopy;
  }
  return null;
}

export type ExecuteOffensiveResult =
  | { ok: true; deduped: boolean; logId: number | null; actionType: string }
  | { ok: false; error: string };

export async function executeOffensiveAction(
  tenantId: string,
  input: ExecuteOffensiveInput
): Promise<ExecuteOffensiveResult> {
  const db = await getDb();
  if (!db) return { ok: false, error: "Database unavailable." };

  const bounds = getDashboardBusinessDayBoundsUtc();
  const t0 = Date.now();

  if (input.block === "building_penetration") {
    const entityId = input.buildingSlug;
    const existing = await db
      .select({ id: adminActionLog.id })
      .from(adminActionLog)
      .where(
        and(
          eq(adminActionLog.tenantId, tenantId),
          eq(adminActionLog.actionType, ACTION_BUILDING_PENETRATION),
          eq(adminActionLog.entityType, "building"),
          eq(adminActionLog.entityId, entityId),
          gte(adminActionLog.createdAt, bounds.startUtc),
          lt(adminActionLog.createdAt, bounds.endUtc)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      return { ok: true, deduped: true, logId: existing[0].id, actionType: ACTION_BUILDING_PENETRATION };
    }

    const ins = await db.insert(adminActionLog).values({
      tenantId,
      actionType: ACTION_BUILDING_PENETRATION,
      entityType: "building",
      entityId,
      dollarValueCents: 0,
      status: "attempted",
      source: "manual_action",
      executionTimeMs: Date.now() - t0,
      metadata: {
        buildingSlug: input.buildingSlug,
        buildingName: input.buildingName,
        snapshot: input.metadata ?? {},
        generatedCopy: input.generatedCopy,
      },
    });
    const logId = Number(ins[0].insertId);
    return {
      ok: true,
      deduped: false,
      logId: Number.isFinite(logId) ? logId : null,
      actionType: ACTION_BUILDING_PENETRATION,
    };
  }

  if (input.block === "referral_request") {
    const entityId = String(input.userId);
    const existing = await db
      .select({ id: adminActionLog.id })
      .from(adminActionLog)
      .where(
        and(
          eq(adminActionLog.tenantId, tenantId),
          eq(adminActionLog.actionType, ACTION_REFERRAL_REQUEST),
          eq(adminActionLog.entityType, "customer"),
          eq(adminActionLog.entityId, entityId)
        )
      )
      .limit(1);
    if (existing.length > 0) {
      return { ok: true, deduped: true, logId: existing[0].id, actionType: ACTION_REFERRAL_REQUEST };
    }

    const ins = await db.insert(adminActionLog).values({
      tenantId,
      actionType: ACTION_REFERRAL_REQUEST,
      entityType: "customer",
      entityId,
      dollarValueCents: input.ltvCents,
      status: "attempted",
      source: "manual_action",
      executionTimeMs: Date.now() - t0,
      metadata: {
        userId: input.userId,
        firstName: input.firstName,
        lastInitial: input.lastInitial,
        orderCount: input.orderCount,
        ltvCents: input.ltvCents,
        generatedCopy: input.generatedCopy,
      },
    });
    const logId = Number(ins[0].insertId);
    return {
      ok: true,
      deduped: false,
      logId: Number.isFinite(logId) ? logId : null,
      actionType: ACTION_REFERRAL_REQUEST,
    };
  }

  // market_hole_outreach — stub-safe. Fires once per tenant per business day.
  const existing = await db
    .select({ id: adminActionLog.id })
    .from(adminActionLog)
    .where(
      and(
        eq(adminActionLog.tenantId, tenantId),
        eq(adminActionLog.actionType, ACTION_MARKET_HOLE),
        eq(adminActionLog.entityType, "building"),
        gte(adminActionLog.createdAt, bounds.startUtc),
        lt(adminActionLog.createdAt, bounds.endUtc)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return { ok: true, deduped: true, logId: existing[0].id, actionType: ACTION_MARKET_HOLE };
  }

  const ins = await db.insert(adminActionLog).values({
    tenantId,
    actionType: ACTION_MARKET_HOLE,
    entityType: "building",
    entityId: "stubbed_for_v1",
    dollarValueCents: 0,
    status: "attempted",
    source: "manual_action",
    executionTimeMs: Date.now() - t0,
    metadata: {
      stubbed: true,
      note: input.note ?? null,
    },
  });
  const logId = Number(ins[0].insertId);
  return {
    ok: true,
    deduped: false,
    logId: Number.isFinite(logId) ? logId : null,
    actionType: ACTION_MARKET_HOLE,
  };
}

