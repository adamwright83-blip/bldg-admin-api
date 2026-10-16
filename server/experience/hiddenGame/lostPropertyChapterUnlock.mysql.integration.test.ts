/**
 * Disposable MySQL proof for the Lost Property chapter unlock already on this branch.
 * The test creates and drops a local database whose name ends in `_disposable`.
 * It does not read DATABASE_URL and it does not run scripts/migrate.mjs.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { CANONICAL_BUILDING_GEOGRAPHY } from "../../../shared/canonicalGeography";
import {
  LOST_PROPERTY_NON_UNLOCK_EVIDENCE,
  LOST_PROPERTY_UNLOCK_RULE_VERSION,
  collectEligibleObjectiveUnits,
  selectFirstVerifiedTerritorialSale,
  type AdmittedPaidOrder,
  type CustomerTerritoryPlacement,
  type LostPropertyChapterPersist,
} from "../../../shared/lostPropertyUnlock";
import { resetDbForTesting, setDbForTesting } from "../../db";
import {
  insertStoredChapterUnlock,
  readDurableLostPropertyUnlock,
  readStoredChapterUnlocks,
  type LostPropertyDurableDeps,
} from "./lostPropertyChapterUnlock";
import type { LostPropertyScope } from "./lostPropertyUnlockRead";

const HOST = "127.0.0.1";
const PORT = 3399;
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const databaseName = `lost_property_${suffix}_disposable`;
const TENANT = `tenant-a-${suffix}`;
const OTHER = `tenant-b-${suffix}`;
const OPERATOR = `op-1-${suffix}`;
const OTHER_OPERATOR = `op-2-${suffix}`;

const opus = CANONICAL_BUILDING_GEOGRAPHY.opus_la;
const at = (day: number, hour = 12) =>
  `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

let admin: mysql.Connection;
let pool: Pool;
let reloadPool: Pool;
const previousDatabaseUrl = process.env.DATABASE_URL;

function scopeFor(tenantId: string, operatorId: string): LostPropertyScope {
  return {
    tenantId,
    canonicalOperatorId: operatorId,
    actorIds: [`${operatorId}-actor`],
    operatorOpenIds: [`${operatorId}-open`],
  };
}

function placed(identity: string, tenantId = TENANT): CustomerTerritoryPlacement {
  return {
    tenantId,
    customerIdentityKey: identity,
    geocodeStatus: "success",
    latitude: opus.latitude,
    longitude: opus.longitude,
  };
}

function order(
  patch: Partial<AdmittedPaidOrder> & Pick<AdmittedPaidOrder, "eventKey" | "occurredAt">
): AdmittedPaidOrder {
  return {
    tenantId: TENANT,
    cents: 4200,
    customerIdentityKey: "customer-1",
    ingestedAt: "2026-10-15T00:00:00.000Z",
    ...patch,
  };
}

const noiseOrders: AdmittedPaidOrder[] = [
  order({ eventKey: "message:draft", occurredAt: at(1, 8), cents: 4200 }),
  order({ eventKey: "message:scheduled", occurredAt: at(1, 9), cents: 4200 }),
  order({ eventKey: "message:sent", occurredAt: at(1, 10), cents: 4200 }),
  order({ eventKey: "message:reply", occurredAt: at(1, 11), cents: 4200 }),
  order({ eventKey: "visit:4", occurredAt: at(1, 12), cents: 4200 }),
  order({ eventKey: "order:40", occurredAt: at(1, 13), cents: 0 }),
  order({ eventKey: "order:41", occurredAt: at(1, 14), cents: 0, customerIdentityKey: "customer-1" }),
];

function durableDeps(
  orders: readonly AdmittedPaidOrder[],
  placements: readonly CustomerTerritoryPlacement[]
): LostPropertyDurableDeps {
  return {
    readFirstSale: async tenantId => selectFirstVerifiedTerritorialSale({ tenantId, orders, placements }),
    readCompletedUnits: async scope =>
      collectEligibleObjectiveUnits(
        {
          tenantId: scope.tenantId,
          canonicalOperatorId: scope.canonicalOperatorId,
          actorIds: scope.actorIds ?? [],
        },
        {
          ignored: LOST_PROPERTY_NON_UNLOCK_EVIDENCE.map((kind, index) => ({
            tenantId: scope.tenantId,
            kind,
            id: `noise-${index}`,
            at: at(2),
          })),
        }
      ),
    readPersisted: scope => readStoredChapterUnlocks(scope),
    insertChapter: (scope, record) => insertStoredChapterUnlock(scope, record),
    env: {},
  };
}

async function countRows(where = ""): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM hidden_game_chapter_unlocks ${where}`
  );
  return Number(rows[0]?.n ?? 0);
}

function asEvidence(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

describe("Lost Property chapter unlocks on disposable MySQL", () => {
  beforeAll(async () => {
    if (HOST !== "127.0.0.1") throw new Error("Local database host required");
    if (!databaseName.endsWith("_disposable")) throw new Error("Disposable database name required");
    delete process.env.DATABASE_URL;
    admin = await mysql.createConnection({ host: HOST, port: PORT, user: "root", password: "root" });
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    const poolOptions = {
      host: HOST,
      port: PORT,
      user: "root",
      password: "root",
      database: databaseName,
      connectionLimit: 4,
      timezone: "Z",
    };
    pool = mysql.createPool(poolOptions);
    reloadPool = mysql.createPool(poolOptions);
    const sql = readFileSync(new URL("../../../drizzle/0135_hidden_game_chapter_unlocks.sql", import.meta.url), "utf8");
    for (const statement of sql
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map(value => value.trim())
      .filter(Boolean)) {
      await pool.query(statement);
    }
    setDbForTesting(drizzle(pool));
  }, 30_000);

  afterAll(async () => {
    resetDbForTesting();
    await pool?.end();
    await reloadPool?.end();
    if (admin && databaseName.endsWith("_disposable")) {
      await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    }
    await admin?.end();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  beforeEach(async () => {
    setDbForTesting(drizzle(pool));
    await pool.query("DELETE FROM hidden_game_chapter_unlocks");
  });

  it("a draft, schedule, send, reply, zero-cent capture, or visit does not open chapter 1", async () => {
    const sale = selectFirstVerifiedTerritorialSale({
      tenantId: TENANT,
      orders: noiseOrders,
      placements: [placed("customer-1")],
    });
    expect(sale).toBeNull();
    const read = await readDurableLostPropertyUnlock(scopeFor(TENANT, OPERATOR), durableDeps(noiseOrders, [placed("customer-1")]));
    expect(read.unlockedChapters).toBe(0);
    expect(read.chapters).toEqual([]);
    expect(read.preview).toBe(false);
    expect(await countRows()).toBe(0);
  });

  it("opens chapter 1 only for the first admitted paid territorial sale and keeps it across a new connection", async () => {
    const orders = [
      ...noiseOrders,
      order({ eventKey: "order:9", occurredAt: at(1, 18) }),
      order({ eventKey: "order:9", occurredAt: at(3, 9) }),
      order({ eventKey: "order:11", occurredAt: at(4, 9), cents: 5100 }),
      order({ eventKey: "order:8", occurredAt: at(1, 7), tenantId: OTHER, customerIdentityKey: "other-customer" }),
    ];
    const placements = [placed("customer-1"), placed("other-customer", OTHER)];
    const sale = selectFirstVerifiedTerritorialSale({ tenantId: TENANT, orders, placements });
    expect(sale).toMatchObject({
      territoryId: "koreatown",
      occurredAt: at(1, 18),
      eventKey: "order:9",
    });

    const opened = await readDurableLostPropertyUnlock(scopeFor(TENANT, OPERATOR), durableDeps(orders, placements));
    expect(opened.unlockedChapters).toBe(1);
    expect(opened.chapters).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
    expect(await countRows()).toBe(1);

    const again = await readDurableLostPropertyUnlock(scopeFor(TENANT, OPERATOR), durableDeps(orders, placements));
    expect(again.chapters).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
    expect(await countRows()).toBe(1);

    setDbForTesting(drizzle(reloadPool));
    const reloaded = await readStoredChapterUnlocks(scopeFor(TENANT, OPERATOR));
    expect(reloaded).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
    const withheld = await readDurableLostPropertyUnlock(scopeFor(TENANT, OPERATOR), {
      ...durableDeps([], []),
      readFirstSale: async () => null,
    });
    expect(withheld.unlockedChapters).toBe(1);
    expect(withheld.chapters).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
    expect(await countRows()).toBe(1);
  });

  it("a duplicate insert does not add a row or replace the opening sale", async () => {
    const orders = [order({ eventKey: "order:9", occurredAt: at(1, 18) })];
    const placements = [placed("customer-1")];
    await readDurableLostPropertyUnlock(scopeFor(TENANT, OPERATOR), durableDeps(orders, placements));
    const [before] = await pool.query<RowDataPacket[]>(
      "SELECT id, openedAt, evidenceJson FROM hidden_game_chapter_unlocks"
    );
    const later: LostPropertyChapterPersist = {
      chapter: 1,
      openedAt: at(9),
      evidence: {
        ruleVersion: LOST_PROPERTY_UNLOCK_RULE_VERSION,
        kind: "territorial_sale",
        eventKey: "order:99",
        territoryId: "koreatown",
        occurredAt: at(9),
      },
    };
    await insertStoredChapterUnlock(scopeFor(TENANT, OPERATOR), later);
    const [after] = await pool.query<RowDataPacket[]>(
      "SELECT id, openedAt, evidenceJson FROM hidden_game_chapter_unlocks"
    );
    expect(after).toHaveLength(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(asEvidence(after[0]?.evidenceJson)).toMatchObject({
      kind: "territorial_sale",
      eventKey: "order:9",
      occurredAt: at(1, 18),
    });
    expect(await readStoredChapterUnlocks(scopeFor(TENANT, OPERATOR))).toEqual([
      { chapter: 1, openedAt: at(1, 18) },
    ]);
  });

  it("keeps tenant and operator reads on their own rows", async () => {
    const orders = [
      order({ eventKey: "order:9", occurredAt: at(1, 18) }),
      order({ eventKey: "order:8", occurredAt: at(1, 7), tenantId: OTHER, customerIdentityKey: "other-customer" }),
    ];
    const placements = [placed("customer-1"), placed("other-customer", OTHER)];
    await readDurableLostPropertyUnlock(scopeFor(TENANT, OPERATOR), durableDeps(orders, placements));

    expect(await readStoredChapterUnlocks(scopeFor(OTHER, OPERATOR))).toEqual([]);
    expect(await readStoredChapterUnlocks(scopeFor(TENANT, OTHER_OPERATOR))).toEqual([]);
    expect(await countRows()).toBe(1);

    const otherTenant = await readDurableLostPropertyUnlock(
      scopeFor(OTHER, OPERATOR),
      durableDeps(orders, placements)
    );
    expect(otherTenant.unlockedChapters).toBe(1);
    expect(otherTenant.chapters).toEqual([{ chapter: 1, openedAt: at(1, 7) }]);
    expect(otherTenant.firstSaleEventKey).toBe("order:8");

    const sameTenantOtherOperator = await readStoredChapterUnlocks(scopeFor(TENANT, OTHER_OPERATOR));
    expect(sameTenantOtherOperator).toEqual([]);
    const owner = await readStoredChapterUnlocks(scopeFor(TENANT, OPERATOR));
    expect(owner).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
    expect(await countRows("WHERE tenantId = " + pool.escape(TENANT) + " AND canonicalOperatorId = " + pool.escape(OPERATOR))).toBe(1);
    expect(await countRows("WHERE tenantId = " + pool.escape(OTHER))).toBe(1);
  });

  it("rejects a chapter 4 row in the disposable table", async () => {
    await expect(
      pool.query(
        `INSERT INTO hidden_game_chapter_unlocks
           (id, tenantId, canonicalOperatorId, chapter, openedAt, evidenceJson)
         VALUES (?, ?, ?, 4, ?, JSON_OBJECT('kind', 'territorial_sale'))`,
        ["chapter-4", TENANT, OPERATOR, at(1, 18).replace("T", " ").replace("Z", "")]
      )
    ).rejects.toThrow(/check|constraint/i);
    expect(await countRows()).toBe(0);
  });
});
