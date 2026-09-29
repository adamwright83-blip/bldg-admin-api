import { and, eq, sql } from "drizzle-orm";
import {
  commercialCustomers,
  commercialOrderAttributions,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { AuthoritativeMetricObservation } from "../../persistentOperator/macroGoalRuns";
import type { MetricReader } from "./registry";

export const propertyAccountsWonMetricReader: MetricReader<AuthoritativeMetricObservation> =
  async ({ tenantId, asOf }) => {
    const db = await getDb();
    if (!db) {
      return {
        value: null,
        observationRef: null,
        precision: "missing",
        coverage: "unavailable",
        observedAt: (asOf ?? new Date()).toISOString(),
      };
    }
    const [row] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(commercialCustomers)
      .where(
        and(
          eq(commercialCustomers.tenantId, tenantId),
          eq(commercialCustomers.status, "active")
        )
      );
    const observedAt = (asOf ?? new Date()).toISOString();
    const value = Number(row?.count ?? 0);
    return {
      value,
      observationRef: `commercial.property_accounts_won.v1:${tenantId}:${observedAt}`,
      precision: "exact",
      coverage: "complete",
      observedAt,
    };
  };

export const recurringAccountPaidRevenueMetricReader: MetricReader<AuthoritativeMetricObservation> =
  async ({ tenantId, asOf }) => {
    const db = await getDb();
    if (!db) {
      return {
        value: null,
        observationRef: null,
        precision: "missing",
        coverage: "unavailable",
        observedAt: (asOf ?? new Date()).toISOString(),
      };
    }
    const [row] = await db
      .select({
        cents: sql<number>`COALESCE(SUM(${commercialOrderAttributions.paidCents}), 0)`,
      })
      .from(commercialOrderAttributions)
      .where(eq(commercialOrderAttributions.tenantId, tenantId));
    const observedAt = (asOf ?? new Date()).toISOString();
    const cents = Number(row?.cents ?? 0);
    return {
      value: cents / 100,
      observationRef: `commercial.recurring_account_paid_revenue.v1:${tenantId}:${observedAt}`,
      precision: "exact",
      coverage: "complete",
      observedAt,
    };
  };
