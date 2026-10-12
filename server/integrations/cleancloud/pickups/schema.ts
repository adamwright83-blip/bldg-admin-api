import {
  mysqlTable,
  varchar,
  timestamp,
  json,
  int,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import type {
  CleancloudPickupRow,
  PickupSyncState,
} from "../../../../shared/cleancloudPickup";

export const pickupConnections = mysqlTable("cleancloud_pickup_connections", {
  tenantId: varchar("tenantId", { length: 64 }).primaryKey(),
  bindingId: varchar("bindingId", { length: 36 }).notNull(),
  actorId: varchar("actorId", { length: 128 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  excludedOrderIds: json("excludedOrderIds").$type<string[]>().notNull(),
  capturedAt: timestamp("capturedAt"),
  lastError: varchar("lastError", { length: 512 }),
});
export const driverPickups = mysqlTable(
  "cleancloud_driver_pickups",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    bindingId: varchar("bindingId", { length: 36 }).notNull(),
    externalOrderId: varchar("externalOrderId", { length: 191 }).notNull(),
    externalOperationalOrderId: varchar("externalOperationalOrderId", {
      length: 36,
    }).notNull(),
    sourceJson: json("sourceJson").$type<CleancloudPickupRow>().notNull(),
    state: varchar("state", { length: 16 })
      .$type<PickupSyncState>()
      .notNull()
      .default("ready"),
    bagCount: int("bagCount"),
    garmentCount: int("garmentCount"),
    collectedBy: varchar("collectedBy", { length: 128 }),
    collectedAt: timestamp("collectedAt"),
    observedAt: timestamp("observedAt").notNull(),
    leaseToken: varchar("leaseToken", { length: 36 }),
    leaseUntil: timestamp("leaseUntil"),
    verifiedAt: timestamp("verifiedAt"),
    lastError: varchar("lastError", { length: 512 }),
  },
  table => ({
    source: uniqueIndex("uq_cc_driver_pickup_source").on(
      table.tenantId,
      table.bindingId,
      table.externalOrderId
    ),
    operational: uniqueIndex("uq_cc_driver_pickup_operational").on(
      table.externalOperationalOrderId
    ),
    queue: index("idx_cc_driver_pickup_queue").on(
      table.tenantId,
      table.state,
      table.leaseUntil
    ),
  })
);
