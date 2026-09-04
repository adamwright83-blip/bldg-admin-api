import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import type { GoldlineOnboardingSession } from "../../shared/goldlineOnboarding";
export async function onboardingDb() { const db = await getDb(); if (!db) throw new Error("Database not available"); return db; }
export function resultRows(result: unknown): any[] { return (result as any)[0] ?? []; }
export async function readSession(tenantId: string): Promise<GoldlineOnboardingSession | null> {
 const db = await onboardingDb();
 const rows = resultRows(await db.execute(sql`SELECT payload FROM goldline_onboarding_sessions WHERE tenantId=${tenantId}`));
 if (!rows.length) return null;
 return typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
}
/**
 * Does this tenant already own a canonical Goldline world it must keep?
 *
 * Both signals are read independently. A table that does not exist in a given
 * environment is not evidence of a world, and it must not take the whole
 * onboarding down with it: this check previously threw straight out of the
 * state query, so a single missing table returned 500 for every tenant rather
 * than answering the question. A missing table is logged loudly and treated as
 * "this signal is unavailable", and the remaining signal still decides.
 */
export async function hasExistingWorld(tenantId: string) {
 const db = await onboardingDb();
 for (const table of ["physical_entities", "goldline_territory_definitions"]) {
  try {
   if (resultRows(await db.execute(sql`SELECT id FROM ${sql.raw(table)} WHERE tenantId=${tenantId} LIMIT 1`)).length) return true;
  } catch (error) {
   console.warn(`[GoldlineOnboarding] existing-world signal ${table} unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
 }
 return false;
}
export async function startSession(tenantId: string) {
 const existing = await readSession(tenantId); if (existing) return existing;
 if (await hasExistingWorld(tenantId)) throw new TRPCError({ code: "CONFLICT", message: "Existing Goldline world is preserved." });
 const session: GoldlineOnboardingSession = { id: randomUUID(), tenantId, status: "INTERVIEW", currentQuestion: 0, answers: [], interpretation: null, optionalUploadReference: null, startedAt: new Date().toISOString(), completedAt: null, version: 0, world: null, mission: null };
 const db = await onboardingDb();
 await db.execute(sql`INSERT IGNORE INTO goldline_onboarding_sessions (tenantId,id,version,payload) VALUES (${tenantId},${session.id},0,${JSON.stringify(session)})`);
 return (await readSession(tenantId))!;
}
export async function saveSession(session: GoldlineOnboardingSession, expectedVersion: number) {
 const db = await onboardingDb();
 const result: any = await db.execute(sql`UPDATE goldline_onboarding_sessions SET payload=${JSON.stringify(session)}, version=${session.version} WHERE tenantId=${session.tenantId} AND version=${expectedVersion}`);
 if (result[0].affectedRows !== 1) throw new TRPCError({ code: "CONFLICT", message: "Your world changed in another session. Reload to resume." });
 return session;
}
