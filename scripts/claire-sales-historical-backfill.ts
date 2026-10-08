import { validateHistoricalPayload } from "../server/integrations/cleancloud/browserSync/validation";
import { parseCsv } from "../extensions/gumballpals/core.js";
import { loadPaidOrderLedger } from "../server/analytics/paidOrderLedger";
import { reconcileLedgerSpan } from "../server/analytics/canonicalRevenue";
import { lineageBreakdown } from "../server/analytics/businessLineage";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { certifyHistoricalSales } from "../server/analytics/salesTruthCertificate";
import { executeCleanCloudIngestion } from "../server/integrations/cleancloud/browserSync/ingestion";

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
const apply = args.includes("--apply");
const tenantId = args.includes("--tenant") ? value("--tenant") : null;
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL required; use the verified production public connection via an authorized secret provider"
  );
const connection = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [bindings] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT tenantId, id, storeId, storeLabel FROM cleancloud_browser_sync_bindings"
  );
  if (args.includes("--preflight")) {
    const [counts] = await connection.query(
      "SELECT sourceReportType, COUNT(*) AS sourceRows, COUNT(DISTINCT cleancloudOrderId) AS uniqueOrders, SUM(totalCents) AS sourceCents FROM cleancloud_paid_orders GROUP BY sourceReportType"
    );
    console.log(JSON.stringify({ bindings, sourceCounts: counts }, null, 2));
  } else {
    if (!tenantId) throw new Error("Explicit --tenant required");
    const binding = bindings.find(row => row.tenantId === tenantId);
    if (!binding || !/\blaundry\s*farm\b/i.test(binding.storeLabel))
      throw new Error("Verified Laundry Farm source binding required");
    const ordersPath = value("--orders"),
      revenuePath = value("--revenue");
    if (!args.includes("--orders") || !args.includes("--revenue"))
      throw new Error("--orders and --revenue private CSV paths required");
    const ordersCsv = readFileSync(ordersPath, "utf8"),
      revenueCsv = readFileSync(revenuePath, "utf8");
    const sourceCertificate = certifyHistoricalSales({ ordersCsv, revenueCsv });
    console.log(JSON.stringify({ sourceCertificate, apply }, null, 2));
    if (!sourceCertificate.passed)
      throw new Error("Historical source controls failed; no import performed");
    for (const reportType of ["orders_sales", "orders_revenue"] as const)
      validateHistoricalPayload(
        {
          csv: reportType === "orders_sales" ? ordersCsv : revenueCsv,
          from: "2024-09-10",
          to: "2026-10-04",
          storeId: binding.storeId,
          reportType,
        },
        tenantId
      );
    if (apply) {
      const ddl = readFileSync(
        new URL(
          "../drizzle/0116_claire_sales_reconciliation.sql",
          import.meta.url
        ),
        "utf8"
      );
      for (const statement of ddl
        .split(";")
        .map(item => item.trim())
        .filter(Boolean))
        await connection.execute(statement);
      const receipts = [];
      for (const reportType of ["orders_sales", "orders_revenue"] as const) {
        for (let replay = 0; replay < 2; replay++) {
          const receipt = await executeCleanCloudIngestion(
            {
              tenantId,
              actorId: "claire-sales-historical-backfill",
              bindingId: binding.id,
              storeId: binding.storeId,
              storeLabel: binding.storeLabel,
              requestId: randomUUID(),
              from: "2024-09-10",
              to: "2026-10-04",
              exportUrl: "",
              csv: reportType === "orders_sales" ? ordersCsv : revenueCsv,
              reportType,
              sourcePrefix: "historical-local",
            },
            { trustedLocalHistoricalImport: true }
          );
          receipts.push({
            reportType,
            replay,
            batchId: receipt.batchId,
            inserted: receipt.inserted,
            updated: receipt.updated,
            unchanged: receipt.unchanged,
            skipped: receipt.skipped,
            totalRows: receipt.totalRows,
            digest: receipt.digest,
            completedAt: receipt.completedAt,
            uniqueOrderCount: receipt.uniqueOrderCount,
          });
          if (
            replay &&
            (receipt.inserted ||
              receipt.updated ||
              receipt.unchanged !== receipt.totalRows)
          )
            throw new Error("Historical replay did not prove idempotency");
        }
      }
      const ids = parseCsv(ordersCsv, "orders_sales").map(
        (row: Record<string, string>) => row["Order ID"]
      );
      const [accounted] = await connection.query<mysql.RowDataPacket[]>(
        `SELECT cleancloudOrderId, sourceReportType, totalCents, paid, paymentDateUtc, paidDateUtc FROM cleancloud_paid_orders WHERE tenantId = ? AND cleancloudOrderId IN (${ids.map(() => "?").join(",")})`,
        [tenantId, ...ids]
      );
      const sourceOrders = accounted.filter(
          row => row.sourceReportType === "orders_sales"
        ),
        sourceRevenue = accounted.filter(
          row => row.sourceReportType === "orders_revenue"
        );
      const revenueIds = new Set(
        sourceRevenue.map(row => row.cleancloudOrderId)
      );
      const refund = sourceOrders.find(row => row.cleancloudOrderId === "141");
      const productionControls = {
        ordersAccounted: sourceOrders.length,
        revenueAccounted: sourceRevenue.length,
        missingRevenueIds: sourceRevenue.filter(
          row =>
            !sourceOrders.some(
              order => order.cleancloudOrderId === row.cleancloudOrderId
            )
        ).length,
        revenueCents: sourceRevenue.reduce(
          (sum, row) => sum + Number(row.totalCents),
          0
        ),
        matchingOrdersNetCents: sourceOrders
          .filter(row => revenueIds.has(row.cleancloudOrderId))
          .reduce((sum, row) => sum + Number(row.totalCents), 0),
        ordersOnly: sourceOrders.length - revenueIds.size,
        refundAccounted: Boolean(
          refund?.paid && Number(refund.totalCents) === -1000
        ),
      };
      if (
        productionControls.ordersAccounted !== 533 ||
        productionControls.revenueAccounted !== 492 ||
        productionControls.missingRevenueIds ||
        productionControls.revenueCents !== 2724697 ||
        productionControls.matchingOrdersNetCents !== 2724697 ||
        !productionControls.refundAccounted
      )
        throw new Error("Production source controls failed");
      const ledger = await loadPaidOrderLedger({
        tenantId,
        startUtc: new Date("2020-01-01"),
        endExclusiveUtc: new Date("2026-10-05T07:00:00Z"),
        timeZone: "America/Los_Angeles",
      });
      const canonical = reconcileLedgerSpan(ledger, {
        start: "2020-01-01",
        end: "2026-10-04",
      });
      console.log(
        JSON.stringify(
          {
            productionReceipts: receipts,
            productionControls,
            canonicalBook: {
              recordedCents: canonical.exactIncludedCents,
              datedEvents: canonical.includedEvents.length,
              undatedAdjustments: canonical.undatedAdjustments,
              provenDuplicates: canonical.definiteDuplicateExclusions.count,
              unresolvedPairs: canonical.suspectedWithheld.count,
              withheldCents: canonical.suspectedWithheld.cents,
              provenDistinctPairs:
                ledger.reconciliationEvidence?.decisions.filter(
                  row => row.decision === "distinct_sales"
                ).length ?? null,
              serviceLines: lineageBreakdown(canonical.includedEvents)
                .byServiceLine,
              readerStatus: ledger.completeness,
            },
          },
          null,
          2
        )
      );
    }
  }
} catch (error) {
  console.error(
    JSON.stringify({
      error:
        "Historical backfill failed; inspect authorized private diagnostics",
      code: (error as { code?: string }).code ?? "BACKFILL_FAILED",
    })
  );
  process.exitCode = 1;
} finally {
  await connection.end();
}
// db.ts owns a process-wide pool; this one-shot command must close it on exit.
process.exit(process.exitCode ? 1 : 0);
