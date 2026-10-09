import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import mysql, { type Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { mysqlTable, varchar } from "drizzle-orm/mysql-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { InsertCleancloudPaidOrder } from "../../../../drizzle/schema";
import { getDb, resetDbForTesting, setDbForTesting } from "../../../db";
import { appendGoldlineWorldEvent } from "../../../experience/goldline/world/worldEventStore";
import {
  claimNextEconomicOutbox,
  drainEconomicOutbox,
  economicHeads,
  economicOutbox,
  economicSnapshot,
  enqueueEconomicSnapshot,
} from "./worldOutbox";

const DATABASE_URL = process.env.DATABASE_URL;
let admin: mysql.Connection;
let pool: Pool;
let databaseName = "";

const testDomainCommits = mysqlTable("program_a_slice2_domain_commits", {
  id: varchar("id", { length: 64 }).primaryKey(),
});

async function applySqlFile(relativePath: string) {
  const sql = await readFile(new URL(relativePath, import.meta.url), "utf8");
  for (const statement of sql
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map(value => value.trim())
    .filter(Boolean)) {
    await pool.query(statement);
  }
}

function paidRow(
  overrides: Partial<InsertCleancloudPaidOrder> = {}
): InsertCleancloudPaidOrder {
  return {
    tenantId: "tenant-a",
    sourceReportType: "orders_sales",
    sourceFileName: "browser.csv",
    importBatchId: 1,
    cleancloudOrderId: "order-1",
    cleancloudCustomerId: "customer-1",
    customerName: "Example",
    customerEmail: null,
    customerPhone: null,
    address: "2170 Century Park East",
    paid: true,
    totalCents: 5100,
    paymentDateUtc: new Date("2026-09-02T07:00:00.000Z"),
    buildingResolutionStatus: "resolved",
    buildingSlug: "centuryparkeast",
    ...overrides,
  };
}

function publicationPayload(
  tenantId: string,
  idempotencyKey: string,
  sourceId = idempotencyKey
) {
  const occurredAt = "2026-09-02T07:00:00.000Z";
  return {
    tenantId,
    physicalEntityId: null,
    eventType: "order_paid",
    classification: "outcome" as const,
    actorType: "system" as const,
    actorId: null,
    occurredAt,
    observedAt: occurredAt,
    sourceType: "gumball",
    sourceId,
    sourceEvidenceReference: "cleancloud-import:test:" + sourceId,
    provenanceClass: "existing_business_record" as const,
    verificationClass: "VERIFIED" as const,
    confidence: "high" as const,
    idempotencyKey,
    correlationId: "cleancloud-import:test",
    metadata: {
      economicKey: sourceId,
      revision: 1,
      paid: true,
      amountCents: 5100,
      paymentAt: occurredAt,
      projectionMode: "replace",
    },
  };
}

async function insertOutbox(input: {
  id: string;
  tenantId: string;
  payloadTenantId?: string;
  idempotencyKey?: string;
}) {
  const payload = publicationPayload(
    input.payloadTenantId ?? input.tenantId,
    input.idempotencyKey ?? "gumball:" + input.id,
    input.id
  );
  await pool.query(
    `INSERT INTO goldline_cleancloud_outbox (id, tenantId, payload)
     VALUES (?, ?, ?)`,
    [input.id, input.tenantId, JSON.stringify(payload)]
  );
}

async function count(table: string) {
  const [rows] = await pool.query<any[]>("SELECT COUNT(*) AS n FROM ??", [table]);
  return Number(rows[0]?.n ?? 0);
}

describe.skipIf(!DATABASE_URL)("CleanCloud economic outbox — real MySQL", () => {
  beforeAll(async () => {
    const url = new URL(DATABASE_URL!);
    databaseName =
      "world_outbox_it_" + randomUUID().replace(/-/g, "").slice(0, 12);
    url.pathname = "/";
    admin = await mysql.createConnection(url.toString());
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    url.pathname = "/" + databaseName;
    pool = mysql.createPool({
      uri: url.toString(),
      connectionLimit: 12,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await applySqlFile("./schema.sql");
    await applySqlFile("../../../platform/persistence/goldlineCompatibilitySchema.sql");
    await pool.query(
      "CREATE TABLE program_a_slice2_domain_commits (id VARCHAR(64) PRIMARY KEY)"
    );
    setDbForTesting(drizzle(pool));
  }, 120_000);

  afterAll(async () => {
    resetDbForTesting();
    await pool?.end();
    if (admin && databaseName) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
    await admin?.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM goldline_world_events");
    await pool.query("DELETE FROM goldline_cleancloud_outbox");
    await pool.query("DELETE FROM goldline_cleancloud_economic_heads");
    await pool.query("DELETE FROM program_a_slice2_domain_commits");
  });

  it("rolls the outbox intent back with the domain transaction", async () => {
    const correction = paidRow({
      cleancloudOrderId: "rollback-order",
      paid: false,
      paymentDateUtc: null,
      paidDateUtc: null,
    });
    const snapshot = economicSnapshot(correction);
    await pool.query(
      `INSERT INTO goldline_cleancloud_economic_heads
         (economicKey, revision, fingerprint)
       VALUES (?, 1, 'prior')`,
      [snapshot.economicKey]
    );

    const db = await getDb();
    expect(db).not.toBeNull();
    await expect(
      db!.transaction(async tx => {
        await tx.insert(testDomainCommits).values({ id: "rollback-domain" });
        await enqueueEconomicSnapshot(tx, correction);
        throw new Error("forced rollback");
      })
    ).rejects.toThrow("forced rollback");

    expect(await count("program_a_slice2_domain_commits")).toBe(0);
    expect(await count("goldline_cleancloud_outbox")).toBe(0);
    const [heads] = await pool.query<any[]>(
      "SELECT revision, fingerprint FROM goldline_cleancloud_economic_heads WHERE economicKey = ?",
      [snapshot.economicKey]
    );
    expect(heads[0]).toMatchObject({ revision: 1, fingerprint: "prior" });
  });

  it("commits the domain write and publication intent together", async () => {
    const correction = paidRow({
      cleancloudOrderId: "commit-order",
      paid: false,
      paymentDateUtc: null,
      paidDateUtc: null,
    });
    const snapshot = economicSnapshot(correction);
    await pool.query(
      `INSERT INTO goldline_cleancloud_economic_heads
         (economicKey, revision, fingerprint)
       VALUES (?, 1, 'prior')`,
      [snapshot.economicKey]
    );

    const db = await getDb();
    await db!.transaction(async tx => {
      await tx.insert(testDomainCommits).values({ id: "committed-domain" });
      await enqueueEconomicSnapshot(tx, correction);
    });

    expect(await count("program_a_slice2_domain_commits")).toBe(1);
    const [rows] = await pool.query<any[]>(
      "SELECT tenantId, publishedAt FROM goldline_cleancloud_outbox"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe("tenant-a");
    expect(rows[0].publishedAt).toBeNull();
  });

  it("allows only one concurrent worker to hold a live publication lease", async () => {
    await insertOutbox({ id: "one", tenantId: "tenant-a" });
    const claims = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        claimNextEconomicOutbox({
          leaseOwner: "worker-" + index,
          leaseMs: 10_000,
        })
      )
    );
    const held = claims.filter(Boolean);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({
      id: "one",
      tenantId: "tenant-a",
      attemptCount: 1,
    });
  });

  it("reclaims an expired lease after a crash before publish", async () => {
    await insertOutbox({ id: "crash-before", tenantId: "tenant-a" });
    const first = await claimNextEconomicOutbox({
      leaseOwner: "dead-worker",
      leaseMs: 10_000,
    });
    expect(first).toMatchObject({ id: "crash-before", attemptCount: 1 });
    await pool.query(
      `UPDATE goldline_cleancloud_outbox
          SET leaseExpiresAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE id = 'crash-before'`
    );
    const recovered = await claimNextEconomicOutbox({
      leaseOwner: "replacement-worker",
      leaseMs: 10_000,
    });
    expect(recovered).toMatchObject({
      id: "crash-before",
      tenantId: "tenant-a",
      leaseOwner: "replacement-worker",
      attemptCount: 2,
    });
  });

  it("replays after publish-before-ack with exactly one durable world effect", async () => {
    await insertOutbox({
      id: "crash-after",
      tenantId: "tenant-a",
      idempotencyKey: "gumball:crash-after",
    });
    const first = await claimNextEconomicOutbox({
      leaseOwner: "dead-after-publish",
      leaseMs: 10_000,
    });
    expect(first).not.toBeNull();
    await appendGoldlineWorldEvent(first!.payload);
    await pool.query(
      `UPDATE goldline_cleancloud_outbox
          SET leaseExpiresAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND)
        WHERE id = 'crash-after'`
    );

    expect(
      await drainEconomicOutbox(1, {
        leaseOwner: "replacement-after-publish",
        leaseMs: 10_000,
      })
    ).toBe(1);
    expect(await count("goldline_world_events")).toBe(1);
    const [rows] = await pool.query<any[]>(
      `SELECT publishedAt, attemptCount, leaseOwner
         FROM goldline_cleancloud_outbox
        WHERE id = 'crash-after'`
    );
    expect(rows[0].publishedAt).not.toBeNull();
    expect(Number(rows[0].attemptCount)).toBe(2);
    expect(rows[0].leaseOwner).toBeNull();
  });

  it("fails closed when durable tenant scope disagrees with the payload", async () => {
    await insertOutbox({
      id: "tenant-mismatch",
      tenantId: "tenant-a",
      payloadTenantId: "tenant-b",
    });
    await expect(
      drainEconomicOutbox(1, {
        leaseOwner: "tenant-guard",
        leaseMs: 10_000,
      })
    ).rejects.toThrow(/tenant mismatch/);
    expect(await count("goldline_world_events")).toBe(0);
    const [rows] = await pool.query<any[]>(
      "SELECT publishedAt, leaseOwner FROM goldline_cleancloud_outbox WHERE id = 'tenant-mismatch'"
    );
    expect(rows[0]).toMatchObject({ publishedAt: null, leaseOwner: null });
  });

  it("keeps the same publication idempotency key independent across tenants", async () => {
    const key = "gumball:shared-idempotency";
    await insertOutbox({
      id: "tenant-a-row",
      tenantId: "tenant-a",
      idempotencyKey: key,
    });
    await insertOutbox({
      id: "tenant-b-row",
      tenantId: "tenant-b",
      idempotencyKey: key,
    });

    expect(
      await drainEconomicOutbox(10, {
        leaseOwner: "cross-tenant-worker",
        leaseMs: 10_000,
      })
    ).toBe(2);
    const [rows] = await pool.query<any[]>(
      `SELECT tenantId, idempotencyKey
         FROM goldline_world_events
        WHERE idempotencyKey = ?
        ORDER BY tenantId`,
      [key]
    );
    expect(rows).toMatchObject([
      { tenantId: "tenant-a", idempotencyKey: key },
      { tenantId: "tenant-b", idempotencyKey: key },
    ]);
  });
});
