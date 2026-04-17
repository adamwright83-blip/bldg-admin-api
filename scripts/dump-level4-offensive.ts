/**
 * Dry-run dump of admin.getLevel4OffensiveState payload (no auth, no router — calls the loader directly).
 * Also prints raw bldg_users.buildingSlug distribution so we can spot slug-mismatch with BUILDINGS config.
 * Run: pnpm tsx scripts/dump-level4-offensive.ts [tenantId]
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getLevel4OffensiveState } from "../server/level4Offensive";
import { getDb } from "../server/db";
import { bldgUsers, orders } from "../drizzle/schema";

async function main() {
  const tenantId = process.argv[2] ?? "default";
  const payload = await getLevel4OffensiveState(tenantId);
  process.stdout.write("=== getLevel4OffensiveState payload ===\n");
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");

  const db = await getDb();
  if (db) {
    process.stdout.write("\n=== diagnostic: distinct bldg_users.buildingSlug values + signup counts ===\n");
    const signupRows = await db
      .select({
        buildingSlug: bldgUsers.buildingSlug,
        signups: sql<number>`COUNT(*)`,
      })
      .from(bldgUsers)
      .groupBy(bldgUsers.buildingSlug);
    process.stdout.write(JSON.stringify(signupRows, null, 2) + "\n");

    process.stdout.write("\n=== diagnostic: paid users per user-home buildingSlug (paid orders linked via bldgUserId) ===\n");
    const paidRows = await db
      .select({
        userBuildingSlug: bldgUsers.buildingSlug,
        paidUsers: sql<number>`COUNT(DISTINCT ${orders.bldgUserId})`,
      })
      .from(orders)
      .innerJoin(bldgUsers, sql`${orders.bldgUserId} = ${bldgUsers.id}`)
      .where(sql`${orders.tenantId} = ${tenantId} AND ${orders.paid} = TRUE`)
      .groupBy(bldgUsers.buildingSlug);
    process.stdout.write(JSON.stringify(paidRows, null, 2) + "\n");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
