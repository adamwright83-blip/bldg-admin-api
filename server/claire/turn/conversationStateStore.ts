import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import { int, json, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { getDb } from "../../db";
import { isMysqlDuplicateKeyError, isMysqlMissingTableError } from "../../mysqlErrors";

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

export type StoredConversationState<T> = ConversationStateOwner & {
  state: T;
  version: number;
  expiresAt: number;
  /** Memory continuity does not survive a process restart or another replica. */
  persistence?: "durable" | "memory";
};

export class ConversationStateConflictError extends Error {
  constructor(readonly key: string, readonly expectedVersion: number | null | undefined, readonly actualVersion: number | null) {
    super(`Conversation state changed concurrently: ${key}`);
    this.name = "ConversationStateConflictError";
  }
}

export class ConversationStatePersistenceUnavailableError extends Error {
  constructor() {
    super("Durable conversation state is unavailable; process memory cannot establish exclusive ownership");
    this.name = "ConversationStatePersistenceUnavailableError";
  }
}

export type ClaireConversationStateStore = {
  load<T>(key: string, now?: number): Promise<StoredConversationState<T> | null>;
  save<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, now?: number): Promise<void>;
  /** Use the version returned by load; null requires an absent row. A claim must require durability. */
  compareAndSave?<T>(
    key: string, owner: ConversationStateOwner, state: T, ttlMs: number,
    expectedVersion: number | null, now?: number, options?: { requireDurable?: boolean }
  ): Promise<StoredConversationState<T>>;
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
      return { ...structuredClone(row), persistence: "memory" } as StoredConversationState<T>;
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
    async compareAndSave<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, expectedVersion: number | null, now = Date.now(), options = {}) {
      if ((options as { requireDurable?: boolean }).requireDurable) throw new ConversationStatePersistenceUnavailableError();
      const previous = rows.get(key);
      const actualVersion = previous && previous.expiresAt > now ? previous.version : null;
      if (actualVersion !== expectedVersion) throw new ConversationStateConflictError(key, expectedVersion, actualVersion);
      const row = { ...owner, state: structuredClone(state), version: (actualVersion ?? 0) + 1, expiresAt: now + ttlMs, persistence: "memory" as const };
      rows.set(key, row);
      return structuredClone(row);
    },
  };
}

function isUnavailable(error: unknown): boolean {
  if (isMysqlMissingTableError(error)) return true;
  let candidate: unknown = error;
  for (let depth = 0; candidate && depth < 5; depth++) {
    if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|Database not available/i.test(String((candidate as Error)?.message ?? candidate))) return true;
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

export function createDatabaseConversationStateStore(
  fallback: ClaireConversationStateStore = createMemoryConversationStateStore()
): ClaireConversationStateStore {
  type Mirror = { row: StoredConversationState<unknown> | null; baseVersion: number | null | undefined; dirty: boolean; retainUntil: number };
  const mirrors = new Map<string, Mirror>();
  const locks = new Map<string, Promise<void>>();
  const tombstoneTtlMs = 24 * 60 * 60 * 1_000;
  let warned = false;
  const degrade = (error: unknown) => {
    if (!warned) {
      warned = true;
      console.error("[ClaireState] durable conversation state unavailable; using process memory", error instanceof Error ? error.message : error);
    }
  };

  // Serialize only this store's bookkeeping. Cross-replica exclusion is the
  // conditional database write, and requires the caller's loaded version.
  async function exclusive<T>(key: string, now: number, work: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => waiting);
    locks.set(key, tail);
    await previous;
    try {
      for (const [id, mirror] of mirrors) {
        if (mirror.retainUntil <= now && id !== key) {
          mirrors.delete(id);
          await fallback.remove(id);
        }
      }
      return await work();
    } finally {
      release();
      if (locks.get(key) === tail) locks.delete(key);
    }
  }

  async function database() {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db;
  }

  async function read(db: Awaited<ReturnType<typeof database>>, key: string): Promise<StoredConversationState<unknown> | null> {
    const [row] = await db.select().from(claireConversationStates).where(eq(claireConversationStates.id, key)).limit(1);
    return row ? {
      tenantId: row.tenantId, operatorUserId: row.operatorUserId,
      surface: row.surface === "text" ? "text" : "voice",
      state: typeof row.stateJson === "string" ? JSON.parse(row.stateJson) : row.stateJson,
      version: row.version, expiresAt: row.expiresAt.getTime(), persistence: "durable",
    } : null;
  }

  async function remember(key: string, row: StoredConversationState<unknown> | null, baseVersion: number | null | undefined, dirty: boolean, now: number) {
    if (row) await fallback.save(key, row, row.state, row.expiresAt - now, now);
    else await fallback.remove(key);
    mirrors.set(key, {
      row: structuredClone(row), baseVersion, dirty,
      retainUntil: (row?.expiresAt ?? now) + (dirty ? tombstoneTtlMs : row ? 0 : tombstoneTtlMs),
    });
  }

  async function memory<T>(key: string, now: number): Promise<StoredConversationState<T> | null> {
    const mirror = mirrors.get(key);
    const row = mirror ? mirror.row : await fallback.load<T>(key, now);
    return row && row.expiresAt > now ? { ...structuredClone(row), persistence: "memory" } as StoredConversationState<T> : null;
  }

  function affected(result: unknown): number {
    return Number((Array.isArray(result) ? result[0] : result as any)?.affectedRows ?? 0);
  }

  async function write(db: Awaited<ReturnType<typeof database>>, key: string, row: StoredConversationState<unknown>, expected: number | null) {
    const values = {
      tenantId: row.tenantId, operatorUserId: row.operatorUserId, surface: row.surface,
      stateJson: row.state, version: row.version, expiresAt: new Date(row.expiresAt),
    };
    if (expected === null) {
      try { await db.insert(claireConversationStates).values({ id: key, ...values }); }
      catch (error) {
        if (!isMysqlDuplicateKeyError(error)) throw error;
        throw new ConversationStateConflictError(key, expected, (await read(db, key))?.version ?? null);
      }
    } else {
      const result = await db.update(claireConversationStates).set(values).where(and(eq(claireConversationStates.id, key), eq(claireConversationStates.version, expected)));
      if (affected(result) !== 1) throw new ConversationStateConflictError(key, expected, (await read(db, key))?.version ?? null);
    }
  }

  async function erase(db: Awaited<ReturnType<typeof database>>, key: string, version: number) {
    const result = await db.delete(claireConversationStates).where(and(eq(claireConversationStates.id, key), eq(claireConversationStates.version, version)));
    if (affected(result) !== 1) throw new ConversationStateConflictError(key, version, (await read(db, key))?.version ?? null);
  }

  async function current(db: Awaited<ReturnType<typeof database>>, key: string, now: number) {
    let row = await read(db, key);
    const mirror = mirrors.get(key);
    if (mirror?.dirty) {
      const desired = mirror.row && mirror.row.expiresAt > now ? mirror.row : null;
      // A connection can fail after MySQL commits. Recognize that exact write
      // on recovery rather than applying it a second time.
      const alreadyApplied = desired && row && row.version === desired.version && row.expiresAt === desired.expiresAt
        && row.tenantId === desired.tenantId && row.operatorUserId === desired.operatorUserId
        && row.surface === desired.surface && isDeepStrictEqual(row.state, desired.state);
      if (!alreadyApplied) {
        const actual = row?.version ?? null;
        if ((mirror.baseVersion === undefined && row) || (mirror.baseVersion !== undefined && actual !== mirror.baseVersion)) {
          await remember(key, row, actual, false, now);
          throw new ConversationStateConflictError(key, mirror.baseVersion, actual);
        }
        if (desired) {
          await write(db, key, desired, mirror.baseVersion ?? null);
          row = { ...desired, persistence: "durable" as const };
        } else {
          if (row) await erase(db, key, row.version);
          row = null;
        }
      }
    }
    if (row && row.expiresAt <= now) {
      await erase(db, key, row.version);
      row = null;
    }
    await remember(key, row, row?.version ?? null, false, now);
    return row;
  }

  async function save<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, now: number, expectedVersion?: number | null, requireDurable = false): Promise<StoredConversationState<T>> {
    const observed = mirrors.get(key);
    const observedVersion = observed ? observed.row && observed.row.expiresAt > now ? observed.row.version : null : undefined;
    const payload = JSON.parse(JSON.stringify(state)) as T;
    // The SQL timestamp has whole-second precision. Keep the mirror identical
    // to its canonical row so an uncertain acknowledgement can be reconciled.
    const expiresAt = Math.ceil((now + ttlMs) / 1_000) * 1_000;
    try {
      const db = await database();
      const previous = await current(db, key, now);
      const expected = expectedVersion !== undefined ? expectedVersion : observedVersion !== undefined ? observedVersion : previous?.version ?? null;
      if (expected !== (previous?.version ?? null)) throw new ConversationStateConflictError(key, expected, previous?.version ?? null);
      const row = { ...owner, state: payload, version: (expected ?? 0) + 1, expiresAt, persistence: "durable" as const };
      await write(db, key, row, expected);
      await remember(key, row, row.version, false, now);
      return structuredClone(row);
    } catch (error) {
      if (!isUnavailable(error)) throw error;
      degrade(error);
      if (requireDurable) throw new ConversationStatePersistenceUnavailableError();
      const previous = await memory<T>(key, now);
      const actual = previous?.version ?? null;
      if (expectedVersion !== undefined && expectedVersion !== actual) throw new ConversationStateConflictError(key, expectedVersion, actual);
      const row = { ...owner, state: payload, version: (actual ?? 0) + 1, expiresAt, persistence: "memory" as const };
      const known = mirrors.get(key);
      await remember(key, row, known?.baseVersion, true, now);
      return structuredClone(row);
    }
  }

  return {
    load<T>(key: string, now = Date.now()) {
      return exclusive(key, now, async () => {
        try { return await current(await database(), key, now) as StoredConversationState<T> | null; }
        catch (error) {
          if (!isUnavailable(error)) throw error;
          degrade(error);
          return memory<T>(key, now);
        }
      });
    },
    async save<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, now = Date.now()) {
      await exclusive(key, now, () => save(key, owner, state, ttlMs, now));
    },
    compareAndSave<T>(key: string, owner: ConversationStateOwner, state: T, ttlMs: number, expectedVersion: number | null, now = Date.now(), options = {}) {
      return exclusive(key, now, () => save(key, owner, state, ttlMs, now, expectedVersion, (options as { requireDurable?: boolean }).requireDurable));
    },
    remove(key: string) {
      const now = Date.now();
      return exclusive(key, now, async () => {
        try {
          const db = await database();
          const row = await current(db, key, now);
          if (row) await erase(db, key, row.version);
          await remember(key, null, null, false, now);
        } catch (error) {
          if (!isUnavailable(error)) throw error;
          degrade(error);
          await remember(key, null, mirrors.get(key)?.baseVersion, true, now);
        }
      });
    },
  };
}

let productionStore: ClaireConversationStateStore | null = null;

/**
 * Whether the Claire-owned database handle is present.
 * Callers outside this store ask here instead of opening the database themselves.
 */
export async function claireOwnedDatabasePresent(): Promise<boolean> {
  const db = await getDb();
  return db != null;
}

export function claireConversationStateStore(): ClaireConversationStateStore {
  productionStore ??= createDatabaseConversationStateStore();
  return productionStore;
}

/** Tests only. */
export function setClaireConversationStateStoreForTests(store: ClaireConversationStateStore | null): void {
  productionStore = store;
}
