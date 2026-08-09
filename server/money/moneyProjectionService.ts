import { eq } from "drizzle-orm";
import { orderPaymentProjections } from "../../drizzle/schema";
import { sourcedFact, unknownValue } from "../../shared/businessGame";
import { getDb } from "../db";
import { listCustomerAssets } from "../customerAssets/customerAssetProjection";
import { getTruePnlCockpitSummary } from "../truePnlCockpit";
import type { MoneyProjection } from "./moneyTypes";

export async function getMoneyProjection(input: { tenantId: string }): Promise<MoneyProjection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [payments, assets, pnl] = await Promise.all([
    db.select().from(orderPaymentProjections).where(eq(orderPaymentProjections.tenantId, input.tenantId)),
    listCustomerAssets({ tenantId: input.tenantId }),
    input.tenantId === "default" ? getTruePnlCockpitSummary({ period: "month" }) : Promise.resolve(null),
  ]);
  const collected = payments.reduce((sum, row) => sum + (row.netPaidCents ?? 0), 0);
  const refunds = payments.reduce((sum, row) => sum + (row.refundedCents ?? 0), 0);
  const receivables = assets.reduce((sum, asset) => sum + (asset.outstandingReceivables.value ?? 0), 0);
  const realizedCommercial = assets.reduce((sum, asset) => sum + (asset.commercial?.realizedRevenue.value ?? 0), 0);
  const ownerPayLine = pnl?.lines.find(line => line.key === "ownerPay");
  const pnlAllowed = input.tenantId === "default";
  const warnings = [
    ...(!pnlAllowed ? ["True P&L is not tenant-scoped for this tenant and was intentionally withheld"] : []),
    ...(pnl?.warnings.map(warning => warning.message) ?? []),
    "Reserve policy is not configured, so expansion capital is unknown",
  ];
  return {
    generatedAt: new Date().toISOString(),
    collectedRevenue: sourcedFact(collected, "order_payment_projections.netPaidCents"),
    realizedRevenue: sourcedFact(collected + realizedCommercial, "payment projections + attributed commercial realized revenue"),
    receivables: sourcedFact(receivables, "customer asset outstanding receivables"),
    refunds: sourcedFact(refunds, "order_payment_projections.refundedCents"),
    grossRevenue: pnl ? sourcedFact(pnl.grossRevenueCents, `true_pnl:${pnl.tabName ?? "missing"}`) : unknownValue("Tenant-scoped gross P&L source unavailable"),
    operatingExpenses: pnl ? sourcedFact(pnl.totalExpenseCents, `true_pnl:${pnl.tabName ?? "missing"}`) : unknownValue("Tenant-scoped expense source unavailable"),
    ownerPay: ownerPayLine && !ownerPayLine.missing ? sourcedFact(ownerPayLine.amountCents, `true_pnl:${ownerPayLine.matchedLabels.join(",")}`) : unknownValue("Owner pay is missing from the trusted P&L source"),
    trueNet: pnl ? sourcedFact(pnl.trueNetCents, `true_pnl:${pnl.tabName ?? "missing"}`) : unknownValue("Tenant-scoped true net source unavailable"),
    reserveRequirement: unknownValue("No explicit reserve policy is configured"),
    expansionCapital: unknownValue("Reserve requirement is unknown"),
    expansionCapitalStatus: "INSUFFICIENT_DATA",
    trust: { trusted: Boolean(pnl?.trusted), warnings, source: pnl ? "google_sheets_true_pnl" : "payment_projections_only" },
    dataQuality: { status: pnl?.trusted ? "partial" : "insufficient", warnings, sources: ["order_payment_projections", "customer_assets", ...(pnl ? ["true_pnl_google_sheet"] : [])] },
  };
}
