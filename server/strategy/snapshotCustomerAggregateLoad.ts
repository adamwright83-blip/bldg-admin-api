/**
 * Tenant-scoped customer-aggregate load for StrategyEngine.
 *
 * Distinguishes observed-empty from source-unavailable. Missing tables and
 * a missing database are unavailable. Arbitrary SQL errors are rethrown.
 */

import { eq } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import {
  buildAdminCustomerAggregatesInMemory,
  normalizeOrderRowFromDb,
  type AdminCustomerAggregateDbRow,
} from "../adminCustomerAggregate";
import { getDb } from "../db";
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
    const rows = await db
      .select({
        id: orders.id,
        phone: orders.phone,
        firstName: orders.firstName,
        lastName: orders.lastName,
        email: orders.email,
        unit: orders.unit,
        address: orders.address,
        buildingSlug: orders.buildingSlug,
        createdAt: orders.createdAt,
        paid: orders.paid,
        total: orders.total,
      })
      .from(orders)
      .where(eq(orders.tenantId, tenantId));

    return {
      status: "available",
      rows: buildAdminCustomerAggregatesInMemory(
        rows.map(normalizeOrderRowFromDb)
      ),
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
