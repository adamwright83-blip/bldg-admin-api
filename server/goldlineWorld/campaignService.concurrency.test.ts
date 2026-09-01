import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  goldlineCampaignInstances,
  goldlineCampaignRevisions,
} from "../../drizzle/schema";
import { CAMPAIGN_RULES_VERSION } from "../../shared/goldlineCampaign";
import { compileGoldlineCampaign } from "../../shared/goldlineCampaignCompiler";
import type { FieldTodayItem, FieldTodayProjection } from "../field/types";
import { emptyTravelTruth } from "../../shared/goldlineTravelTruth";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getFieldToday: vi.fn(),
  listPresentedTerritories: vi.fn(),
  estimateCampaignTravel: vi.fn(),
  appendGoldlineWorldEvent: vi.fn(),
}));

vi.mock("../db", () => ({ getDb: mocks.getDb }));
vi.mock("../field/fieldTodayService", () => ({ getFieldToday: mocks.getFieldToday }));
vi.mock("./territoryService", () => ({
  listPresentedTerritories: mocks.listPresentedTerritories,
}));
vi.mock("./campaignTravelAdapter", () => ({
  estimateCampaignTravel: mocks.estimateCampaignTravel,
}));
vi.mock("./worldEventStore", () => ({
  appendGoldlineWorldEvent: mocks.appendGoldlineWorldEvent,
}));

import { getOrMaterializeTodayCampaign, chooseCampaignBranch, recordCampaignGuardianFinaleForTerritory } from "./campaignService";

type Row = Record<string, any>;

function walkSql(node: unknown, visit: (value: unknown) => void) {
  visit(node);
  if (!node || typeof node !== "object") return;
  const value = node as { queryChunks?: unknown[] };
  if (Array.isArray(value.queryChunks)) {
    for (const chunk of value.queryChunks) walkSql(chunk, visit);
  }
}

function chunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return typeof chunk === "string" ? chunk : "";
  const value = chunk as { constructor?: { name?: string }; value?: unknown };
  if (value.constructor?.name === "StringChunk" && Array.isArray(value.value)) {
    return value.value.join("");
  }
  return "";
}

function namedEquals(predicate: unknown): Record<string, unknown> {
  const equals: Record<string, unknown> = {};
  walkSql(predicate, node => {
    if (!node || typeof node !== "object") return;
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
    if (!Array.isArray(chunks)) return;
    for (let index = 0; index < chunks.length; index += 1) {
      const column = chunks[index] as { name?: string };
      if (typeof column?.name !== "string") continue;
      const opText = chunkText(chunks[index + 1]);
      if (/is null/i.test(opText)) {
        equals[column.name] = null;
        continue;
      }
      if (!opText.includes("=")) continue;
      const rhs = chunks[index + 2] as { constructor?: { name?: string }; value?: unknown };
      if (rhs?.constructor?.name === "Param") {
        equals[column.name] = rhs.value;
      }
    }
  });
  return equals;
}

function predicateParams(predicate: unknown): unknown[] {
  const params: unknown[] = [];
  walkSql(predicate, node => {
    if (!node || typeof node !== "object") return;
    const value = node as { constructor?: { name?: string }; value?: unknown; queryChunks?: unknown[] };
    if (value.constructor?.name === "Param" && "value" in value) {
      params.push(value.value);
    }
  });
  return params;
}

function snapshotMatches(row: Row, predicate: unknown): boolean {
  const equals = namedEquals(predicate);
  const completed = Array.isArray(row.completedChapterIdsJson)
    ? (row.completedChapterIdsJson as string[])
    : [];
  if (equals.id !== row.id) return false;
  if (Number(equals.revision) !== Number(row.revision)) return false;
  if (equals.inputFingerprint !== row.inputFingerprint) return false;
  if ((equals.currentChapterId ?? null) !== (row.currentChapterId ?? null)) return false;
  const params = predicateParams(predicate);
  const sql = (() => {
    const parts: string[] = [];
    walkSql(predicate, node => {
      const text = chunkText(node);
      if (text) parts.push(text);
    });
    return parts.join("");
  })();
  const quoted = Array.from(sql.matchAll(/JSON_QUOTE\(([^)]+)\)/g), match => match[1]);
  const seen = new Set([...params, ...quoted].map(value => String(value)));
  if (!completed.every(id => seen.has(id))) return false;
  const inlinedLength = sql.match(/JSON_LENGTH\([^)]*\) = (\d+)/);
  if (inlinedLength && Number(inlinedLength[1]) !== completed.length) return false;
  return true;
}

function thenable<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  return {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    limit: async (count: number) => rows.slice(0, count),
    orderBy: () => ({
      limit: async (count: number) => rows.slice(0, count),
    }),
  };
}

function timelineItem(
  id: string,
  kind: FieldTodayItem["kind"],
  status = "open"
): FieldTodayItem {
  return {
    id,
    kind,
    source: {
      entityType: kind === "pickup" ? "order" : "commercial_follow_up",
      entityId: id,
      sourceReference: id,
    },
    scheduledAt: kind === "pickup" ? "2026-09-01T17:00:00.000Z" : null,
    urgency: kind === "pickup" ? "scheduled" : "flexible",
    title: id,
    subtitle: "",
    status,
    destination: { address: "1 Main St", latitude: 34.05, longitude: -118.3 },
    customer: { name: "Acme", phone: null, email: null },
    money: null,
    verificationClass: "VERIFIED",
    actions: [],
  };
}

function fieldToday(input: {
  timeline?: FieldTodayItem[];
  authoritativeCompletedObjectiveIds?: string[];
}): FieldTodayProjection {
  return {
    generatedAt: "2026-09-01T12:00:00.000Z",
    businessDate: "2026-09-01",
    currentUserId: "driver-1",
    timeline: input.timeline ?? [],
    authoritativeCompletedObjectiveIds: input.authoritativeCompletedObjectiveIds ?? [],
    nextFixedCommitment: null,
    blockers: [],
    dataQuality: { status: "trusted", warnings: [], sources: [] },
  };
}

function seedRowFromObjectives(
  objectives: Parameters<typeof compileGoldlineCampaign>[0]["objectives"],
  extras: Partial<Row> = {}
): Row {
  const draft = compileGoldlineCampaign({
    tenantId: "tenant-a",
    operatorId: "driver-1",
    businessDate: "2026-09-01",
    objectives,
  });
  return {
    id: "campaign-1",
    tenantId: "tenant-a",
    operatorId: "driver-1",
    businessDate: "2026-09-01",
    rulesVersion: CAMPAIGN_RULES_VERSION,
    stableKey: draft.stableKey,
    campaignArchetypeId: draft.campaignArchetypeId,
    title: draft.title,
    premise: draft.premise,
    inputFingerprint: draft.inputFingerprint,
    status: draft.status,
    currentChapterId: draft.currentChapterId,
    completedChapterIdsJson: [],
    chaptersJson: draft.chapters,
    revision: 1,
    endingTreatment: draft.endingTreatment,
    classification: "game_projection",
    createdAt: new Date("2026-09-01T08:00:00.000Z"),
    startedAt: new Date("2026-09-01T08:00:00.000Z"),
    completedAt: null,
    ...extras,
  };
}

function memoryDb(seed: Row | null = null) {
  const instances: Row[] = seed
    ? [{ ...seed, chaptersJson: structuredClone(seed.chaptersJson) }]
    : [];
  const revisions: Row[] = [];
  let failNextRevisionInsert = false;
  let beforeFirstUpdate: (() => Promise<void>) | null = null;
  let firstUpdateSeen = false;
  let beforeFirstInsert: (() => Promise<void>) | null = null;
  let firstInsertSeen = false;

  const db: any = {
    select: vi.fn(() => ({
      from: (table: object) => ({
        where: (predicate: unknown) => {
          const params = predicateParams(predicate);
          let rows: Row[] = [];
          if (table === goldlineCampaignInstances) {
            rows = instances.filter(
              row =>
                params.includes(row.tenantId) &&
                (params.includes(row.businessDate) || params.includes(row.id))
            );
          } else if (table === goldlineCampaignRevisions) {
            rows = revisions
              .filter(row => params.includes(row.campaignId))
              .sort((a, b) => Number(b.revision) - Number(a.revision));
          }
          return thenable(rows);
        },
      }),
    })),
    insert: vi.fn((table: object) => ({
      values: (value: Row) => insertValues(table, value),
    })),
    update: vi.fn((table: object) => ({
      set: (values: Row) => ({
        where: async (predicate: unknown) => {
          const updated = await updateWhere(table, values, predicate);
          return Array.isArray(updated) ? updated : updated.result;
        },
      }),
    })),
  };

  async function insertValues(table: object, value: Row) {
    if (table === goldlineCampaignRevisions) {
      if (failNextRevisionInsert) {
        failNextRevisionInsert = false;
        throw new Error("revision insert failed");
      }
      if (
        revisions.some(
          row => row.campaignId === value.campaignId && row.revision === value.revision
        )
      ) {
        const error = new Error("Duplicate entry");
        (error as { code?: string }).code = "ER_DUP_ENTRY";
        throw error;
      }
      revisions.push({ ...value });
    } else if (table === goldlineCampaignInstances) {
      if (beforeFirstInsert && !firstInsertSeen) {
        firstInsertSeen = true;
        await beforeFirstInsert();
      }
      if (
        instances.some(
          row =>
            row.tenantId === value.tenantId &&
            row.businessDate === value.businessDate &&
            Number(row.rulesVersion) === Number(value.rulesVersion)
        )
      ) {
        const error = new Error("Duplicate entry");
        (error as { code?: string }).code = "ER_DUP_ENTRY";
        throw error;
      }
      instances.push({
        ...value,
        createdAt: value.createdAt instanceof Date ? value.createdAt : new Date("2026-09-01T08:00:00.000Z"),
        startedAt: value.startedAt ?? null,
        completedAt: value.completedAt ?? null,
        completedChapterIdsJson: value.completedChapterIdsJson ?? [],
        chaptersJson: value.chaptersJson ?? [],
      });
    }
  }

  async function updateWhere(table: object, values: Row, predicate: unknown) {
    if (table !== goldlineCampaignInstances) return [{ affectedRows: 0 }];
    if (beforeFirstUpdate && !firstUpdateSeen) {
      firstUpdateSeen = true;
      await beforeFirstUpdate();
    }
    const row = instances[0];
    if (!row || !snapshotMatches(row, predicate)) {
      return [{ affectedRows: 0 }];
    }
    Object.assign(row, values);
    return [{ affectedRows: 1 }];
  }

  db.transaction = async (run: (tx: typeof db) => unknown) => {
    const undo: Array<() => void> = [];
    const tx: any = {
      insert: (table: object) => ({
        values: async (value: Row) => {
          const revisionCount = revisions.length;
          await db.insert(table).values(value);
          undo.push(() => {
            if (table === goldlineCampaignRevisions && revisions.length > revisionCount) {
              revisions.splice(revisionCount);
            }
          });
        },
      }),
      update: (table: object) => ({
        set: (values: Row) => ({
          where: async (predicate: unknown) => {
            const before = instances[0] ? structuredClone(instances[0]) : null;
            const result = await db.update(table).set(values).where(predicate);
            const affected = Array.isArray(result)
              ? Number(result[0]?.affectedRows ?? 0)
              : 0;
            if (affected === 1 && before) {
              undo.push(() => {
                if (instances[0]) Object.assign(instances[0], before);
              });
            }
            return result;
          },
        }),
      }),
    };
    try {
      return await run(tx);
    } catch (error) {
      for (const revert of undo.reverse()) revert();
      throw error;
    }
  };
  return {
    db,
    instances,
    revisions,
    failNextRevisionInsert() {
      failNextRevisionInsert = true;
    },
    onFirstUpdate(gate: () => Promise<void>) {
      firstUpdateSeen = false;
      beforeFirstUpdate = gate;
    },
    onFirstInsert(gate: () => Promise<void>) {
      firstInsertSeen = false;
      beforeFirstInsert = gate;
    },
  };
}

const followUpObjective = {
  id: "follow-up:88",
  physicalEntityId: null,
  kind: "follow_up" as const,
  authority: "persisted_task" as const,
  status: "ready" as const,
  latitude: 34.05,
  longitude: -118.3,
  windowStart: null,
  windowEnd: null,
  priority: 1,
  explanation: "Due follow-up",
  sourceEvidenceReference: "commercial_follow_ups:88",
};

const pickupObjective = {
  ...followUpObjective,
  id: "pickup:1",
  kind: "pickup" as const,
  authority: "fixed_commitment" as const,
  windowStart: "2026-09-01T09:00:00.000Z",
  sourceEvidenceReference: "orders:1",
};

describe("campaign revision concurrency", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.getFieldToday.mockReset();
    mocks.listPresentedTerritories.mockReset();
    mocks.estimateCampaignTravel.mockReset();
    mocks.appendGoldlineWorldEvent.mockReset();
    mocks.listPresentedTerritories.mockResolvedValue([]);
    mocks.estimateCampaignTravel.mockResolvedValue(emptyTravelTruth("unconfigured"));
    mocks.appendGoldlineWorldEvent.mockResolvedValue(undefined);
  });

  it("does not let a stale concurrent materialization erase authoritative completion", async () => {
    const memory = memoryDb(seedRowFromObjectives([followUpObjective]));
    mocks.getDb.mockResolvedValue(memory.db);
    const completedChapterId = memory.instances[0]!.chaptersJson[0].stableChapterId as string;

    const arrived = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    memory.onFirstUpdate(async () => {
      arrived.resolve();
      await hold.promise;
    });

    const completedToday = fieldToday({
      timeline: [],
      authoritativeCompletedObjectiveIds: ["follow-up:88"],
    });
    const staleToday = fieldToday({
      timeline: [timelineItem("pickup:42", "pickup", "new")],
    });
    let fieldTodayCalls = 0;
    mocks.getFieldToday.mockImplementation(async () => {
      fieldTodayCalls += 1;
      return fieldTodayCalls === 1 ? staleToday : completedToday;
    });

    const stale = getOrMaterializeTodayCampaign({
      tenantId: "tenant-a",
      operatorId: "driver-1",
    });
    await arrived.promise;
    const completed = await getOrMaterializeTodayCampaign({
      tenantId: "tenant-a",
      operatorId: "driver-1",
    });
    hold.resolve();
    const staleResult = await stale;

    expect(completed.campaign.completedChapterIds).toContain(completedChapterId);
    expect(staleResult.campaign.completedChapterIds).toContain(completedChapterId);
    expect(memory.instances[0]!.completedChapterIdsJson).toContain(completedChapterId);
    expect(fieldTodayCalls).toBeGreaterThan(2);
    expect(memory.revisions).toHaveLength(memory.instances[0]!.revision - 1);
  });

  it("does not let concurrent materialization overwrite an intervening branch selection", async () => {
    const memory = memoryDb(seedRowFromObjectives([pickupObjective, followUpObjective]));
    mocks.getDb.mockResolvedValue(memory.db);
    const chapters = memory.instances[0]!.chaptersJson as Array<{ stableChapterId: string }>;
    expect(chapters.length).toBeGreaterThanOrEqual(2);
    const first = memory.instances[0]!.currentChapterId as string;
    const selected = chapters.find(chapter => chapter.stableChapterId !== first);
    expect(selected).toBeTruthy();
    const second = selected!.stableChapterId;

    const arrived = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    memory.onFirstUpdate(async () => {
      arrived.resolve();
      await hold.promise;
    });

    mocks.getFieldToday.mockResolvedValue(
      fieldToday({
        timeline: [
          timelineItem("pickup:1", "pickup", "new"),
          timelineItem("follow-up:88", "follow_up"),
          timelineItem("visit:77", "commercial_visit"),
        ],
      })
    );

    const materialize = getOrMaterializeTodayCampaign({
      tenantId: "tenant-a",
      operatorId: "driver-1",
    });
    await arrived.promise;
    memory.instances[0]!.currentChapterId = second;
    hold.resolve();
    const result = await materialize;

    expect(result.campaign.currentChapterId).toBe(second);
    expect(memory.instances[0]!.currentChapterId).toBe(second);
    expect(result.campaign.currentChapterId).not.toBe(first);
  });

  it("rolls back a campaign instance update when revision insertion fails", async () => {
    const memory = memoryDb(seedRowFromObjectives([followUpObjective]));
    mocks.getDb.mockResolvedValue(memory.db);
    memory.failNextRevisionInsert();
    mocks.getFieldToday.mockResolvedValue(
      fieldToday({
        timeline: [],
        authoritativeCompletedObjectiveIds: ["follow-up:88"],
      })
    );

    await expect(
      getOrMaterializeTodayCampaign({
        tenantId: "tenant-a",
        operatorId: "driver-1",
      })
    ).rejects.toThrow("revision insert failed");

    expect(memory.instances[0]!.revision).toBe(1);
    expect(memory.instances[0]!.completedChapterIdsJson).toEqual([]);
    expect(memory.revisions).toHaveLength(0);
  });

  it("retries a bounded number of times then stops instead of looping forever", async () => {
    const memory = memoryDb(seedRowFromObjectives([followUpObjective]));
    mocks.getDb.mockResolvedValue(memory.db);
    memory.db.update = vi.fn(() => ({
      set: () => ({
        where: async () => [{ affectedRows: 0 }],
      }),
    }));
    mocks.getFieldToday.mockResolvedValue(
      fieldToday({
        timeline: [],
        authoritativeCompletedObjectiveIds: ["follow-up:88"],
      })
    );

    await expect(
      getOrMaterializeTodayCampaign({
        tenantId: "tenant-a",
        operatorId: "driver-1",
      })
    ).rejects.toThrow("Campaign revision could not be persisted after concurrent updates");
    expect(memory.db.update).toHaveBeenCalledTimes(4);
    expect(memory.instances[0]!.revision).toBe(1);
  });

  it("merges Guardian completion onto a concurrently locked chapter instead of erasing it", async () => {
    const seed = seedRowFromObjectives([followUpObjective]);
    const followUpId = seed.chaptersJson[0].stableChapterId as string;
    const finale = {
      stableChapterId: "finale-territory-1",
      chapterKind: "guardian_finale",
      objectiveIds: [],
      required: true,
      hardAnchor: false,
      campaignPhase: "climax",
      eligibleGameplayBindings: ["guardian_finale"],
      selectedGameplayBinding: "guardian_finale",
      territoryId: "territory-1",
      fictionalTreatment: "finale",
      fictionTemplateId: null,
      physicalAnchors: [],
    };
    seed.chaptersJson = [...seed.chaptersJson, finale];
    const memory = memoryDb(seed);
    mocks.getDb.mockResolvedValue(memory.db);
    mocks.getFieldToday.mockResolvedValue(fieldToday({ timeline: [timelineItem("follow-up:88", "follow_up")] }));

    const arrived = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    memory.onFirstUpdate(async () => {
      arrived.resolve();
      await hold.promise;
    });

    const guardian = recordCampaignGuardianFinaleForTerritory({
      tenantId: "tenant-a",
      operatorId: "driver-1",
      territoryId: "territory-1",
    });
    await arrived.promise;
    Object.assign(memory.instances[0]!, {
      revision: 2,
      inputFingerprint: "fp:concurrent-completion",
      completedChapterIdsJson: [followUpId],
      currentChapterId: finale.stableChapterId,
    });
    hold.resolve();
    const result = await guardian;

    expect(result.completed).toBe(true);
    expect(result.chapterId).toBe(finale.stableChapterId);
    expect(memory.instances[0]!.completedChapterIdsJson).toEqual(
      expect.arrayContaining([followUpId, finale.stableChapterId])
    );
  });

  it("does not pin a branch choice after the chapter has been revised away", async () => {
    const memory = memoryDb(seedRowFromObjectives([pickupObjective, followUpObjective]));
    mocks.getDb.mockResolvedValue(memory.db);
    const chapters = memory.instances[0]!.chaptersJson as Array<{
      stableChapterId: string;
      required: boolean;
    }>;
    const optional = chapters.find(chapter => !chapter.required);
    expect(optional).toBeTruthy();

    const both = fieldToday({
      timeline: [
        timelineItem("pickup:1", "pickup", "new"),
        timelineItem("follow-up:88", "follow_up"),
      ],
    });
    const pickupOnly = fieldToday({
      timeline: [timelineItem("pickup:1", "pickup", "new")],
    });
    let fieldTodayCalls = 0;
    mocks.getFieldToday.mockImplementation(async () => {
      fieldTodayCalls += 1;
      return fieldTodayCalls === 1 ? both : pickupOnly;
    });

    const arrived = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    memory.onFirstUpdate(async () => {
      arrived.resolve();
      await hold.promise;
    });

    const branch = chooseCampaignBranch({
      tenantId: "tenant-a",
      operatorId: "driver-1",
      chapterId: optional!.stableChapterId,
    });
    await arrived.promise;
    await getOrMaterializeTodayCampaign({
      tenantId: "tenant-a",
      operatorId: "driver-1",
    });
    hold.resolve();
    const result = await branch;

    expect(result.campaign.chapters.some(chapter => chapter.stableChapterId === optional!.stableChapterId)).toBe(
      false
    );
    expect(memory.instances[0]!.currentChapterId).not.toBe(optional!.stableChapterId);
  });

  it("reconciles a newer draft when the first-day insert lost a uniqueness race", async () => {
    const memory = memoryDb(null);
    mocks.getDb.mockResolvedValue(memory.db);
    const pickupToday = fieldToday({
      timeline: [timelineItem("pickup:1", "pickup", "new")],
    });
    const emptyToday = fieldToday({ timeline: [] });
    let fieldTodayCalls = 0;
    mocks.getFieldToday.mockImplementation(async () => {
      fieldTodayCalls += 1;
      return fieldTodayCalls === 2 ? emptyToday : pickupToday;
    });

    const arrived = Promise.withResolvers<void>();
    const hold = Promise.withResolvers<void>();
    memory.onFirstInsert(async () => {
      arrived.resolve();
      await hold.promise;
    });

    const newer = getOrMaterializeTodayCampaign({
      tenantId: "tenant-a",
      operatorId: "driver-1",
    });
    await arrived.promise;
    await getOrMaterializeTodayCampaign({
      tenantId: "tenant-a",
      operatorId: "driver-1",
    });
    hold.resolve();
    const result = await newer;

    expect(result.campaign.chapters.some(chapter => chapter.objectiveIds.includes("pickup:1"))).toBe(
      true
    );
    expect(result.campaign.status).not.toBe("quiet");
    expect(memory.instances).toHaveLength(1);
  });
});
