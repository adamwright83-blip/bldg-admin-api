import { describe, expect, it } from "vitest";
import {
  SCHEDULE_CURRENT_MINUTES,
  assessScheduleFreshness,
  scheduleOmissions,
  unreadableScheduleFreshness,
} from "./cleancloudScheduleFreshness";

const NOW = new Date("2026-10-29T17:12:00.000Z"); // 10:12 AM Pacific
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("CleanCloud schedule freshness: connected, current and complete are separate claims", () => {
  it("a business that does not run on CleanCloud is not limited at all", () => {
    const f = assessScheduleFreshness(
      {
        usesCleanCloud: false,
        pickupConnection: null,
        deliveriesSynced: false,
      },
      NOW
    );
    expect(f).toMatchObject({ applicable: false, complete: true, label: "" });
    expect(scheduleOmissions(f)).toEqual([]);
  });

  it("current pickups without a delivery feed are connected and current, never complete, and say so", () => {
    const f = assessScheduleFreshness(
      {
        usesCleanCloud: true,
        pickupConnection: {
          enabled: true,
          capturedAt: minutesAgo(2),
          lastError: null,
        },
        deliveriesSynced: false,
      },
      NOW
    );
    expect(f).toMatchObject({
      connected: true,
      current: true,
      complete: false,
      tone: "warn",
      gaps: ["deliveries_not_synced"],
    });
    expect(f.label).toBe(
      "CleanCloud pickups verified 10:10 AM. Deliveries aren't synced from CleanCloud yet."
    );
    expect(scheduleOmissions(f)).toEqual(["cleancloud_deliveries"]);
  });

  it("an old pickup read is connected but not current", () => {
    const f = assessScheduleFreshness(
      {
        usesCleanCloud: true,
        pickupConnection: {
          enabled: true,
          capturedAt: minutesAgo(SCHEDULE_CURRENT_MINUTES + 1),
          lastError: null,
        },
        deliveriesSynced: false,
      },
      NOW
    );
    expect(f).toMatchObject({
      connected: true,
      current: false,
      complete: false,
      tone: "alert",
    });
    expect(f.gaps).toEqual(["pickups_stale", "deliveries_not_synced"]);
    expect(f.label).toMatch(/last verified 10:01 AM, not current/);
    expect(scheduleOmissions(f)).toEqual([
      "cleancloud_pickups",
      "cleancloud_deliveries",
    ]);
  });

  it("never connected, or a failed last read, is not connected", () => {
    const none = assessScheduleFreshness(
      { usesCleanCloud: true, pickupConnection: null, deliveriesSynced: false },
      NOW
    );
    expect(none).toMatchObject({
      connected: false,
      current: false,
      complete: false,
      tone: "alert",
    });
    expect(none.label).toMatch(/aren't connected/);
    const failed = assessScheduleFreshness(
      {
        usesCleanCloud: true,
        pickupConnection: {
          enabled: true,
          capturedAt: minutesAgo(1),
          lastError: "boom",
        },
        deliveriesSynced: false,
      },
      NOW
    );
    expect(failed).toMatchObject({ connected: false, current: false });
    expect(failed.gaps).toContain("pickups_capture_failed");
  });

  it("complete only when pickups are current AND deliveries are synced", () => {
    const f = assessScheduleFreshness(
      {
        usesCleanCloud: true,
        pickupConnection: {
          enabled: true,
          capturedAt: minutesAgo(1),
          lastError: null,
        },
        deliveriesSynced: true,
      },
      NOW
    );
    expect(f).toMatchObject({
      connected: true,
      current: true,
      complete: true,
      tone: "ok",
      gaps: [],
    });
  });

  it("an unreadable check is never current", () => {
    const f = unreadableScheduleFreshness();
    expect(f).toMatchObject({
      applicable: true,
      current: false,
      complete: false,
      tone: "alert",
    });
    expect(scheduleOmissions(f)).toEqual(["cleancloud_schedule"]);
  });
});
