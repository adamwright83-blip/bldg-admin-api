/**
 * Claire progression backfill — one operator, idempotent, NOT auto-run. DRY-RUN BY DEFAULT.
 *
 *   railway run pnpm tsx scripts/claire-progression-backfill.ts --tenant default --operator adam-admin
 *   railway run pnpm tsx scripts/claire-progression-backfill.ts --tenant default --operator adam-admin --alias driver-primary
 *   railway run pnpm tsx scripts/claire-progression-backfill.ts --tenant default --operator adam-admin --apply [--json]
 *
 * Re-derives evidence from the authoritative sources (Day 1 Ten Doors outcomes, commercial visit outcomes,
 * completed follow-ups, canonical order truth) and credits what the live feeds missed. The dry-run only
 * reads: it projects band, rung and entitlement mints by replaying the real refresh in memory.
 * --apply writes through the same governed path as the live feeds; a second --apply creates nothing.
 * --alias folds another login id's Day 1 missions / follow-ups / visits into this operator. That is an
 * explicit admin decision about identity; the report lists unclaimed Day 1 driver ids to choose from.
 */
import {
  applyProgressionBackfill,
  formatBackfillReport,
  planProgressionBackfill,
  type BackfillDeps,
} from "../server/claire/progression/backfill";
import { getProgressionStore } from "../server/claire/progression/drizzleStore";
import { loadDisclosureSafetyOk, loadProgressionBackfillSources } from "../server/claire/progression/evidenceSources";
import { getDb } from "../server/db";

function arg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const tenantId = arg(args, "--tenant");
  const operatorUserId = arg(args, "--operator");
  if (!tenantId || !operatorUserId) {
    throw new Error("usage: --tenant <id> --operator <openId> [--alias <openId>]... [--apply] [--json]");
  }
  const aliases = args.flatMap((value, index) => (value === "--alias" && args[index + 1] ? [args[index + 1]] : []));
  const apply = args.includes("--apply");
  if (!(await getDb())) throw new Error("Database not available (run via `railway run`)");

  const store = getProgressionStore();
  const scope = { tenantId, operatorUserId };
  const deps: BackfillDeps = {
    store,
    loadSources: target => loadProgressionBackfillSources(target, { aliases, store }),
    loadDisclosureSafetyOk,
  };
  if (!apply) {
    const plan = await planProgressionBackfill(scope, deps);
    console.log(args.includes("--json") ? JSON.stringify(plan, null, 2) : formatBackfillReport(plan, "dry-run"));
    console.log("\nDry run: nothing was written. Re-run with --apply to credit the rows marked WOULD MINT.");
    return;
  }
  const result = await applyProgressionBackfill(scope, deps);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatBackfillReport(result.plan, "applied"));
  console.log(`\nApplied: ${result.created} evidence rows created; grant now band ${result.grant.rapportBand}, rung ${result.grant.personalRung}; ${result.mintedEntitlementIds.length} entitlements minted.`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
