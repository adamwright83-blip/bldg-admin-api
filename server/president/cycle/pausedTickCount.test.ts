import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pool, RowDataPacket } from "mysql2/promise";
import { MysqlCycleStore } from "./cycleStore";

describe("paused president worker tick", () => {
  it("counts open cycles in SQL and does not read payloadJson", async () => {
    const sql: string[] = [];
    const pool = {
      execute: async (statement: string, params: unknown[]) => {
        sql.push(statement);
        expect(params).toEqual(["COMPLETE", "NO_APPROVAL"]);
        return [[{ waiting: 4 }] as RowDataPacket[]];
      },
      query: async () => {
        throw new Error("paused count must not query payload rows");
      },
    };
    const store = new MysqlCycleStore(pool as unknown as Pool);
    await expect(store.countExcludingStatuses(["COMPLETE", "NO_APPROVAL"])).resolves.toBe(4);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/COUNT\(\*\)/);
    expect(sql[0]).not.toMatch(/payloadJson/);
    expect(sql[0]).not.toMatch(/SELECT cycleId/);
  });

  it("the paused tick counts instead of listing payloads and does not enable model calls", () => {
    const source = readFileSync(new URL("./runtime.ts", import.meta.url), "utf8");
    const paused = source.slice(
      source.indexOf("if (!presidentWorkerModelCallsEnabled())"),
      source.indexOf("await ensureScheduledPresidentCycle")
    );
    expect(paused).toContain("countExcludingStatuses");
    expect(paused).not.toContain(".list(");
    expect(paused).not.toContain('PRESIDENT_WORKER_MODEL_CALLS_ENABLED = "1"');
    expect(source).toContain('return env.PRESIDENT_WORKER_MODEL_CALLS_ENABLED === "1"');
  });
});
