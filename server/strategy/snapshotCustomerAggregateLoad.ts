/**
 * Tenant-scoped customer-aggregate load for StrategyEngine.
 *
 * Distinguishes observed-empty from source-unavailable. Missing tables and
 * a missing database are unavailable. Arbitrary SQL errors are rethrown.
 *
 * History is the unified canonical customer/order set (native + CleanCloud).
 * Churn Radar / recovery scans remain native-orders-only; see GOLDLINE-TASKS.
 */

import {
  buildAdminCustomerAggregatesFromTruth,
  type AdminCustomerAggregateDbRow,
} from "../adminCustomerAggregate";
import { getDb } from "../db";
import { loadCustomerOrderTruth } from "../geography/customerOrderTruth";
import { isMysqlMissingTableError } from "../mysqlErrors";

export type CustomerAggregateLoad =
  | { status: "available"; rows: AdminCustomerAggregateDbRow[] }
  | { status: "unavailable"; reason: string };

export async function loadStrategyCustomerAggregates(
  tenantId: string
): Promise<CustomerAggregateLoad> {
  const db = await getDb();
  if (!db) {
    return { status: "unavailable", reason: "Database not available" };
  }

  try {
    const records = await loadCustomerOrderTruth(tenantId, {
      includeCancelledNative: true,
    });
    return {
      status: "available",
      rows: buildAdminCustomerAggregatesFromTruth(tenantId, records),
    };
  } catch (error) {
    if (isMysqlMissingTableError(error)) {
      return {
        status: "unavailable",
        reason: "orders table is not present in this database",
      };
    }
    throw error;
  }
}
