/** Isolated browser proof server. Never reads an inherited DATABASE_URL and
 * never modifies the source fixture database. Run with --prepare or --serve. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const database = "goldline_recomposition_20260904";
const password = execFileSync("docker", ["exec", "goldline-mysql", "printenv", "MYSQL_ROOT_PASSWORD"], { encoding: "utf8" }).trim();
process.env.DATABASE_URL = `mysql://root:${encodeURIComponent(password)}@127.0.0.1:3306/${database}`;
process.env.NODE_ENV = "development";
process.env.PORT = "4188";
process.env.JWT_SECRET = "goldline-proof-jwt-secret-000000000000000000";
process.env.APP_SHARED_API_SECRET = "goldline-proof-app-secret-000000000000000000";
process.env.ADMIN_PASSWORD = "goldline-proof-admin-pass";
process.env.STRIPE_SECRET_KEY = "sk_test_goldline_local_placeholder_not_used";
process.env.DRIVER_PASSWORD = "pixel-driver-pass";
process.env.DRIVER_OPEN_ID = "goldline-proof-driver";
process.env.GOLDLINE_PROOF_MODE = "1";
process.env.DAYFORGE_RELEASE_DB = "1";
process.env.GOLDLINE_ADMIN_DEV_SETUP = "true";
if (process.argv.includes("--prepare")) {
  const connection = await mysql.createConnection({ host: "127.0.0.1", port: 3306, user: "root", password, multipleStatements: true });
  // Fail if already present, rather than reset an unknown database.
  await connection.query(`CREATE DATABASE ${database}`);
  const [rows] = await connection.query<mysql.RowDataPacket[]>("SHOW FULL TABLES FROM goldline_daylight WHERE Table_type='BASE TABLE'");
  for (const row of rows) {
    const table = String(Object.values(row)[0]);
    if (!/^[a-zA-Z0-9_]+$/.test(table)) throw new Error("Unexpected table name");
    await connection.query(`CREATE TABLE ${database}.\`${table}\` LIKE goldline_daylight.\`${table}\``);
  }
  await connection.query(`USE ${database}`);
  for (const path of ["../server/cleancloudBrowserSync/schema.sql", "../server/towerWars/impactSchema.sql"])
    await connection.query(readFileSync(new URL(path, import.meta.url), "utf8"));
  await connection.end();
  await import("./goldline-admin-dev-setup");
} else if (process.argv.includes("--serve")) {
  await import("../server/_core/index");
} else if (process.argv.includes("--seed")) {
  const { resetGoldlineProofWorld } = await import("./goldline-living-world-proof-seed");
  await resetGoldlineProofWorld();
  process.exit(0);
} else if (process.argv.includes("--seed-impacts")) {
  const { importCleanCloudPaidOrders } = await import("../server/cleancloudPaidOrders");
  const { formatInTimeZone } = await import("date-fns-tz");
  const today = formatInTimeZone(new Date(), "America/Los_Angeles", "yyyy-MM-dd");
  await importCleanCloudPaidOrders({ tenantId: "default", sourceReportType: "orders_sales", sourceFileName: "local-fifteen-impact-proof.csv",
    csvText: `Order ID,Customer,Address,Paid,Payment Date,Total\nwave-impact-proof,Local fixture,2170 Century Park East,Yes,${today},750.00` });
  process.exit(0);
} else throw new Error("Use --prepare or --serve");
