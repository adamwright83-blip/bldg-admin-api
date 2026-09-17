/**
 * Recent first-order → second-order pipeline from admin customer aggregates.
 * Feedback is not observed in this source; status fields are marked unavailable
 * rather than filled with plausible "positive"/"delivered" values.
 */

import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { listAdminCustomerAggregates } from "../db";
import {
  daysSince,
  strategyCustomerSnapshotId,
} from "./snapshotDormantCustomers";

/** Same 30-day business window as the snapshot growth metrics period. */
export const RECENT_FIRST_ORDER_WINDOW_DAYS = 30;
export const MAX_REPEAT_PIPELINE_IN_SNAPSHOT = 12;

export type RepeatPipelineCustomer = {
  id: string;
  displayName?: string;
  firstOrderAt: string;
  fulfillmentStatus: string;
  feedbackStatus: string;
  hasSecondOrder: boolean;
  cohortAgeDays: number;
  isDueToReorder: boolean;
  reorderBasis?: string;
};

export type RepeatPipelineResult = {
  recentFirstOrderCustomers: RepeatPipelineCustomer[];
  summary: {
    totalRecent: number;
    secondOrdersPlaced: number;
    openFeedbackIssues: number | null;
  };
};

export function deriveRepeatPipeline(
  rows: AdminCustomerAggregateDbRow[],
  input: { tenantId: string; now: Date; windowDays?: number; limit?: number }
): RepeatPipelineResult {
  const windowDays = input.windowDays ?? RECENT_FIRST_ORDER_WINDOW_DAYS;
  const limit = input.limit ?? MAX_REPEAT_PIPELINE_IN_SNAPSHOT;
  const recent = rows
    .filter(row => row.paidOrderCount >= 1)
    .map(row => {
      const cohortAgeDays = daysSince(row.firstOrderAt, input.now);
      if (cohortAgeDays > windowDays) return null;
      const hasSecondOrder = row.paidOrderCount >= 2;
      const displayName = row.firstName.trim();
      const customer: RepeatPipelineCustomer = {
        id: strategyCustomerSnapshotId(input.tenantId, row),
        firstOrderAt: row.firstOrderAt.toISOString(),
        fulfillmentStatus: "unavailable",
        feedbackStatus: "unavailable",
        hasSecondOrder,
        cohortAgeDays,
        isDueToReorder: false,
        reorderBasis: hasSecondOrder
          ? "second_paid_order_already_placed"
          : "insufficient_history_for_observed_cadence",
      };
      if (displayName) customer.displayName = displayName;
      return customer;
    })
    .filter((item): item is RepeatPipelineCustomer => item !== null)
    .sort((a, b) => {
      if (a.cohortAgeDays !== b.cohortAgeDays) {
        return b.cohortAgeDays - a.cohortAgeDays;
      }
      return a.id.localeCompare(b.id);
    });

  const limited = recent.slice(0, limit);
  return {
    recentFirstOrderCustomers: limited,
    summary: {
      totalRecent: recent.length,
      secondOrdersPlaced: recent.filter(c => c.hasSecondOrder).length,
      openFeedbackIssues: null,
    },
  };
}

export async function loadRepeatPipeline(input: {
  tenantId: string;
  now: Date;
  aggregates?: AdminCustomerAggregateDbRow[];
}): Promise<RepeatPipelineResult> {
  const rows =
    input.aggregates ?? (await listAdminCustomerAggregates(input.tenantId));
  return deriveRepeatPipeline(rows, {
    tenantId: input.tenantId,
    now: input.now,
  });
}
