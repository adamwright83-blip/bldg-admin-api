/**
 * CLI: print customer identity JSON (same shape as GET /api/export/customer-identities).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/export-customer-identities.ts
 *   npx tsx scripts/export-customer-identities.ts --days=90
 *   npx tsx scripts/export-customer-identities.ts --days=all
 *
 * Loads .env when present (dotenv).
 */
import "dotenv/config";
import { listLatestCustomerIdentityForExport } from "../server/db";

function parseDays(argv: string[]): { since?: Date; daysRequested?: number; mode: "all" | "since" } {
  const arg = argv.find((a) => a.startsWith("--days="));
  if (!arg) {
    return { mode: "all" };
  }
  const v = arg.slice("--days=".length).trim();
  if (!v || v.toLowerCase() === "all") {
    return { mode: "all" };
  }
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 1 || n > 3650) {
    console.error("Invalid --days= value (use 1..3650 or all)");
    process.exit(1);
  }
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - n);
  return { since, daysRequested: n, mode: "since" };
}

async function main() {
  const { since, daysRequested, mode } = parseDays(process.argv.slice(2));
  const customers = await listLatestCustomerIdentityForExport(
    since ? { since } : undefined
  );
  const payload = {
    generatedAt: new Date().toISOString(),
    filter:
      mode === "since" && since != null && daysRequested != null
        ? {
            mode: "since" as const,
            days: daysRequested,
            since: since.toISOString(),
            note: "Orders with createdAt >= since (UTC)",
          }
        : { mode: "all" as const },
    count: customers.length,
    customers,
  };
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
