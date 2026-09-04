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
process.env.VITE_GOLDLINE_TEST_HARNESS = "1";
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
} else if (process.argv.includes("--seed-recurrence")) {
  const { listPresentedTerritories } = await import("../server/goldlineWorld/territoryService");
  const { appendGoldlineWorldEvent } = await import("../server/goldlineWorld/worldEventStore");
  const [territory] = await listPresentedTerritories({ tenantId: "default" });
  if (!territory?.state.cleared) throw new Error("Win the local Guardian first");
  await appendGoldlineWorldEvent({ tenantId: "default", physicalEntityId: territory.definition.members[0]!.physicalEntityId,
    eventType: "customer_became_dormant", classification: "outcome", actorType: "system", actorId: null,
    occurredAt: new Date().toISOString(), observedAt: null, sourceType: "local_fixture", sourceId: "wave-recurrence",
    sourceEvidenceReference: "local-proof:dormancy", provenanceClass: "existing_business_record", verificationClass: "VERIFIED", confidence: "high",
    idempotencyKey: "wave-local-recurrence", correlationId: "local-guardian-proof", metadata: { fixture: true } });
  console.log("Local-only dormancy fixture follows saved victory."); process.exit(0);
} else if (process.argv.includes("--seed-chain")) {
  const { importCleanCloudPaidOrders } = await import("../server/cleancloudPaidOrders");
  for (const [id, date, value] of [["wave-prior-season", "2026-08-25", "100.00"], ["wave-live-chain", "2026-09-04", "100.00"]]) {
    await importCleanCloudPaidOrders({ tenantId: "default", sourceReportType: "orders_sales", sourceFileName: "local-chain-proof.csv",
      csvText: `Order ID,Customer,Address,Paid,Payment Date,Total\n${id},Local chain fixture,3545 Wilshire Blvd,Yes,${date},${value}` });
  }
  console.log("Local-only prior-season and new economic chain fixtures imported; background publisher owns delivery.");
  process.exit(0);
} else if (process.argv.includes("--seed-repair")) {
  const { importCleanCloudPaidOrders } = await import("../server/cleancloudPaidOrders");
  await importCleanCloudPaidOrders({ tenantId: "default", sourceReportType: "orders_sales", sourceFileName: "local-repair-proof.csv",
    csvText: "Order ID,Customer,Address,Paid,Payment Date,Total\nwave-impact-proof,Local fixture,2170 Century Park East,Yes,2026-09-01,750.00" });
  const { getDb } = await import("../server/db");
  const { orders, operationsEvents } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = (await getDb())!;
  const [prior] = await db.select().from(orders).where(eq(orders.specialInstructions, "wave-local-repair-proof"));
  const orderId = prior?.id ?? (await db.insert(orders).values({ tenantId: "default", pickupDate: "2026-09-02", pickupTimeWindow: "9am-12pm", firstName: "Local", lastName: "Repair fixture", phone: "3105550199", address: "3545 Wilshire Blvd", status: "collected", paid: false, total: "0", serviceType: "wash_fold", specialInstructions: "wave-local-repair-proof" }).$returningId())[0]!.id;
  await db.insert(operationsEvents).values({ tenantId: "default", businessUnitLabel: "Local proof", source: "system_backfill", sourceEventType: "pickup_completed", eventStatus: "completed", orderId, customerName: "Local repair fixture", serviceType: "wash_fold", buildingSlug: "opusla", buildingResolutionStatus: "resolved", actualEventTimestamp: new Date("2026-09-02T18:00:00Z"), rawJson: { fixture: true, proofOnly: true } }).onDuplicateKeyUpdate({ set: { eventStatus: "completed" } });
  console.log("Local-only post-impact collection fixture ready.");
  process.exit(0);
} else if (process.argv.includes("--seed-guardian-ready")) {
  const { listPresentedTerritories } = await import("../server/goldlineWorld/territoryService");
  const { appendGoldlineWorldEvent } = await import("../server/goldlineWorld/worldEventStore");
  const [territory] = await listPresentedTerritories({ tenantId: "default" });
  if (!territory) throw new Error("No local territory fixture");
  for (const member of territory.definition.members) await appendGoldlineWorldEvent({ tenantId: "default", physicalEntityId: member.physicalEntityId, eventType: "visited", classification: "action", actorType: "operator", actorId: "local-browser-proof", occurredAt: new Date().toISOString(), sourceType: "local_fixture", sourceId: member.physicalEntityId, sourceEvidenceReference: "local-proof:evidence-gate", provenanceClass: "operator_observed", verificationClass: "VERIFIED", confidence: "high", idempotencyKey: `wave-ready:${member.physicalEntityId}`, correlationId: "local-guardian-proof", metadata: { fixture: true } });
  console.log("Local-only Guardian evidence gate ready."); process.exit(0);
} else throw new Error("Use a documented local proof mode");
