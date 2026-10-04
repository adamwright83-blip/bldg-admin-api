import mysql, { type Pool } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  MysqlPresidentIntelligenceStore,
  evidenceHash,
} from "./intelligenceStore";
import { type CompanyEvidence } from "../../shared/presidentIntelligence";
let pool: Pool;
describe.skipIf(process.env.PRESIDENT_MYSQL_TEST !== "1")(
  "President intelligence real MySQL",
  () => {
    beforeAll(async () => {
      const admin = await mysql.createConnection(
        "mysql://root:root@127.0.0.1:3411/"
      );
      await admin.query(
        "CREATE DATABASE IF NOT EXISTS president_intelligence_store_test"
      );
      await admin.end();
      pool = mysql.createPool({
        uri: "mysql://root:root@127.0.0.1:3411/president_intelligence_store_test",
        timezone: "Z",
        connectionLimit: 8,
      });
      const sql = await readFile(
        resolve(
          import.meta.dirname,
          "../../drizzle/0113_president_intelligence.sql"
        ),
        "utf8"
      );
      for (const s of sql
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map(x => x.trim())
        .filter(Boolean))
        await pool.query(s);
    });
    afterAll(async () => {
      await pool?.end();
    });
    const evidence = (id: string): CompanyEvidence => ({
      id,
      source: "test:declared-fixture",
      capturedAt: "2026-10-04T17:00:00.000Z",
      sourceAt: null,
      statement: "A explicitly labeled test observation",
      sha256: evidenceHash("A explicitly labeled test observation"),
      kind: "FACT",
      confidence: 1,
      availability: "AVAILABLE",
      origin: "TEST_FIXTURE",
      expiresAt: null,
    });
    it("roundtrips immutable evidence and rejects conflicting rewrites", async () => {
      const s = new MysqlPresidentIntelligenceStore(pool, "TEST_FIXTURE");
      const e = evidence("fixture-immutable");
      expect(await s.putEvidence(e)).toEqual(e);
      expect(await s.putEvidence(e)).toEqual(e);
      await expect(
        s.putEvidence({
          ...e,
          statement: "changed",
          sha256: evidenceHash("changed"),
        })
      ).rejects.toThrow("identity conflict");
      expect((await s.evidence([e.id]))[0]).toEqual(e);
    });
    it("prevents truncation of long evidence IDs", async () => {
      const s = new MysqlPresidentIntelligenceStore(pool, "TEST_FIXTURE");
      await expect(s.putEvidence(evidence("x".repeat(65)))).rejects.toThrow();
    });
    it("fixture evidence cannot enter the real ledger", async () => {
      const s = new MysqlPresidentIntelligenceStore(pool);
      await expect(s.putEvidence(evidence("fixture-cross"))).rejects.toThrow(
        "origin/hash"
      );
      expect(await s.evidence(["fixture-immutable"])).toEqual([]);
    });
    it("retains old reasons through revisions and recovers retries", async () => {
      const s = new MysqlPresidentIntelligenceStore(pool, "TEST_FIXTURE");
      await s.putEvidence(evidence("fixture-memory"));
      const key = "memory-" + Date.now();
      const firstInput = {
        kind: "DECISION" as const,
        key,
        evidenceIds: ["fixture-memory"],
        payload: { decision: "Stop X", reason: "Unproven outcome" },
        expectedVersion: 0,
        idempotencyKey: key + ":v1",
      };
      const first = await s.append(firstInput);
      const second = await s.append({
        ...firstInput,
        expectedVersion: 1,
        idempotencyKey: key + ":v2",
        payload: {
          decision: "Reconsider X",
          reason: "New evidence, not rewritten history",
        },
      });
      expect(second.supersedesId).toBe(first.id);
      const recovered = new MysqlPresidentIntelligenceStore(
        pool,
        "TEST_FIXTURE"
      );
      expect((await recovered.append(firstInput)).id).toBe(first.id);
      expect((await recovered.current("DECISION", key))?.id).toBe(second.id);
      await expect(
        s.append({ ...firstInput, payload: { decision: "rewrite" } })
      ).rejects.toThrow("different request");
    });
    it("rejects unsupported provenance", async () => {
      const s = new MysqlPresidentIntelligenceStore(pool, "TEST_FIXTURE");
      await expect(
        s.append({
          kind: "STRATEGY",
          key: "unsupported",
          payload: {},
          evidenceIds: ["missing"],
          expectedVersion: 0,
          idempotencyKey: "unsupported",
        })
      ).rejects.toThrow("Evidence missing");
    });
  }
);
