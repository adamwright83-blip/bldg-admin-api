/**
 * Live-derived dormant-eligible customers for the StrategyEngine snapshot.
 *
 * Source of truth: tenant-scoped `listAdminCustomerAggregates` (orders table).
 * Dormancy is recency against the same 30-day inactivity rule used by
 * `getStrategyGrowthMetrics` (`inactivityDays` default). Churn scoring is
 * not used as a gate: `scoreCustomerChurn` requires two completed orders and
 * would silently drop one-order customers who never returned.
 *
 * Snapshot `id` is a non-reversible hash of the admin customer group key so
 * raw phone numbers are not copied into Claire/strategy context.
 */

import { createHash } from "node:crypto";
import { buildingFromSlug } from "@shared/buildings";
import {
  computeCustomerGroupKey,
  type AdminCustomerAggregateDbRow,
} from "../adminCustomerAggregate";
import { listAdminCustomerAggregates } from "../db";

/** Matches `getStrategyGrowthMetrics` default `inactivityDays`. */
export const DORMANT_INACTIVITY_DAYS = 30;

/** Token-budget cap for Claire context, not a fixture-shape leftover. */
export const MAX_DORMANT_ELIGIBLE_IN_SNAPSHOT = 12;

const DAY_MS = 86_400_000;

export type DormantEligibleCustomer = {
  id: string;
  firstName: string;
  buildingName?: string;
  lastOrderAt: string;
  daysSinceLastOrder: number;
};

export type DormantEligibleResult = {
  customers: DormantEligibleCustomer[];
  consideredPaidCustomerCount: number;
  totalEligibleCount: number;
};

export function strategyCustomerSnapshotId(
  tenantId: string,
  row: Pick<
    AdminCustomerAggregateDbRow,
    "phone" | "firstName" | "lastName" | "unit" | "buildingSlug" | "address"
  >
): string {
  const groupKey = computeCustomerGroupKey(row);
  const digest = createHash("sha256")
    .update(`strategy-customer:${tenantId}:${groupKey}`)
    .digest("hex")
    .slice(0, 20);
  return `cust_${digest}`;
}

export function daysSince(lastOrderAt: Date, now: Date): number {
  const lastMs = lastOrderAt.getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor((nowMs - lastMs) / DAY_MS));
}

export function deriveDormantEligibleCustomers(
  rows: AdminCustomerAggregateDbRow[],
  input: { tenantId: string; now: Date; inactivityDays?: number; limit?: number }
): DormantEligibleResult {
  const inactivityDays = input.inactivityDays ?? DORMANT_INACTIVITY_DAYS;
  const limit = input.limit ?? MAX_DORMANT_ELIGIBLE_IN_SNAPSHOT;
  const paid = rows.filter(row => row.paidOrderCount >= 1);
  const eligible = paid
    .map(row => {
      const elapsed = daysSince(row.lastOrderAt, input.now);
      if (elapsed < inactivityDays) return null;
      const building = buildingFromSlug(row.buildingSlug);
      const item: DormantEligibleCustomer = {
        id: strategyCustomerSnapshotId(input.tenantId, row),
        firstName: row.firstName.trim(),
        lastOrderAt: row.lastOrderAt.toISOString(),
        daysSinceLastOrder: elapsed,
      };
      if (building?.name) item.buildingName = building.name;
      return item;
    })
    .filter((item): item is DormantEligibleCustomer => item !== null)
    .sort((a, b) => {
      if (b.daysSinceLastOrder !== a.daysSinceLastOrder) {
        return b.daysSinceLastOrder - a.daysSinceLastOrder;
      }
      return a.id.localeCompare(b.id);
    });

  return {
    customers: eligible.slice(0, limit),
    consideredPaidCustomerCount: paid.length,
    totalEligibleCount: eligible.length,
  };
}

export async function loadDormantEligibleCustomers(input: {
  tenantId: string;
  now: Date;
  inactivityDays?: number;
  aggregates?: AdminCustomerAggregateDbRow[];
}): Promise<DormantEligibleResult> {
  const rows =
    input.aggregates ?? (await listAdminCustomerAggregates(input.tenantId));
  return deriveDormantEligibleCustomers(rows, {
    tenantId: input.tenantId,
    now: input.now,
    inactivityDays: input.inactivityDays,
  });
}
