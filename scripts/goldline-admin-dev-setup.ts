/**
 * Provision a disposable LOCAL database so Goldline Admin can actually be
 * opened and played during development.
 *
 * Usage:
 *   GOLDLINE_ADMIN_DEV_SETUP=true DATABASE_URL=mysql://root:root@127.0.0.1:3306/<db> \
 *     pnpm goldline:admin:dev-setup
 *
 * WHY THIS EXISTS — AND WHY IT IS NOT A MIGRATION
 *
 * Admin reads two tables this repository does not own:
 *
 *   bldg_users         residents of app.bldg.chat
 *   service_requests   coordinated requests raised in that resident app
 *
 * Their lifecycle belongs upstream, and the ownership trace is unambiguous:
 *
 *   - `scripts/migrate.mjs` is the production bootstrap
 *     (`pnpm start` = migrate && node dist/index.js) and never mentions
 *     either table;
 *   - no migration in `drizzle/*.sql` creates either — 0015 creates
 *     `vendor_peer_service_requests`, which is a different table;
 *   - `service_requests` entered the schema in "Add Requests tab:
 *     coordinated requests from resident app";
 *   - `bldg_users` arrived with the initial baseline;
 *   - `scripts/check-bldg-users-columns.mjs` exists to INSPECT the real
 *     upstream column shape, which is only a sensible thing to write about a
 *     table somebody else creates.
 *
 * Production therefore expects them to already exist, provisioned elsewhere.
 * Adding them to the production migration runner would make this service claim
 * ownership of another app's data, and a future upstream schema change would
 * then fight our CREATE TABLE. So this script creates local stand-ins for
 * development only, and the production path is left alone.
 *
 * Without them, `admin.countNewCoordinatedRequests` and
 * `canonicalBuilding.world` return 500 and Lantern City renders blank — which
 * is exactly the wall that blocked authenticated browser proof.
 *
 * SAFETY
 *
 * Refuses to run without an explicit opt-in flag, and refuses any database
 * that is not on localhost — the same guard `goldline-living-world-proof-seed`
 * uses. This is fixture infrastructure and must never be pointed at real data.
 * It contains no secrets: credentials come from the environment.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../server/db";

const ENABLED = process.env.GOLDLINE_ADMIN_DEV_SETUP === "true";

function assertDisposableDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is required");
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error(
      `Refusing to touch a non-local database. This is dev/test fixture ` +
        `infrastructure only. Got: ${url.replace(/:[^:@]*@/, ":***@")}`
    );
  }
}

/**
 * Local stand-ins for the upstream resident-app tables.
 *
 * Columns mirror `drizzle/schema.ts` exactly rather than only the subset
 * today's queries read, so a consumer that later selects another column does
 * not fail confusingly against a simplified local shape.
 *
 * IF NOT EXISTS throughout: this must be safe to run repeatedly, and must
 * never clobber a local database that already carries a real upstream copy.
 */
const UPSTREAM_COMPATIBLE_TABLES: ReadonlyArray<{ name: string; ddl: string }> = [
  {
    name: "bldg_users",
    ddl: `CREATE TABLE IF NOT EXISTS \`bldg_users\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`firstName\` VARCHAR(100),
      \`lastName\` VARCHAR(100),
      \`phoneE164\` VARCHAR(30),
      \`phone\` VARCHAR(30),
      \`buildingSlug\` VARCHAR(100),
      \`unit\` VARCHAR(100)
    )`,
  },
  {
    name: "service_requests",
    ddl: `CREATE TABLE IF NOT EXISTS \`service_requests\` (
      \`id\` INT AUTO_INCREMENT PRIMARY KEY,
      \`bldgUserId\` INT,
      \`serviceType\` VARCHAR(64) NOT NULL,
      \`status\` VARCHAR(64) NOT NULL DEFAULT 'new',
      \`requestSummary\` TEXT,
      \`requestJson\` JSON,
      \`scheduledDate\` VARCHAR(20),
      \`scheduledWindow\` VARCHAR(100),
      \`scheduledStartUtc\` TIMESTAMP NULL,
      \`scheduledEndUtc\` TIMESTAMP NULL,
      \`scheduledStartLocal\` VARCHAR(50),
      \`scheduledEndLocal\` VARCHAR(50),
      \`timezone\` VARCHAR(64),
      \`upgradeCode\` VARCHAR(64),
      \`upgradePriceCents\` INT,
      \`upgradeLabel\` VARCHAR(255),
      \`paymentAdjustmentDueCents\` INT,
      \`createdAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updatedAt\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      \`receiptUrl\` TEXT,
      \`orderId\` INT
    )`,
  },
];

async function main() {
  if (!ENABLED) {
    console.error(
      "[goldline-admin-dev-setup] GOLDLINE_ADMIN_DEV_SETUP is not true. Refusing to run."
    );
    process.exit(1);
  }
  assertDisposableDatabase();

  const db = await getDb();
  if (!db) throw new Error("No database connection");

  for (const table of UPSTREAM_COMPATIBLE_TABLES) {
    await db.execute(sql.raw(table.ddl));
    console.log(`[goldline-admin-dev-setup] ensured ${table.name}`);
  }

  /*
    A couple of residents so building penetration has something to count.
    Keyed by buildingSlug because that is how canonicalBuilding groups them.
    Deleted first so re-running cannot inflate the counts.
  */
  await db.execute(
    sql.raw(`DELETE FROM \`bldg_users\` WHERE \`phoneE164\` LIKE '+1310555%'`)
  );
  await db.execute(
    sql.raw(`INSERT INTO \`bldg_users\`
      (\`firstName\`,\`lastName\`,\`phoneE164\`,\`buildingSlug\`,\`unit\`) VALUES
      ('Dev','Resident','+13105550100','opusla','1201'),
      ('Dev','Resident','+13105550101','opusla','1408'),
      ('Dev','Resident','+13105550102','century-park-east','905')`)
  );
  console.log("[goldline-admin-dev-setup] seeded bldg_users fixtures");

  console.log(
    "\n[goldline-admin-dev-setup] Ready.\n" +
      "  Next: pnpm tsx scripts/goldline-living-world-proof-seed.ts   (world fixtures)\n" +
      "  Then: POST /api/auth/login {password: $ADMIN_PASSWORD|$APP_SHARED_API_SECRET, role:'admin'}\n"
  );
  process.exit(0);
}

main().catch(error => {
  console.error("[goldline-admin-dev-setup] failed:", error);
  process.exit(1);
});
