import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import type { Connection } from "mysql2/promise";

const NEEDED_PROOF_TABLES = [
  "orders",
  "entity_locations",
  "cleancloud_paid_orders",
  "cleancloud_import_batches",
  "dayforge_saas_memberships",
  "physical_entities",
  "physical_entity_aliases",
  "goldline_world_events",
  "commercial_accounts",
  "commercial_account_locations",
  "commercial_pipeline_records",
];

const FALLBACK_DDL = [
  `CREATE TABLE IF NOT EXISTS dayforge_saas_memberships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    userOpenId VARCHAR(64) NOT NULL,
    role ENUM('owner','admin','operator','field') NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dayforge_saas_membership_user (tenantId, userOpenId)
  )`,
  `CREATE TABLE IF NOT EXISTS cleancloud_import_batches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    source VARCHAR(64) NOT NULL DEFAULT 'cleancloud',
    sourceFileName VARCHAR(255) NOT NULL,
    importedRowCount INT NOT NULL DEFAULT 0,
    skippedRowCount INT NOT NULL DEFAULT 0,
    duplicateRowCount INT NOT NULL DEFAULT 0,
    importStatus ENUM('completed','completed_with_errors','failed') NOT NULL DEFAULT 'completed',
    errorJson JSON,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS cleancloud_paid_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    sourceReportType ENUM('orders_sales','orders_revenue') NOT NULL,
    sourceFileName VARCHAR(255) NOT NULL,
    importBatchId INT NOT NULL,
    cleancloudOrderId VARCHAR(128) NOT NULL,
    cleancloudCustomerId VARCHAR(128),
    customerName VARCHAR(255) NOT NULL,
    customerEmail VARCHAR(320),
    customerPhone VARCHAR(30),
    address TEXT,
    placedAtUtc TIMESTAMP NULL,
    paymentDateUtc TIMESTAMP NULL,
    paidDateUtc TIMESTAMP NULL,
    readyByDateUtc TIMESTAMP NULL,
    collectedAtUtc TIMESTAMP NULL,
    cleanedAtUtc TIMESTAMP NULL,
    orderStatus VARCHAR(100),
    paid TINYINT(1) NOT NULL DEFAULT 0,
    paymentType VARCHAR(100),
    cardPaymentType VARCHAR(100),
    totalCents INT NOT NULL DEFAULT 0,
    subtotalCents INT,
    discountCents INT,
    creditCents INT,
    totalWeightLbs DECIMAL(8,2),
    summaryText TEXT,
    buildingName VARCHAR(255),
    buildingSlug VARCHAR(100),
    tower VARCHAR(100),
    unit VARCHAR(50),
    buildingResolutionStatus ENUM('resolved','unresolved_needs_mapping','not_applicable') NOT NULL,
    rawJson JSON,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_cleancloud_paid_order_report (tenantId, cleancloudOrderId, sourceReportType)
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_accounts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    accountType VARCHAR(96) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_pipeline_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    accountId INT NOT NULL,
    opportunityId INT NOT NULL,
    missionId INT NOT NULL,
    stage ENUM('discovered','qualified','mission_created','game_ready','field_ready','visit_planned','visited','follow_up','proposal_sent','pilot_requested','verbal_yes','won','lost') NOT NULL,
    version INT NOT NULL DEFAULT 1,
    estimatedContractValueCents INT NOT NULL DEFAULT 0,
    invoicedRevenueCents INT NOT NULL DEFAULT 0,
    paidRevenueCents INT NOT NULL DEFAULT 0,
    realizedRevenueCents INT NOT NULL DEFAULT 0,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS commercial_account_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    accountId INT NOT NULL,
    locationKey VARCHAR(64),
    label VARCHAR(128),
    address VARCHAR(512) NOT NULL,
    latitude DECIMAL(10,7),
    longitude DECIMAL(10,7),
    isPrimary TINYINT(1) NOT NULL DEFAULT 0,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_commercial_locations_tenant_account (tenantId, accountId),
    UNIQUE KEY uq_commercial_locations_tenant_account_key (tenantId, accountId, locationKey)
  )`,
];

async function tableExists(connection: Connection, table: string) {
  const [rows] = await connection.query(
    "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
    [table]
  );
  return (rows as Array<{ ok: number }>).length > 0;
}

async function schemaTableExists(
  connection: Connection,
  schema: string,
  table: string
) {
  const [rows] = await connection.query(
    "SELECT 1 AS ok FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1",
    [schema, table]
  );
  return (rows as Array<{ ok: number }>).length > 0;
}

async function resolveCloneSource(connection: Connection) {
  const override = process.env.GUMBALL_PROOF_CLONE_SCHEMA;
  if (override === "") return null;
  const candidates = override
    ? [override]
    : ["goldline_proof", "goldline_daylight"];
  for (const schema of candidates) {
    // Fast Goldline smoke creates an empty goldline_proof database before
    // dayforge-release. That schema exists but has no tables yet — LIKE
    // clone from it is not a usable source.
    if (await schemaTableExists(connection, schema, "orders")) return schema;
  }
  return null;
}

export async function provisionGumballCustomerTruthSchema(
  connection: Connection
) {
  const cloneSource = await resolveCloneSource(connection);
  for (const table of NEEDED_PROOF_TABLES) {
    if (await tableExists(connection, table)) continue;
    if (cloneSource) {
      try {
        await connection.query(
          `CREATE TABLE \`${table}\` LIKE \`${cloneSource}\`.\`${table}\``
        );
        continue;
      } catch {
        // fall through to explicit DDL
      }
    }
  }
  for (const sql of FALLBACK_DDL) {
    await connection.query(sql);
  }
  const gumballSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  for (const statement of gumballSql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map(value => value.trim())
    .filter(Boolean)) {
    await connection.query(statement);
  }
}

export async function grantGumballProofMembership(
  connection: Connection,
  tenantId: string,
  actorId: string
) {
  await connection.query(
    `INSERT INTO dayforge_saas_memberships (tenantId, userOpenId, role, active)
     VALUES (?, ?, 'owner', 1)
     ON DUPLICATE KEY UPDATE active = 1, role = 'owner'`,
    [tenantId, actorId]
  );
}

const CSV_HEADER =
  "Order ID,Placed,Customer,Customer ID,Address,Paid,Payment Date,Total";
const BASE_CSV = `${CSV_HEADER}\n1,08/20/2026,Example,7,2170 Century Park East,Yes,09/02/2026,51.00`;

export type GumballProofCaller = {
  pair: (input: {
    tenantId: string;
    actorId: string;
    storeId: string;
    storeLabel: string;
  }) => Promise<{ id: string }>;
  import: (input: {
    tenantId: string;
    actorId: string;
    storeId: string;
    storeLabel: string;
    bindingId: string;
    requestId: string;
    from: string;
    to: string;
    exportUrl: string;
    csv: string;
  }) => Promise<Record<string, unknown>>;
};

/**
 * Real MySQL proof: browser-sync import → cleancloud_paid_orders → receipt →
 * geographic truth + strategy aggregates. Never talks to production.
 */
export async function proveGumballImportCustomerTruth(input: {
  tenantId: string;
  actorId?: string;
  caller: GumballProofCaller;
  connection: Connection;
}) {
  const tenantId = input.tenantId;
  const actorId = input.actorId ?? "sync-proof";
  const account = {
    tenantId,
    actorId,
    storeId: "123",
    storeLabel: "Example store",
  };
  const binding = await input.caller.pair(account);
  const importInput = {
    ...account,
    bindingId: binding.id,
    requestId: randomUUID(),
    from: "2026-08-15",
    to: "2026-09-03",
    exportUrl:
      "https://cleancloudapp.com/include/data-export-endpoint.php?type=1&d1=15&m1=08&y1=2026&d2=03&m2=09&y2=2026&stores=[123]&group=",
    csv: BASE_CSV,
  };

  const first = await input.caller.import(importInput);
  assert.equal(first.inserted, 1);
  assert.equal(first.importCommitted, true);
  assert.equal(
    first.customerTruth,
    "refreshed",
    `expected customer truth refreshed, got ${String(first.customerTruth)} assimilationError=${String(first.assimilationError ?? first.error ?? "")}`
  );
  assert.ok(
    first.map === "pending" || first.map === "refreshed" || first.map === "failed",
    `map status should be pending/refreshed/failed after a committed import, got ${String(first.map)}`
  );
  assert.match(String(first.operatorStatusLine), /customer truth refreshed/);
  assert.doesNotMatch(String(first.operatorStatusLine), /database import failed/);

  const [paidRows] = await input.connection.query(
    "SELECT cleancloudOrderId, totalCents, paid FROM cleancloud_paid_orders WHERE tenantId = ?",
    [tenantId]
  );
  const paid = paidRows as Array<{
    cleancloudOrderId: string;
    totalCents: number;
    paid: number;
  }>;
  assert.equal(paid.length, 1);
  assert.equal(paid[0]?.cleancloudOrderId, "1");
  assert.equal(Number(paid[0]?.totalCents), 5100);

  const { loadPaidOrderLedger } = await import("../analytics/paidOrderLedger");
  const ledger = await loadPaidOrderLedger({
    tenantId,
    startUtc: new Date("2026-08-01T00:00:00.000Z"),
    endExclusiveUtc: new Date("2026-09-10T00:00:00.000Z"),
    timeZone: "America/Los_Angeles",
  });
  assert.ok(ledger.loadedSources.includes("cleancloud"));
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0]?.eventKey, "cleancloud:1");
  assert.equal(ledger.events[0]?.cents, 5100);

  const { getGeographicTruth } = await import(
    "../geography/geographicTruthService"
  );
  const atlas = await getGeographicTruth({ tenantId });
  assert.equal(atlas.customers.length, 1);
  assert.equal(atlas.customers[0]?.totalOrders, 1);
  assert.equal(atlas.customers[0]?.sources?.includes("cleancloud"), true);
  assert.ok(atlas.customers[0]?.lastOrderAt);
  assert.equal(atlas.customers[0]?.cadence.confidence, "sparse");

  const { loadStrategyCustomerAggregates } = await import(
    "../strategy/snapshotCustomerAggregateLoad"
  );
  const strategy = await loadStrategyCustomerAggregates(tenantId);
  assert.equal(strategy.status, "available");
  if (strategy.status === "available") {
    assert.equal(strategy.rows.length, 1);
    assert.equal(strategy.rows[0]?.paidOrderCount, 1);
    assert.equal(strategy.rows[0]?.lifetimeSpend, 0);
    assert.equal(strategy.rows[0]?.sources?.includes("cleancloud"), true);
  }

  const repeat = await input.caller.import({
    ...importInput,
    requestId: randomUUID(),
  });
  assert.equal(repeat.inserted, 0);
  assert.equal(repeat.updated, 0);
  assert.equal(repeat.unchanged, 1);
  const [afterRepeat] = await input.connection.query(
    "SELECT COUNT(*) AS n FROM cleancloud_paid_orders WHERE tenantId = ?",
    [tenantId]
  );
  assert.equal(Number((afterRepeat as Array<{ n: number }>)[0]?.n), 1);

  const identityOnly = await input.caller.import({
    ...importInput,
    requestId: randomUUID(),
    csv: BASE_CSV.replace(",7,", ",99,"),
  });
  assert.equal(identityOnly.updated, 1);
  const { drainEconomicOutbox } = await import("./worldOutbox");
  await drainEconomicOutbox();
  const [identityEvents] = await input.connection.query(
    "SELECT eventType FROM goldline_world_events WHERE tenantId = ? AND eventType IN ('order_paid','order_payment_corrected')",
    [tenantId]
  );
  const identityTypes = (identityEvents as Array<{ eventType: string }>).map(
    row => row.eventType
  );
  assert.equal(identityTypes.filter(type => type === "order_paid").length, 1);
  assert.equal(
    identityTypes.filter(type => type === "order_payment_corrected").length,
    0,
    "identity enrichment must not emit order_payment_corrected"
  );

  await input.caller.import({
    ...importInput,
    requestId: randomUUID(),
    csv: BASE_CSV.replace(",7,", ",99,").replace("51.00", "61.00"),
  });
  await drainEconomicOutbox();
  const [amountEvents] = await input.connection.query(
    "SELECT eventType FROM goldline_world_events WHERE tenantId = ? AND eventType IN ('order_paid','order_payment_corrected')",
    [tenantId]
  );
  const amountTypes = (amountEvents as Array<{ eventType: string }>).map(
    row => row.eventType
  );
  assert.equal(amountTypes.filter(type => type === "order_paid").length, 1);
  assert.equal(
    amountTypes.filter(type => type === "order_payment_corrected").length,
    1
  );
  const [corrected] = await input.connection.query(
    "SELECT COUNT(*) AS n, SUM(totalCents) AS cents FROM cleancloud_paid_orders WHERE tenantId = ?",
    [tenantId]
  );
  const correctedRow = (corrected as Array<{ n: number; cents: number }>)[0];
  assert.equal(Number(correctedRow?.n), 1);
  assert.equal(Number(correctedRow?.cents), 6100);

  const atlasAfter = await getGeographicTruth({ tenantId });
  assert.equal(atlasAfter.customers.length, 1);
  assert.equal(atlasAfter.customers[0]?.totalOrders, 1);
}
