import { and, eq, lt } from "drizzle-orm";
import { int, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { getDb } from "../../db";
import { isMysqlMissingTableError } from "../../mysqlErrors";

/**
 * Durable working state for a Claire conversation (a phone call or a desk
 * thread): pending confirmations, a pending briefing, the analytical thread,
 * and the last turns. It is conversation state, never business truth.
 *
 * Previously this lived in process-local Maps, so a deploy, restart, or a
 * webhook landing on another replica made Claire hang up with "I lost the
 * current brief". The database is the primary store; process memory is only a
 * degraded fallback when the database is unreachable, and says so in logs.
 */

export const claireConversationStates = mysqlTable("claire_conversation_states", {
  id: varchar("id", { length: 191 }).primaryKey(),
  tenantId: varchar("tenantId", { length: 64 }).notNull(),
  operatorUserId: varchar("operatorUserId", { length: 128 }).notNull(),
  surface: varchar("surface", { length: 16 }).notNull(),
  stateJson: json("stateJson").notNull(),
  version: int("version").notNull().default(1),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ConversationStateOwner = {
  tenantId: string;
  operatorUserId: string;
  surface: "voice" | "text";
};

export type StoredConversationState<T> = ConversationStateOwner & { state: T; version: number; expiresAt: number };

export type ClaireConversationStateStore = {
  load<T>(key: string, now?: number): Promise<StoredConversationState<T> | null>;
  save<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, now?: number): Promise<void>;
  remove(key: string): Promise<void>;
};

export function createMemoryConversationStateStore(): ClaireConversationStateStore {
  const rows = new Map<string, StoredConversationState<unknown>>();
  return {
    async load<T>(key: string, now = Date.now()) {
      const row = rows.get(key);
      if (!row) return null;
      if (row.expiresAt <= now) {
        rows.delete(key);
        return null;
      }
      return structuredClone(row) as StoredConversationState<T>;
    },
    async save<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, now = Date.now()) {
      const previous = rows.get(key);
      rows.set(key, {
        ...owner,
        state: structuredClone(state),
        version: (previous?.version ?? 0) + 1,
        expiresAt: now + ttlMs,
      });
    },
    async remove(key: string) {
      rows.delete(key);
    },
  };
}

function isUnavailable(error: unknown): boolean {
  return isMysqlMissingTableError(error) || /ECONNREFUSED|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|Database not available/i.test(String((error as Error)?.message ?? error));
}

export function createDatabaseConversationStateStore(
  fallback: ClaireConversationStateStore = createMemoryConversationStateStore()
): ClaireConversationStateStore {
  let warned = false;
  const degrade = (error: unknown) => {
    if (!warned) {
      warned = true;
      console.error("[ClaireState] durable conversation state unavailable; using process memory", error instanceof Error ? error.message : error);
    }
  };
  return {
    async load<T>(key: string, now = Date.now()) {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [row] = await db.select().from(claireConversationStates).where(eq(claireConversationStates.id, key)).limit(1);
        if (!row) return fallback.load<T>(key, now);
        if (row.expiresAt.getTime() <= now) {
          await db.delete(claireConversationStates).where(eq(claireConversationStates.id, key));
          return null;
        }
        const state = typeof row.stateJson === "string" ? JSON.parse(row.stateJson) : row.stateJson;
        return {
          tenantId: row.tenantId,
          operatorUserId: row.operatorUserId,
          surface: row.surface === "text" ? "text" : "voice",
          state: state as T,
          version: row.version,
          expiresAt: row.expiresAt.getTime(),
        };
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        degrade(error);
        return fallback.load<T>(key, now);
      }
    },
    async save<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, now = Date.now()) {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const expiresAt = new Date(now + ttlMs);
        const payload = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
        await db
          .insert(claireConversationStates)
          .values({ id: key, ...owner, stateJson: payload, version: 1, expiresAt })
          .onDuplicateKeyUpdate({
            set: {
              stateJson: payload,
              expiresAt,
              version: (await currentVersion(key)) + 1,
            },
          });
        // Opportunistic cleanup of long-expired conversations.
        if (Math.random() < 0.02) {
          await db.delete(claireConversationStates).where(lt(claireConversationStates.expiresAt, new Date(now)));
        }
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        degrade(error);
        await fallback.save(key, owner, state, ttlMs, now);
      }
    },
    async remove(key: string) {
      try {
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.delete(claireConversationStates).where(and(eq(claireConversationStates.id, key)));
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        degrade(error);
      }
      await fallback.remove(key);
    },
  };

  async function currentVersion(key: string): Promise<number> {
    const db = await getDb();
    if (!db) return 0;
    const [row] = await db
      .select({ version: claireConversationStates.version })
      .from(claireConversationStates)
      .where(eq(claireConversationStates.id, key))
      .limit(1);
    return row?.version ?? 0;
  }
}

let productionStore: ClaireConversationStateStore | null = null;

export function claireConversationStateStore(): ClaireConversationStateStore {
  productionStore ??= createDatabaseConversationStateStore();
  return productionStore;
}

/** Tests only. */
export function setClaireConversationStateStoreForTests(store: ClaireConversationStateStore | null): void {
  productionStore = store;
}
