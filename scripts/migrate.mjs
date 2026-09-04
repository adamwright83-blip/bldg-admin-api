import mysql from "mysql2/promise";

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

await conn.end();
console.log("\nMigration complete.");
