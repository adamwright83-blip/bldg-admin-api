import "dotenv/config";
import {
  createProcurementPool,
  getProcurementMigrationStatus,
  loadProcurementMigrations,
  runProcurementMigrations,
} from "../server/procurement/migrations";

const command = process.argv[2] ?? "status";
if (command !== "status" && command !== "migrate") {
  console.error("Usage: tsx scripts/procurement-migrate.ts <status|migrate>");
  process.exit(2);
}

const migrations = await loadProcurementMigrations();
const pool = createProcurementPool();
try {
  if (command === "status") {
    const status = await getProcurementMigrationStatus(pool, migrations);
    console.table(
      status.map(row => ({
        migration: row.key,
        state: row.state,
        checksum: row.checksum.slice(0, 12),
        databaseChecksum: row.databaseChecksum?.slice(0, 12) ?? "-",
      })),
    );
    if (status.some(row => row.state === "failed" || row.state === "checksum_mismatch")) {
      process.exitCode = 1;
    }
  } else {
    const result = await runProcurementMigrations(pool, migrations);
    console.table(result);
    const status = await getProcurementMigrationStatus(pool, migrations);
    if (status.some(row => row.state !== "applied")) {
      throw new Error("Procurement migration verification failed: not every migration is applied");
    }
    console.log(`Verified ${status.length} procurement migrations.`);
  }
} finally {
  await pool.end();
}
