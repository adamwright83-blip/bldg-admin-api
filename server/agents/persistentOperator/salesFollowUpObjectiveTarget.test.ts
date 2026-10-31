import { beforeEach, describe, expect, it, vi } from "vitest";
import { commercialMissions, goalCycleObjectives } from "../../../drizzle/schema";
import { salesFollowUpObligation } from "../../../shared/claireProactive";
import type { GoalCycleDecisionRecord } from "./decisionStore";
import type { PersistentObligation } from "./obligationStore";

/**
 * A sales_follow_up obligation is keyed by its commercial mission. The objective
 * materialized from it must name that mission, so a driver's field action on the
 * mission credits that follow-up, and only that follow-up.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  objectives: [] as Record<string, unknown>[],
  missionAccount: new Map<number, number>(),
  missionUnderTest: 0,
}));

function query(selectFields: unknown) {
  let table: unknown = null;
  const builder: Record<string, unknown> = {};
  for (const method of ["where", "orderBy", "limit", "for", "innerJoin", "leftJoin"]) {
    builder[method] = () => builder;
  }
  builder.from = (from: unknown) => {
    table = from;
    return builder;
  };
  builder.then = (resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve()
      .then(() => {
        if (table === goalCycleObjectives) return state.objectives;
        if (table === commercialMissions) {
          const accountId = state.missionAccount.get(state.missionUnderTest);
          return accountId == null ? [] : [{ accountSnapshotJson: { accountId } }];
        }
        return [];
      })
      .then(resolve, reject);
  void selectFields;
  return builder;
}

const fakeDb: Record<string, unknown> = {
  select: (fields?: unknown) => query(fields),
  insert: (table: unknown) => ({
    values: async (values: Row) => {
      if (table === goalCycleObjectives) {
        state.objectives.push({
          latestDecisionId: null,
          createdAt: new Date("2026-10-31T16:00:00.000Z"),
          updatedAt: new Date("2026-10-31T16:00:00.000Z"),
          ...values,
        });
      }
    },
  }),
  update: () => ({ set: () => ({ where: async () => [{ affectedRows: 0 }] }) }),
  // The transaction sees the same rows; the reuse lookup inside it finds none.
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

vi.mock("../../db", () => ({ getDb: vi.fn(async () => fakeDb) }));

import { materializeGoalCycleObjective, obligationActionTarget } from "./objectiveStore";
import { findDeterministicObjectivesForDriverAction } from "./fieldEventBridge";

function salesObligationRecord(missionId: number, accountName: string): PersistentObligation {
  const payload = salesFollowUpObligation({
    accountKey: String(missionId),
    accountName,
    dueDate: "2026-11-02",
    nextStep: "Email the revised quote.",
    lastOutcome: null,
    history: ["Email the revised quote."],
  });
  return {
    id: payload.id,
    tenantId: "tenant-follow",
    operatorUserId: "op-1",
    canonicalOperatorId: "tenant:tenant-follow:operator:op-1",
    kind: payload.kind,
    subjectKey: payload.subjectKey,
    status: payload.status,
    dueDate: payload.dueDate,
    payload,
    goalRunId: null,
    cycleId: null,
    decisionId: null,
    executionType: null,
    commercialFollowUpRef: `follow-${missionId}`,
    objectiveRef: null,
    agentEventId: null,
  };
}

function decisionFor(obligation: PersistentObligation, id: string): GoalCycleDecisionRecord {
  return {
    id,
    decisionFingerprint: `fp-${id}`,
    createdAt: "2026-10-31T16:00:00.000Z",
    tenantId: "tenant-follow",
    goalRunId: "run-1",
    cycleId: `cycle-${id}`,
    canonicalOperatorId: "tenant:tenant-follow:operator:op-1",
    operatorUserId: "op-1",
    policyVersion: "test",
    weeklyIntentId: null,
    weeklyIntentRevision: null,
    weekStart: null,
    candidateFingerprint: null,
    candidateIds: [],
    candidateReasonCodes: {},
    missionDirectorPlanId: null,
    missionDirectorRevision: null,
    selectionKind: "obligation",
    selectedRef: obligation.id,
    selectedExecutionType: "challenge",
    selectedReasonCode: "obligation_due",
    evidenceRefs: [],
    blockedCandidates: [],
    priorComparableDecisionId: null,
    sourceCoverage: null,
    loadout: [],
    experiment: null,
  };
}

async function materialize(obligation: PersistentObligation, decisionId: string) {
  // Each materialization sees only what it inserts, so it never re-selects a sibling.
  const before = state.objectives;
  state.objectives = [];
  const { objective } = await materializeGoalCycleObjective({
    tenantId: "tenant-follow",
    decision: decisionFor(obligation, decisionId),
    obligation,
  });
  state.objectives = [...before, ...state.objectives];
  return objective;
}

async function creditedBy(missionId: number): Promise<string[]> {
  state.missionUnderTest = missionId;
  const matches = await findDeterministicObjectivesForDriverAction({
    tenantId: "tenant-follow",
    actorId: "driver-1",
    missionId,
    evidenceReference: `commercial_mission_events:${missionId}00`,
  });
  return matches.map(objective => objective.id);
}

describe("sales_follow_up objectives target the commercial mission", () => {
  beforeEach(() => {
    state.objectives = [];
    state.missionAccount = new Map();
    state.missionUnderTest = 0;
  });

  it("labels a sales follow-up as its commercial mission, and a recovery as its customer", () => {
    expect(obligationActionTarget({ kind: "sales_follow_up", subjectKey: "101" })).toEqual({
      actionTargetType: "commercial_mission",
      actionTargetId: "101",
    });
    expect(obligationActionTarget({ kind: "dormant_recovery", subjectKey: "phone:3105550101" })).toEqual({
      actionTargetType: "customer",
      actionTargetId: "phone:3105550101",
    });
  });

  it("a field action on mission M credits the follow-up for M and nothing else", async () => {
    // Mission 101's account happens to have id 202, the same number as another
    // mission. Before this repair the follow-up for mission 202 was stored as
    // commercial_account:202 and an action on mission 101 credited it.
    state.missionAccount.set(101, 202);
    state.missionAccount.set(202, 7);

    const followUp101 = await materialize(salesObligationRecord(101, "Larkspur Hotel"), "dec-101");
    const followUp202 = await materialize(salesObligationRecord(202, "Juniper Spa"), "dec-202");

    expect(await creditedBy(101)).toEqual([followUp101.id]);
    expect(await creditedBy(202)).toEqual([followUp202.id]);
    // A mission with no follow-up of its own credits none.
    expect(await creditedBy(7)).toEqual([]);

    expect(followUp101).toMatchObject({
      actionTargetType: "commercial_mission",
      actionTargetId: "101",
      actionTargetDisplayName: "Larkspur Hotel",
    });
    expect(followUp202).toMatchObject({ actionTargetType: "commercial_mission", actionTargetId: "202" });
  });
});
