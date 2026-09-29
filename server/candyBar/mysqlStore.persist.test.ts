import { describe, expect, it } from "vitest";
import { MysqlCandyBarStore, CandyBarSchemaBlockedError } from "./mysqlStore";
import { CANDY_BAR_ALLOWED_REPOSITORY } from "../../shared/candyBar";

type Row = Record<string, unknown>;

/**
 * Pragmatic shared fake for upsertWorkflow + createRun + getRun.
 * Table identity is resolved via drizzle Symbol.for("drizzle:Name").
 * Where clauses are applied best-effort via column.name when present;
 * with a single row per table the persist-restart path stays correct.
 */
function tableNameOf(table: unknown): string {
  const sym = Symbol.for("drizzle:Name");
  if (table && typeof table === "object" && sym in (table as object)) {
    return String((table as Record<symbol, unknown>)[sym]);
  }
  const nested = table as { _: { name?: string } };
  if (nested?._?.name) return nested._.name;
  throw new Error("fake_db_unknown_table");
}

function columnName(col: unknown): string | null {
  if (col && typeof col === "object" && "name" in col) {
    return String((col as { name: string }).name);
  }
  return null;
}

/** Best-effort: walk drizzle SQL / eq trees for {name, value} pairs. */
function extractEqPairs(cond: unknown, out: Array<{ name: string; value: unknown }> = []) {
  if (!cond || typeof cond !== "object") return out;
  const c = cond as Record<string, unknown>;
  // Mock-style or simple descriptors
  if (c.type === "eq" && typeof c.column === "string") {
    out.push({ name: c.column, value: c.value });
    return out;
  }
  if (c.type === "and" && Array.isArray(c.conds)) {
    for (const inner of c.conds) extractEqPairs(inner, out);
    return out;
  }
  // Real drizzle: queryChunks / encoder internals vary; try common shapes
  if (Array.isArray(c.queryChunks)) {
    for (const chunk of c.queryChunks) extractEqPairs(chunk, out);
  }
  if (Array.isArray(c.conds)) {
    for (const inner of c.conds) extractEqPairs(inner, out);
  }
  // eq(column, value) often stores value in .value or as second queryChunk
  const name = columnName(c);
  if (name && "value" in c) {
    out.push({ name, value: c.value });
  }
  return out;
}

function rowMatches(row: Row, cond: unknown): boolean {
  const pairs = extractEqPairs(cond);
  if (pairs.length === 0) return true; // no parseable filters → accept (single-row tests)
  return pairs.every(p => row[p.name] === p.value);
}

function createSharedFakeDb() {
  const tables = new Map<string, Map<string, Row>>([
    ["candy_bar_workflows", new Map()],
    ["candy_bar_runs", new Map()],
    ["candy_bar_steps", new Map()],
    ["candy_bar_artifacts", new Map()],
    ["candy_bar_approvals", new Map()],
  ]);

  function storeFor(table: unknown): Map<string, Row> {
    const name = tableNameOf(table);
    const store = tables.get(name);
    if (!store) throw new Error(`fake_db_missing_map:${name}`);
    return store;
  }

  const db = {
    insert(table: unknown) {
      const store = storeFor(table);
      return {
        async values(values: Row) {
          const id = String(values.id);
          if (store.has(id)) {
            const err = Object.assign(new Error("Duplicate entry"), {
              code: "ER_DUP_ENTRY",
              errno: 1062,
            });
            throw err;
          }
          store.set(id, { ...values });
          return [{ insertId: id }];
        },
      };
    },
    select(_shape?: unknown) {
      let store: Map<string, Row> | null = null;
      let cond: unknown;
      let limitN: number | undefined;
      const builder: {
        from: (t: unknown) => typeof builder;
        where: (c: unknown) => typeof builder;
        orderBy: (...a: unknown[]) => typeof builder;
        limit: (n: number) => typeof builder;
        then: (
          resolve: (rows: Row[]) => unknown,
          reject?: (e: unknown) => unknown
        ) => Promise<unknown>;
      } = {
        from(t: unknown) {
          store = storeFor(t);
          return builder;
        },
        where(c: unknown) {
          cond = c;
          return builder;
        },
        orderBy() {
          return builder;
        },
        limit(n: number) {
          limitN = n;
          return builder;
        },
        then(resolve, reject) {
          try {
            if (!store) return Promise.resolve(resolve([]));
            let rows = [...store.values()].filter(r => rowMatches(r, cond));
            // Fallback for unparseable drizzle conditions: single-row tables still work
            if (rows.length === 0 && store.size > 0 && extractEqPairs(cond).length === 0) {
              rows = [...store.values()];
            }
            if (limitN != null) rows = rows.slice(0, limitN);
            return Promise.resolve(resolve(rows));
          } catch (e) {
            return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
          }
        },
      };
      return builder;
    },
    update(table: unknown) {
      const store = storeFor(table);
      let patch: Row = {};
      const builder = {
        set(values: Row) {
          patch = values;
          return builder;
        },
        async where(c: unknown) {
          let any = false;
          for (const [id, row] of store) {
            if (rowMatches(row, c) || extractEqPairs(c).length === 0) {
              store.set(id, { ...row, ...patch });
              any = true;
              // If we can't parse conditions, update first match only once for safety
              if (extractEqPairs(c).length === 0) break;
            }
          }
          return [{ affectedRows: any ? 1 : 0 }];
        },
      };
      return builder;
    },
  };

  return db;
}

describe("MysqlCandyBarStore persist", () => {
  it("persist-restart: create run → new store instance → run still exists", async () => {
    const sharedDb = createSharedFakeDb();
    const storeA = new MysqlCandyBarStore(() => Promise.resolve(sharedDb as never));
    const wf = await storeA.upsertWorkflow({
      tenantId: "t1",
      operatorUserId: "op1",
      repository: CANDY_BAR_ALLOWED_REPOSITORY,
      currentGoal: "ship mysql candy bar",
      actorUserId: "op1",
    });
    expect(wf.id).toBeTruthy();
    expect(wf.currentGoal).toBe("ship mysql candy bar");

    const run = await storeA.createRun({
      tenantId: "t1",
      operatorUserId: "op1",
      workflowId: wf.id,
    });
    expect(run.id).toBeTruthy();
    expect(run.goalSnapshot.currentGoal).toBe("ship mysql candy bar");

    const storeB = new MysqlCandyBarStore(() => Promise.resolve(sharedDb as never));
    const loaded = await storeB.getRun({ tenantId: "t1", id: run.id });
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(run.id);
    expect(loaded!.goalSnapshot.currentGoal).toBe("ship mysql candy bar");
    expect(loaded!.goalSnapshot.workflowId).toBe(wf.id);
  });

  it("fail-closed when getDb returns null", async () => {
    const store = new MysqlCandyBarStore(() => Promise.resolve(null));
    await expect(
      store.upsertWorkflow({
        tenantId: "t1",
        operatorUserId: "op1",
        currentGoal: "x",
        actorUserId: "op1",
      })
    ).rejects.toMatchObject({
      name: "CandyBarSchemaBlockedError",
      message: "Database not available",
    });
    await expect(
      store.createRun({
        tenantId: "t1",
        operatorUserId: "op1",
        workflowId: "missing",
      })
    ).rejects.toMatchObject({
      name: "CandyBarSchemaBlockedError",
      message: "Database not available",
    });
  });

  it("fail-closed on ER_NO_SUCH_TABLE", async () => {
    const missing = () => {
      const err = Object.assign(new Error("Table 'candy_bar_workflows' doesn't exist"), {
        code: "ER_NO_SUCH_TABLE",
        errno: 1146,
      });
      throw err;
    };
    const missingTableDb = {
      insert() {
        return { values: async () => missing() };
      },
      select() {
        const builder = {
          from: () => builder,
          where: () => builder,
          orderBy: () => builder,
          limit: () => builder,
          then(_resolve: unknown, reject?: (e: unknown) => unknown) {
            try {
              missing();
            } catch (e) {
              return reject ? Promise.resolve(reject(e)) : Promise.reject(e);
            }
            return Promise.resolve([]);
          },
        };
        return builder;
      },
      update() {
        return {
          set() {
            return { where: async () => missing() };
          },
        };
      },
    };

    const store = new MysqlCandyBarStore(() => Promise.resolve(missingTableDb as never));
    await expect(
      store.upsertWorkflow({
        tenantId: "t1",
        operatorUserId: "op1",
        currentGoal: "x",
        actorUserId: "op1",
      })
    ).rejects.toBeInstanceOf(CandyBarSchemaBlockedError);
    await expect(
      store.upsertWorkflow({
        tenantId: "t1",
        operatorUserId: "op1",
        currentGoal: "x",
        actorUserId: "op1",
      })
    ).rejects.toMatchObject({
      name: "CandyBarSchemaBlockedError",
      message: "candy_bar tables are not present",
    });
  });
});
