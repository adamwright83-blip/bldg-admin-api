import { MySqlDialect } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ current: null as any }));
vi.mock("../../db", () => ({ getDb: async () => database.current }));

import { createDatabaseConversationStateStore } from "./conversationStateStore";

const owner = { tenantId: "tenant-a", operatorUserId: "operator-a", surface: "voice" as const };
const key = "call:recovery";
const dialect = new MySqlDialect();

/** Model MySQL row visibility and conditional affected-row counts at the SQL boundary. */
function mysqlFixture() {
  const rows = new Map<string, any>();
  const fixture = {
    rows,
    offline: false,
    assertAvailable() {
      if (fixture.offline) throw new Error("ECONNREFUSED");
    },
    select() {
      return { from: () => ({ where: (condition: any) => ({ limit: async () => {
        fixture.assertAvailable();
        const [id] = dialect.sqlToQuery(condition).params;
        const row = rows.get(String(id));
        return row ? [structuredClone(row)] : [];
      } }) }) };
    },
    insert() {
      return { values: (values: any) => {
        const execute = async (update?: any) => {
          fixture.assertAvailable();
          const existing = rows.get(values.id);
          if (existing && !update) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
          rows.set(values.id, structuredClone(existing ? { ...existing, ...update.set } : values));
          return [{ affectedRows: 1 }];
        };
        return {
          then: (resolve: any, reject: any) => execute().then(resolve, reject),
          onDuplicateKeyUpdate: (update: any) => execute(update),
        };
      } };
    },
    update() {
      return { set: (values: any) => ({ where: async (condition: any) => {
        fixture.assertAvailable();
        const [id, version] = dialect.sqlToQuery(condition).params;
        const existing = rows.get(String(id));
        if (!existing || existing.version !== version) return [{ affectedRows: 0 }];
        rows.set(String(id), structuredClone({ ...existing, ...values }));
        return [{ affectedRows: 1 }];
      } }) };
    },
    delete() {
      return { where: async (condition: any) => {
        fixture.assertAvailable();
        const [id, version] = dialect.sqlToQuery(condition).params;
        const existing = rows.get(String(id));
        if (!existing || (version !== undefined && existing.version !== version)) return [{ affectedRows: 0 }];
        rows.delete(String(id));
        return [{ affectedRows: 1 }];
      } };
    },
  };
  return fixture;
}

describe("conversation persistence across database transitions", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => { database.current = null; vi.restoreAllMocks(); });

  it("retains a successfully persisted active call if the database then becomes unreachable", async () => {
    const db = mysqlFixture();
    database.current = db;
    const store = createDatabaseConversationStateStore();
    await store.save(key, owner, { lastHeard: "plan Monday", pending: ["visit"] }, 60_000, 1_000);
    db.offline = true;
    const continued = await store.load<any>(key, 2_000);
    expect(continued?.state).toEqual({ lastHeard: "plan Monday", pending: ["visit"] });
    expect(continued?.version).toBe(1);
  });

  it("persists outage progress before serving recovered state and a new replica reads that progress", async () => {
    const db = mysqlFixture();
    database.current = db;
    const store = createDatabaseConversationStateStore();
    await store.save(key, owner, { phase: "proposal" }, 60_000, 1_000);
    db.offline = true;
    await store.save(key, owner, { phase: "approved", heard: "yes" }, 60_000, 2_000);
    db.offline = false;
    expect((await store.load<any>(key, 3_000))?.state).toEqual({ phase: "approved", heard: "yes" });
    expect((await createDatabaseConversationStateStore().load<any>(key, 3_000))?.state).toEqual({ phase: "approved", heard: "yes" });
  });

  it("does not resurrect a call removed while the database was unavailable", async () => {
    const db = mysqlFixture();
    database.current = db;
    const store = createDatabaseConversationStateStore();
    await store.save(key, owner, { phase: "active" }, 60_000, Date.now());
    db.offline = true;
    await store.remove(key);
    db.offline = false;
    expect(await store.load(key)).toBeNull();
    expect(await createDatabaseConversationStateStore().load(key)).toBeNull();
  });
});
