/**
 * Backfill orders.buildingSlug from normalized address via matchBuilding().
 *
 * Usage:
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-order-buildings.ts
 *   npx tsx scripts/backfill-order-buildings.ts
 *
 * Batched keyset pagination (id ascending); updates one row at a time (no table lock).
 */
import "dotenv/config";
import { matchBuilding } from "../shared/buildings";
import { normalizeOrderAddress } from "../server/orderLocation";
import {
  countOrdersMissingBuildingSlug,
  listOrdersMissingBuildingSlugBatch,
  updateOrderBuildingSlug,
} from "../server/db";

const BATCH = 100;

async function main() {
  const before = await countOrdersMissingBuildingSlug();
  console.log("[backfill-order-buildings] Orders missing buildingSlug (before):", before);

  let updated = 0;
  let unresolved = 0;
  const samples: Record<string, unknown>[] = [];
  let cursor = 0;

  for (;;) {
    const batch = await listOrdersMissingBuildingSlugBatch(cursor, BATCH);
    if (batch.length === 0) break;

    for (const row of batch) {
      cursor = row.id;
      const raw = row.address != null ? String(row.address).trim() : "";
      if (!raw) {
        unresolved++;
        if (samples.length < 10) {
          samples.push({
            id: row.id,
            reason: "empty_address",
            address: row.address,
            buildingSlug: row.buildingSlug,
          });
        }
        continue;
      }

      const norm = normalizeOrderAddress(raw);
      const hit = matchBuilding(norm);
      if (!hit) {
        unresolved++;
        if (samples.length < 10) {
          samples.push({
            id: row.id,
            reason: "no_keyword_match",
            addressPreview: norm.slice(0, 160),
          });
        }
        continue;
      }

      await updateOrderBuildingSlug(row.id, hit.slug);
      updated++;
    }
  }

  const afterMissing = await countOrdersMissingBuildingSlug();
  console.log("[backfill-order-buildings] Updated:", updated);
  console.log("[backfill-order-buildings] Unresolved (no match / no address) this run:", unresolved);
  console.log("[backfill-order-buildings] Orders still missing buildingSlug (after):", afterMissing);
  console.log("[backfill-order-buildings] Sample unresolved (max 10):");
  console.log(JSON.stringify(samples, null, 2));
}

main().catch((err) => {
  console.error("[backfill-order-buildings] Failed:", err);
  process.exit(1);
});
