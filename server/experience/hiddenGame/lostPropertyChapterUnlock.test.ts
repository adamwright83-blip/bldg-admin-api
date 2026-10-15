import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CANONICAL_BUILDING_GEOGRAPHY } from "../../../shared/canonicalGeography";
import {
  LOST_PROPERTY_NON_UNLOCK_EVIDENCE,
  collectEligibleObjectiveUnits,
  projectLostPropertyUnlock,
  selectFirstVerifiedTerritorialSale,
  type AdmittedPaidOrder,
  type CompletedUnit,
  type CustomerTerritoryPlacement,
  type DayDirectorCommitmentEvidence,
  type FirstVerifiedSale,
  type GoalCycleActionEvidence,
  type GoalCycleObjectiveEvidence,
  type LostPropertyChapterPersist,
  type LostPropertyOperatorScope,
  type UnlockRecord,
} from "../../../shared/lostPropertyUnlock";
import { readDurableLostPropertyUnlock, type LostPropertyDurableDeps } from "./lostPropertyChapterUnlock";
import type { LostPropertyScope } from "./lostPropertyUnlockRead";

const TENANT = "tenant-a";
const OPERATOR = "op-1";
const ACTOR = "actor-7";
const scope: LostPropertyScope = {
  tenantId: TENANT,
  canonicalOperatorId: OPERATOR,
  actorIds: [ACTOR],
  operatorOpenIds: ["open-1"],
};
const operatorScope: LostPropertyOperatorScope = {
  tenantId: TENANT,
  canonicalOperatorId: OPERATOR,
  actorIds: [ACTOR],
};

const opus = CANONICAL_BUILDING_GEOGRAPHY.opus_la;
const placed = (identity: string): CustomerTerritoryPlacement => ({
  tenantId: TENANT,
  customerIdentityKey: identity,
  geocodeStatus: "success",
  latitude: opus.latitude,
  longitude: opus.longitude,
});

const at = (day: number, hour = 12) =>
  `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

const order = (patch: Partial<AdmittedPaidOrder> & Pick<AdmittedPaidOrder, "eventKey" | "occurredAt">): AdmittedPaidOrder => ({
  tenantId: TENANT,
  cents: 4200,
  customerIdentityKey: "customer-1",
  ingestedAt: "2026-10-15T00:00:00.000Z",
  ...patch,
});

function objective(id: string, patch: Partial<GoalCycleObjectiveEvidence> = {}): GoalCycleObjectiveEvidence {
  return {
    tenantId: TENANT,
    canonicalOperatorId: OPERATOR,
    id,
    executionType: "mission",
    status: "action_executed",
    actionTargetType: null,
    actionTargetId: null,
    ...patch,
  };
}

function action(objectiveId: string, observedAt: string, patch: Partial<GoalCycleActionEvidence> = {}): GoalCycleActionEvidence {
  return {
    tenantId: TENANT,
    objectiveId,
    observedAt,
    createdAt: "2026-10-20T00:00:00.000Z",
    impactClass: "action_verification",
    epistemicStatus: "verified",
    ...patch,
  };
}

function commitment(id: string, completedAt: string): DayDirectorCommitmentEvidence {
  return {
    tenantId: TENANT,
    actorId: ACTOR,
    id,
    status: "completed",
    completedAt,
    metadata: {
      operatorMission: {
        version: 1,
        source: "operator_explicit",
        scope: "today_only",
        completionCondition: "Knock the door",
        verification: "operator_reported",
        operatorMissionKey: id,
        requestedAt: at(2, 15),
        weeklyIntentDisplacement: true,
        sourceCommandRef: `cmd-${id}`,
        evidenceQuote: "I'll knock",
        businessDate: "2026-10-02",
      },
    },
  };
}

function unitsFrom(count: number, startDay = 2): CompletedUnit[] {
  const objectives = Array.from({ length: count }, (_, index) => objective(`obj-${index}`));
  const outcomes = objectives.map((row, index) => action(row.id, at(startDay + index)));
  return collectEligibleObjectiveUnits(operatorScope, { objectives, outcomes });
}

type StoredChapter = LostPropertyChapterPersist & {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
};

function memoryStore() {
  const rows: StoredChapter[] = [];
  return {
    rows,
    async readPersisted(scope: LostPropertyScope): Promise<UnlockRecord[]> {
      return rows
        .filter(row => row.tenantId === scope.tenantId && row.canonicalOperatorId === scope.canonicalOperatorId)
        .map(row => ({ chapter: row.chapter, openedAt: row.openedAt }));
    },
    async insertChapter(scope: LostPropertyScope, record: LostPropertyChapterPersist): Promise<void> {
      const existing = rows.find(
        row =>
          row.tenantId === scope.tenantId &&
          row.canonicalOperatorId === scope.canonicalOperatorId &&
          row.chapter === record.chapter
      );
      if (existing) return;
      rows.push({
        ...record,
        id: `row-${rows.length + 1}`,
        tenantId: scope.tenantId,
        canonicalOperatorId: scope.canonicalOperatorId,
      });
    },
  };
}

function harness(init: {
  sale?: FirstVerifiedSale | null;
  units?: CompletedUnit[];
  store?: ReturnType<typeof memoryStore>;
  env?: LostPropertyDurableDeps["env"];
}) {
  const store = init.store ?? memoryStore();
  const readPersisted = vi.fn((scope: LostPropertyScope) => store.readPersisted(scope));
  const insertChapter = vi.fn((scope: LostPropertyScope, record: LostPropertyChapterPersist) =>
    store.insertChapter(scope, record)
  );
  const deps: LostPropertyDurableDeps = {
    readFirstSale: vi.fn(async () => (init.sale === undefined ? null : init.sale)),
    readCompletedUnits: vi.fn(async () => init?.units ?? []),
    readPersisted,
    insertChapter,
    env: init.env ?? {},
  };
  return { deps, store, insertChapter };
}

const territorialSale = selectFirstVerifiedTerritorialSale({
  tenantId: TENANT,
  orders: [order({ eventKey: "order:9", occurredAt: at(1, 18) })],
  placements: [placed("customer-1")],
});

describe("durable Lost Property chapter unlocks", () => {
  it("a paid territorial sale unlocks chapter 1 and the second read keeps that row", async () => {
    expect(territorialSale).toMatchObject({
      territoryId: "koreatown",
      occurredAt: at(1, 18),
      eventKey: "order:9",
    });
    const store = memoryStore();
    const first = harness({ sale: territorialSale, units: [], store });
    const opened = await readDurableLostPropertyUnlock(scope, first.deps);
    expect(opened.unlockedChapters).toBe(1);
    expect(opened.chapters).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      chapter: 1,
      openedAt: at(1, 18),
      evidence: {
        ruleVersion: 2,
        kind: "territorial_sale",
        eventKey: "order:9",
        territoryId: "koreatown",
        occurredAt: at(1, 18),
      },
    });

    const second = harness({ sale: territorialSale, units: [], store });
    const again = await readDurableLostPropertyUnlock(scope, second.deps);
    expect(again.unlockedChapters).toBe(1);
    expect(again.chapters[0]?.openedAt).toBe(at(1, 18));
    expect(store.rows).toHaveLength(1);
    expect(store.rows.map(row => row.id)).toEqual(["row-1"]);
    expect(second.insertChapter).not.toHaveBeenCalled();
  });

  it("an SMS, a draft, a reply, a visit, and a zero-dollar event do not open a chapter", async () => {
    const sale = selectFirstVerifiedTerritorialSale({
      tenantId: TENANT,
      orders: [
        order({ eventKey: "message:sent", occurredAt: at(1), cents: 4200 }),
        order({ eventKey: "message:draft", occurredAt: at(1), cents: 4200 }),
        order({ eventKey: "message:reply", occurredAt: at(1), cents: 4200 }),
        order({ eventKey: "visit:4", occurredAt: at(1), cents: 4200 }),
        order({ eventKey: "order:0", occurredAt: at(1), cents: 0 }),
      ],
      placements: [placed("customer-1")],
    });
    expect(sale).toBeNull();
    const units = collectEligibleObjectiveUnits(operatorScope, {
      objectives: [
        objective("draft", { status: "draft" }),
        objective("attempted", { status: "action_attempted" }),
        objective("cancelled", { status: "cancelled" }),
      ],
      outcomes: [action("draft", at(2)), action("attempted", at(2)), action("cancelled", at(2))],
      ignored: LOST_PROPERTY_NON_UNLOCK_EVIDENCE.map((kind, index) => ({
        tenantId: TENANT,
        kind,
        id: `noise-${index}`,
        at: at(2),
      })),
    });
    expect(units).toEqual([]);
    const { deps, store, insertChapter } = harness({ sale, units });
    const read = await readDurableLostPropertyUnlock(scope, deps);
    expect(read.unlockedChapters).toBe(0);
    expect(read.chapters).toEqual([]);
    expect(store.rows).toEqual([]);
    expect(insertChapter).not.toHaveBeenCalled();
  });

  it("three later distinct completions open chapter 2, three more open chapter 3, and replay does not add rows", async () => {
    const store = memoryStore();
    const three = unitsFrom(3);
    const first = harness({ sale: territorialSale, units: three, store });
    const chapter2 = await readDurableLostPropertyUnlock(scope, first.deps);
    expect(chapter2.unlockedChapters).toBe(2);
    expect(chapter2.chapters[1]).toEqual({ chapter: 2, openedAt: at(4) });
    expect(store.rows.map(row => row.chapter)).toEqual([1, 2]);
    expect(store.rows[1]?.evidence).toMatchObject({
      kind: "objective_completion",
      unitKey: "objective:obj-2",
      completedAt: at(4),
    });

    const sameWork = collectEligibleObjectiveUnits(operatorScope, {
      objectives: [objective("obj-2", { actionTargetType: "commitment", actionTargetId: "commit-2" })],
      outcomes: [action("obj-2", at(8))],
      commitments: [commitment("commit-2", at(4))],
    });
    expect(sameWork).toEqual([{ key: "commitment:commit-2", completedAt: at(4) }]);
    const replay = harness({
      sale: territorialSale,
      units: [...three, ...three, ...sameWork],
      store,
    });
    const replayedRead = await readDurableLostPropertyUnlock(scope, replay.deps);
    expect(replayedRead.unlockedChapters).toBe(2);
    expect(store.rows).toHaveLength(2);
    expect(replay.insertChapter).not.toHaveBeenCalled();

    const six = unitsFrom(6);
    const third = harness({ sale: territorialSale, units: six, store });
    const chapter3 = await readDurableLostPropertyUnlock(scope, third.deps);
    expect(chapter3.unlockedChapters).toBe(3);
    expect(chapter3.chapters.map(chapter => chapter.chapter)).toEqual([1, 2, 3]);
    expect(chapter3.chapters[2]).toEqual({ chapter: 3, openedAt: at(7) });
    expect(chapter3.nextChapter).toBeNull();
    expect(store.rows.map(row => row.chapter)).toEqual([1, 2, 3]);
    expect(store.rows[2]?.evidence).toMatchObject({ unitKey: "objective:obj-5", completedAt: at(7) });

    const fourth = harness({ sale: territorialSale, units: unitsFrom(12), store });
    const stillThree = await readDurableLostPropertyUnlock(scope, fourth.deps);
    expect(stillThree.unlockedChapters).toBe(3);
    expect(stillThree.chapters.some(chapter => chapter.chapter > 3)).toBe(false);
    expect(store.rows.map(row => row.chapter)).toEqual([1, 2, 3]);
    expect(fourth.insertChapter).not.toHaveBeenCalled();
  });

  it("a recompute that would have withheld the sale leaves chapter 1 open", async () => {
    const store = memoryStore();
    await readDurableLostPropertyUnlock(scope, harness({ sale: territorialSale, units: [], store }).deps);
    const openedAt = store.rows[0]?.openedAt;
    const evidence = store.rows[0]?.evidence;
    expect(projectLostPropertyUnlock({ firstSale: null, units: [] }).unlockedChapters).toBe(0);

    const withheld = harness({ sale: null, units: [], store });
    const read = await readDurableLostPropertyUnlock(scope, withheld.deps);
    expect(read.unlockedChapters).toBe(1);
    expect(read.chapters).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.openedAt).toBe(openedAt);
    expect(store.rows[0]?.evidence).toEqual(evidence);
    expect(withheld.insertChapter).not.toHaveBeenCalled();
  });

  it("stores chapters for the operator that earned them", async () => {
    const store = memoryStore();
    await readDurableLostPropertyUnlock(scope, harness({ sale: territorialSale, units: [], store }).deps);
    const other = harness({
      sale: null,
      units: [],
      store,
    });
    const read = await readDurableLostPropertyUnlock(
      { ...scope, canonicalOperatorId: "op-2" },
      other.deps
    );
    expect(read.unlockedChapters).toBe(0);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]?.canonicalOperatorId).toBe(OPERATOR);
  });

  it("preview does not read the ledger and does not insert a chapter", async () => {
    const readFirstSale = vi.fn(async () => {
      throw new Error("must not read");
    });
    const readCompletedUnits = vi.fn(async () => {
      throw new Error("must not read");
    });
    const readPersisted = vi.fn(async () => {
      throw new Error("must not read");
    });
    const insertChapter = vi.fn(async () => {
      throw new Error("must not insert");
    });
    const read = await readDurableLostPropertyUnlock(scope, {
      readFirstSale,
      readCompletedUnits,
      readPersisted,
      insertChapter,
      env: { openIds: "open-1", tenantId: TENANT },
    });
    expect(read.preview).toBe(true);
    expect(read.chapters).toEqual([]);
    expect(readFirstSale).not.toHaveBeenCalled();
    expect(readCompletedUnits).not.toHaveBeenCalled();
    expect(readPersisted).not.toHaveBeenCalled();
    expect(insertChapter).not.toHaveBeenCalled();
  });
});

describe("chapter unlock migration", () => {
  const sql = readFileSync(new URL("../../../drizzle/0135_hidden_game_chapter_unlocks.sql", import.meta.url), "utf8");
  const migrate = readFileSync(new URL("../../../scripts/migrate.mjs", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../../../drizzle/schema.ts", import.meta.url), "utf8");
  const writer = readFileSync(new URL("./lostPropertyChapterUnlock.ts", import.meta.url), "utf8");

  it("registers 0135, keeps chapter 4 out of the table, and does not delete a stored chapter", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `hidden_game_chapter_unlocks`");
    expect(sql).toContain("UNIQUE KEY `uq_hidden_game_chapter_unlock` (`tenantId`, `canonicalOperatorId`, `chapter`)");
    expect(sql).toContain("CHECK (`chapter` IN (1, 2, 3))");
    expect(sql).not.toContain("0128_hidden_game_chapter_unlocks");
    expect(migrate).toContain("../drizzle/0135_hidden_game_chapter_unlocks.sql");
    expect(migrate).toContain('await assertRequiredColumns("hidden_game_chapter_unlocks"');
    const registration = migrate.slice(migrate.indexOf("const hiddenGameChapterUnlockDdl"));
    expect(registration.slice(0, registration.indexOf("const assertRequiredColumns"))).toContain(
      '.replace(/^\\s*--.*$/gm, "")'
    );
    expect(schema).toContain('mysqlTable(\n  "hidden_game_chapter_unlocks"');
    expect(writer).not.toMatch(/\.delete\s*\(/);
    const duplicate = writer.slice(writer.indexOf("onDuplicateKeyUpdate"));
    expect(duplicate).not.toContain("openedAt");
    expect(duplicate).not.toContain("evidenceJson");
    expect(writer).toContain("assertLostPropertyChapterPersist");
  });
});
