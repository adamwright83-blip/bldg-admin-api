import { describe, expect, it } from "vitest";
import { sortDayforgeTodayItems, type DayforgeTodayItem } from "./dayforgeTodayService";

const base: DayforgeTodayItem = {
  id: "base", kind: "missing_next_action", urgency: "exception", missionId: 1,
  pipelineId: 1, followUpId: null, accountName: "Hotel", missionCode: "DF-1",
  status: "candidate", dueAt: null, note: null, address: null, phone: null,
  email: null, destinationPath: "/commercial-missions", estimatedValueCents: null,
};

describe("DayForge Today queue", () => {
  it("orders overdue, dispatch, today, upcoming, then missing-action exceptions", () => {
    const now = new Date("2026-07-24T12:00:00.000Z");
    const items = [
      { ...base, id: "missing" },
      { ...base, id: "future", kind: "follow_up" as const, dueAt: "2026-07-26T12:00:00.000Z" },
      { ...base, id: "dispatch", kind: "dispatch" as const },
      { ...base, id: "overdue", kind: "follow_up" as const, dueAt: "2026-07-23T12:00:00.000Z" },
      { ...base, id: "today", kind: "follow_up" as const, dueAt: "2026-07-24T18:00:00.000Z" },
    ];
    expect(sortDayforgeTodayItems(items, now).map(item => item.id)).toEqual([
      "overdue", "dispatch", "today", "future", "missing",
    ]);
  });

  it("uses known value and a stable id only after urgency and time", () => {
    const items = [
      { ...base, id: "b", estimatedValueCents: 100 },
      { ...base, id: "a", estimatedValueCents: 100 },
      { ...base, id: "high", estimatedValueCents: 500 },
    ];
    expect(sortDayforgeTodayItems(items).map(item => item.id)).toEqual(["high", "a", "b"]);
  });
});
