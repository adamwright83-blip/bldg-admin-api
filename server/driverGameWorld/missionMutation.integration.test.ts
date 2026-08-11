/**
 * Mission Mutation persistence against real MySQL. Proves the load-bearing
 * claims: repeated evaluation of identical evidence is idempotent, different
 * actors never collide, reload reads back the same durable mutation, and a
 * CLOSED mission cannot be reopened by game state.
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { missionMutations } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  evaluateAndPersistMutation,
  getLatestMutation,
  listMissionMutations,
} from "./missionMutationService";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const missionIds: number[] = [];

describe.skipIf(!runDatabaseGate)("Mission Mutation persistence", () => {
  afterAll(async () => {
    if (!missionIds.length) return;
    const db = await getDb();
    if (!db) return;
    await db
      .delete(missionMutations)
      .where(inArray(missionMutations.missionId, missionIds));
  });

  it("persists once and is idempotent on repeated identical evaluation", async () => {
    const tenantId = `t-${randomUUID()}`;
    const missionId = 9_001 + Math.floor(Math.random() * 100_000);
    missionIds.push(missionId);

    const first = await evaluateAndPersistMutation({
      tenantId,
      actorId: "driver-1",
      missionId,
      evidence: {
        missionStatus: "follow_up",
        pipelineStage: "follow_up",
        lossReason: null,
        followUpDueAt: "2026-08-15T17:00:00.000Z",
        hasDecisionMakerContact: true,
        verifiedWin: false,
      },
    });
    const second = await evaluateAndPersistMutation({
      tenantId,
      actorId: "driver-1",
      missionId,
      evidence: {
        missionStatus: "follow_up",
        pipelineStage: "follow_up",
        lossReason: null,
        followUpDueAt: "2026-08-15T17:00:00.000Z",
        hasDecisionMakerContact: true,
        verifiedWin: false,
      },
    });

    expect(first?.id).toBe(second?.id);
    const all = await listMissionMutations({ tenantId, actorId: "driver-1", missionId });
    expect(all).toHaveLength(1);
  });

  it("survives reload by reading back the same durable mutation", async () => {
    const tenantId = `t-${randomUUID()}`;
    const missionId = 9_001 + Math.floor(Math.random() * 100_000);
    missionIds.push(missionId);

    const persisted = await evaluateAndPersistMutation({
      tenantId,
      actorId: "driver-1",
      missionId,
      evidence: {
        missionStatus: "won",
        pipelineStage: "won",
        lossReason: null,
        followUpDueAt: null,
        hasDecisionMakerContact: true,
        verifiedWin: true,
      },
    });
    const reloaded = await getLatestMutation({ tenantId, actorId: "driver-1", missionId });
    expect(reloaded?.id).toBe(persisted?.id);
    expect(reloaded?.mutationType).toBe("CAPTURED_PATH");
  });

  it("does not collide across different actor scopes on the same mission", async () => {
    const tenantId = `t-${randomUUID()}`;
    const missionId = 9_001 + Math.floor(Math.random() * 100_000);
    missionIds.push(missionId);

    await evaluateAndPersistMutation({
      tenantId,
      actorId: "driver-a",
      missionId,
      evidence: {
        missionStatus: "follow_up",
        pipelineStage: "follow_up",
        lossReason: null,
        followUpDueAt: "2026-08-15T17:00:00.000Z",
        hasDecisionMakerContact: true,
        verifiedWin: false,
      },
    });

    const driverB = await listMissionMutations({
      tenantId,
      actorId: "driver-b",
      missionId,
    });
    expect(driverB).toHaveLength(0);
  });

  it("keeps CLOSED authoritative even after re-evaluation with stale in-flight signals", async () => {
    const tenantId = `t-${randomUUID()}`;
    const missionId = 9_001 + Math.floor(Math.random() * 100_000);
    missionIds.push(missionId);

    const lost = await evaluateAndPersistMutation({
      tenantId,
      actorId: "driver-1",
      missionId,
      evidence: {
        missionStatus: "lost",
        pipelineStage: "lost",
        lossReason: "no_budget",
        followUpDueAt: null,
        hasDecisionMakerContact: true,
        verifiedWin: false,
      },
    });
    expect(lost?.mutationType).toBe("CLOSED_PATH");

    // Re-evaluating with a stale in-flight-looking evidence bundle must not
    // create a second, conflicting mutation — CLOSED evidence always wins.
    const reevaluated = await evaluateAndPersistMutation({
      tenantId,
      actorId: "driver-1",
      missionId,
      evidence: {
        missionStatus: "lost",
        pipelineStage: "lost",
        lossReason: "no_budget",
        followUpDueAt: "2026-08-20T09:00:00.000Z",
        hasDecisionMakerContact: true,
        verifiedWin: false,
      },
    });
    expect(reevaluated?.mutationType).toBe("CLOSED_PATH");
    const all = await listMissionMutations({ tenantId, actorId: "driver-1", missionId });
    expect(all.every(row => row.mutationType === "CLOSED_PATH")).toBe(true);
  });
});
