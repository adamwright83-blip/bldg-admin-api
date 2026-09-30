/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
if (process.env.DATABASE_URL?.includes("mysql.railway.internal")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace(
    "mysql.railway.internal:3306",
    "shortline.proxy.rlwy.net:36032"
  );
}
import { getDb } from "../server/db";
import { cleancloudPaidOrders } from "../drizzle/schema";
import { browserSyncBindings, browserSyncAttempts, browserSyncReceipts } from "../server/cleancloudBrowserSync/schema";
import { loadTenantOperatingPulse } from "../server/cleancloudBrowserSync/operatingPulse";
import { loadLatestCleanCloudSales } from "../server/cleancloudBrowserSync/latestSales";
import { runCleanCloudDirectSync } from "../server/cleancloudBrowserSync/cleancloudDirectSync";
import { desc, eq, and } from "drizzle-orm";

async function main() {
  console.log("=== JAWBREAKER / GUMBALL VERIFICATION WITNESS ===");
  const db = await getDb();
  if (!db) {
    throw new Error("DB connection failed");
  }

  // 1. Initial State
  const [binding] = await db
    .select()
    .from(browserSyncBindings)
    .where(eq(browserSyncBindings.tenantId, "default"));
  console.log("Current Binding:", {
    tenantId: binding?.tenantId,
    storeId: binding?.storeId,
    storeLabel: binding?.storeLabel,
    lastSuccessAt: binding?.lastSuccessAt?.toISOString(),
  });

  const priorOrders = await db
    .select()
    .from(cleancloudPaidOrders)
    .where(eq(cleancloudPaidOrders.tenantId, "default"))
    .orderBy(desc(cleancloudPaidOrders.cleancloudOrderId))
    .limit(5);

  console.log(
    "Top 5 CleanCloud Orders in DB BEFORE sync:",
    priorOrders.map(o => ({
      orderId: o.cleancloudOrderId,
      totalCents: o.totalCents,
      customerName: o.customerName,
      sourceReportType: o.sourceReportType,
      paidDateUtc: o.paidDateUtc?.toISOString(),
    }))
  );

  const initialPulse = await loadTenantOperatingPulse("default");
  console.log("Operating Pulse BEFORE sync:", {
    functioning: initialPulse.functioning,
    jawbreaker: initialPulse.jawbreaker,
    book: initialPulse.book,
    lastSuccessAt: initialPulse.lastSuccessAt,
    expectedThrough: initialPulse.expectedThrough,
    coveredThrough: initialPulse.coveredThrough,
    summary: initialPulse.summary,
  });

  // 2. Execute Direct Server-side Sync
  console.log("\n>>> Executing runCleanCloudDirectSync for 2026-09-18 through 2026-09-29...");
  const syncResult = await runCleanCloudDirectSync({
    tenantId: "default",
    actorId: "system:jawbreaker-witness",
    from: "2026-09-18",
    to: "2026-09-29",
  });

  console.log("\nDirect Sync Execution Finished:");
  console.log("Success:", syncResult.success);
  console.log("Store:", syncResult.storeLabel, "(ID:", syncResult.storeId, ")");
  console.log("Range:", syncResult.range);
  console.log("Sales Receipt:", {
    batchId: syncResult.salesReceipt?.batchId,
    totalRows: syncResult.salesReceipt?.totalRows,
    inserted: syncResult.salesReceipt?.inserted,
    updated: syncResult.salesReceipt?.updated,
    unchanged: syncResult.salesReceipt?.unchanged,
    customerTruth: syncResult.salesReceipt?.customerTruth,
    map: syncResult.salesReceipt?.map,
    operatorStatusLine: syncResult.salesReceipt?.operatorStatusLine,
  });
  console.log("Revenue Receipt:", {
    batchId: syncResult.revenueReceipt?.batchId,
    totalRows: syncResult.revenueReceipt?.totalRows,
    inserted: syncResult.revenueReceipt?.inserted,
    updated: syncResult.revenueReceipt?.updated,
    unchanged: syncResult.revenueReceipt?.unchanged,
    customerTruth: syncResult.revenueReceipt?.customerTruth,
    map: syncResult.revenueReceipt?.map,
    operatorStatusLine: syncResult.revenueReceipt?.operatorStatusLine,
  });

  // 3. Post-Sync State Verification
  const newOrders = await db
    .select()
    .from(cleancloudPaidOrders)
    .where(eq(cleancloudPaidOrders.tenantId, "default"))
    .orderBy(desc(cleancloudPaidOrders.cleancloudOrderId))
    .limit(10);

  console.log(
    "\nTop 10 CleanCloud Orders in DB AFTER sync:",
    newOrders.map(o => ({
      orderId: o.cleancloudOrderId,
      totalCents: o.totalCents,
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      sourceReportType: o.sourceReportType,
      paidDateUtc: o.paidDateUtc?.toISOString(),
      buildingSlug: o.buildingSlug,
    }))
  );

  // 4. Verify Latest Sales Read Model
  const { sales: latestSales } = await loadLatestCleanCloudSales({
    tenantId: "default",
    limit: 5,
  });
  console.log(
    "\nLatest CleanCloud Sales (Read Model):",
    latestSales.map(s => ({
      orderId: s.orderId,
      customerName: s.customerName,
      amountCents: s.amountCents,
      paymentAt: s.paymentAt,
      paidAt: s.paidAt,
      ingestedAt: s.ingestedAt,
    }))
  );

  // 5. Verify Operating Pulse
  const finalPulse = await loadTenantOperatingPulse("default");
  console.log("\nOperating Pulse AFTER sync:", {
    functioning: finalPulse.functioning,
    jawbreaker: finalPulse.jawbreaker,
    book: finalPulse.book,
    lastSuccessAt: finalPulse.lastSuccessAt,
    expectedThrough: finalPulse.expectedThrough,
    coveredThrough: finalPulse.coveredThrough,
    lastImportRows: finalPulse.lastImportRows,
    summary: finalPulse.summary,
  });

  // 6. Verify Canonical Business Source Coverage (Revenue Truth)
  const { loadBusinessSourceCoverage } = await import("../server/analytics/sourceCoverage");
  const coverage = await loadBusinessSourceCoverage({ tenantId: "default" });
  const ccCoverage = coverage.sources.find(s => s.sourceId === "cleancloud");
  console.log("\nAuthoritative CleanCloud Business Source Coverage (Revenue Truth):", {
    status: ccCoverage?.status,
    expectedThrough: ccCoverage?.expectedThrough,
    coveredThrough: ccCoverage?.coveredThrough,
    paymentEventsProven: ccCoverage?.provenance?.paymentEventsProven,
    combinedBookStatus: coverage.bookStatus,
  });

  // 7. Verify Sync Attempts Log
  const recentAttempts = await db
    .select()
    .from(browserSyncAttempts)
    .where(eq(browserSyncAttempts.tenantId, "default"))
    .orderBy(desc(browserSyncAttempts.createdAt))
    .limit(3);
  console.log(
    "\nRecent Browser Sync Attempts Recorded in DB:",
    recentAttempts.map(a => ({
      outcome: a.outcome,
      rangeFrom: a.rangeFrom,
      rangeTo: a.rangeTo,
      rowCount: a.rowCount,
      createdAt: a.createdAt.toISOString(),
      message: a.message,
    }))
  );

  console.log("\n=== VERIFICATION COMPLETE ===");
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL ERROR in witness script:", err);
  process.exit(1);
});
