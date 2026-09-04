import { describe, expect, it } from "vitest";
import type { FieldTodayItem } from "./types";
import { sortFieldTimeline, timeFromWindow } from "./fieldTodayService";

function item(id: string, urgency: FieldTodayItem["urgency"], scheduledAt: string | null): FieldTodayItem {
  return { id, kind: "job", source: { entityType: "order", entityId: id, sourceReference: `orders:${id}` }, scheduledAt, urgency, title: id, subtitle: "", status: "new", destination: null, customer: null, money: null, verificationClass: "VERIFIED", actions: [] };
}

describe("FIELD Today ordering", () => {
  it("puts payment blockers and overdue work ahead of later discretionary work", () => {
    expect(sortFieldTimeline([
      item("later", "flexible", null), item("scheduled", "scheduled", "2026-08-08T18:00:00Z"),
      item("overdue", "overdue", "2026-08-08T15:00:00Z"), item("blocked", "blocked", "2026-08-08T17:00:00Z"),
    ]).map(value => value.id)).toEqual(["blocked", "overdue", "scheduled", "later"]);
  });
  it("does not duplicate a source occurrence in the canonical timeline", () => {
    expect(sortFieldTimeline([item("order:1", "scheduled", null), item("order:1", "scheduled", null)])).toHaveLength(1);
  });
});

describe("FIELD fixed commitment timezone truth", () => {
  it("keeps a Los Angeles summer 9 AM window at 9 AM local, not 9 AM UTC", () => {
    expect(timeFromWindow("2026-09-01", "9:00 AM - 10:00 AM", "America/Los_Angeles"))
      .toBe("2026-09-01T16:00:00.000Z");
  });

  it("honors the winter offset without inventing a fixed UTC hour", () => {
    expect(timeFromWindow("2026-12-01", "9 AM", "America/Los_Angeles"))
      .toBe("2026-12-01T17:00:00.000Z");
  });

  it("does not invent a time when the source window has no clock time", () => {
    expect(timeFromWindow("2026-09-01", "morning", "America/Los_Angeles")).toBeNull();
  });
});
