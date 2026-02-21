import { bigint, boolean, decimal, int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).default("default"),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Pickup orders table — shared between customer-facing site and admin/driver views.
 *
 * Status flow: new → collected → processing → ready → delivered
 */
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),

  /* Tenant */
  tenantId: varchar("tenantId", { length: 64 }).default("default"),

  /* Service info */
  serviceType: mysqlEnum("serviceType", ["wash_fold", "dry_cleaning"]).notNull(),

  /* Pickup schedule */
  pickupDate: varchar("pickupDate", { length: 20 }).notNull(),
  pickupTimeWindow: varchar("pickupTimeWindow", { length: 50 }).notNull(),

  /* Delivery schedule */
  deliveryDate: varchar("deliveryDate", { length: 20 }),
  deliveryTimeWindow: varchar("deliveryTimeWindow", { length: 50 }),

  /* Address */
  address: text("address").notNull(),
  unit: varchar("unit", { length: 50 }),
  specialInstructions: text("specialInstructions"),

  /* Customer contact */
  firstName: varchar("firstName", { length: 100 }).notNull(),
  lastName: varchar("lastName", { length: 100 }).notNull(),
  phone: varchar("phone", { length: 30 }).notNull(),
  email: varchar("email", { length: 320 }),
  bldgUserId: int("bldgUserId"), /* User ID from app.bldg.chat for chat notifications */

  /* Stripe — card saved on file */
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 255 }),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),

  /* Order status */
  status: mysqlEnum("status", ["new", "collected", "processing", "ready", "delivered"])
    .default("new")
    .notNull(),

  /* Intake: weights & counts */
  weightLbs: decimal("weightLbs", { precision: 8, scale: 2 }),
  bagCount: int("bagCount").default(1),
  garmentCount: int("garmentCount"),

  /* Pricing */
  subtotal: decimal("subtotal", { precision: 10, scale: 2 }).default("0"),
  discountPercent: decimal("discountPercent", { precision: 5, scale: 2 }).default("0"),
  total: decimal("total", { precision: 10, scale: 2 }).default("0"),

  /* Line-item detail (JSON) */
  upchargesJson: json("upchargesJson"),
  drycleanItemsJson: json("drycleanItemsJson"),

  /* Payment */
  paid: boolean("paid").default(false).notNull(),

  /* First-paid portal enrollment */
  isFirstPaidOrder: boolean("isFirstPaidOrder").default(false).notNull(),
  portalJwt: text("portalJwt"),

  /* Timestamps */
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;
