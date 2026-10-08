import { eq } from "drizzle-orm";
import { orderPaymentProjections } from "../../drizzle/schema";
import { sourcedFact, unknownValue } from "../../shared/businessGame";
import { getDb } from "../db";
import { readCanonicalRevenue } from "../analytics/canonicalRevenue";
import { resolvePeriod } from "../analytics/businessPeriods";
import { listCustomerAssets } from "../customerAssets/customerAssetProjection";
import { getTruePnlCockpitSummary } from "../truePnlCockpit";
import type { MoneyProjection } from "./moneyTypes";

export async function getMoneyProjection(input: {
  tenantId: string;
}): Promise<MoneyProjection> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  // Payment revenue remains cumulative; the separate P&L below remains monthly.
  const period = resolvePeriod({ kind: "all_time" }, now);
  const [revenue, payments, assets, pnl] = await Promise.all([
    readCanonicalRevenue({
      tenantId: input.tenantId,
      from: period.start,
      to: period.end,
      timeZone: period.timeZone,
      now,
    }),
    db
      .select()
      .from(orderPaymentProjections)
      .where(eq(orderPaymentProjections.tenantId, input.tenantId)),
    listCustomerAssets({ tenantId: input.tenantId }),
    input.tenantId === "default"
      ? getTruePnlCockpitSummary({ period: "month" })
      : Promise.resolve(null),
  ]);
  const revenueSource = `canonical_paid_revenue:${input.tenantId}:${period.start}:${period.end}:${period.timeZone}`;
  const paymentRevenue =
    revenue.status === "unavailable"
      ? unknownValue<number>("Canonical paid revenue sources are unavailable")
      : {
          ...sourcedFact(
            revenue.recordedCents,
            `${revenueSource}:${revenue.precision}`
          ),
          confidence: revenue.mayStateExact
            ? ("high" as const)
            : ("medium" as const),
        };
  const refunds = payments.reduce(
    (sum, row) => sum + (row.refundedCents ?? 0),
    0
  );
  const receivables = assets.reduce(
    (sum, asset) => sum + (asset.outstandingReceivables.value ?? 0),
    0
  );
  const ownerPayLine = pnl?.lines.find(line => line.key === "ownerPay");
  const pnlAllowed = input.tenantId === "default";
  const warnings = [
    ...(revenue.status === "unavailable"
      ? ["Canonical paid revenue is unavailable; unknown is not zero"]
      : revenue.mayStateExact
        ? []
        : [
            `Payment revenue is recorded only for ${period.start} through ${period.end}; canonical coverage does not license an exact total (book: ${revenue.coverage.bookStatus ?? "unknown"}; affected sources: ${revenue.coverage.affectedSources.join(", ") || "none"}; failed sources: ${revenue.coverage.failedSources.join(", ") || "none"}; withheld cents: ${revenue.suspectedWithheld.cents}; unverified native cents: ${revenue.unverifiedNative.cents})`,
          ]),
    ...(!pnlAllowed
      ? [
          "True P&L is not tenant-scoped for this tenant and was intentionally withheld",
        ]
      : []),
    ...(pnl?.warnings.map(warning => warning.message) ?? []),
    "Reserve policy is not configured, so expansion capital is unknown",
  ];
  return {
    generatedAt: now.toISOString(),
    collectedRevenue: paymentRevenue,
    // Attribution classifies payments already in the ledger; it is not additive revenue.
    realizedRevenue: paymentRevenue,
    receivables: assets.some(asset => asset.outstandingReceivables.value == null)
      ? unknownValue<number>("Some customer payment balances are unverified")
      : sourcedFact(
      receivables,
      "customer asset outstanding receivables"
    ),
    refunds: sourcedFact(refunds, "order_payment_projections.refundedCents"),
    grossRevenue: pnl
      ? sourcedFact(
          pnl.grossRevenueCents,
          `true_pnl:${pnl.tabName ?? "missing"}`
        )
      : unknownValue("Tenant-scoped gross P&L source unavailable"),
    operatingExpenses: pnl
      ? sourcedFact(
          pnl.totalExpenseCents,
          `true_pnl:${pnl.tabName ?? "missing"}`
        )
      : unknownValue("Tenant-scoped expense source unavailable"),
    ownerPay:
      ownerPayLine && !ownerPayLine.missing
        ? sourcedFact(
            ownerPayLine.amountCents,
            `true_pnl:${ownerPayLine.matchedLabels.join(",")}`
          )
        : unknownValue("Owner pay is missing from the trusted P&L source"),
    trueNet: pnl
      ? sourcedFact(pnl.trueNetCents, `true_pnl:${pnl.tabName ?? "missing"}`)
      : unknownValue("Tenant-scoped true net source unavailable"),
    reserveRequirement: unknownValue(
      "No explicit reserve policy is configured"
    ),
    expansionCapital: unknownValue("Reserve requirement is unknown"),
    expansionCapitalStatus: "INSUFFICIENT_DATA",
    trust: {
      trusted: Boolean(
        pnl?.trusted && revenue.status === "ok" && revenue.mayStateExact
      ),
      warnings,
      source: pnl ? "google_sheets_true_pnl" : "canonical_paid_revenue",
    },
    dataQuality: {
      status: revenue.status === "ok" ? "partial" : "insufficient",
      warnings,
      sources: [
        "canonical_paid_revenue",
        "order_payment_projections_refunds",
        "customer_assets",
        ...(pnl ? ["true_pnl_google_sheet"] : []),
      ],
    },
  };
}
