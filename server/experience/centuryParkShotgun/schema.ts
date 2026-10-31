import {
  index,
  json,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { ShotgunSubmission } from "../../../shared/centuryParkShotgun";

/** Kept independent of the shared schema file while its owners finish their PRs. */
export const centuryParkShots = mysqlTable(
  "century_park_shots",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    operatorId: varchar("operator_id", { length: 64 }).notNull(),
    requestId: varchar("request_id", { length: 36 }).notNull(),
    customerId: varchar("customer_id", { length: 128 }).notNull(),
    customerName: varchar("customer_name", { length: 255 }).notNull(),
    recipientPhone: varchar("recipient_phone", { length: 32 }).notNull(),
    lastOrderDate: varchar("last_order_date", { length: 40 }).notNull(),
    opportunityKey: varchar("opportunity_key", { length: 64 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    approval: json("approval_json").$type<ShotgunSubmission>().notNull(),
    policyVersion: varchar("policy_version", { length: 40 }).notNull(),
    approvedAt: timestamp("approved_at", { fsp: 3 }).notNull(),
    scheduledFor: timestamp("scheduled_for", { fsp: 3 }).notNull(),
    state: varchar("state", { length: 32 })
      .$type<"reserved" | "blocked_offer" | "saved" | "retryable_failure">()
      .notNull(),
    offerState: varchar("offer_state", { length: 32 })
      .$type<"not_applicable" | "blocked_integration">()
      .notNull(),
    messageId: varchar("message_id", { length: 64 }),
    failureReason: text("failure_reason"),
    updatedAt: timestamp("updated_at", { fsp: 3 }).notNull(),
  },
  t => ({
    request: uniqueIndex("uq_cpe_shot_request").on(t.tenantId, t.requestId),
    opportunity: uniqueIndex("uq_cpe_shot_opportunity").on(
      t.tenantId,
      t.customerId,
      t.opportunityKey
    ),
    timeline: index("idx_cpe_shot_timeline").on(t.tenantId, t.approvedAt),
  })
);
export type ShotRow = typeof centuryParkShots.$inferSelect;
