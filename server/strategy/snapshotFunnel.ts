/**
 * Funnel counts that can be derived from paid-order customer aggregates.
 *
 * Property Discovery / Property Approval are laundry-template labels, not
 * columns on commercial_accounts. Mapping pipeline stages onto those names
 * would be an invented equivalence. Those stages are omitted until a product
 * mapping exists. Resident first/repeat counts are observed paid-order facts.
 */

import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import type { FunnelStageItem } from "./snapshotTypes";

export const FUNNEL_LIMITING_INSUFFICIENT_DATA = "insufficient_data";
export const FUNNEL_LIMITING_SOURCE_UNAVAILABLE = "source_unavailable";

export function deriveFunnelFromCustomerAggregates(
  rows: AdminCustomerAggregateDbRow[]
): {
  stages: FunnelStageItem[];
  limitingStage: string;
} {
  const paid = rows.filter(row => row.paidOrderCount >= 1);
  const firstCount = paid.length;
  const repeatCount = paid.filter(row => row.paidOrderCount >= 2).length;
  const firstToRepeat =
    firstCount > 0 ? repeatCount / firstCount : undefined;

  const stages: FunnelStageItem[] = [];
  if (firstCount > 0) {
    stages.push({
      name: "Resident First Order",
      count: firstCount,
      observedConversionRate: firstToRepeat,
      isScenario: false,
      sampleSize: firstCount,
    });
  }
  if (repeatCount > 0 || firstCount > 0) {
    stages.push({
      name: "Resident Repeat Order",
      count: repeatCount,
      isScenario: false,
      sampleSize: firstCount,
    });
  }

  let limitingStage = FUNNEL_LIMITING_INSUFFICIENT_DATA;
  if (firstCount > 0 && firstToRepeat !== undefined) {
    limitingStage = "Resident First Order";
  }

  return { stages, limitingStage };
}
