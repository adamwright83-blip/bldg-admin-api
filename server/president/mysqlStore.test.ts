import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { MysqlPresidentAssessmentStore } from "./mysqlStore";
import { MemoryPresidentAssessmentStore } from "./store";
import { inspectPresidentEvidence } from "./evidence";
import { assessPresidentStage1 } from "./assessment";

const root = resolve(import.meta.dirname, "../..");
let pool: Pool;

describe.skipIf(process.env.PRESIDENT_MYSQL_TEST !== "1")(
  "President real MySQL store",
  () => {
    beforeAll(async () => {
      // Dedicated loopback CI database; application DATABASE_URL is never consumed.
      const admin = await mysql.createConnection(
        "mysql://root:root@127.0.0.1:3411/"
      );
      const databaseName =
        "president_stage1_test_" + randomUUID().replaceAll("-", "");
      await admin.query(`CREATE DATABASE ${databaseName}`);
      await admin.end();
      pool = mysql.createPool({
        uri: "mysql://root:root@127.0.0.1:3411/" + databaseName,
        timezone: "Z",
        connectionLimit: 8,
      });
      const migration = await readFile(
        resolve(root, "drizzle/0109_president_stage1.sql"),
        "utf8"
      );
      for (const statement of migration
        .replace(/^\s*--.*$/gm, "")
        .split(";")
        .map(s => s.trim())
        .filter(Boolean))
        await pool.query(statement);
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("persists complete metadata/provenance and recovers across adapter instances and concurrent retries", async () => {
      const snapshot = await inspectPresidentEvidence({
        repositoryRoot: root,
        repositorySha: "38b20810be8575ef85fed60ba25e6c229bc10170",
      });
      const { assessment } = await assessPresidentStage1({
        snapshot,
        store: new MemoryPresidentAssessmentStore(),
        now: () => new Date("2026-10-02T12:00:00Z"),
      });
      const store = new MysqlPresidentAssessmentStore(pool);
      await Promise.all([
        store.saveIfAbsent(assessment),
        new MysqlPresidentAssessmentStore(pool).saveIfAbsent(assessment),
      ]);
      expect(await store.count()).toBe(1);
      expect(await store.candidateCount()).toBe(assessment.candidates.length);

      const recovered = await new MysqlPresidentAssessmentStore(
        pool
      ).findByEvidence(snapshot.repositorySha, snapshot.id);
      expect(recovered).toEqual(assessment);

      const retry = await assessPresidentStage1({
        snapshot,
        store: new MysqlPresidentAssessmentStore(pool),
      });
      expect(retry.reused).toBe(true);
      expect(retry.assessment.id).toBe(assessment.id);
      expect(await store.count()).toBe(1);
      expect(await store.candidateCount()).toBe(2);
    });

    it("rolls back the entire assessment when a candidate insert fails", async () => {
      const snapshot = await inspectPresidentEvidence({
        repositoryRoot: root,
        repositorySha: "38b20810be8575ef85fed60ba25e6c229bc10170",
        readSource: async path =>
          (await readFile(resolve(root, path), "utf8")) + "\nChanged fixture",
      });
      const { assessment } = await assessPresidentStage1({
        snapshot,
        store: new MemoryPresidentAssessmentStore(),
      });
      // Duplicate a candidate PK inside the transaction: no partial assessment/menu may survive.
      assessment.candidates.push({ ...assessment.candidates[0], rank: 3 });
      const store = new MysqlPresidentAssessmentStore(pool);
      await expect(store.saveIfAbsent(assessment)).rejects.toThrow(
        "did not persist"
      );
      expect(
        await store.findByEvidence(snapshot.repositorySha, snapshot.id)
      ).toBeNull();
      expect(await store.count()).toBe(1);
      expect(await store.candidateCount()).toBe(2);
      const [tables] = await pool.query<RowDataPacket[]>("SHOW TABLES");
      expect(tables).toHaveLength(2);
    });
  }
);
