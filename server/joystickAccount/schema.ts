import { index, int, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

/**
 * drizzle/0165_joystick_accounts.sql: a person who signed up with Google, before any workspace exists. Not a `users`
 * row (that is a workspace identity); its own session reaches only the person's own first-ten journeys.
 */
export const joystickAccounts = mysqlTable(
  "joystick_accounts",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    googleSub: varchar("google_sub", { length: 255 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 255 }),
    givenName: varchar("given_name", { length: 255 }),
    /** raised on sign-out: every cookie and journey token issued under an older version stops working */
    sessionVersion: int("session_version").notNull().default(1),
    /**
     * Which crew code admitted the account while JOYSTICK_FIRST_TEN_MINUTES is `preview` (previewPass.ts's code
     * version); its cookie then opens the preview on any device. A new code (or none) closes it, as it does every pass.
     */
    previewVersion: varchar("preview_version", { length: 32 }),
    signedUpAt: timestamp("signed_up_at", { fsp: 3 }).notNull(),
    lastSignedInAt: timestamp("last_signed_in_at", { fsp: 3 }),
    // the sign-up funnel, first time each happened: counts, never content
    googleConnectedAt: timestamp("google_connected_at", { fsp: 3 }),
    firstLinesAt: timestamp("first_lines_at", { fsp: 3 }),
    portraitKeptAt: timestamp("portrait_kept_at", { fsp: 3 }),
    activatedAt: timestamp("activated_at", { fsp: 3 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    googleSub: uniqueIndex("uq_joystick_accounts_google_sub").on(table.googleSub),
  })
);

/** Which first-ten journeys belong to which account (the acquisition session id is the journey's draft). */
export const joystickAccountJourneys = mysqlTable(
  "joystick_account_journeys",
  {
    journeyId: varchar("journey_id", { length: 36 }).primaryKey(),
    accountId: varchar("account_id", { length: 36 }).notNull(),
    acquisitionSessionId: varchar("acquisition_session_id", { length: 36 }).notNull(),
    createdAt: timestamp("created_at", { fsp: 3 }).notNull(),
  },
  table => ({
    account: index("idx_joystick_account_journeys_account").on(table.accountId, table.createdAt),
    session: index("idx_joystick_account_journeys_session").on(table.acquisitionSessionId),
  })
);

export type AccountRow = typeof joystickAccounts.$inferSelect;
export type FunnelStep = "googleConnectedAt" | "firstLinesAt" | "portraitKeptAt" | "activatedAt";
