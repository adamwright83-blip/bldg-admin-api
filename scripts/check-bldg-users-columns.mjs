/**
 * Print actual column names of bldg_users from the DB.
 * Run: node scripts/check-bldg-users-columns.mjs (with DATABASE_URL set)
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.execute(
      `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bldg_users' 
       ORDER BY ORDINAL_POSITION`
    );
    console.log("bldg_users columns in DB:");
    rows.forEach((r) => console.log("  ", r.COLUMN_NAME, "(", r.DATA_TYPE, ")"));
    if (rows.length === 0) {
      console.log("  (no columns — table may not exist)");
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
