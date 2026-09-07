#!/usr/bin/env tsx
/**
 * Idempotent backfill for Goldline customer historical order-date evidence.
 *
 * Reads goldline_customer_order_import.xlsx, validates 82 customers / 482 dates,
 * inserts cadence-evidence order rows, syncs geographic truth, and geocodes.
 *
 * Usage:
 *   tsx scripts/import-goldline-customer-order-history.ts [--dry-run] [path-to-xlsx]
 */

import { readFileSync } from "node:fs";
import {
  importCustomerOrderHistory,
  parseCustomerOrderWorkbookBuffer,
} from "../server/goldline/customerOrderHistoryImport";

const TENANT = process.env.GOLDLINE_TENANT_ID ?? "default";
const dryRun = process.argv.includes("--dry-run");
const fileArg = process.argv.find(
  arg => !arg.startsWith("-") && arg.endsWith(".xlsx")
);
const filePath =
  fileArg ??
  process.env.GOLDLINE_CUSTOMER_ORDER_IMPORT ??
  "/Users/adamwrightpfi/Downloads/goldline_customer_order_import_1.xlsx";

async function main() {
  const buffer = readFileSync(filePath);
  const rows = parseCustomerOrderWorkbookBuffer(buffer);
  const result = await importCustomerOrderHistory({
    tenantId: TENANT,
    rows,
    dryRun,
  });
  console.log(
    JSON.stringify(
      {
        filePath,
        dryRun: result.dryRun,
        validation: result.validation,
        customersProcessed: result.customersProcessed,
        ordersInserted: result.ordersInserted,
        ordersSkippedExisting: result.ordersSkippedExisting,
        discrepancyCount: result.discrepancies.length,
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
