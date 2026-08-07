import { describe, expect, it } from "vitest";
import { stableCalendarEventId } from "./googleCalendarService";

describe("stableCalendarEventId", () => {
  it("is deterministic and valid for Google Calendar custom event ids", () => {
    const input = {
      tenantId: "tenant-1",
      userId: "driver-1",
      missionId: 42,
      followUpAt: new Date("2026-08-07T22:30:00.000Z"),
    };
    const first = stableCalendarEventId(input);
    const second = stableCalendarEventId(input);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{32}$/);
  });

  it("changes when the follow-up time changes", () => {
    const base = { tenantId: "tenant-1", userId: "driver-1", missionId: 42 };
    expect(stableCalendarEventId({ ...base, followUpAt: new Date("2026-08-07T22:30:00.000Z") }))
      .not.toBe(stableCalendarEventId({ ...base, followUpAt: new Date("2026-08-07T23:30:00.000Z") }));
  });
});
