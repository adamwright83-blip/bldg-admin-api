import mysql from "mysql2/promise";

const DB_URL = process.env.DATABASE_URL || "mysql://root:gKtLKCELwQeVyvbIpBQETwTMPnErVdjW@shortline.proxy.rlwy.net:36032/railway";

const conn = await mysql.createConnection(DB_URL);
console.log("Connected to Railway MySQL");

const run = async (sql, label) => {
  try {
    await conn.execute(sql);
    console.log("✓", label);
  } catch (e) {
    if (e.code === "ER_DUP_FIELDNAME" || e.code === "ER_TABLE_EXISTS_ERROR" || String(e.message).includes("Duplicate column")) {
      console.log("→ already exists, skipping:", label);
    } else {
      console.error("✗", label, e.message);
    }
  }
};

// ── users table ──────────────────────────────────────────────────
await run(`
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
`, "CREATE TABLE users");

await run(`ALTER TABLE users ADD COLUMN tenantId VARCHAR(64) DEFAULT 'default' AFTER id`, "users.tenantId");
await run(`ALTER TABLE users ADD COLUMN loginMethod VARCHAR(64) AFTER email`, "users.loginMethod");
await run(`ALTER TABLE users ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user' AFTER loginMethod`, "users.role");
await run(`ALTER TABLE users ADD COLUMN lastSignedIn TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER updatedAt`, "users.lastSignedIn");

// ── orders table ─────────────────────────────────────────────────
await run(`
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
`, "CREATE TABLE orders");

// Add any missing columns to existing orders table
const cols = [
  [`ALTER TABLE orders ADD COLUMN tenantId VARCHAR(64) DEFAULT 'default' AFTER id`, "orders.tenantId"],
  [`ALTER TABLE orders ADD COLUMN bldgUserId INT AFTER email`, "orders.bldgUserId"],
  [`ALTER TABLE orders ADD COLUMN stripePaymentIntentId VARCHAR(255) AFTER stripePaymentMethodId`, "orders.stripePaymentIntentId"],
  [`ALTER TABLE orders ADD COLUMN weightLbs DECIMAL(8,2) AFTER status`, "orders.weightLbs"],
  [`ALTER TABLE orders ADD COLUMN bagCount INT DEFAULT 1 AFTER weightLbs`, "orders.bagCount"],
  [`ALTER TABLE orders ADD COLUMN garmentCount INT AFTER bagCount`, "orders.garmentCount"],
  [`ALTER TABLE orders ADD COLUMN subtotal DECIMAL(10,2) DEFAULT 0 AFTER garmentCount`, "orders.subtotal"],
  [`ALTER TABLE orders ADD COLUMN discountPercent DECIMAL(5,2) DEFAULT 0 AFTER subtotal`, "orders.discountPercent"],
  [`ALTER TABLE orders ADD COLUMN total DECIMAL(10,2) DEFAULT 0 AFTER discountPercent`, "orders.total"],
  [`ALTER TABLE orders ADD COLUMN upchargesJson JSON AFTER total`, "orders.upchargesJson"],
  [`ALTER TABLE orders ADD COLUMN drycleanItemsJson JSON AFTER upchargesJson`, "orders.drycleanItemsJson"],
  [`ALTER TABLE orders ADD COLUMN paid BOOLEAN NOT NULL DEFAULT FALSE AFTER drycleanItemsJson`, "orders.paid"],
  [`ALTER TABLE orders ADD COLUMN isFirstPaidOrder BOOLEAN NOT NULL DEFAULT FALSE AFTER paid`, "orders.isFirstPaidOrder"],
  [`ALTER TABLE orders ADD COLUMN portalJwt TEXT AFTER isFirstPaidOrder`, "orders.portalJwt"],
  [`ALTER TABLE orders ADD COLUMN deliveryDate VARCHAR(20) AFTER pickupTimeWindow`, "orders.deliveryDate"],
  [`ALTER TABLE orders ADD COLUMN deliveryTimeWindow VARCHAR(50) AFTER deliveryDate`, "orders.deliveryTimeWindow"],
];

for (const [sql, label] of cols) {
  await run(sql, label);
}

await conn.end();
console.log("\nMigration complete.");
