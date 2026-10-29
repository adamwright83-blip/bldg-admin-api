import { int, mysqlTable, text, timestamp, uniqueIndex, index, varchar } from "drizzle-orm/mysql-core";
import type { ConnectionProvider, JourneyKind, JourneyStage } from "../../shared/firstTenMinutes";

/** drizzle/0152_first_ten_journeys.sql, applied by scripts/migrate.mjs. */
export const firstTenJourneys = mysqlTable(
  "first_ten_journeys",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    /** the signup draft this journey belongs to (id on the legacy dayforge_saas_onboarding_sessions table) */
    acquisitionSessionId: varchar("acquisition_session_id", { length: 36 }).notNull(),
    /** set when the paid workspace is provisioned from the draft */
    tenantId: varchar("tenant_id", { length: 64 }),
    kind: varchar("kind", { length: 16 }).$type<JourneyKind>().notNull(),
    stage: varchar("stage", { length: 32 }).$type<JourneyStage>().notNull(),
    version: int("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    session: uniqueIndex("uq_first_ten_journeys_session").on(table.acquisitionSessionId),
    tenant: index("idx_first_ten_journeys_tenant").on(table.tenantId),
  })
);

export type ConnectionStatus = "connected" | "disconnected";

export const firstTenConnections = mysqlTable(
  "first_ten_connections",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    provider: varchar("provider", { length: 16 }).$type<ConnectionProvider>().notNull(),
    /** Google: the account's email. Slack: the workspace's name. */
    accountLabel: varchar("account_label", { length: 320 }),
    /** Google: the account's stable `sub`. Slack: the user id. */
    accountSubject: varchar("account_subject", { length: 191 }),
    /** space-separated, exactly as the provider granted them */
    grantedScopes: text("granted_scopes").notNull(),
    encryptedAccessToken: text("encrypted_access_token"),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    accessExpiresAt: timestamp("access_expires_at"),
    status: varchar("status", { length: 16 }).$type<ConnectionStatus>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    provider: uniqueIndex("uq_first_ten_connections_provider").on(table.journeyId, table.provider),
  })
);
