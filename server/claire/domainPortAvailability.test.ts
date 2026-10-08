import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({
  getDb: vi.fn(),
  getUserByOpenId: vi.fn(),
}));

import { getDb } from "../db";
import { loadTenantBusinessIdentity } from "../saas/tenantIdentityService";
import { loadWorkdayPlanSnapshot } from "../planning/dayDirector/workdayPlanSnapshotStore";
import { listActiveDayDirectorRecurrenceRules } from "../planning/dayDirector/workdayRecurrenceStore";
import { latestWeeklyIntent } from "../planning/weeklyIntentStore";
import { databaseMacroGoalPersistence } from "../planning/macroGoalStore";
import { loadClaireIdentityTruth } from "./identityTruth";
import { loadExistingWork } from "./briefing/briefingCommit";

const originalNodeEnv = process.env.NODE_ENV;
const originalVitest = process.env.VITEST;

describe("Claire authoritative domain-port availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = originalVitest;
  });

  it("does not turn an unavailable tenant registry into an authoritative empty identity", async () => {
    await expect(loadTenantBusinessIdentity("tenant-a")).rejects.toThrow(
      "Database unavailable"
    );
    await expect(loadClaireIdentityTruth("tenant-a")).rejects.toThrow(
      "Database unavailable"
    );
  });

  it("does not turn a failed Day Director existing-work read into an empty authoritative state", async () => {
    await expect(
      loadExistingWork(
        {
          tenantId: "tenant-a",
          dayDirectorActorId: "operator-a",
          dates: ["2026-10-06"],
        },
        {
          getState: vi.fn(async () => {
            throw new Error("Day Director unavailable");
          }) as never,
        }
      )
    ).rejects.toThrow("Day Director unavailable");
  });

  it("does not turn an unavailable Day Director store into no confirmed plan", async () => {
    await expect(
      loadWorkdayPlanSnapshot({
        tenantId: "tenant-a",
        actorId: "operator-a",
        businessDate: "2026-10-06",
        idempotencyKey: "plan:2026-10-06",
      })
    ).rejects.toThrow("Database not available");
  });

  it("does not turn an unavailable recurrence store into an empty rule set", async () => {
    await expect(
      listActiveDayDirectorRecurrenceRules({
        tenantId: "tenant-a",
        actorId: "operator-a",
      })
    ).rejects.toThrow("Database not available");
  });

  it("does not turn an unavailable Planning store into no weekly intent", async () => {
    await expect(
      latestWeeklyIntent({
        tenantId: "tenant-a",
        operatorId: "operator-a",
        weekStart: "2026-10-05",
      })
    ).rejects.toThrow("Database not available");
  });

  it("does not use the macro-goal memory fallback outside tests", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.VITEST;
    await expect(
      databaseMacroGoalPersistence.getActive({
        tenantId: "tenant-a",
        operatorUserId: "operator-a",
      })
    ).rejects.toThrow("Database unavailable");
  });
});
