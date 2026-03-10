/**
 * One-off: print actual column names of service_requests from the DB.
 * Run: node scripts/check-service-requests-columns.mjs (with DATABASE_URL in env or .env)
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Set it in .env or the environment.");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'service_requests' 
       ORDER BY ORDINAL_POSITION`
    );
    console.log("service_requests columns in DB:");
    rows.forEach((r) => console.log("  ", r.COLUMN_NAME, "(", r.DATA_TYPE, ")"));
    if (rows.length === 0) {
      console.log("  (no columns found — table may not exist or name differs)");
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
