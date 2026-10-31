import { int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import type { GoogleCapabilityName, GoogleCapabilityStatus } from "../../shared/googleCapabilities";

/**
 * drizzle/0158_google_capability_evidence.sql: the newest real answer from each Google API JOYSTICK calls, kept
 * across restarts. In-process telemetry (googleTelemetry.ts) is lost on every deploy; this is what lets the admin
 * capabilities view still say when an API last worked, and when it last failed.
 */
export const googleCapabilityEvidence = mysqlTable("google_capability_evidence", {
  capability: varchar("capability", { length: 48 }).primaryKey(),
  lastStatus: varchar("last_status", { length: 32 }).$type<GoogleCapabilityStatus>().notNull(),
  lastCheckedAt: timestamp("last_checked_at").notNull(),
  lastSuccessAt: timestamp("last_success_at"),
  lastFailureAt: timestamp("last_failure_at"),
  lastError: varchar("last_error", { length: 300 }),
  lastLatencyMs: int("last_latency_ms"),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type CapabilityEvidence = {
  capability: GoogleCapabilityName;
  lastStatus: GoogleCapabilityStatus;
  lastCheckedAt: Date;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastError: string | null;
  lastLatencyMs: number | null;
};

/**
 * Records one real answer. A success moves last_success_at; anything else moves last_failure_at and keeps the error.
 * Never throws: evidence is diagnostics, and a diagnostics write must never break the call it describes.
 */
export async function recordCapabilityEvidence(event: {
  capability: GoogleCapabilityName;
  status: GoogleCapabilityStatus;
  success: boolean;
  at: Date;
  error: string | null;
  latencyMs: number;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db
      .insert(googleCapabilityEvidence)
      .values({
        capability: event.capability,
        lastStatus: event.status,
        lastCheckedAt: event.at,
        lastSuccessAt: event.success ? event.at : null,
        lastFailureAt: event.success ? null : event.at,
        lastError: event.success ? null : event.error,
        lastLatencyMs: event.latencyMs,
      })
      .onDuplicateKeyUpdate({
        set: {
          lastStatus: event.status,
          lastCheckedAt: event.at,
          lastLatencyMs: event.latencyMs,
          // a success keeps the last failure's error beside last_failure_at, so both stay readable
          ...(event.success ? { lastSuccessAt: event.at } : { lastFailureAt: event.at, lastError: event.error }),
        },
      });
  } catch (error) {
    console.warn("[GoogleCapabilityEvidence] could not record evidence:", error instanceof Error ? error.message : "unknown");
  }
}

/** Every capability's persisted evidence; empty when there is no database (then only this process's telemetry counts). */
export async function loadCapabilityEvidence(): Promise<Map<GoogleCapabilityName, CapabilityEvidence>> {
  try {
    const db = await getDb();
    if (!db) return new Map();
    const rows = await db.select().from(googleCapabilityEvidence);
    return new Map(
      rows.map(row => [
        row.capability as GoogleCapabilityName,
        {
          capability: row.capability as GoogleCapabilityName,
          lastStatus: row.lastStatus,
          lastCheckedAt: row.lastCheckedAt,
          lastSuccessAt: row.lastSuccessAt,
          lastFailureAt: row.lastFailureAt,
          lastError: row.lastError,
          lastLatencyMs: row.lastLatencyMs,
        },
      ])
    );
  } catch (error) {
    console.warn("[GoogleCapabilityEvidence] could not load evidence:", error instanceof Error ? error.message : "unknown");
    return new Map();
  }
}
