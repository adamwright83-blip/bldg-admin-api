import {
  mysqlTable,
  varchar,
  json,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/mysql-core";
import type {
  IntakeOrder,
  IntakePlan,
  IntakePrepared,
  IntakeProduct,
  IntakeState,
} from "../../../../shared/cleancloudIntake";
export const intakeConnections = mysqlTable("cleancloud_intake_connections", {
  tenantId: varchar("tenantId", { length: 64 }).primaryKey(),
  bindingId: varchar("bindingId", { length: 36 }).notNull(),
  actorId: varchar("actorId", { length: 128 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  catalogJson: json("catalogJson").$type<IntakeProduct[]>().notNull(),
  capturedAt: timestamp("capturedAt"),
});
export const intakeOrders = mysqlTable(
  "cleancloud_intake_orders",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenantId", { length: 64 }).notNull(),
    bindingId: varchar("bindingId", { length: 36 }).notNull(),
    externalOrderId: varchar("externalOrderId", { length: 191 }).notNull(),
    sourceJson: json("sourceJson").$type<IntakeOrder>().notNull(),
    sourcePresent: boolean("sourcePresent").notNull().default(true),
    state: varchar("state", { length: 24 })
      .$type<IntakeState>()
      .notNull()
      .default("detail"),
    revision: varchar("revision", { length: 36 }),
    planJson: json("planJson").$type<IntakePlan>(),
    preparedJson: json("preparedJson").$type<IntakePrepared>(),
    preparedAt: timestamp("preparedAt"),
    approvedAt: timestamp("approvedAt"),
    submittedAt: timestamp("submittedAt"),
    resultJson: json("resultJson").$type<{
      stage: "cleaning";
      paymentStatus: "not_verified";
      observedAt: string;
    }>(),
    leaseToken: varchar("leaseToken", { length: 36 }),
    leaseUntil: timestamp("leaseUntil"),
    operation: varchar("operation", { length: 16 }).$type<
      "prepare" | "submit" | "verify"
    >(),
    focusRequested: boolean("focusRequested").notNull().default(false),
    lastError: varchar("lastError", { length: 512 }),
    observedAt: timestamp("observedAt").notNull(),
  },
  t => ({
    source: uniqueIndex("uq_cc_intake_source").on(
      t.tenantId,
      t.bindingId,
      t.externalOrderId
    ),
    queue: index("idx_cc_intake_queue").on(t.tenantId, t.state, t.leaseUntil),
  })
);
