import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL env var required");
  process.exit(1);
}

const conn = await mysql.createConnection(DB_URL);
console.log("Connected to Railway MySQL");

const run = async (sql, label) => {
  try {
    await conn.execute(sql);
    console.log("✓", label);
  } catch (e) {
    if (
      e.code === "ER_DUP_FIELDNAME" ||
      e.code === "ER_TABLE_EXISTS_ERROR" ||
      e.code === "ER_DUP_KEYNAME" ||
      String(e.message).includes("Duplicate column")
    ) {
      console.log("→ already exists, skipping:", label);
    } else {
      console.error("✗", label, e.message);
    }
  }
};

const runRequired = async (sql, label, params) => {
  try {
    await conn.execute(sql, params ?? []);
    console.log("✓", label);
  } catch (error) {
    console.error("✗ required migration failed:", label, error.message);
    throw error;
  }
};

const assertRequiredColumns = async (tableName, columns) => {
  const [rows] = await conn.execute(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [tableName]
  );
  const present = new Set(rows.map(row => row.COLUMN_NAME));
  const missing = columns.filter(column => !present.has(column));
  if (missing.length) {
    throw new Error(
      `Required migration ${tableName} is incomplete; missing: ${missing.join(", ")}`
    );
  }
  console.log("✓", `${tableName} required columns verified`);
};

// `run()` swallows any non-"already exists" failure into a console.error and
// continues — correct for legacy/best-effort DDL, but a widened ENUM that
// silently failed to apply is not a schema mismatch a later ALTER can heal:
// every write of the missing value throws at request time in production
// until someone notices. Anything a later slice's writes depend on must go
// through runRequired + an assertion, never plain run().
const assertEnumContainsValues = async (tableName, columnName, values) => {
  const [rows] = await conn.execute(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  const columnType = rows[0]?.COLUMN_TYPE ?? "";
  const missing = values.filter(value => !columnType.includes(`'${value}'`));
  if (missing.length) {
    throw new Error(
      `Required migration ${tableName}.${columnName} is missing enum value(s): ${missing.join(", ")} (actual: ${columnType || "<column not found>"})`
    );
  }
  console.log("✓", `${tableName}.${columnName} required enum values verified`);
};

// ── users table ──────────────────────────────────────────────────
await run(
  `
  CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) DEFAULT 'default',
    openId VARCHAR(64) NOT NULL UNIQUE,
    name TEXT,
    email VARCHAR(320),
    loginMethod VARCHAR(64),
    role ENUM('user','admin') NOT NULL DEFAULT 'user',
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`,
  "CREATE TABLE users"
);

await run(
  `ALTER TABLE users ADD COLUMN tenantId VARCHAR(64) DEFAULT 'default' AFTER id`,
  "users.tenantId"
);
await run(
  `ALTER TABLE users ADD COLUMN loginMethod VARCHAR(64) AFTER email`,
  "users.loginMethod"
);
await run(
  `ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER loginMethod`,
  "users.role"
);
await run(
  `ALTER TABLE users ADD COLUMN lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER updatedAt`,
  "users.lastSignedIn"
);

// ── orders table ─────────────────────────────────────────────────
await run(
  `
  CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) DEFAULT 'default',
    serviceType ENUM('wash_fold','dry_cleaning') NOT NULL,
    pickupDate VARCHAR(20) NOT NULL,
    pickupTimeWindow VARCHAR(50) NOT NULL,
    deliveryDate VARCHAR(20),
    deliveryTimeWindow VARCHAR(50),
    address TEXT NOT NULL,
    unit VARCHAR(50),
    specialInstructions TEXT,
    firstName VARCHAR(100) NOT NULL,
    lastName VARCHAR(100) NOT NULL,
    phone VARCHAR(30) NOT NULL,
    email VARCHAR(320),
    bldgUserId INT,
    stripeCustomerId VARCHAR(255),
    stripePaymentMethodId VARCHAR(255),
    stripePaymentIntentId VARCHAR(255),
    status ENUM('new','collected','processing','ready','delivered') NOT NULL DEFAULT 'new',
    weightLbs DECIMAL(8,2),
    bagCount INT DEFAULT 1,
    garmentCount INT,
    subtotal DECIMAL(10,2) DEFAULT 0,
    discountPercent DECIMAL(5,2) DEFAULT 0,
    total DECIMAL(10,2) DEFAULT 0,
    upchargesJson JSON,
    drycleanItemsJson JSON,
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    isFirstPaidOrder BOOLEAN NOT NULL DEFAULT FALSE,
    portalJwt TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`,
  "CREATE TABLE orders"
);

// Add any missing columns to existing orders table
const cols = [
  [
    `ALTER TABLE orders ADD COLUMN tenantId VARCHAR(64) DEFAULT 'default' AFTER id`,
    "orders.tenantId",
  ],
  [
    `ALTER TABLE orders ADD COLUMN bldgUserId INT AFTER email`,
    "orders.bldgUserId",
  ],
  [
    `ALTER TABLE orders ADD COLUMN stripePaymentIntentId VARCHAR(255) AFTER stripePaymentMethodId`,
    "orders.stripePaymentIntentId",
  ],
  [
    `ALTER TABLE orders ADD COLUMN weightLbs DECIMAL(8,2) AFTER status`,
    "orders.weightLbs",
  ],
  [
    `ALTER TABLE orders ADD COLUMN bagCount INT DEFAULT 1 AFTER weightLbs`,
    "orders.bagCount",
  ],
  [
    `ALTER TABLE orders ADD COLUMN garmentCount INT AFTER bagCount`,
    "orders.garmentCount",
  ],
  [
    `ALTER TABLE orders ADD COLUMN subtotal DECIMAL(10,2) DEFAULT 0 AFTER garmentCount`,
    "orders.subtotal",
  ],
  [
    `ALTER TABLE orders ADD COLUMN discountPercent DECIMAL(5,2) DEFAULT 0 AFTER subtotal`,
    "orders.discountPercent",
  ],
  [
    `ALTER TABLE orders ADD COLUMN total DECIMAL(10,2) DEFAULT 0 AFTER discountPercent`,
    "orders.total",
  ],
  [
    `ALTER TABLE orders ADD COLUMN upchargesJson JSON AFTER total`,
    "orders.upchargesJson",
  ],
  [
    `ALTER TABLE orders ADD COLUMN drycleanItemsJson JSON AFTER upchargesJson`,
    "orders.drycleanItemsJson",
  ],
  [
    `ALTER TABLE orders ADD COLUMN paid BOOLEAN NOT NULL DEFAULT FALSE AFTER drycleanItemsJson`,
    "orders.paid",
  ],
  [
    `ALTER TABLE orders ADD COLUMN isFirstPaidOrder BOOLEAN NOT NULL DEFAULT FALSE AFTER paid`,
    "orders.isFirstPaidOrder",
  ],
  [
    `ALTER TABLE orders ADD COLUMN portalJwt TEXT AFTER isFirstPaidOrder`,
    "orders.portalJwt",
  ],
  [
    `ALTER TABLE orders ADD COLUMN deliveryDate VARCHAR(20) AFTER pickupTimeWindow`,
    "orders.deliveryDate",
  ],
  [
    `ALTER TABLE orders ADD COLUMN deliveryTimeWindow VARCHAR(50) AFTER deliveryDate`,
    "orders.deliveryTimeWindow",
  ],
];

for (const [sql, label] of cols) {
  await run(sql, label);
}

// ── vendors table (Phase 1) ───────────────────────────────────────
await run(
  `
  CREATE TABLE IF NOT EXISTS vendors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    country VARCHAR(2) DEFAULT 'US',
    isActive BOOLEAN NOT NULL DEFAULT TRUE,
    stripeConnectAccountId VARCHAR(255),
    chargesEnabled BOOLEAN DEFAULT FALSE,
    payoutsEnabled BOOLEAN DEFAULT FALSE,
    detailsSubmitted BOOLEAN DEFAULT FALSE,
    currentlyDue TEXT,
    pastDue TEXT,
    disabledReason VARCHAR(255),
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`,
  "CREATE TABLE vendors"
);

// ── vendors: per-vendor platform fee ─────────────────────────────
await run(
  `ALTER TABLE vendors ADD COLUMN platformFeePercent DECIMAL(5,2) AFTER disabledReason`,
  "vendors.platformFeePercent"
);

// ── orders: vendor + payout columns (Phase 1) ────────────────────
const vendorCols = [
  [
    `ALTER TABLE orders ADD COLUMN buildingSlug VARCHAR(100) AFTER portalJwt`,
    "orders.buildingSlug",
  ],
  [
    `ALTER TABLE orders ADD COLUMN vendorId INT AFTER buildingSlug`,
    "orders.vendorId",
  ],
  [
    `ALTER TABLE orders ADD COLUMN vendorNameSnapshot VARCHAR(255) AFTER vendorId`,
    "orders.vendorNameSnapshot",
  ],
  [
    `ALTER TABLE orders ADD COLUMN routingPrioritySnapshot INT AFTER vendorNameSnapshot`,
    "orders.routingPrioritySnapshot",
  ],
  [
    `ALTER TABLE orders ADD COLUMN platformFeeCents INT AFTER routingPrioritySnapshot`,
    "orders.platformFeeCents",
  ],
  [
    `ALTER TABLE orders ADD COLUMN vendorPayoutCents INT AFTER platformFeeCents`,
    "orders.vendorPayoutCents",
  ],
  [
    `ALTER TABLE orders ADD COLUMN stripeConnectedAccountIdSnapshot VARCHAR(255) AFTER vendorPayoutCents`,
    "orders.stripeConnectedAccountIdSnapshot",
  ],
];

for (const [sql, label] of vendorCols) {
  await run(sql, label);
}

// ── vendors: vendor portal columns ────────────────────────────────
await run(
  `ALTER TABLE vendors ADD COLUMN slug VARCHAR(50) UNIQUE AFTER platformFeePercent`,
  "vendors.slug"
);
await run(
  `ALTER TABLE vendors ADD COLUMN brandName VARCHAR(100) AFTER slug`,
  "vendors.brandName"
);
await run(
  `ALTER TABLE vendors ADD COLUMN logoUrl VARCHAR(512) AFTER brandName`,
  "vendors.logoUrl"
);

// ── vendor_users table (vendor portal auth) ───────────────────────
await run(
  `
  CREATE TABLE IF NOT EXISTS vendor_users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendorId INT NOT NULL,
    email VARCHAR(255) NOT NULL,
    passwordHash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vendor_email (vendorId, email)
  )
`,
  "CREATE TABLE vendor_users"
);

// ── vendor_service_coverage table (Phase 2) ───────────────────────
await run(
  `
  CREATE TABLE IF NOT EXISTS vendor_service_coverage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    vendorId INT NOT NULL,
    buildingSlug VARCHAR(100) NOT NULL,
    serviceType ENUM('wash_fold','dry_cleaning') NOT NULL,
    priority INT NOT NULL DEFAULT 10,
    isActive BOOLEAN NOT NULL DEFAULT TRUE,
    isDefault BOOLEAN DEFAULT FALSE,
    notes TEXT,
    serviceArea VARCHAR(255),
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_vendor_coverage (vendorId, buildingSlug, serviceType)
  )
`,
  "CREATE TABLE vendor_service_coverage"
);

// ── Goldline Day Director ────────────────────────────────────────
// Keep this idempotent production bootstrap aligned with migration 0059.
await runRequired(
  `
  CREATE TABLE IF NOT EXISTS day_director_processing_locations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    name VARCHAR(191) NOT NULL,
    locality VARCHAR(191),
    address VARCHAR(512),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_day_director_processing_tenant (tenantId)
  )
`,
  "CREATE TABLE day_director_processing_locations"
);

await runRequired(
  `
  CREATE TABLE IF NOT EXISTS day_director_commitments (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    actorId VARCHAR(128) NOT NULL,
    businessDate VARCHAR(10) NOT NULL,
    idempotencyKey VARCHAR(191) NOT NULL,
    title VARCHAR(255) NOT NULL,
    kind ENUM('growth','prep','operations') NOT NULL,
    quantity INT,
    provenance ENUM('user_reported','manual') NOT NULL,
    status ENUM('open','completed') NOT NULL DEFAULT 'open',
    sourceText TEXT,
    metadataJson JSON,
    completedAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_day_director_commitment_key (tenantId,actorId,businessDate,idempotencyKey),
    KEY idx_day_director_commitment_today (tenantId,actorId,businessDate)
  )
`,
  "CREATE TABLE day_director_commitments"
);

await runRequired(
  `
  CREATE TABLE IF NOT EXISTS day_director_prompt_states (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    actorId VARCHAR(128) NOT NULL,
    businessDate VARCHAR(10) NOT NULL,
    promptKey VARCHAR(191) NOT NULL,
    state ENUM('accepted','dismissed') NOT NULL,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_day_director_prompt_state (tenantId,actorId,businessDate,promptKey)
  )
`,
  "CREATE TABLE day_director_prompt_states"
);

await runRequired(
  `
  INSERT INTO day_director_processing_locations (tenantId,name,locality,active)
  VALUES ('default','Lugo''s Lavanderia','Huntington Park',TRUE)
  ON DUPLICATE KEY UPDATE tenantId = VALUES(tenantId)
`,
  "seed default Day Director processing location"
);

// ── Goldline truth-bound world ───────────────────────────────────
await runRequired(
  `CREATE TABLE IF NOT EXISTS entity_locations (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    entityType ENUM('customer','building','commercial_prospect') NOT NULL,
    entityKey VARCHAR(191) NOT NULL,
    sourceAddress VARCHAR(512) NOT NULL,
    normalizedSourceAddress VARCHAR(512) NOT NULL,
    canonicalAddress VARCHAR(512), latitude DECIMAL(10,7), longitude DECIMAL(10,7),
    googlePlaceId VARCHAR(255),
    geocodeStatus ENUM('pending','success','missing_address','ambiguous','provider_failure','transient_failure','unconfigured') NOT NULL DEFAULT 'pending',
    geocodeProvider VARCHAR(64), geocodedAt TIMESTAMP NULL, geocodeError VARCHAR(512), lastAttemptAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_entity_locations_tenant_entity (tenantId,entityType,entityKey),
    KEY idx_entity_locations_tenant_status (tenantId,geocodeStatus),
    KEY idx_entity_locations_tenant_address (tenantId,normalizedSourceAddress)
  )`,
  "CREATE TABLE entity_locations"
);

for (const [sql, label] of [
  [
    `ALTER TABLE entity_locations ADD COLUMN canonicalAddress VARCHAR(512) AFTER normalizedSourceAddress`,
    "entity_locations.canonicalAddress",
  ],
  [
    `ALTER TABLE entity_locations ADD COLUMN geocodeProvider VARCHAR(64) AFTER geocodeStatus`,
    "entity_locations.geocodeProvider",
  ],
  [
    `ALTER TABLE entity_locations ADD COLUMN geocodeError VARCHAR(512) AFTER geocodedAt`,
    "entity_locations.geocodeError",
  ],
  [
    `ALTER TABLE entity_locations ADD COLUMN lastAttemptAt TIMESTAMP NULL AFTER geocodeError`,
    "entity_locations.lastAttemptAt",
  ],
  [
    `ALTER TABLE entity_locations ADD COLUMN createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`,
    "entity_locations.createdAt",
  ],
  [
    `ALTER TABLE entity_locations ADD COLUMN updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`,
    "entity_locations.updatedAt",
  ],
])
  await run(sql, label);

await runRequired(
  `CREATE TABLE IF NOT EXISTS tower_wars_promises (
    id VARCHAR(36) PRIMARY KEY, tenantId VARCHAR(64) NOT NULL,
    buildingId ENUM('opus_la','century_park_east') NOT NULL,
    customerIdentity VARCHAR(191),
    promiseType ENUM('offer_insert','referral_card','loyalty_reward','thank_you_presentation','other') NOT NULL,
    sourceText TEXT NOT NULL, quantity INT,
    permissionStatus ENUM('not_required_physical_fulfillment','recorded','not_recorded','revoked') NOT NULL,
    permissionChannel ENUM('physical_delivery','sms','email','phone','none') NOT NULL,
    permissionEvidence TEXT, sourceReference VARCHAR(512) NOT NULL,
    idempotencyKey VARCHAR(191) NOT NULL, fulfilledAt TIMESTAMP NULL,
    fulfilledBy VARCHAR(128), fulfillmentEvidence TEXT,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_tower_wars_promises_tenant_key (tenantId,idempotencyKey),
    KEY idx_tower_wars_promises_building_open (tenantId,buildingId,fulfilledAt)
  )`,
  "CREATE TABLE tower_wars_promises"
);

// catalog_items is read (never altered) throughout this script — the same
// old-bootstrap-assumption pattern as ops_tasks/ops_task_events above: every
// use here assumes the table already exists from drizzle/0006 (+0007's
// serviceType column, +0008's nullable costCents) having been applied once,
// historically, outside this script. No-op against production, where the
// table already exists in this exact shape; required for a clean database,
// where the very first read below (`SELECT DISTINCT tenantId FROM
// catalog_items ...`) would otherwise throw ER_NO_SUCH_TABLE.
await runRequired(
  `CREATE TABLE IF NOT EXISTS catalog_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    slug VARCHAR(128) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    serviceType VARCHAR(32) NOT NULL DEFAULT 'dry_clean',
    standardPriceCents INT NOT NULL,
    expressPriceCents INT NULL,
    costCents INT NULL,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    isOnline TINYINT(1) NOT NULL DEFAULT 0,
    archived TINYINT(1) NOT NULL DEFAULT 0,
    sortOrder INT NOT NULL DEFAULT 0,
    iconUrl VARCHAR(512) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_catalog_items_tenant_slug (tenantId, slug)
  )`,
  "CREATE TABLE catalog_items"
);
await assertRequiredColumns("catalog_items", [
  "tenantId", "slug", "name", "category", "serviceType", "standardPriceCents",
]);

/* ===== Dry-cleaning partners (multi-cleaner order lines) =====
 * COAST 1hr CLEANERS is the base partner: its price list is `catalog_items`
 * itself, so no existing Coast pricing is copied, moved, or duplicated here.
 * PARAGON CLEANERS starts with the single garment we actually know a price for. */
await runRequired(
  `CREATE TABLE IF NOT EXISTS dry_cleaners (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    slug VARCHAR(64) NOT NULL,
    displayName VARCHAR(128) NOT NULL,
    defaultPartnerDiscountPct DECIMAL(5,2) NOT NULL DEFAULT 0,
    usesBaseCatalog TINYINT(1) NOT NULL DEFAULT 0,
    sortOrder INT NOT NULL DEFAULT 0,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dry_cleaners_tenant_slug (tenantId,slug)
  )`,
  "CREATE TABLE dry_cleaners"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS dry_cleaner_item_prices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    dryCleanerId INT NOT NULL,
    catalogItemId INT NOT NULL,
    cleanerRetailPriceCents INT NOT NULL,
    partnerDiscountPct DECIMAL(5,2) NULL,
    customerPriceCents INT NOT NULL,
    isActive TINYINT(1) NOT NULL DEFAULT 1,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_dry_cleaner_item_prices_cleaner_item (tenantId,dryCleanerId,catalogItemId),
    KEY idx_dry_cleaner_item_prices_cleaner (tenantId,dryCleanerId,isActive)
  )`,
  "CREATE TABLE dry_cleaner_item_prices"
);

/* Seed the two partners for every tenant that already has a dry-clean catalog,
 * plus the default tenant. Idempotent: the unique key absorbs re-runs. */
const [dcTenantRows] = await conn.query(
  `SELECT DISTINCT tenantId FROM catalog_items WHERE serviceType IN ('dry_clean','alteration')`
);
const cleanerTenantIds = Array.from(
  new Set(["default", ...dcTenantRows.map(r => r.tenantId)])
);
for (const tenantId of cleanerTenantIds) {
  await runRequired(
    `INSERT IGNORE INTO dry_cleaners
       (tenantId,slug,displayName,defaultPartnerDiscountPct,usesBaseCatalog,sortOrder,isActive)
     VALUES (?,?,?,?,?,?,1)`,
    `seed dry_cleaners COAST 1hr CLEANERS (${tenantId})`,
    [tenantId, "coast_1hr", "COAST 1hr CLEANERS", "40.00", 1, 0]
  );
  await runRequired(
    `INSERT IGNORE INTO dry_cleaners
       (tenantId,slug,displayName,defaultPartnerDiscountPct,usesBaseCatalog,sortOrder,isActive)
     VALUES (?,?,?,?,?,?,1)`,
    `seed dry_cleaners PARAGON CLEANERS (${tenantId})`,
    [tenantId, "paragon", "PARAGON CLEANERS", "15.00", 0, 1]
  );

  /* PARAGON's first and only known garment: the canonical `dress` — the same
   * garment Coast cleans, distinguished purely by this pricing relationship,
   * never by a duplicate Paragon-specific item.
   * Paragon retail $14.79, explicit 0% discount override (they charged full
   * retail rather than our normal 15%), customer price $19.00. Profit and
   * margin are derived from these, never stored.
   * Catalog pricing only: no order or customer row is seeded here. A real
   * order acquires its own immutable snapshot when the garment is added
   * through New Order. */
  const [dressRows] = await conn.query(
    `SELECT id FROM catalog_items WHERE tenantId = ? AND slug = 'dress' LIMIT 1`,
    [tenantId]
  );
  const [paragonRows] = await conn.query(
    `SELECT id FROM dry_cleaners WHERE tenantId = ? AND slug = 'paragon' LIMIT 1`,
    [tenantId]
  );
  if (dressRows.length && paragonRows.length) {
    await runRequired(
      `INSERT IGNORE INTO dry_cleaner_item_prices
         (tenantId,dryCleanerId,catalogItemId,cleanerRetailPriceCents,partnerDiscountPct,customerPriceCents,isActive)
       VALUES (?,?,?,?,?,?,1)`,
      `seed PARAGON CLEANERS dress pricing (${tenantId})`,
      [tenantId, paragonRows[0].id, dressRows[0].id, 1479, "0.00", 1900]
    );
  }
}

await assertRequiredColumns("dry_cleaners", [
  "tenantId",
  "slug",
  "displayName",
  "defaultPartnerDiscountPct",
  "usesBaseCatalog",
  "sortOrder",
  "isActive",
]);
await assertRequiredColumns("dry_cleaner_item_prices", [
  "tenantId",
  "dryCleanerId",
  "catalogItemId",
  "cleanerRetailPriceCents",
  "partnerDiscountPct",
  "customerPriceCents",
  "isActive",
]);

await assertRequiredColumns("entity_locations", [
  "tenantId",
  "entityType",
  "entityKey",
  "sourceAddress",
  "normalizedSourceAddress",
  "latitude",
  "longitude",
  "googlePlaceId",
  "geocodeStatus",
  "geocodedAt",
  "canonicalAddress",
  "geocodeProvider",
  "geocodeError",
  "lastAttemptAt",
  "createdAt",
  "updatedAt",
]);
await assertRequiredColumns("tower_wars_promises", [
  "tenantId",
  "buildingId",
  "sourceText",
  "permissionStatus",
  "permissionChannel",
  "permissionEvidence",
  "sourceReference",
  "idempotencyKey",
  "fulfilledAt",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_territory_definitions (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    stableKey VARCHAR(191) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    fantasyTitle VARCHAR(128) NOT NULL,
    realGeographyLabel VARCHAR(191) NULL,
    grammar ENUM('visit_hunt','break_the_silence','send_the_standard') NOT NULL,
    guardianId VARCHAR(64) NOT NULL,
    geometryMode ENUM('corridor','cluster','authoritative_polygon') NOT NULL,
    membersJson JSON NOT NULL,
    createdFrom VARCHAR(64) NOT NULL,
    classification VARCHAR(32) NOT NULL DEFAULT 'game_projection',
    publishedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_territory_stable (tenantId,stableKey,version),
    KEY idx_goldline_territory_tenant (tenantId,publishedAt)
  )`,
  "CREATE TABLE goldline_territory_definitions"
);

await assertRequiredColumns("goldline_territory_definitions", [
  "tenantId",
  "stableKey",
  "version",
  "fantasyTitle",
  "grammar",
  "guardianId",
  "geometryMode",
  "membersJson",
  "classification",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_campaign_instances (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorId VARCHAR(128) NOT NULL,
    businessDate VARCHAR(10) NOT NULL,
    rulesVersion INT NOT NULL DEFAULT 1,
    stableKey VARCHAR(191) NOT NULL,
    campaignArchetypeId VARCHAR(32) NOT NULL,
    title VARCHAR(128) NOT NULL,
    premise VARCHAR(512) NOT NULL,
    inputFingerprint VARCHAR(80) NOT NULL,
    status VARCHAR(16) NOT NULL,
    currentChapterId VARCHAR(191) NULL,
    completedChapterIdsJson JSON NOT NULL,
    chaptersJson JSON NOT NULL,
    revision INT NOT NULL DEFAULT 1,
    endingTreatment VARCHAR(512) NULL,
    classification VARCHAR(32) NOT NULL DEFAULT 'game_projection',
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    startedAt TIMESTAMP NULL,
    completedAt TIMESTAMP NULL,
    UNIQUE KEY uq_goldline_campaign_day (tenantId,businessDate,rulesVersion),
    UNIQUE KEY uq_goldline_campaign_stable (tenantId,stableKey),
    KEY idx_goldline_campaign_operator (tenantId,operatorId,businessDate)
  )`,
  "CREATE TABLE goldline_campaign_instances"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_campaign_revisions (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    campaignId VARCHAR(36) NOT NULL,
    revision INT NOT NULL,
    inputFingerprint VARCHAR(80) NOT NULL,
    reasonCodesJson JSON NOT NULL,
    addedFutureChapterIdsJson JSON NOT NULL,
    removedFutureChapterIdsJson JSON NOT NULL,
    reorderedFutureChapterIdsJson JSON NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_campaign_revision (campaignId,revision)
  )`,
  "CREATE TABLE goldline_campaign_revisions"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_lantern_operations (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorId VARCHAR(128) NOT NULL,
    stableKey VARCHAR(191) NOT NULL,
    sourceCampaignChapterId VARCHAR(191) NULL,
    operationType VARCHAR(32) NOT NULL,
    campaignTerritoryDefinitionId VARCHAR(36) NULL,
    lanternCityTerritoryId VARCHAR(64) NULL,
    startedAt TIMESTAMP NOT NULL,
    baselineCustomerIdentityKeysJson JSON NOT NULL,
    baselineDormantIdentityKeysJson JSON NOT NULL,
    anchorCustomerIdentityKey VARCHAR(191) NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    metadataJson JSON NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_lantern_operation_stable (tenantId,operatorId,stableKey)
  )`,
  "CREATE TABLE goldline_lantern_operations"
);

await assertRequiredColumns("goldline_lantern_operations", [
  "tenantId",
  "operatorId",
  "stableKey",
  "operationType",
  "startedAt",
  "baselineCustomerIdentityKeysJson",
  "baselineDormantIdentityKeysJson",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_fiction_assignments (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorId VARCHAR(128) NOT NULL,
    stableMissionKey VARCHAR(191) NOT NULL,
    templateId VARCHAR(64) NOT NULL,
    rulesVersion INT NOT NULL DEFAULT 1,
    instantiatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_fiction_mission (tenantId,operatorId,stableMissionKey)
  )`,
  "CREATE TABLE goldline_fiction_assignments"
);

await assertRequiredColumns("goldline_campaign_instances", [
  "tenantId",
  "operatorId",
  "businessDate",
  "rulesVersion",
  "stableKey",
  "campaignArchetypeId",
  "inputFingerprint",
  "chaptersJson",
  "classification",
]);

// Required, additive Gumballpals schema. Fail startup rather than accept imports
// against a partially provisioned database.
const gumballSql = await readFile(
  new URL("../server/cleancloudBrowserSync/schema.sql", import.meta.url),
  "utf8"
);
for (const statement of gumballSql
  .replace(/^\s*--.*$/gm, "")
  .split(";")
  .map(value => value.trim())
  .filter(Boolean)) {
  await runRequired(statement, "Gumballpals schema");
}
await assertRequiredColumns("cleancloud_browser_sync_bindings", [
  "tenantId",
  "id",
  "storeId",
  "storeLabel",
  "createdBy",
  "lastSuccessAt",
]);
await assertRequiredColumns("cleancloud_browser_sync_receipts", [
  "id",
  "tenantId",
  "requestId",
  "digest",
  "storeId",
  "importBatchId",
  "receiptJson",
  "createdAt",
]);
await assertRequiredColumns("cleancloud_browser_sync_attempts", [
  "id",
  "tenantId",
  "requestId",
  "outcome",
  "rowCount",
  "createdAt",
]);

const impactSql = await readFile(
  new URL("../server/towerWars/impactSchema.sql", import.meta.url),
  "utf8"
);
for (const statement of impactSql
  .split(";")
  .map(value => value.trim())
  .filter(Boolean))
  await runRequired(statement, "Tower Wars located impacts and seasons");
await assertRequiredColumns("goldline_tower_impacts", [
  "id",
  "tenantId",
  "payload",
]);
const cargoSql = await readFile(
  new URL("../server/goldlineCargo/schema.sql", import.meta.url),
  "utf8"
);
for (const statement of cargoSql
  .split(";")
  .map(value => value.trim())
  .filter(Boolean))
  await runRequired(statement, "Goldline vehicle cargo");
await assertRequiredColumns("goldline_field_cargo", [
  "id",
  "tenantId",
  "vehicleId",
  "requestId",
  "customerDisplayName",
  "itemDescription",
  "vehicleState",
  "linkedOrderId",
]);
const worldEventsSql = await readFile(
  new URL("../server/goldlineWorld/schema.sql", import.meta.url),
  "utf8"
);
for (const statement of worldEventsSql
  .split(";")
  .map(value => value.trim())
  .filter(Boolean))
  await runRequired(statement, "Goldline world events");
await assertRequiredColumns("goldline_world_events", [
  "id",
  "tenantId",
  "classification",
  "idempotencyKey",
]);
await assertRequiredColumns("goldline_territory_definitions", [
  "id",
  "tenantId",
]);
await assertRequiredColumns("physical_entities", ["id", "tenantId"]);
await assertRequiredColumns("tower_forge_jobs", [
  "id",
  "tenantId",
  "state",
  "idempotencyKey",
]);
const onboardingSql = await readFile(
  new URL("../server/goldlineOnboarding/schema.sql", import.meta.url),
  "utf8"
);
for (const statement of onboardingSql
  .split(";")
  .map(value => value.trim())
  .filter(Boolean))
  await runRequired(statement, "Goldline onboarding");

const driverSalesSql = await readFile(
  new URL(
    "../server/commercialMissions/driverSalesMotivationSchema.sql",
    import.meta.url
  ),
  "utf8"
);
for (const statement of driverSalesSql
  .split(";")
  .map(value => value.trim())
  .filter(Boolean))
  await runRequired(statement, "Driver sales motivation");
// Best-effort upgrade for a driver_sales_journals table already at the
// pre-0061 (0047-only) shape: CREATE TABLE IF NOT EXISTS above is a no-op
// on an existing table, so the newer columns need adding explicitly.
await run(
  `ALTER TABLE driver_sales_journals DROP INDEX uq_driver_sales_journal_tenant_driver_date`,
  "driver_sales_journals: drop legacy daily-uniqueness index"
);
await run(
  `ALTER TABLE driver_sales_journals
    ADD COLUMN clientRequestId varchar(36) NULL AFTER journalDate,
    ADD COLUMN rawTranscript text NULL AFTER audioMimeType,
    ADD COLUMN captureLatitude decimal(10,7) NULL AFTER journalPoints,
    ADD COLUMN captureLongitude decimal(10,7) NULL AFTER captureLatitude,
    ADD COLUMN captureAccuracyMeters decimal(10,2) NULL AFTER captureLongitude,
    ADD COLUMN locationCapturedAt timestamp NULL AFTER captureAccuracyMeters,
    ADD COLUMN locationContemporaneous boolean NOT NULL DEFAULT false AFTER locationCapturedAt,
    ADD COLUMN processingError varchar(512) NULL AFTER locationContemporaneous,
    ADD COLUMN processingAttempts int NOT NULL DEFAULT 0 AFTER processingError,
    ADD COLUMN processedAt timestamp NULL AFTER processingAttempts,
    ADD UNIQUE KEY uq_driver_sales_journal_tenant_request (tenantId,clientRequestId),
    ADD KEY idx_driver_sales_journal_processing (tenantId,processingStatus,createdAt),
    ADD KEY idx_driver_sales_journal_driver_date (tenantId,driverId,journalDate,createdAt)`,
  "driver_sales_journals: 0061 columns"
);
await assertRequiredColumns("driver_sales_journals", [
  "id",
  "tenantId",
  "driverId",
  "journalDate",
  "processingStatus",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS authored_days (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorId VARCHAR(128) NOT NULL,
    businessDate VARCHAR(10) NOT NULL,
    stableKey VARCHAR(191) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    headline VARCHAR(255) NOT NULL,
    framing VARCHAR(512) NOT NULL,
    linesJson JSON NOT NULL,
    inputFingerprint VARCHAR(80) NOT NULL,
    intelligence VARCHAR(32) NOT NULL,
    linkedOperationStableKey VARCHAR(191) NULL,
    committedAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_authored_day_operator_date (tenantId,operatorId,businessDate),
    UNIQUE KEY uq_authored_day_stable (tenantId,operatorId,stableKey)
  )`,
  "CREATE TABLE authored_days"
);

await assertRequiredColumns("authored_days", [
  "tenantId",
  "operatorId",
  "businessDate",
  "stableKey",
  "linesJson",
  "inputFingerprint",
  "intelligence",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_campaigns (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    campaignId VARCHAR(64) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    title VARCHAR(191) NOT NULL,
    objective VARCHAR(512) NOT NULL,
    completionCondition VARCHAR(512) NOT NULL,
    prepLeadDays INT NOT NULL DEFAULT 0,
    prepCondition VARCHAR(512) NULL,
    pocketKind VARCHAR(32) NOT NULL,
    pocketMinutesMin INT NOT NULL,
    fallbackVariantJson JSON NULL,
    autoVerifiableJson JSON NOT NULL,
    selfReportedJson JSON NOT NULL,
    missionCategory VARCHAR(64) NOT NULL,
    companionAbilityId VARCHAR(64) NULL,
    timingAssumptionsJson JSON NOT NULL,
    opsTaskType VARCHAR(64) NOT NULL,
    legacyContract VARCHAR(32) NULL,
    legacyContractRefJson JSON NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_campaign_id (tenantId,campaignId)
  )`,
  "CREATE TABLE goldline_campaigns"
);

await assertRequiredColumns("goldline_campaigns", [
  "tenantId",
  "campaignId",
  "enabled",
  "pocketKind",
  "pocketMinutesMin",
  "opsTaskType",
]);

// migrate.mjs has ALTERed ops_tasks/ops_task_events for a long time (see the
// taskType-widening ALTER immediately below, and the eventType-widening
// ALTER in the Behavioral Ledger block at the end of this file) without ever
// creating either table — an old bootstrap assumption that production's
// tables already existed from a one-time historical setup outside this
// script. That assumption breaks on a genuinely clean database (a fresh CI
// MySQL instance, in particular): the ALTERs below would throw
// ER_NO_SUCH_TABLE. Both CREATE TABLE IF NOT EXISTS blocks are no-ops
// against the real production database, where these tables already exist.
await runRequired(
  `CREATE TABLE IF NOT EXISTS ops_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    lane ENUM('lane_1','lane_2','lane_3','level_4') NOT NULL,
    level ENUM('1','2','3','4') NOT NULL,
    taskType ENUM('intake_missing_price','unpaid_order','vague_intake','missed_pickup','stale_customer','revenue_leak','referral_ask','vendor_followup','gm_followup','manual_operator_task','dry_clean_receipt_intake','emergency_task') NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    source ENUM('manual','agent_suggested','system_detected','level_4','voice','quick_input') NOT NULL DEFAULT 'manual',
    createdBy VARCHAR(128) NULL,
    assignedTo VARCHAR(128) NULL,
    status ENUM('open','accepted','in_progress','completed','dismissed','expired') NOT NULL DEFAULT 'open',
    priority ENUM('low','normal','high','emergency') NOT NULL DEFAULT 'normal',
    revenueAtRiskCents INT NOT NULL DEFAULT 0,
    revenueRecoveredCents INT NOT NULL DEFAULT 0,
    customerId INT NULL,
    orderId INT NULL,
    agentEventId INT NULL,
    metadataJson JSON NULL,
    outcome TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    completedAt TIMESTAMP NULL,
    completedBy VARCHAR(128) NULL,
    KEY idx_ops_tasks_tenant_status (tenantId, status),
    KEY idx_ops_tasks_tenant_lane (tenantId, lane),
    KEY idx_ops_tasks_tenant_completed (tenantId, completedAt),
    KEY idx_ops_tasks_agent_event (agentEventId),
    KEY idx_ops_tasks_order (orderId)
  )`,
  "CREATE TABLE ops_tasks"
);
await assertRequiredColumns("ops_tasks", ["tenantId", "lane", "level", "taskType", "title", "status"]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS ops_task_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL DEFAULT 'default',
    taskId INT NOT NULL,
    eventType ENUM('created','viewed','accepted','completed','dismissed','expired','agent_suggested','human_approved','revenue_recovered','outcome_recorded') NOT NULL,
    actorType ENUM('human','voice','resident_chat','driver','vendor','ai_agent','system') NOT NULL DEFAULT 'human',
    actorId VARCHAR(128) NULL,
    agentEventId INT NULL,
    beforeJson JSON NULL,
    afterJson JSON NULL,
    note TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_ops_task_events_tenant_task (tenantId, taskId),
    KEY idx_ops_task_events_tenant_event (tenantId, eventType),
    KEY idx_ops_task_events_agent_event (agentEventId)
  )`,
  "CREATE TABLE ops_task_events"
);
await assertRequiredColumns("ops_task_events", ["tenantId", "taskId", "eventType"]);

await run(
  `ALTER TABLE ops_tasks MODIFY COLUMN taskType ENUM(
    'intake_missing_price','unpaid_order','vague_intake','missed_pickup',
    'stale_customer','revenue_leak','referral_ask','vendor_followup',
    'gm_followup','manual_operator_task','dry_clean_receipt_intake',
    'emergency_task','door_hanger_operation','office_account_pitch',
    'review_request','digital_footprint_post','partnership_outreach'
  ) NOT NULL`,
  "ops_tasks: widen taskType enum for campaign library types"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_kingdoms (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    kingdomId VARCHAR(64) NOT NULL,
    sequence INT NOT NULL,
    title VARCHAR(191) NOT NULL,
    realCampaignId VARCHAR(64) NULL,
    fictionalFieldMission VARCHAR(191) NOT NULL,
    lanternCityStatus VARCHAR(32) NOT NULL DEFAULT 'locked',
    driverDayRelevance VARCHAR(512) NOT NULL,
    companionEarnedId VARCHAR(64) NULL,
    enablesKingdomId VARCHAR(64) NULL,
    capabilityRequirement VARCHAR(512) NULL,
    selectedAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_kingdom_id (tenantId,kingdomId)
  )`,
  "CREATE TABLE goldline_kingdoms"
);

await assertRequiredColumns("goldline_kingdoms", [
  "tenantId",
  "kingdomId",
  "sequence",
  "fictionalFieldMission",
  "lanternCityStatus",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_companions (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    companionId VARCHAR(32) NOT NULL,
    name VARCHAR(64) NOT NULL,
    fictionTruth VARCHAR(512) NOT NULL,
    afterAvailableText VARCHAR(512) NOT NULL,
    mayJson JSON NOT NULL,
    mayNotJson JSON NOT NULL,
    fantasyExpressionJson JSON NOT NULL,
    abilityId VARCHAR(64) NOT NULL,
    abilityDescription VARCHAR(512) NOT NULL,
    unifiedProductPersona BOOLEAN NOT NULL DEFAULT false,
    productPersonaNote VARCHAR(512) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_companion_id (tenantId,companionId)
  )`,
  "CREATE TABLE goldline_companions"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_companion_unlocks (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorId VARCHAR(128) NOT NULL,
    companionId VARCHAR(32) NOT NULL,
    earnedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    earnedViaKingdomId VARCHAR(64) NOT NULL,
    earnedViaCampaignId VARCHAR(64) NOT NULL,
    evidenceOpsTaskId INT NOT NULL,
    UNIQUE KEY uq_goldline_companion_unlock (tenantId,operatorId,companionId)
  )`,
  "CREATE TABLE goldline_companion_unlocks"
);

await assertRequiredColumns("goldline_companions", [
  "tenantId",
  "companionId",
  "mayJson",
  "mayNotJson",
  "abilityId",
]);
await assertRequiredColumns("goldline_companion_unlocks", [
  "tenantId",
  "operatorId",
  "companionId",
  "evidenceOpsTaskId",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS mission_director_plans (
    id VARCHAR(36) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorId VARCHAR(128) NOT NULL,
    businessDate VARCHAR(10) NOT NULL,
    stableKey VARCHAR(191) NOT NULL,
    revision INT NOT NULL DEFAULT 1,
    inputFingerprint VARCHAR(80) NOT NULL,
    outcomeJson JSON NOT NULL,
    usageOutcome VARCHAR(16) NULL,
    usageReportedAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_mission_director_plan_revision (tenantId,operatorId,businessDate,revision)
  )`,
  "CREATE TABLE mission_director_plans"
);

await assertRequiredColumns("mission_director_plans", [
  "tenantId",
  "operatorId",
  "businessDate",
  "revision",
  "inputFingerprint",
  "outcomeJson",
]);

// ── Claire Pass 1: persistent character runtime substrate ────────
// Operator scope is tenantId + operatorUserId + characterId. Relationship
// events are append-only; relationship state is a reproducible cache
// derived from them (server/claire/character/tierEngine.ts).
await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_relationship_events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    characterId VARCHAR(32) NOT NULL DEFAULT 'claire',
    eventType VARCHAR(48) NOT NULL,
    summary VARCHAR(512) NOT NULL,
    provenance VARCHAR(128) NOT NULL,
    relatedEntityType VARCHAR(64) NULL,
    relatedEntityId VARCHAR(64) NULL,
    evidenceSource VARCHAR(128) NULL,
    occurredAt TIMESTAMP NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_claire_relationship_event_operator (tenantId,operatorUserId,characterId,occurredAt)
  )`,
  "CREATE TABLE claire_relationship_events"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_relationship_state (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    characterId VARCHAR(32) NOT NULL DEFAULT 'claire',
    professionalRespect INT NOT NULL DEFAULT 0,
    reliability INT NOT NULL DEFAULT 0,
    disclosureSafety INT NOT NULL DEFAULT 0,
    familiarity INT NOT NULL DEFAULT 0,
    disclosureTier INT NOT NULL DEFAULT 0,
    qualifyingInteractionCount INT NOT NULL DEFAULT 0,
    distinctInteractionDays INT NOT NULL DEFAULT 0,
    lastEventId INT NULL,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_claire_relationship_state (tenantId,operatorUserId,characterId)
  )`,
  "CREATE TABLE claire_relationship_state"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_tier_transitions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    characterId VARCHAR(32) NOT NULL DEFAULT 'claire',
    fromTier INT NOT NULL,
    toTier INT NOT NULL,
    reasonsJson JSON NOT NULL,
    supportingEventIdsJson JSON NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_claire_tier_transition_operator (tenantId,operatorUserId,characterId,createdAt)
  )`,
  "CREATE TABLE claire_tier_transitions"
);

await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_generation_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NULL,
    characterId VARCHAR(32) NOT NULL DEFAULT 'claire',
    characterVersion VARCHAR(32) NOT NULL,
    compilerVersion VARCHAR(32) NOT NULL,
    mode VARCHAR(32) NOT NULL,
    generationKind VARCHAR(32) NOT NULL,
    generationSource VARCHAR(16) NOT NULL,
    disclosureTier INT NOT NULL,
    generatedText VARCHAR(1024) NOT NULL,
    relationshipDimensionsJson JSON NOT NULL,
    sharedHistoryEventIdsJson JSON NOT NULL,
    canonFragmentIdsJson JSON NOT NULL,
    businessContextSummary VARCHAR(512) NULL,
    fallbackReason VARCHAR(64) NULL,
    reviewLabel VARCHAR(32) NULL,
    reviewedByUserId VARCHAR(128) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_claire_generation_log_tenant (tenantId,createdAt)
  )`,
  "CREATE TABLE claire_generation_logs"
);

await assertRequiredColumns("claire_relationship_events", [
  "tenantId",
  "operatorUserId",
  "characterId",
  "eventType",
  "summary",
  "provenance",
  "occurredAt",
]);
await assertRequiredColumns("claire_relationship_state", [
  "tenantId",
  "operatorUserId",
  "characterId",
  "professionalRespect",
  "reliability",
  "disclosureSafety",
  "familiarity",
  "disclosureTier",
  "qualifyingInteractionCount",
  "distinctInteractionDays",
]);
// ── Earned Rapport + Guarded Disclosure: additive tables only ───────────
await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_progression_evidence (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    category VARCHAR(24) NOT NULL,
    kind VARCHAR(64) NOT NULL,
    strength VARCHAR(16) NULL,
    sourceType VARCHAR(64) NOT NULL,
    sourceId VARCHAR(96) NOT NULL,
    provenance VARCHAR(128) NOT NULL,
    occurredAt TIMESTAMP NOT NULL,
    recognizedAt TIMESTAMP NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_claire_progression_evidence (tenantId,operatorUserId,category,sourceType,sourceId)
  )`,
  "CREATE TABLE claire_progression_evidence"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_progression_grants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    rapportBand INT NOT NULL DEFAULT 0,
    rapportPolicyVersion VARCHAR(64) NULL,
    personalRung INT NOT NULL DEFAULT 0,
    rungPolicyVersion VARCHAR(64) NULL,
    entitlementCursor VARCHAR(190) NULL,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_claire_progression_grants (tenantId,operatorUserId)
  )`,
  "CREATE TABLE claire_progression_grants"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_disclosure_entitlements (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    evidenceId INT NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'unused',
    mintedAt TIMESTAMP NOT NULL,
    reservedAt TIMESTAMP NULL,
    reservationToken VARCHAR(64) NULL,
    reservedConversationId VARCHAR(128) NULL,
    reservedFragmentId VARCHAR(64) NULL,
    reservedTopic VARCHAR(64) NULL,
    reservedRung INT NULL,
    reservedRapportBand INT NULL,
    consumedAt TIMESTAMP NULL,
    consumedFragmentId VARCHAR(64) NULL,
    consumedConversationId VARCHAR(128) NULL,
    UNIQUE KEY uq_claire_disclosure_entitlement_evidence (tenantId,operatorUserId,evidenceId)
  )`,
  "CREATE TABLE claire_disclosure_entitlements"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_personal_ledger (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    conversationId VARCHAR(128) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    topic VARCHAR(64) NULL,
    fragmentId VARCHAR(64) NULL,
    entitlementId INT NULL,
    rungAtTime INT NOT NULL DEFAULT 0,
    rapportBandAtTime INT NOT NULL DEFAULT 0,
    declineId VARCHAR(64) NULL,
    failureReason VARCHAR(96) NULL,
    hadUnusedEntitlement INT NULL,
    failurePhase VARCHAR(24) NULL,
    occurredAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_claire_personal_ledger_operator (tenantId,operatorUserId,occurredAt),
    KEY idx_claire_personal_ledger_kind (tenantId,kind,occurredAt)
  )`,
  "CREATE TABLE claire_personal_ledger"
);

await assertRequiredColumns("claire_tier_transitions", [
  "tenantId",
  "operatorUserId",
  "characterId",
  "fromTier",
  "toTier",
  "reasonsJson",
  "supportingEventIdsJson",
]);
await assertRequiredColumns("claire_generation_logs", [
  "tenantId",
  "characterVersion",
  "compilerVersion",
  "mode",
  "generationKind",
  "generationSource",
  "disclosureTier",
  "generatedText",
]);

// Claire Intelligence Repair Part 2, Slice A: answer-path routing telemetry.
// Additive, nullable columns on the existing log table — no parallel table, so
// one query covers model generations and deterministic renderings alike.
// `run()` is correct here: ADD COLUMN is re-run on every boot and the
// duplicate-column error is the expected steady state.
for (const [column, definition] of [
  ["answerPath", "VARCHAR(32) NULL"],
  ["businessReader", "VARCHAR(48) NULL"],
  ["rendererProse", "TINYINT(1) NULL"],
  ["surface", "VARCHAR(16) NULL"],
  ["turnKind", "VARCHAR(32) NULL"],
  ["modelRequested", "VARCHAR(64) NULL"],
  ["modelServed", "VARCHAR(64) NULL"],
  ["promptChars", "INT NULL"],
  ["answerPathDetailJson", "JSON NULL"],
]) {
  await run(
    `ALTER TABLE claire_generation_logs ADD COLUMN ${column} ${definition}`,
    `ALTER claire_generation_logs ADD ${column}`
  );
}
await run(
  "CREATE INDEX idx_claire_generation_log_answer_path ON claire_generation_logs (tenantId, answerPath, createdAt)",
  "CREATE INDEX idx_claire_generation_log_answer_path"
);
// Slice A's telemetry writes depend on these columns existing.
await assertRequiredColumns("claire_generation_logs", [
  "answerPath",
  "rendererProse",
  "surface",
  "turnKind",
  "answerPathDetailJson",
]);

// ── Claire durable conversation state ────────────────────────────
// A live call or desk conversation's working state (pending confirmations,
// pending briefings, analytical thread, recent turns). Not business truth;
// persisted so a deploy, restart, or replica switch can't make Claire forget
// what she and the operator were discussing mid-conversation.
await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_conversation_states (
    id VARCHAR(191) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    surface VARCHAR(16) NOT NULL,
    stateJson JSON NOT NULL,
    version INT NOT NULL DEFAULT 1,
    expiresAt TIMESTAMP NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_claire_conversation_state_operator (tenantId,operatorUserId,updatedAt),
    KEY idx_claire_conversation_state_expiry (expiresAt)
  )`,
  "CREATE TABLE claire_conversation_states"
);
await assertRequiredColumns("claire_conversation_states", [
  "id",
  "tenantId",
  "operatorUserId",
  "surface",
  "stateJson",
  "version",
  "expiresAt",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_operator_doctrine (
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    rulesJson JSON NOT NULL,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_claire_operator_doctrine (tenantId, operatorUserId)
  )`,
  "CREATE TABLE claire_operator_doctrine"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS claire_proactive_obligations (
    id VARCHAR(191) PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    subjectKey VARCHAR(191) NOT NULL,
    payloadJson JSON NOT NULL,
    status VARCHAR(32) NOT NULL,
    dueDate VARCHAR(10) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_claire_proactive_open (tenantId, operatorUserId, status, dueDate)
  )`,
  "CREATE TABLE claire_proactive_obligations"
);

// ── Claire Pass 2: MissionSalesBrief ──────────────────────────────
// The single authoritative, versioned sales brief per commercial mission.
// Append-only — a new mission reality creates a new version row.
await runRequired(
  `CREATE TABLE IF NOT EXISTS mission_sales_briefs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    missionId INT NOT NULL,
    accountId INT NULL,
    version INT NOT NULL DEFAULT 1,
    briefJson JSON NOT NULL,
    source VARCHAR(16) NOT NULL,
    compilerVersion VARCHAR(64) NOT NULL,
    frameworkId VARCHAR(36) NULL,
    confidence INT NOT NULL DEFAULT 0,
    generatedFromEvidenceThrough TIMESTAMP NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_mission_sales_brief_version (tenantId,missionId,version),
    KEY idx_mission_sales_brief_tenant_mission (tenantId,missionId,version)
  )`,
  "CREATE TABLE mission_sales_briefs"
);
await assertRequiredColumns("mission_sales_briefs", [
  "tenantId",
  "missionId",
  "version",
  "briefJson",
  "source",
  "compilerVersion",
  "generatedFromEvidenceThrough",
]);

// ── Claire Prompt A: durable operator macro goals ────────────────
await runRequired(
  `CREATE TABLE IF NOT EXISTS operator_macro_goals (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    objective VARCHAR(512) NOT NULL,
    metricKey VARCHAR(64) NOT NULL,
    targetValue DECIMAL(15,2) NOT NULL,
    unit VARCHAR(64) NOT NULL,
    urgencyText VARCHAR(191) NULL,
    targetDate VARCHAR(10) NULL,
    source ENUM('operator_attested','admin') NOT NULL,
    sourceNote VARCHAR(512) NOT NULL,
    status ENUM('active','superseded','closed') NOT NULL DEFAULT 'active',
    supersededById VARCHAR(36) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_operator_macro_goals_active (tenantId,operatorUserId,metricKey,status)
  )`,
  "CREATE TABLE operator_macro_goals"
);
await assertRequiredColumns("operator_macro_goals", [
  "tenantId", "operatorUserId", "objective", "metricKey", "targetValue",
  "unit", "source", "sourceNote", "status", "supersededById",
]);

// Production runs this file (`npm start` → node scripts/migrate.mjs), not drizzle/0080.
// The CREATE TABLE above historically omitted secondaryTargetsJson; drizzle's 0080 ALTER
// never executed on Railway. Additive, nullable, no data rewrite.
await run(
  `ALTER TABLE operator_macro_goals ADD COLUMN secondaryTargetsJson JSON NULL`,
  "operator_macro_goals.secondaryTargetsJson"
);
await assertRequiredColumns("operator_macro_goals", [
  "tenantId", "operatorUserId", "objective", "metricKey", "targetValue",
  "unit", "source", "sourceNote", "status", "supersededById", "secondaryTargetsJson",
]);

// ── Goldline Campaign Runs: standing operations across days ──────
// docs/goldline/FICTION_PACKS.md §2. Progress is DERIVED from the event table;
// there is deliberately no counter column in any of these three tables.
await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_campaign_runs (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    campaignId VARCHAR(64) NOT NULL,
    campaignVersion INT NOT NULL DEFAULT 1,
    fictionPackId VARCHAR(64) NULL,
    fictionPackVersion INT NULL,
    targetSetId VARCHAR(64) NOT NULL,
    startedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status ENUM('active','complete','abandoned') NOT NULL DEFAULT 'active',
    completedAt TIMESTAMP NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_goldline_campaign_runs_active (tenantId,operatorUserId,status),
    KEY idx_goldline_campaign_runs_campaign (tenantId,campaignId)
  )`,
  "CREATE TABLE goldline_campaign_runs"
);
await assertRequiredColumns("goldline_campaign_runs", [
  "tenantId", "operatorUserId", "campaignId", "campaignVersion",
  "fictionPackId", "fictionPackVersion", "targetSetId", "status", "completedAt",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_campaign_targets (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    targetSetId VARCHAR(64) NOT NULL,
    targetId VARCHAR(64) NOT NULL,
    label VARCHAR(191) NOT NULL,
    address VARCHAR(512) NOT NULL,
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL,
    placementPoint VARCHAR(32) NOT NULL,
    sourceNote VARCHAR(512) NOT NULL,
    provenance VARCHAR(64) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_campaign_target (tenantId,targetSetId,targetId),
    KEY idx_goldline_campaign_targets_set (tenantId,targetSetId)
  )`,
  "CREATE TABLE goldline_campaign_targets"
);
await assertRequiredColumns("goldline_campaign_targets", [
  "tenantId", "targetSetId", "targetId", "label", "address",
  "placementPoint", "sourceNote", "provenance",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_campaign_run_targets (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    campaignRunId VARCHAR(36) NOT NULL,
    slotId VARCHAR(64) NOT NULL,
    originalTargetId VARCHAR(64) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_goldline_campaign_run_slot (campaignRunId,slotId),
    KEY idx_goldline_campaign_run_targets_run (tenantId,campaignRunId)
  )`,
  "CREATE TABLE goldline_campaign_run_targets"
);
await assertRequiredColumns("goldline_campaign_run_targets", [
  "tenantId", "campaignRunId", "slotId", "originalTargetId",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS goldline_campaign_target_events (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    campaignRunId VARCHAR(36) NOT NULL,
    targetId VARCHAR(64) NULL,
    kind ENUM('territory_presence','placement_reported','supporting_photo','target_replaced') NOT NULL,
    occurredAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    operatorUserId VARCHAR(128) NOT NULL,
    provenance VARCHAR(64) NOT NULL,
    epistemicState VARCHAR(32) NOT NULL,
    supportingPresenceEventId VARCHAR(36) NULL,
    replacementTargetId VARCHAR(64) NULL,
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL,
    accuracyMeters INT NULL,
    note VARCHAR(512) NULL,
    payloadJson JSON NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_goldline_campaign_target_events_run (tenantId,campaignRunId,kind),
    KEY idx_goldline_campaign_target_events_target (campaignRunId,targetId)
  )`,
  "CREATE TABLE goldline_campaign_target_events"
);
await assertRequiredColumns("goldline_campaign_target_events", [
  "tenantId", "campaignRunId", "targetId", "kind", "operatorUserId",
  "provenance", "epistemicState", "supportingPresenceEventId", "replacementTargetId",
  "lat", "lng", "accuracyMeters",
]);

// ── StrategyEngine Playground Rules & Spend Ledger (Slice 3) ───────
await runRequired(
  `CREATE TABLE IF NOT EXISTS playground_rules (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    version INT NOT NULL DEFAULT 1,
    monthlySpendCeilingCents INT NOT NULL DEFAULT 0,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    approvalCategoriesJson JSON NOT NULL,
    effectiveFrom TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    effectiveTo TIMESTAMP NULL,
    source ENUM('operator_attested', 'admin') NOT NULL DEFAULT 'admin',
    macroGoalId VARCHAR(36) NULL,
    status ENUM('active', 'superseded') NOT NULL DEFAULT 'active',
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_playground_rules_tenant_status (tenantId, status),
    KEY idx_playground_rules_tenant_version (tenantId, version)
  )`,
  "CREATE TABLE playground_rules"
);
await assertRequiredColumns("playground_rules", [
  "tenantId", "version", "monthlySpendCeilingCents", "approvalCategoriesJson", "status",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_spend_ledger (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    businessMonth VARCHAR(7) NOT NULL,
    category VARCHAR(64) NOT NULL,
    amountCents INT NOT NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    status ENUM('planned', 'committed', 'released') NOT NULL,
    sourcePlayId VARCHAR(64) NULL,
    sourceMissionId VARCHAR(64) NULL,
    sourceRef VARCHAR(191) NULL,
    dedupeKey VARCHAR(191) NOT NULL,
    approvedByUserId VARCHAR(128) NULL,
    metadataJson JSON NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_strategy_spend_tenant_dedupe (tenantId, dedupeKey),
    KEY idx_strategy_spend_tenant_month_status (tenantId, businessMonth, status)
  )`,
  "CREATE TABLE strategy_spend_ledger"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_snapshots (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    schemaVersion INT NOT NULL DEFAULT 1,
    contentHash VARCHAR(64) NOT NULL,
    estimatedTokens INT NOT NULL DEFAULT 0,
    isTruncated BOOLEAN NOT NULL DEFAULT FALSE,
    payloadJson JSON NOT NULL,
    provenanceJson JSON NOT NULL,
    stalenessJson JSON NOT NULL,
    generatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_strategy_snapshots_tenant_created (tenantId, createdAt),
    KEY idx_strategy_snapshots_tenant_hash (tenantId, contentHash)
  )`,
  "CREATE TABLE strategy_snapshots"
);
await assertRequiredColumns("strategy_snapshots", [
  "tenantId", "schemaVersion", "contentHash", "payloadJson", "provenanceJson",
]);

// ── StrategyEngine Plays, Offers & Choices (Slice 6) ───────────────
await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_plays (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    businessName VARCHAR(191) NOT NULL,
    worldName VARCHAR(191) NOT NULL,
    hypothesis TEXT NOT NULL,
    primaryMetric VARCHAR(64) NOT NULL,
    geography VARCHAR(128) NOT NULL,
    stopsCount INT NOT NULL DEFAULT 1,
    isClustered BOOLEAN NOT NULL DEFAULT FALSE,
    estimatedInitiationCost INT NOT NULL DEFAULT 0,
    estimatedSpendCents INT NOT NULL DEFAULT 0,
    spendCategory VARCHAR(64) NOT NULL DEFAULT 'other',
    confidence VARCHAR(32) NOT NULL DEFAULT 'medium',
    evidenceReferencesJson JSON NULL,
    scoreBreakdownJson JSON NOT NULL,
    totalScore INT NOT NULL DEFAULT 0,
    status ENUM('candidate', 'offered', 'chosen', 'active', 'paused', 'retired') NOT NULL DEFAULT 'candidate',
    needsApprovalToRun BOOLEAN NOT NULL DEFAULT FALSE,
    minimumEvidenceThresholdJson JSON NULL,
    verticalKey VARCHAR(64) NOT NULL DEFAULT 'generic',
    templateKey VARCHAR(64) NOT NULL,
    provenanceJson JSON NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_strategy_plays_tenant_status (tenantId, status)
  )`,
  "CREATE TABLE strategy_plays"
);
await assertRequiredColumns("strategy_plays", [
  "tenantId", "businessName", "worldName", "primaryMetric", "totalScore", "status",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_path_offers (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    playIdsJson JSON NOT NULL,
    recommendedPlayId VARCHAR(64) NOT NULL,
    claireRationale TEXT NOT NULL,
    status ENUM('active', 'accepted', 'expired', 'superseded') NOT NULL DEFAULT 'active',
    offeredAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    businessDate VARCHAR(10) NOT NULL,
    expiresAt TIMESTAMP NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_strategy_path_offers_tenant_status (tenantId, status),
    KEY idx_strategy_path_offers_tenant_date (tenantId, businessDate)
  )`,
  "CREATE TABLE strategy_path_offers"
);
await assertRequiredColumns("strategy_path_offers", [
  "tenantId", "playIdsJson", "recommendedPlayId", "status", "businessDate",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_path_choices (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    offerId VARCHAR(64) NULL,
    playId VARCHAR(64) NOT NULL,
    chosenOnSurface ENUM('map', 'voice', 'admin') NOT NULL,
    previousPlayId VARCHAR(64) NULL,
    readbackConfirmed BOOLEAN NOT NULL DEFAULT FALSE,
    chosenAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_strategy_path_choices_tenant_play (tenantId, playId)
  )`,
  "CREATE TABLE strategy_path_choices"
);
await assertRequiredColumns("strategy_path_choices", [
  "tenantId", "playId", "chosenOnSurface",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_mission_plan (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    playId VARCHAR(64) NOT NULL,
    dayDirectorCommitmentId VARCHAR(36) NULL,
    commercialMissionId INT NULL,
    businessDate VARCHAR(10) NOT NULL,
    missionType ENUM('growth','support') NOT NULL DEFAULT 'growth',
    status ENUM('planned','wait_approval','active','completed','cancelled') NOT NULL DEFAULT 'planned',
    title VARCHAR(255) NOT NULL,
    geographyCluster VARCHAR(128) NULL,
    stopCount INT NOT NULL DEFAULT 1,
    spendReservationId VARCHAR(64) NULL,
    spendCategory VARCHAR(64) NULL,
    spendCents INT NOT NULL DEFAULT 0,
    preparedSalesPrepJson JSON NOT NULL,
    dedupeKey VARCHAR(191) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_strategy_mission_plan_dedupe (tenantId, dedupeKey),
    KEY idx_strategy_mission_plan_date (tenantId, businessDate),
    KEY idx_strategy_mission_plan_play (tenantId, playId),
    KEY idx_strategy_mission_plan_status (tenantId, status)
  )`,
  "CREATE TABLE strategy_mission_plan"
);
await assertRequiredColumns("strategy_mission_plan", [
  "tenantId", "playId", "businessDate", "status", "preparedSalesPrepJson", "dedupeKey",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS communication_permissions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    subjectType ENUM('lead','contact','customer','property') NOT NULL,
    subjectId VARCHAR(128) NOT NULL,
    channel ENUM('sms','email','call','visit','any') NOT NULL DEFAULT 'any',
    status ENUM('opted_in','opted_out','refused','unspecified') NOT NULL DEFAULT 'unspecified',
    reason TEXT NULL,
    lastOutreachAt TIMESTAMP NULL DEFAULT NULL,
    frequencyCapDays INT NOT NULL DEFAULT 7,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_comm_perm_subject_channel (tenantId, subjectType, subjectId, channel),
    KEY idx_comm_perm_tenant_status (tenantId, status)
  )`,
  "CREATE TABLE communication_permissions"
);
await assertRequiredColumns("communication_permissions", [
  "tenantId", "subjectType", "subjectId", "status",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS property_activation_tracks (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    propertyId VARCHAR(128) NOT NULL,
    propertyName VARCHAR(255) NOT NULL,
    agreedServiceDetailsJson JSON NOT NULL,
    residentCommunicationPermitted TINYINT(1) NOT NULL DEFAULT 0,
    bookingInstructions TEXT NULL,
    pickupArrangements TEXT NULL,
    stage ENUM('access_granted','flyer_distribution','resident_announcement','first_order','repeat_orders') NOT NULL DEFAULT 'access_granted',
    blockedReason TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_property_activation_property (tenantId, propertyId),
    KEY idx_property_activation_stage (tenantId, stage)
  )`,
  "CREATE TABLE property_activation_tracks"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_evidence (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    playId VARCHAR(64) NOT NULL,
    windowDays INT NOT NULL,
    windowStart VARCHAR(10) NOT NULL,
    windowEnd VARCHAR(10) NOT NULL,
    funnelCountsJson JSON NOT NULL,
    untrackedFunnelStepsJson JSON NOT NULL,
    statement TEXT NOT NULL,
    sampleSize INT NOT NULL DEFAULT 0,
    thresholdMet TINYINT(1) NOT NULL DEFAULT 0,
    worldSignal ENUM('brighten','dim','none') NOT NULL DEFAULT 'none',
    provenanceJson JSON NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_strategy_evidence_play (tenantId, playId),
    KEY idx_strategy_evidence_signal (tenantId, worldSignal)
  )`,
  "CREATE TABLE strategy_evidence"
);
await assertRequiredColumns("strategy_evidence", [
  "tenantId", "playId", "statement", "worldSignal", "provenanceJson",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS opportunity_stall_reasons (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    opportunityId VARCHAR(64) NULL,
    source VARCHAR(64) NOT NULL DEFAULT 'debrief',
    reason ENUM('timing','price','trust','pickup_convenience','existing_provider','access_restriction','service_issue','unknown') NOT NULL DEFAULT 'unknown',
    detail TEXT NULL,
    recordedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_opp_stall_reason (tenantId, reason),
    KEY idx_opp_stall_opp (tenantId, opportunityId)
  )`,
  "CREATE TABLE opportunity_stall_reasons"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS strategy_trigger_runs (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    triggerType ENUM('morning','mission_completion','mission_skip','business_change','weekly_dawn') NOT NULL,
    businessDate VARCHAR(10) NOT NULL,
    dedupeKey VARCHAR(191) NOT NULL,
    snapshotId VARCHAR(64) NULL,
    outcome VARCHAR(64) NOT NULL DEFAULT 'success',
    detailJson JSON NOT NULL,
    errorMessage TEXT NULL,
    executedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_strategy_trigger_dedupe (tenantId, dedupeKey),
    KEY idx_strategy_trigger_tenant_type (tenantId, triggerType, executedAt)
  )`,
  "CREATE TABLE strategy_trigger_runs"
);
await runRequired(
  `CREATE TABLE IF NOT EXISTS recovery_items (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    commitmentRef VARCHAR(128) NOT NULL,
    playId VARCHAR(64) NULL,
    title VARCHAR(255) NOT NULL,
    state ENUM('visible','queued','repaired','rescheduled','dropped','archived_outstanding') NOT NULL DEFAULT 'queued',
    dropReason TEXT NULL,
    rescheduledToDate VARCHAR(10) NULL,
    missedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolvedAt TIMESTAMP NULL DEFAULT NULL,
    promotedVisibleAt TIMESTAMP NULL DEFAULT NULL,
    chronicleRef VARCHAR(128) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_recovery_items_tenant_state (tenantId, state),
    KEY idx_recovery_items_tenant_play (tenantId, playId)
  )`,
  "CREATE TABLE recovery_items"
);
await assertRequiredColumns("recovery_items", [
  "tenantId", "commitmentRef", "title", "state",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS drop_pattern_flags (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    patternType ENUM('play_cluster_drops','overall_drops_surge','repeated_reschedules','archived_backlog') NOT NULL,
    playId VARCHAR(64) NULL,
    windowDays INT NOT NULL DEFAULT 14,
    occurrenceCount INT NOT NULL DEFAULT 0,
    firstOccurrenceAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lastOccurrenceAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    surfacedAtDawn TINYINT(1) NOT NULL DEFAULT 0,
    dawnSummary TEXT NULL,
    acknowledgedAt TIMESTAMP NULL DEFAULT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_drop_pattern_tenant_type (tenantId, patternType, surfacedAtDawn)
  )`,
  "CREATE TABLE drop_pattern_flags"
);
await assertRequiredColumns("drop_pattern_flags", [
  "tenantId", "patternType", "occurrenceCount", "surfacedAtDawn",
]);

// ── Behavioral Ledger (Slice 1) ──────────────────────────────────
// See docs/goldline/BEHAVIORAL_SCIENCE_FOUNDATION.md. Mirrors
// drizzle/0087_behavioral_ledger.sql — keep both in sync; this file is
// what production actually runs (`node scripts/migrate.mjs`), the numbered
// drizzle/*.sql file alone is not.
//
// The eventType widening is `runRequired`, not `run()`: server/opsTasks.ts
// already writes "started" as of this slice, so a server that starts
// without this column change is a server that throws on every task-start
// transition. That must fail the deploy, not log a warning and continue.
await runRequired(
  `ALTER TABLE ops_task_events MODIFY COLUMN eventType ENUM(
    'created','viewed','accepted','started','completed','dismissed',
    'expired','agent_suggested','human_approved','revenue_recovered',
    'outcome_recorded'
  ) NOT NULL`,
  "ops_task_events: add started to eventType enum"
);
await assertEnumContainsValues("ops_task_events", "eventType", ["started"]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS behavioral_ledger_events (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    correlationId VARCHAR(128) NOT NULL,
    sourceSystem ENUM(
      'ops_task','strategy_path_offer','commercial_mission',
      'mission_director','campaign_run','first_mission'
    ) NOT NULL,
    sourceEntityType VARCHAR(96) NOT NULL,
    sourceEntityId VARCHAR(128) NOT NULL,
    eventType ENUM(
      'DELIVERED','VIEWABLE','ENGAGED','ACCEPTED','STARTED','COMPLETED',
      'VERIFIED','DEFERRED','DISMISSED','EXPIRED','SUPERSEDED','NOT_COMPLETED'
    ) NOT NULL,
    occurredAt TIMESTAMP NOT NULL,
    verificationClass ENUM('VERIFIED','ATTESTED','CLAIMED') NULL,
    provenance VARCHAR(191) NOT NULL,
    evidenceSource VARCHAR(191) NULL,
    decisionPointId VARCHAR(128) NULL,
    availability TINYINT(1) NULL,
    eligibleOptionsJson JSON NULL,
    assignedOption VARCHAR(128) NULL,
    assignmentProbability DECIMAL(6,5) NULL,
    interventionPolicyVersion INT NULL,
    interventionDefinitionVersion INT NULL,
    proximalOutcomeWindowMinutes INT NULL,
    idempotencyKey VARCHAR(191) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_behavioral_ledger_idempotency (tenantId, idempotencyKey),
    KEY idx_behavioral_ledger_tenant_operator (tenantId, operatorUserId),
    KEY idx_behavioral_ledger_correlation (tenantId, correlationId),
    KEY idx_behavioral_ledger_source (tenantId, sourceSystem, sourceEntityId),
    KEY idx_behavioral_ledger_decision_point (tenantId, decisionPointId)
  )`,
  "CREATE TABLE behavioral_ledger_events"
);
await assertRequiredColumns("behavioral_ledger_events", [
  "tenantId", "operatorUserId", "correlationId", "sourceSystem",
  "sourceEntityType", "sourceEntityId", "eventType", "occurredAt",
  "idempotencyKey",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS intervention_definitions (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    interventionKey VARCHAR(96) NOT NULL,
    version INT NOT NULL,
    framework VARCHAR(64) NULL,
    frameworkVersion VARCHAR(32) NULL,
    proposedConstructJson JSON NULL,
    bctAnnotationsJson JSON NULL,
    evidenceReferencesJson JSON NULL,
    annotationStatus ENUM('proposed','expert_reviewed','empirically_supported') NOT NULL DEFAULT 'proposed',
    reviewedBy VARCHAR(128) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_intervention_definitions_key_version (tenantId, interventionKey, version),
    KEY idx_intervention_definitions_tenant_key (tenantId, interventionKey)
  )`,
  "CREATE TABLE intervention_definitions"
);
await assertRequiredColumns("intervention_definitions", [
  "tenantId", "interventionKey", "version", "annotationStatus",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS spirit_human_rescue_missions (
    missionId VARCHAR(64) NOT NULL,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    snapshotCustomerId VARCHAR(64) NOT NULL,
    dormancyEpisodeKey VARCHAR(40) NOT NULL,
    villagerId VARCHAR(32) NOT NULL,
    lifecycle VARCHAR(32) NOT NULL,
    sendStatus VARCHAR(32) NOT NULL,
    missionJson JSON NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (missionId),
    KEY idx_shr_missions_tenant_operator (tenantId, operatorUserId),
    KEY idx_shr_missions_tenant_customer (tenantId, snapshotCustomerId),
    UNIQUE KEY uq_shr_missions_tenant_customer_episode (tenantId, snapshotCustomerId, dormancyEpisodeKey)
  )`,
  "CREATE TABLE spirit_human_rescue_missions"
);
await assertRequiredColumns("spirit_human_rescue_missions", [
  "missionId", "tenantId", "operatorUserId", "snapshotCustomerId",
  "dormancyEpisodeKey", "villagerId", "lifecycle", "sendStatus", "missionJson",
]);

// ── Narrator OS slices A–D ──────────────────────────────────────
// Mirrors drizzle/0090_narrator_os.sql. New tables (existing
// goldline_world_events / claire_personal_ledger / Brain WM cannot hold
// WORLD_TRUTH, lived bio, knowledge planes, and the authored event ledger
// without collapsing those separations). Seed is empty ledger + static
// authored catalogs at init time; this DDL does not backfill chats or CRM.
await runRequired(
  `CREATE TABLE IF NOT EXISTS narrator_os_operator (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    worldTruthJson JSON NOT NULL,
    livedBioJson JSON NOT NULL,
    narrativeStateJson JSON NOT NULL,
    worldTruthVersion VARCHAR(96) NOT NULL,
    livedBioVersion VARCHAR(96) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_narrator_os_operator (tenantId, operatorUserId)
  )`,
  "CREATE TABLE narrator_os_operator"
);
await assertRequiredColumns("narrator_os_operator", [
  "tenantId", "operatorUserId", "worldTruthJson", "livedBioJson",
  "narrativeStateJson", "worldTruthVersion", "livedBioVersion",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS narrator_os_knowledge (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    plane ENUM('PLAYER','CLAIRE','CHEMIST','OTHER') NOT NULL,
    factId VARCHAR(128) NOT NULL,
    factKind ENUM('EVENT_FACT','CHARACTER_INTERPRETATION') NOT NULL,
    known BOOLEAN NOT NULL,
    interpretationText TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_narrator_os_knowledge_fact (tenantId, operatorUserId, plane, factId),
    KEY idx_narrator_os_knowledge_operator (tenantId, operatorUserId, plane)
  )`,
  "CREATE TABLE narrator_os_knowledge"
);
await assertRequiredColumns("narrator_os_knowledge", [
  "tenantId", "operatorUserId", "plane", "factId", "factKind", "known",
]);

await runRequired(
  `CREATE TABLE IF NOT EXISTS narrator_os_event_ledger (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    kind ENUM('FIRED_AUTHORED_BEAT','VERIFIED_GOLDLINE_OUTCOME') NOT NULL,
    beatId VARCHAR(64) NULL,
    goldlineOutcomeId VARCHAR(128) NULL,
    offscreen BOOLEAN NOT NULL DEFAULT 0,
    playerVisible BOOLEAN NOT NULL DEFAULT 0,
    payloadJson JSON NOT NULL,
    occurredAt TIMESTAMP NOT NULL,
    idempotencyKey VARCHAR(191) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_narrator_os_ledger_idempotency (tenantId, idempotencyKey),
    KEY idx_narrator_os_ledger_operator (tenantId, operatorUserId, occurredAt)
  )`,
  "CREATE TABLE narrator_os_event_ledger"
);
await assertRequiredColumns("narrator_os_event_ledger", [
  "tenantId", "operatorUserId", "kind", "offscreen", "playerVisible",
  "payloadJson", "occurredAt", "idempotencyKey",
]);

// ── Narrator OS slice H ─────────────────────────────────────────
// Mirrors drizzle/0091_narrator_presentation_receipt.sql.
// Presentation receipts are not occurrence-ledger rows and not business truth.
await runRequired(
  `CREATE TABLE IF NOT EXISTS narrator_os_presentation_receipt (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    tenantId VARCHAR(64) NOT NULL,
    operatorUserId VARCHAR(128) NOT NULL,
    occurrenceLedgerEntryId VARCHAR(36) NOT NULL,
    beatId VARCHAR(64) NOT NULL,
    presentationId VARCHAR(96) NOT NULL,
    status ENUM('prepared','rendered_to_surface') NOT NULL,
    preparedAt TIMESTAMP NOT NULL,
    renderedAt TIMESTAMP NULL DEFAULT NULL,
    idempotencyKey VARCHAR(191) NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_narrator_os_presentation_occurrence (tenantId, operatorUserId, occurrenceLedgerEntryId),
    UNIQUE KEY uq_narrator_os_presentation_idempotency (tenantId, idempotencyKey),
    KEY idx_narrator_os_presentation_operator (tenantId, operatorUserId)
  )`,
  "CREATE TABLE narrator_os_presentation_receipt"
);
await assertRequiredColumns("narrator_os_presentation_receipt", [
  "tenantId", "operatorUserId", "occurrenceLedgerEntryId", "beatId",
  "presentationId", "status", "preparedAt", "idempotencyKey",
]);

await conn.end();
console.log("\nMigration complete.");
