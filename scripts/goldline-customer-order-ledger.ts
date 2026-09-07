#!/usr/bin/env tsx
/**
 * Local QA ledger for the customer-order workbook import. NOT committed.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import {
  importCustomerOrderHistory,
  parseCustomerOrderWorkbookBuffer,
} from "../server/goldline/customerOrderHistoryImport";

const TENANT = process.env.GOLDLINE_TENANT_ID ?? "default";
const filePath =
  process.argv[2] ??
  process.env.GOLDLINE_CUSTOMER_ORDER_IMPORT ??
  "/Users/adamwrightpfi/Downloads/goldline_customer_order_import_1.xlsx";
const outPath = join(
  dirname(filePath),
  "goldline-customer-order-ledger.local.json"
);

async function main() {
  const rows = parseCustomerOrderWorkbookBuffer(readFileSync(filePath));
  const result = await importCustomerOrderHistory({
    tenantId: TENANT,
    rows,
    dryRun: process.argv.includes("--dry-run"),
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote ledger: ${outPath}`);
  console.log(
    `customers=${result.customersProcessed} dates=${result.totalSourceOrderDates} inserted=${result.ordersInserted} skipped=${result.ordersSkippedExisting}`
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
