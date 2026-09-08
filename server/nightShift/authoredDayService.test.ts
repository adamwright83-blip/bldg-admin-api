import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authoredDays } from "../../drizzle/schema";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getFieldToday: vi.fn(),
  listFuturePressure: vi.fn(),
  getGeographicTruth: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../field/fieldTodayService", () => ({
  getFieldToday: mocks.getFieldToday,
}));
vi.mock("../goldlineWorld/futurePressureService", () => ({
  listFuturePressure: mocks.listFuturePressure,
}));
vi.mock("../geography/geographicTruthService", () => ({
  getGeographicTruth: mocks.getGeographicTruth,
}));
vi.mock("../_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));

vi.mock("../_core/env", () => ({
  ENV: {
    goldlineNightShiftEnabled: false,
    anthropicApiKey: "",
    anthropicModel: "claude-sonnet-4-6",
  },
}));

import { ENV } from "../_core/env";
import {
  composeAuthoredDayFromBundle,
  gatherNightShiftInputs,
  getOrAuthorTodayAuthoredDay,
  isAfterLosAngelesBusinessDateRoll,
  isBeforeLosAngelesBusinessDateRoll,
  isNightShiftEnabled,
  runNightShiftForBusinessDate,
} from "./authoredDayService";
import type { NightShiftInputBundle } from "./authoredDayService";
import { zonedDayStartUtc } from "../dashboardZoned";

type Row = Record<string, unknown>;

function predicateParameters(predicate: unknown): unknown[] {
  if (!predicate || typeof predicate !== "object") return [];
  const node = predicate as {
    constructor?: { name?: string };
    queryChunks?: unknown[];
    value?: unknown;
  };
  if (node.constructor?.name === "Param") return [node.value];
  return (node.queryChunks ?? []).flatMap(predicateParameters);
}

function memoryDb() {
  const rows: Row[] = [];
  const db: any = {
    select: vi.fn(() => ({
      from: (table: object) => ({
        where: (predicate: unknown) => {
          const params = predicateParameters(predicate);
          let result = rows;
          if (table === authoredDays) {
            result = rows.filter(
              row =>
                row.tenantId === params[0] &&
                row.operatorId === params[1] &&
                (row.businessDate === params[2] || row.stableKey === params[2])
            );
          }
          const promise = Promise.resolve(result) as Promise<Row[]> & {
            limit: (count: number) => Promise<Row[]>;
          };
          promise.limit = async count => result.slice(0, count);
          return promise;
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: async (value: Row) => {
        if (
          rows.some(
            row =>
              row.tenantId === value.tenantId &&
              row.operatorId === value.operatorId &&
              row.businessDate === value.businessDate
          )
        ) {
          const error = new Error("duplicate") as Error & { code: string; errno: number };
          error.code = "ER_DUP_ENTRY";
          error.errno = 1062;
          throw error;
        }
        rows.push({ ...value, createdAt: new Date(), updatedAt: new Date() });
      },
    })),
    update: vi.fn(() => ({
      set: () => ({
        where: async () => undefined,
      }),
    })),
  };
  return { db, rows };
}

function sampleBundle(): NightShiftInputBundle {
  return {
    businessDate: "2026-09-09",
    allowlist: {
      customerIds: new Set(["cust-1"]),
      physicalEntityIds: new Set(["pe-1"]),
      fieldItemIds: new Set(["pickup:42"]),
      obligationIds: new Set(["obl-1"]),
      territoryIds: new Set(["koreatown"]),
      operationStableKeys: new Set(),
      campaignChapterIds: new Set(),
      orderIds: new Set(["42"]),
      followUpIds: new Set(),
      externalOrderIds: new Set(),
      missionIds: new Set(),
    },
    candidateLines: [
      {
        id: "line:pickup:42",
        title: "Pick up Ada",
        narrative: "Scheduled pickup.",
        kind: "pickup",
        emphasis: "primary",
        provenance: [
          {
            entityType: "field_item",
            entityId: "pickup:42",
            sourceReference: "orders:42",
          },
          {
            entityType: "order",
            entityId: "42",
            sourceReference: "orders:42",
          },
        ],
      },
    ],
    headlineSeed: "Tomorrow on 2026-09-09",
    framingSeed: "1 real stop.",
    inputFingerprint: "abc123",
  };
}

describe("Night Shift service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV.goldlineNightShiftEnabled = false;
    ENV.anthropicApiKey = "";
    mocks.getFieldToday.mockResolvedValue({
      timeline: [
        {
          id: "pickup:42",
          kind: "pickup",
          title: "Pick up Ada",
          subtitle: "Pickup",
          urgency: "scheduled",
          whySurfaced: "Scheduled pickup",
          source: {
            entityType: "order",
            entityId: "42",
            sourceReference: "orders:42",
          },
          physicalEntityId: "pe-1",
        },
      ],
    });
    mocks.listFuturePressure.mockResolvedValue({ date: "2026-09-09", items: [] });
    mocks.getGeographicTruth.mockResolvedValue({
      customers: [
        {
          identityKey: "cust-1",
          cadence: { state: "active", daysSinceLastOrder: 3, confidence: "measured" },
          location: { latitude: 34.05, longitude: -118.3 },
        },
      ],
    });
  });

  it("defaults GOLDLINE_NIGHT_SHIFT to off", () => {
    ENV.goldlineNightShiftEnabled = false;
    expect(isNightShiftEnabled()).toBe(false);
  });

  it("does not author when the flag is off", async () => {
    const result = await runNightShiftForBusinessDate({
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      businessDate: "2026-09-09",
    });
    expect(result.status).toBe("disabled");
  });

  it("uses Los Angeles semantics instead of naive UTC midnight", async () => {
    ENV.goldlineNightShiftEnabled = true;
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    const timeZone = "America/Los_Angeles";
    const sep9Start = zonedDayStartUtc("2026-09-09", timeZone);
    const beforeRoll = await runNightShiftForBusinessDate({
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      businessDate: "2026-09-09",
      now: new Date(sep9Start.getTime() - 1),
    });
    const afterRoll = await runNightShiftForBusinessDate({
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      businessDate: "2026-09-09",
      now: new Date(sep9Start.getTime() + 1),
    });
    expect(beforeRoll.status).toBe("before_rollover");
    expect(afterRoll.status).toBe("authored");
  });

  it("does not run before LA business-date rollover", async () => {
    ENV.goldlineNightShiftEnabled = true;
    const timeZone = "America/Los_Angeles";
    const start = zonedDayStartUtc("2026-09-09", timeZone);
    const result = await runNightShiftForBusinessDate({
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      businessDate: "2026-09-09",
      now: new Date(start.getTime() - 1),
    });
    expect(result.status).toBe("before_rollover");
  });

  it("authors exactly one row per business date", async () => {
    ENV.goldlineNightShiftEnabled = true;
    const { db, rows } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.getGeographicTruth.mockResolvedValue({
      customers: [],
    });
    const timeZone = "America/Los_Angeles";
    const now = new Date(zonedDayStartUtc("2026-09-09", timeZone).getTime() + 1000);
    const input = {
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      businessDate: "2026-09-09",
      now,
    };
    const first = await runNightShiftForBusinessDate(input);
    const second = await runNightShiftForBusinessDate(input);
    expect(first.status).toBe("authored");
    expect(second.status).toBe("existing");
    expect(rows).toHaveLength(1);
  });

  it("settles concurrent runs on one authoritative row", async () => {
    ENV.goldlineNightShiftEnabled = true;
    const { db, rows } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.getGeographicTruth.mockResolvedValue({ customers: [] });
    const timeZone = "America/Los_Angeles";
    const now = new Date(zonedDayStartUtc("2026-09-09", timeZone).getTime() + 1000);
    const input = {
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      businessDate: "2026-09-09",
      now,
    };
    const [a, b] = await Promise.all([
      runNightShiftForBusinessDate(input),
      runNightShiftForBusinessDate(input),
    ]);
    expect(rows).toHaveLength(1);
    expect(a.authoredDay?.id).toBe(b.authoredDay?.id);
    expect(a.status).toBe("authored");
  });

  it("rejects hallucinated model output fail-closed", async () => {
    const bundle = sampleBundle();
    ENV.anthropicApiKey = "test-key";
    mocks.invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              headline: "Tomorrow",
              framing: "Work",
              selections: [{ candidateId: "line:does-not-exist", emphasis: "primary" }],
            }),
          },
        },
      ],
    });
    const result = await composeAuthoredDayFromBundle(bundle, "default");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intelligence).toBe("deterministic_fallback");
      expect(result.lines[0]?.title).toBe("Pick up Ada");
    }
  });

  it("reconstructs canonical candidate text instead of accepting fabricated prose", async () => {
    ENV.anthropicApiKey = "test-key";
    mocks.invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              headline: "Confirmed meeting with Sarah at 2 PM",
              framing: "Greystar signed the deal",
              selections: [{ candidateId: "line:pickup:42", emphasis: "primary" }],
            }),
          },
        },
      ],
    });
    const result = await composeAuthoredDayFromBundle(sampleBundle(), "default");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0]?.title).toBe("Pick up Ada");
      expect(result.lines[0]?.narrative).toBe("Scheduled pickup.");
      expect(result.headline).toBe("Tomorrow on 2026-09-09");
      expect(result.framing).toBe("1 real stop.");
    }
  });

  it("accepts deterministic fallback from real candidates", async () => {
    const result = await composeAuthoredDayFromBundle(sampleBundle(), "default");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intelligence).toBe("deterministic_fallback");
      expect(result.lines.every(line => line.provenance.length > 0)).toBe(true);
    }
  });

  it("fails closed on malformed model JSON", async () => {
    ENV.anthropicApiKey = "test-key";
    mocks.invokeLLM.mockResolvedValue({
      choices: [{ message: { content: "{not-json" } }],
    });
    const result = await composeAuthoredDayFromBundle(sampleBundle(), "default");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.intelligence).toBe("deterministic_fallback");
  });

  it("lazy dawn read triggers authoring after rollover", async () => {
    ENV.goldlineNightShiftEnabled = true;
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    mocks.getGeographicTruth.mockResolvedValue({ customers: [] });
    const timeZone = "America/Los_Angeles";
    const now = new Date(zonedDayStartUtc("2026-09-09", timeZone).getTime() + 1000);
    const result = await getOrAuthorTodayAuthoredDay({
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      now,
    });
    expect(result.available).toBe(true);
    expect(result.authoredDay?.businessDate).toBe("2026-09-09");
  });

  it("does not create business records merely by mentioning them in model output", async () => {
    ENV.anthropicApiKey = "test-key";
    mocks.invokeLLM.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              headline: "Closed revenue",
              framing: "A deal happened",
              selections: [{ candidateId: "line:pickup:42", emphasis: "primary" }],
            }),
          },
        },
      ],
    });
    const result = await composeAuthoredDayFromBundle(sampleBundle(), "default");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[0]?.title).toBe("Pick up Ada");
      expect(result.headline).toBe("Tomorrow on 2026-09-09");
    }
  });

  it("builds allowlisted inputs from field today only", async () => {
    const { db } = memoryDb();
    mocks.getDb.mockResolvedValue(db);
    const bundle = await gatherNightShiftInputs({
      tenantId: "default",
      operatorId: "op-1",
      userId: "1",
      businessDate: "2026-09-09",
    });
    expect(bundle.allowlist.fieldItemIds.has("pickup:42")).toBe(true);
    expect(bundle.candidateLines[0]?.provenance.length).toBeGreaterThan(0);
  });
});

describe("Night Shift production persistence contract", () => {
  it("bootstraps authored_days through migrate.mjs", () => {
    const migration = readFileSync(new URL("../../scripts/migrate.mjs", import.meta.url), "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS authored_days");
    expect(migration).toContain("uq_authored_day_operator_date");
  });

  it("bootstraps goldline_lantern_operations through migrate.mjs", () => {
    const migration = readFileSync(new URL("../../scripts/migrate.mjs", import.meta.url), "utf8");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS goldline_lantern_operations");
  });
});
