import { describe, expect, it } from "vitest";
import { CANONICAL_BUILDING_GEOGRAPHY } from "./canonicalGeography";
import { GOLDLINE_DAYLINE_OVERLAY_KEY } from "./goldlineDayLine";
import {
  LOST_PROPERTY_NON_UNLOCK_EVIDENCE,
  LOST_PROPERTY_OBJECTIVES_PER_CHAPTER,
  assertLostPropertyChapterPersist,
  collectEligibleObjectiveUnits,
  isRejectedUnlockEvidence,
  lostPropertyChaptersToPersist,
  previewLostPropertyUnlock,
  projectLostPropertyUnlock,
  selectFirstVerifiedTerritorialSale,
  type AdmittedPaidOrder,
  type CustomerTerritoryPlacement,
  type DayDirectorCommitmentEvidence,
  type GoalCycleActionEvidence,
  type GoalCycleObjectiveEvidence,
  type IgnoredActivityEvidence,
  type LostPropertyOperatorScope,
} from "./lostPropertyUnlock";

const TENANT = "tenant-a";
const OTHER = "tenant-b";
const OPERATOR = "op-1";
const ACTOR = "actor-7";
const scope: LostPropertyOperatorScope = {
  tenantId: TENANT,
  canonicalOperatorId: OPERATOR,
  actorIds: [ACTOR],
};

const opus = CANONICAL_BUILDING_GEOGRAPHY.opus_la;
const placed = (identity: string, tenantId = TENANT): CustomerTerritoryPlacement => ({
  tenantId,
  customerIdentityKey: identity,
  geocodeStatus: "success",
  latitude: opus.latitude,
  longitude: opus.longitude,
});

const order = (patch: Partial<AdmittedPaidOrder> & Pick<AdmittedPaidOrder, "eventKey" | "occurredAt">): AdmittedPaidOrder => ({
  tenantId: TENANT,
  cents: 4200,
  customerIdentityKey: "customer-1",
  ingestedAt: "2026-10-15T00:00:00.000Z",
  ...patch,
});

function mission(id = "mission-1") {
  return {
    operatorMission: {
      version: 1,
      source: "operator_explicit",
      scope: "today_only",
      completionCondition: "Knock the door",
      verification: "operator_reported",
      operatorMissionKey: id,
      requestedAt: "2026-10-02T15:00:00.000Z",
      weeklyIntentDisplacement: true,
      sourceCommandRef: `cmd-${id}`,
      evidenceQuote: "I'll knock",
      businessDate: "2026-10-02",
    },
  };
}

const at = (day: number, hour = 12) =>
  `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;

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

function commitment(id: string, completedAt: string | null, patch: Partial<DayDirectorCommitmentEvidence> = {}): DayDirectorCommitmentEvidence {
  return {
    tenantId: TENANT,
    actorId: ACTOR,
    id,
    status: "completed",
    completedAt,
    metadata: mission(id),
    ...patch,
  };
}

function ignored(kind: IgnoredActivityEvidence["kind"], id: string): IgnoredActivityEvidence {
  return { tenantId: TENANT, kind, id, at: at(3) };
}

describe("rejected evidence", () => {
  it("draft, schedule, send, reply, animation, Lantern City, and campaign runs unlock nothing", () => {
    for (const kind of LOST_PROPERTY_NON_UNLOCK_EVIDENCE) {
      expect(isRejectedUnlockEvidence(kind)).toBe(true);
    }
    const noise = LOST_PROPERTY_NON_UNLOCK_EVIDENCE.map((kind, index) => ignored(kind, `noise-${index}`));
    expect(collectEligibleObjectiveUnits(scope, { ignored: noise })).toEqual([]);
    const read = projectLostPropertyUnlock({
      firstSale: null,
      units: collectEligibleObjectiveUnits(scope, { ignored: noise }),
    });
    expect(read.unlockedChapters).toBe(0);
    expect(read.nextUnlockRequirement).toBe("first_verified_sale");
    expect(read.preview).toBe(false);
  });
});

describe("first verified territorial sale", () => {
  it("a verified paid order in a territory opens Chapter 1 with no Objectives", () => {
    const sale = selectFirstVerifiedTerritorialSale({
      tenantId: TENANT,
      orders: [order({ eventKey: "order:9", occurredAt: at(1, 18) })],
      placements: [placed("customer-1")],
    });
    expect(sale).toMatchObject({ territoryId: "koreatown", occurredAt: at(1, 18), eventKey: "order:9" });
    const read = projectLostPropertyUnlock({ firstSale: sale, units: [] });
    expect(read.unlockedChapters).toBe(1);
    expect(read.nextChapter).toBe(2);
    expect(read.objectivesRemaining).toBe(LOST_PROPERTY_OBJECTIVES_PER_CHAPTER);
    expect(read.chapters).toEqual([{ chapter: 1, openedAt: at(1, 18) }]);
  });

  it("uses the sale occurrence, not a later ingestion time, and keeps the historical first", () => {
    const sale = selectFirstVerifiedTerritorialSale({
      tenantId: TENANT,
      orders: [
        order({ eventKey: "order:2", occurredAt: at(4), ingestedAt: at(1) }),
        order({ eventKey: "order:1", occurredAt: at(2), ingestedAt: "2026-12-01T00:00:00.000Z" }),
      ],
      placements: [placed("customer-1")],
    });
    expect(sale).toMatchObject({ eventKey: "order:1", occurredAt: at(2) });
  });

  it("a replay of the same paid order does not create a second sale or move the time later", () => {
    const sale = selectFirstVerifiedTerritorialSale({
      tenantId: TENANT,
      orders: [
        order({ eventKey: "order:1", occurredAt: at(4, 9) }),
        order({ eventKey: "order:1", occurredAt: at(2, 8) }),
        order({ eventKey: "order:1", occurredAt: at(6) }),
      ],
      placements: [placed("customer-1")],
    });
    expect(sale).toMatchObject({ eventKey: "order:1", occurredAt: at(2, 8) });
  });

  it("rejects sends, unpaid lookalikes, zero cents, failed geocodes, and other tenants", () => {
    const placements = [placed("customer-1"), placed("other-customer", OTHER)];
    expect(
      selectFirstVerifiedTerritorialSale({
        tenantId: TENANT,
        orders: [
          order({ eventKey: "message:sent", occurredAt: at(1), cents: 4200, customerIdentityKey: "customer-1" }),
          order({ eventKey: "message:reply", occurredAt: at(1), cents: 4200 }),
          order({ eventKey: "cleancloud:77:excluded:orders_revenue:0", occurredAt: at(1), cents: 4200 }),
          order({ eventKey: "order:free", occurredAt: at(1), cents: 0 }),
          order({ eventKey: "order:negative", occurredAt: at(1), cents: -100 }),
          order({ eventKey: "order:ungeocoded", occurredAt: at(1), customerIdentityKey: "missing" }),
          order({
            eventKey: "order:pending",
            occurredAt: at(1),
            customerIdentityKey: "pending",
          }),
          order({ eventKey: "order:other-tenant", occurredAt: at(1), tenantId: OTHER, customerIdentityKey: "other-customer" }),
        ],
        placements: [
          ...placements,
          { ...placed("pending"), geocodeStatus: "pending", latitude: null, longitude: null },
          { ...placed("outside"), latitude: 0, longitude: 0 },
        ],
      })
    ).toBeNull();
    expect(
      selectFirstVerifiedTerritorialSale({
        tenantId: TENANT,
        orders: [order({ eventKey: "order:outside", occurredAt: at(1), customerIdentityKey: "outside" })],
        placements: [{ ...placed("outside"), latitude: 0, longitude: 0 }],
      })
    ).toBeNull();
  });

  it("does not let another tenant's placement classify this tenant's order", () => {
    expect(
      selectFirstVerifiedTerritorialSale({
        tenantId: TENANT,
        orders: [order({ eventKey: "order:1", occurredAt: at(1) })],
        placements: [placed("customer-1", OTHER)],
      })
    ).toBeNull();
  });
});

describe("objective counting", () => {
  const sale = {
    territoryId: "koreatown",
    occurredAt: at(1, 18),
    eventKey: "order:1",
  };

  function unitsFrom(count: number, startDay = 2) {
    const objectives = Array.from({ length: count }, (_, index) => objective(`obj-${index}`));
    const outcomes = objectives.map((row, index) => action(row.id, at(startDay + index)));
    return collectEligibleObjectiveUnits(scope, { objectives, outcomes });
  }

  it("three completions after Chapter 1 open Chapter 2, and three more open Chapter 3", () => {
    const two = projectLostPropertyUnlock({ firstSale: sale, units: unitsFrom(2) });
    expect(two.unlockedChapters).toBe(1);
    expect(two.objectivesRemaining).toBe(1);

    const three = projectLostPropertyUnlock({ firstSale: sale, units: unitsFrom(3) });
    expect(three.unlockedChapters).toBe(2);
    expect(three.chapters[1]).toEqual({ chapter: 2, openedAt: at(4) });
    expect(three.objectivesRemaining).toBe(3);

    const five = projectLostPropertyUnlock({ firstSale: sale, units: unitsFrom(5) });
    expect(five.unlockedChapters).toBe(2);
    expect(five.objectivesRemaining).toBe(1);
    expect(five.objectiveCounts).toEqual({ afterChapter1: 5, afterChapter2: 2 });

    const six = projectLostPropertyUnlock({ firstSale: sale, units: unitsFrom(6) });
    expect(six.unlockedChapters).toBe(3);
    expect(six.nextChapter).toBeNull();
    expect(six.nextUnlockRequirement).toBe("all_unlocked");
    expect(six.chapters[2]).toEqual({ chapter: 3, openedAt: at(7) });
    expect(six.chapters.some(chapter => chapter.chapter > 3)).toBe(false);
  });

  it("counts completion time, ignores work before the previous chapter, and ignores the read clock", () => {
    const units = collectEligibleObjectiveUnits(scope, {
      objectives: [objective("before"), objective("same"), objective("a"), objective("b"), objective("c")],
      outcomes: [
        action("before", "2026-09-01T00:00:00.000Z", { createdAt: at(9) }),
        action("same", sale.occurredAt, { createdAt: at(9) }),
        action("a", at(2), { createdAt: at(9) }),
        action("b", at(3), { createdAt: at(9) }),
        action("c", at(4), { createdAt: at(9) }),
      ],
    });
    const read = projectLostPropertyUnlock({ firstSale: sale, units });
    expect(read.unlockedChapters).toBe(2);
    expect(read.chapters[1]?.openedAt).toBe(at(4));
    expect(units.find(unit => unit.key === "objective:a")?.completedAt).toBe(at(2));
  });

  it("does not count unfinished, economic-only, attested, or message-status rows", () => {
    const units = collectEligibleObjectiveUnits(scope, {
      objectives: [
        objective("attempted", { status: "action_attempted" }),
        objective("open", { status: "in_progress" }),
        objective("draft", { status: "draft" }),
        objective("scheduled", { status: "scheduled" }),
        objective("sent", { status: "sent" }),
        objective("replied", { status: "replied" }),
        objective("revenue", { status: "completed" }),
        objective("attested", { status: "action_executed" }),
        objective("unknown-type", { executionType: null }),
        objective("other-operator", { canonicalOperatorId: "op-2" }),
        objective("other-tenant", { tenantId: OTHER }),
      ],
      outcomes: [
        action("attempted", at(2)),
        action("open", at(2)),
        action("draft", at(2)),
        action("scheduled", at(2)),
        action("sent", at(2)),
        action("replied", at(2)),
        action("revenue", at(2), { impactClass: "commercial_revenue" }),
        action("attested", at(2), { epistemicStatus: "attested" }),
        action("unknown-type", at(2)),
        action("other-operator", at(2)),
        action("other-tenant", at(2), { tenantId: OTHER }),
      ],
      ignored: LOST_PROPERTY_NON_UNLOCK_EVIDENCE.map((kind, index) => ignored(kind, `x-${index}`)),
    });
    expect(units).toEqual([]);
    expect(projectLostPropertyUnlock({ firstSale: sale, units }).unlockedChapters).toBe(1);
  });

  it("replays and campaign rows do not double count the same work", () => {
    const units = collectEligibleObjectiveUnits(scope, {
      objectives: [
        objective("obj-1", { actionTargetType: "commitment", actionTargetId: "commit-1" }),
        objective("obj-1-replay", { actionTargetType: "campaign", actionTargetId: "campaign-9" }),
      ],
      outcomes: [
        action("obj-1", at(5)),
        action("obj-1", at(3)),
        action("obj-1-replay", at(4)),
        action("obj-1-replay", at(6), { createdAt: at(2) }),
      ],
      commitments: [commitment("commit-1", at(8))],
      ignored: [ignored("campaign_run", "campaign-9"), ignored("message_sent", "sms-1")],
    });
    expect(units.map(unit => unit.key).sort()).toEqual(["commitment:commit-1", "objective:obj-1-replay"]);
    expect(units.find(unit => unit.key === "commitment:commit-1")?.completedAt).toBe(at(3));
    expect(units.find(unit => unit.key === "objective:obj-1-replay")?.completedAt).toBe(at(4));
  });

  it("counts a completed operator mission by its completedAt and ignores unfinished commitments", () => {
    const units = collectEligibleObjectiveUnits(scope, {
      commitments: [
        commitment("done", at(2)),
        commitment("open", null, { status: "open" }),
        commitment("no-mission", at(2), { metadata: {} }),
        commitment("hidden", at(2), { metadata: { ...mission("hidden"), hiddenFromDayPlan: true } }),
        commitment("cancelled", at(2), {
          metadata: { ...mission("cancelled"), [GOLDLINE_DAYLINE_OVERLAY_KEY]: { cancelledAt: at(2) } },
        }),
        commitment("other-actor", at(2), { actorId: "someone-else" }),
        commitment("other-tenant", at(2), { tenantId: OTHER }),
      ],
    });
    expect(units).toEqual([{ key: "commitment:done", completedAt: at(2) }]);
  });

  it("objectives alone never open Chapter 1", () => {
    const read = projectLostPropertyUnlock({ firstSale: null, units: unitsFrom(12) });
    expect(read.unlockedChapters).toBe(0);
    expect(read.chapters).toEqual([]);
  });
});

describe("chapter permanence", () => {
  const sale = {
    territoryId: "koreatown",
    occurredAt: at(1, 18),
    eventKey: "order:9",
  };

  function unitsFrom(count: number, startDay = 2) {
    const objectives = Array.from({ length: count }, (_, index) => objective(`obj-${index}`));
    const outcomes = objectives.map((row, index) => action(row.id, at(startDay + index)));
    return collectEligibleObjectiveUnits(scope, { objectives, outcomes });
  }

  it("records chapter 1 from the sale and does not record it again", () => {
    const first = lostPropertyChaptersToPersist({ firstSale: sale, units: [] });
    expect(first).toEqual([
      {
        chapter: 1,
        openedAt: sale.occurredAt,
        evidence: {
          ruleVersion: 2,
          kind: "territorial_sale",
          eventKey: "order:9",
          territoryId: "koreatown",
          occurredAt: sale.occurredAt,
        },
      },
    ]);
    expect(
      lostPropertyChaptersToPersist({
        firstSale: sale,
        units: [],
        persisted: first.map(row => ({ chapter: row.chapter, openedAt: row.openedAt })),
      })
    ).toEqual([]);
  });

  it("keeps a stored chapter 1 when the sale would no longer qualify, and still refuses chapter 4", () => {
    const stored = [{ chapter: 1, openedAt: sale.occurredAt }];
    expect(lostPropertyChaptersToPersist({ firstSale: null, units: [], persisted: stored })).toEqual([]);
    const kept = projectLostPropertyUnlock({ firstSale: null, units: [], persisted: stored });
    expect(kept.chapters).toEqual([{ chapter: 1, openedAt: sale.occurredAt }]);
    const continued = lostPropertyChaptersToPersist({ firstSale: null, units: unitsFrom(12), persisted: stored });
    expect(continued.map(row => row.chapter)).toEqual([2, 3]);
    expect(
      projectLostPropertyUnlock({ firstSale: null, units: unitsFrom(12), persisted: stored }).chapters.map(
        chapter => chapter.chapter
      )
    ).toEqual([1, 2, 3]);
    expect(lostPropertyChaptersToPersist({ firstSale: sale, units: unitsFrom(12) }).map(row => row.chapter)).toEqual([
      1, 2, 3,
    ]);
    expect(() =>
      assertLostPropertyChapterPersist({
        chapter: 4,
        openedAt: sale.occurredAt,
        evidence: {
          ruleVersion: 2,
          kind: "territorial_sale",
          eventKey: "order:9",
          territoryId: "koreatown",
          occurredAt: sale.occurredAt,
        },
      })
    ).toThrow(/chapter 4/);
  });
});

describe("preview", () => {
  it("reports every playable chapter open and records no sale, no chapters, and no objective counts", () => {
    expect(previewLostPropertyUnlock()).toMatchObject({
      unlockedChapters: 3,
      preview: true,
      chapters: [],
      firstSaleTerritoryId: null,
      firstSaleOccurredAt: null,
      objectiveCounts: { afterChapter1: 0, afterChapter2: 0 },
    });
  });
});
