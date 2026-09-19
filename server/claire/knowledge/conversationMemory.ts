import { and, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { claireConversationSessions, claireConversationTurns } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { isAuthoritativeOperatorTurn } from "../conversation/speechDelivery";

/**
 * What Adam and Claire actually said on past calls, from the conversation
 * ledger. A quote proves "Adam said X" — it never proves X happened.
 */

export type RememberedTurn = {
  sessionId: string;
  at: string;
  speaker: "OPERATOR" | "CLAIRE";
  text: string;
};

export async function searchOperatorConversation(input: {
  tenantId: string;
  operatorUserId: string;
  terms: string[];
  speaker?: "OPERATOR" | "CLAIRE" | null;
  limit?: number;
  excludeSessionId?: string | null;
}): Promise<RememberedTurn[]> {
  const terms = input.terms.map(term => term.trim().toLowerCase()).filter(term => term.length >= 3);
  if (!terms.length) return [];
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      sessionId: claireConversationTurns.sessionId,
      at: claireConversationTurns.occurredAt,
      speaker: claireConversationTurns.speaker,
      text: claireConversationTurns.text,
      providerMetadata: claireConversationTurns.providerMetadataJson,
    })
    .from(claireConversationTurns)
    .innerJoin(claireConversationSessions, eq(claireConversationSessions.id, claireConversationTurns.sessionId))
    .where(
      and(
        eq(claireConversationSessions.tenantId, input.tenantId),
        eq(claireConversationSessions.operatorUserId, input.operatorUserId),
        input.speaker ? eq(claireConversationTurns.speaker, input.speaker) : sql`1 = 1`,
        or(...terms.map(term => sql`LOWER(${claireConversationTurns.text}) LIKE ${`%${term}%`}`))
      )
    )
    .orderBy(desc(claireConversationTurns.occurredAt))
    .limit(Math.min(input.limit ?? 6, 20));
  return rows
    .filter(row => row.sessionId !== input.excludeSessionId)
    .filter(row => row.speaker !== "OPERATOR" || isAuthoritativeOperatorTurn(row.providerMetadata as Record<string, unknown> | null))
    .map(row => ({
      sessionId: row.sessionId,
      at: row.at.toISOString(),
      speaker: row.speaker === "CLAIRE" ? "CLAIRE" : "OPERATOR",
      text: row.text,
    }));
}

export async function operatorTurnsBetween(input: {
  tenantId: string;
  operatorUserId: string;
  startUtc: Date;
  endExclusiveUtc: Date;
  limit?: number;
}): Promise<RememberedTurn[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select({
      sessionId: claireConversationTurns.sessionId,
      at: claireConversationTurns.occurredAt,
      speaker: claireConversationTurns.speaker,
      text: claireConversationTurns.text,
      providerMetadata: claireConversationTurns.providerMetadataJson,
    })
    .from(claireConversationTurns)
    .innerJoin(claireConversationSessions, eq(claireConversationSessions.id, claireConversationTurns.sessionId))
    .where(
      and(
        eq(claireConversationSessions.tenantId, input.tenantId),
        eq(claireConversationSessions.operatorUserId, input.operatorUserId),
        eq(claireConversationTurns.speaker, "OPERATOR"),
        gte(claireConversationTurns.occurredAt, input.startUtc),
        lt(claireConversationTurns.occurredAt, input.endExclusiveUtc)
      )
    )
    .orderBy(desc(claireConversationTurns.occurredAt))
    .limit(Math.min(input.limit ?? 20, 60));
  return rows
    .filter(row => isAuthoritativeOperatorTurn(row.providerMetadata as Record<string, unknown> | null))
    .map(row => ({ sessionId: row.sessionId, at: row.at.toISOString(), speaker: "OPERATOR" as const, text: row.text }));
}

/** Operator turns long enough to carry meaning (not "yes", "hello"). */
export function substantiveTurns(turns: RememberedTurn[]): RememberedTurn[] {
  return turns.filter(turn => turn.speaker === "OPERATOR" && turn.text.split(/\s+/).filter(Boolean).length >= 5);
}
