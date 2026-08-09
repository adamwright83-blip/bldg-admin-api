import { describe, expect, it } from "vitest";
import type { FieldTodayItem } from "./types";
import { sortFieldTimeline } from "./fieldTodayService";

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
