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
export async function hasExistingWorld(tenantId: string) {
 const db = await onboardingDb();
 const rows = resultRows(await db.execute(sql`SELECT id FROM physical_entities WHERE tenantId=${tenantId} LIMIT 1`));
 if (rows.length) return true;
 return resultRows(await db.execute(sql`SELECT id FROM goldline_territory_definitions WHERE tenantId=${tenantId} LIMIT 1`)).length > 0;
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
