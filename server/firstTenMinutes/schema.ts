import { boolean, int, json, mysqlTable, text, timestamp, uniqueIndex, index, varchar } from "drizzle-orm/mysql-core";
import type { ConnectionProvider, JourneyKind, JourneyStage } from "../../shared/firstTenMinutes";
import type {
  CompanionId,
  FindingKind,
  FindingPayload,
  FindingStatus,
  SourceRef,
  UnderstandingStage,
  UnderstandingView,
} from "../../shared/firstTenMinutesFindings";
import type { PortraitLine, PortraitStatus } from "../../shared/firstTenMinutesPortrait";
import type { DraftApproach, DraftStatus } from "../../shared/firstTenMinutesChapter";

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

/** drizzle/0153_first_ten_findings.sql: the crew's reading of a journey's sources (one per journey). */
export const firstTenReadings = mysqlTable("first_ten_readings", {
  journeyId: varchar("journey_id", { length: 36 }).primaryKey(),
  runId: varchar("run_id", { length: 36 }).notNull(),
  status: varchar("status", { length: 16 }).$type<"running" | "complete" | "failed">().notNull(),
  stage: varchar("stage", { length: 24 }).$type<UnderstandingStage | null>(),
  finishedJson: json("finished_json").$type<UnderstandingStage[]>(),
  countsJson: json("counts_json").$type<UnderstandingView["counts"]>(),
  notesJson: json("notes_json").$type<string[]>(),
  leaseUntil: timestamp("lease_until"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  finishedAt: timestamp("finished_at"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/** What the reading found, each with its sources. `origin_json` is server-only (where an image's bytes live). */
export const firstTenFindings = mysqlTable(
  "first_ten_findings",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    runId: varchar("run_id", { length: 36 }).notNull(),
    kind: varchar("kind", { length: 24 }).$type<FindingKind>().notNull(),
    companion: varchar("companion", { length: 16 }).$type<CompanionId | null>(),
    rank: int("rank").notNull().default(0),
    payloadJson: json("payload_json").$type<FindingPayload>().notNull(),
    sourcesJson: json("sources_json").$type<SourceRef[]>().notNull(),
    status: varchar("status", { length: 16 }).$type<FindingStatus>().notNull(),
    correctionText: text("correction_text"),
    originJson: json("origin_json").$type<FindingOrigin | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    journey: index("idx_first_ten_findings_journey").on(table.journeyId, table.kind),
  })
);

/** Where a finding's media can be fetched again, for the person who owns it. Never sent to a browser. */
export type FindingOrigin =
  | { provider: "gmail"; messageId: string; attachmentId: string }
  | { provider: "drive"; fileId: string }
  | { provider: "example"; asset: string };

/** drizzle/0154_first_ten_events.sql: what the person decided, append-only. */
export const firstTenEvents = mysqlTable(
  "first_ten_events",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    journeyId: varchar("journey_id", { length: 36 }).notNull(),
    kind: varchar("kind", { length: 48 }).notNull(),
    payloadJson: json("payload_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { fsp: 3 }).defaultNow().notNull(),
  },
  table => ({
    journey: index("idx_first_ten_events_journey").on(table.journeyId, table.createdAt),
  })
);

/**
 * drizzle/0155_first_ten_portraits.sql: Claire's portrait of the journey (one per journey). `basis` is what it was
 * written from; `edits_json` holds the person's own words in place of a line, keyed by the line.
 */
export const firstTenPortraits = mysqlTable("first_ten_portraits", {
  journeyId: varchar("journey_id", { length: 36 }).primaryKey(),
  runId: varchar("run_id", { length: 36 }).notNull(),
  status: varchar("status", { length: 16 }).$type<PortraitStatus>().notNull(),
  basis: varchar("basis", { length: 64 }).notNull(),
  portraitJson: json("portrait_json").$type<{ greeting: string; paragraphs: PortraitLine[][]; closing: PortraitLine | null } | null>(),
  editsJson: json("edits_json").$type<Record<string, { to: string | null; at: string }> | null>(),
  writtenBy: varchar("written_by", { length: 16 }),
  leaseUntil: timestamp("lease_until"),
  keptAt: timestamp("kept_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

/** drizzle/0156_first_ten_drafts.sql: the real message prepared at the writing table (one per journey). */
export const firstTenDrafts = mysqlTable("first_ten_drafts", {
  journeyId: varchar("journey_id", { length: 36 }).primaryKey(),
  opportunityId: varchar("opportunity_id", { length: 36 }).notNull(),
  recipientName: varchar("recipient_name", { length: 255 }),
  recipientAddress: varchar("recipient_address", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body").notNull(),
  approach: varchar("approach", { length: 32 }).$type<DraftApproach>().notNull(),
  edited: boolean("edited").notNull().default(false),
  status: varchar("status", { length: 24 }).$type<DraftStatus>().notNull(),
  handedOffAt: timestamp("handed_off_at"),
  reportedSentAt: timestamp("reported_sent_at"),
  verifiedSentAt: timestamp("verified_sent_at"),
  verifiedMessageId: varchar("verified_message_id", { length: 191 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});
