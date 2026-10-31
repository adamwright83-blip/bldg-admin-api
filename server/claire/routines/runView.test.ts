import { describe, expect, it } from "vitest";
import type { RoutineRecord, RoutineRunRecord } from "../../routines/routineStore";
import { routineView } from "./service";

const routine = (patch: Partial<RoutineRecord>): RoutineRecord => ({
  id: "r1",
  tenantId: "df_t",
  operatorOpenId: "op",
  kind: "waiting_on",
  instruction: "Every Monday at 8, who hasn't replied",
  cadence: "weekly",
  weekday: 1,
  localTime: "08:00",
  timeZone: "America/Los_Angeles",
  status: "active",
  nextRunAt: new Date("2026-11-02T16:00:00Z"),
  lastRunAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  ...patch,
});
const failed: RoutineRunRecord = {
  id: "run1",
  routineId: "r1",
  tenantId: "df_t",
  periodKey: "2026-11-02",
  trigger: "schedule",
  status: "failed",
  attempts: 1,
  startedAt: new Date("2026-11-02T16:00:00Z"),
  finishedAt: new Date("2026-11-02T16:00:05Z"),
  findings: null,
  summary: null,
  error: "Gmail 503",
};
const note = (r: RoutineRecord) => routineView(r, [failed]).runs[0]!.note;

describe("a failed scheduled run says what really happens next", () => {
  it("promises a retry only while the routine is active and still due", () => {
    expect(note(routine({}))).toMatch(/tries again in a few minutes/);
  });
  it("once the routine moved on to its next time, it says it runs at its next time", () => {
    expect(note(routine({ nextRunAt: new Date("2026-11-09T16:00:00Z") }))).toMatch(/runs again at its next time/);
  });
  it("a paused or stopped routine never promises a retry", () => {
    expect(note(routine({ status: "paused" }))).toMatch(/paused; it runs again once you resume it/);
    expect(note(routine({ status: "stopped" }))).toMatch(/stopped, so it won't run again/);
    expect(note(routine({ status: "stopped" }))).not.toMatch(/tries again/);
  });
});
