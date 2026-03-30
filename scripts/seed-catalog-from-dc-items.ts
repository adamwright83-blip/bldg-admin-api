/**
 * Idempotent seed: inserts catalog_items from shared/pricing DC_ITEMS for one or more tenants.
 * Skips rows where (tenantId, slug) already exists — safe to run multiple times.
 * New items added later to DC_ITEMS will be inserted on the next run.
 *
 * Usage:
 *   pnpm seed:catalog
 *   pnpm exec tsx scripts/seed-catalog-from-dc-items.ts --tenant=laundry_farm
 *   pnpm exec tsx scripts/seed-catalog-from-dc-items.ts --tenant=all
 *
 * Requires: DATABASE_URL, migration 0006_catalog_items applied.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../server/db";
import { catalogItems } from "../drizzle/schema";
import { DC_ITEMS } from "../shared/pricing";

const TENANTS_DEFAULT = ["default"] as const;
const TENANTS_ALL = ["default", "laundry_farm"] as const;

function parseTenantArg(): readonly string[] {
  const arg = process.argv.find((a) => a.startsWith("--tenant="));
  if (!arg) return TENANTS_DEFAULT;
  const v = arg.split("=")[1]?.trim().toLowerCase();
  if (v === "all") return TENANTS_ALL;
  if (v === "default" || v === "laundry_farm") return [v];
  console.error(`Unknown --tenant=${v}. Use default | laundry_farm | all`);
  process.exit(1);
}

async function main() {
  const tenants = parseTenantArg();
  const db = await getDb();
  if (!db) {
    console.error("DATABASE_URL not set or DB unavailable.");
    process.exit(1);
  }

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const tenantId of tenants) {
    const existing = await db
      .select({ slug: catalogItems.slug })
      .from(catalogItems)
      .where(eq(catalogItems.tenantId, tenantId));
    const have = new Set(existing.map((r) => r.slug));

    let ins = 0;
    let skip = 0;
    for (let i = 0; i < DC_ITEMS.length; i++) {
      const item = DC_ITEMS[i];
      const slug = item.id;
      if (have.has(slug)) {
        skip += 1;
        continue;
      }

      await db.insert(catalogItems).values({
        tenantId,
        slug,
        name: item.label,
        category: item.category,
        standardPriceCents: item.priceCents,
        expressPriceCents: null,
        costCents: 0,
        isActive: true,
        isOnline: true,
        archived: false,
        sortOrder: i,
        iconUrl: null,
      });
      have.add(slug);
      ins += 1;
    }
    totalInserted += ins;
    totalSkipped += skip;
    console.log(`[seed-catalog] tenant=${tenantId} inserted=${ins} skipped_existing=${skip}`);
  }

  console.log(`[seed-catalog] done. total_inserted=${totalInserted} total_skipped=${totalSkipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
