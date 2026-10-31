import { describe, expect, it } from "vitest";
import { ROUTINES_RULE, type RoutineView } from "../../../shared/claireRoutines";
import { buildShowrunnerBriefing } from "../showrunner/showrunnerBriefing";
import { systemPrompt, type ShowrunnerCallState } from "../showrunner/showrunnerTurn";
import { claireRoutinesWorkerEnabled } from "./worker";

const TZ = "America/Los_Angeles";
const identity = { tenantId: "t1", canonicalOperatorId: "op", dayDirectorActorId: "1", dayDirectorActorIds: ["1"], canonicalOpenId: "op", membership: { source: "owner", canonical: "owner" } } as never;
const routine: RoutineView = {
  id: "r1",
  instruction: "Every Monday morning, tell me who I'm waiting to hear back from",
  kind: "waiting_on",
  cadence: "weekly",
  weekday: 1,
  localTime: "08:00",
  timeZone: TZ,
  status: "active",
  describe: "Every Monday at 8:00 — who you're waiting to hear back from",
  nextRunAt: "2026-11-09T16:00:00.000Z",
  lastRunAt: "2026-11-02T16:00:05.000Z",
  createdAt: "2026-10-31T16:00:00.000Z",
  runs: [
    {
      id: "run1",
      trigger: "schedule",
      status: "done",
      attempts: 1,
      startedAt: "2026-11-02T16:00:00.000Z",
      finishedAt: "2026-11-02T16:00:05.000Z",
      summary: "You're waiting on a reply from 1 person: Elena Ruiz (4 days).",
      findings: null,
      note: null,
    },
  ],
};

const briefing = (loadRoutines: (tenantId: string) => Promise<RoutineView[]>) =>
  buildShowrunnerBriefing({
    identity,
    purpose: "desk_planning",
    timeZone: TZ,
    now: new Date("2026-11-03T18:00:00Z"),
    getDay: (async () => ({ commitments: [] })) as never,
    listOpen: (async () => []) as never,
    loadDriverDayLine: (async () => null) as never,
    loadGameState: (async () => null) as never,
    loadGoal: (async () => null) as never,
    loadStandingInstructions: async () => [],
    loadPreparedItems: async () => [],
    loadSignupKnowledge: async () => null,
    loadRoutines,
  } as never);

const stateWith = (b: Awaited<ReturnType<typeof buildShowrunnerBriefing>>): ShowrunnerCallState => ({
  purpose: "desk_planning",
  tenantId: "t1",
  canonicalOperatorId: "op",
  operatorUserId: "op",
  dayDirectorActorId: "1",
  dayDirectorActorIds: ["1"],
  timeZone: TZ,
  businessDate: "2026-11-03",
  briefing: b,
  captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
  replan: null,
  turns: 0,
});

describe("Claire's briefing carries the operator's routines", () => {
  it("each routine in words with its latest run, and one rule line telling Claire how to use it", async () => {
    let asked: string | null = null;
    const b = await briefing(async tenantId => {
      asked = tenantId;
      return [routine];
    });
    expect(asked).toBe("t1");
    expect(b.routines).toEqual([
      expect.objectContaining({
        routine: "Every Monday at 8:00 — who you're waiting to hear back from",
        status: "active",
        lastRun: expect.objectContaining({ status: "done", summary: "You're waiting on a reply from 1 person: Elena Ruiz (4 days)." }),
      }),
    ]);
    expect(systemPrompt(stateWith(b))).toContain(ROUTINES_RULE);
  });

  it("routines that couldn't be read leave the briefing (and the rule) out instead of claiming there are none", async () => {
    const b = await briefing(async () => {
      throw new Error("db down");
    });
    expect(b.routines).toBeNull();
    expect(systemPrompt(stateWith(b))).not.toContain("BRIEFING.routines");
  });
});

describe("the routines worker", () => {
  it("runs in production unless turned off, and elsewhere only when asked", () => {
    expect(claireRoutinesWorkerEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(claireRoutinesWorkerEnabled({ NODE_ENV: "production", CLAIRE_ROUTINES_WORKER: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(claireRoutinesWorkerEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(claireRoutinesWorkerEnabled({ NODE_ENV: "test", CLAIRE_ROUTINES_WORKER: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
