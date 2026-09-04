import test from "node:test";
import assert from "node:assert/strict";
import { nextDailyRun, scheduleDue } from "./schedule.js";
test("6 PM Pacific follows summer and winter offsets", () => {
  assert.equal(
    new Date(nextDailyRun(Date.parse("2026-09-03T20:00:00Z"))).toISOString(),
    "2026-09-04T01:00:00.000Z"
  );
  assert.equal(
    new Date(nextDailyRun(Date.parse("2026-12-03T20:00:00Z"))).toISOString(),
    "2026-12-04T02:00:00.000Z"
  );
});
test("DST changes preserve 6 PM and exact target advances to tomorrow", () => {
  assert.equal(
    new Date(nextDailyRun(Date.parse("2026-03-08T02:00:00Z"))).toISOString(),
    "2026-03-09T01:00:00.000Z"
  );
  assert.equal(
    new Date(nextDailyRun(Date.parse("2026-11-01T01:00:00Z"))).toISOString(),
    "2026-11-02T02:00:00.000Z"
  );
});
test("missed enabled runs catch up; disabled or corrupt schedules do not", () => {
  assert.equal(scheduleDue({ enabled: true, nextRunAt: 100 }, 200), true);
  assert.equal(scheduleDue({ enabled: false, nextRunAt: 100 }, 200), false);
  assert.equal(scheduleDue({ enabled: true }, 200), false);
});
