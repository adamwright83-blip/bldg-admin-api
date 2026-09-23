import { describe, expect, it, vi } from "vitest";
import { projectCurrentDayLine } from "../../../shared/currentDayLine";
import { loadDayWork, speakDayWork } from "./operationsKnowledge";

const line = projectCurrentDayLine({
  businessDate: "2026-09-23",
  rankingStatus: "ranked",
  rankedWorks: [
    {
      id: "zzz-visit",
      title: "Visit Greystar",
      completionCondition: "The visit is completed.",
    },
    {
      id: "aaa-email",
      title: "Email the office",
      completionCondition: "Email the office.",
    },
  ],
});

const input = {
  tenantId: "tenant-a",
  operatorUserId: "user-1",
  dayDirectorActorId: "operator-1",
  now: new Date("2026-09-23T15:00:00.000Z"),
  timeZone: "UTC",
};

describe("Claire current day line attachment", () => {
  it("attaches today's Mission Director order and does not speak that order instead of the route", async () => {
    const readDayLine = vi.fn(async () => line);
    const work = await loadDayWork(
      { ...input, businessDate: "2026-09-23" },
      {
        getState: async () =>
          ({
            processingLocation: null,
            commitments: [
              {
                id: "c1",
                businessDate: "2026-09-23",
                title: "Bag the hangers",
                kind: "prep",
                quantity: null,
                provenance: "user_reported",
                status: "open",
                completedAt: null,
                sourceText: "Bag the hangers",
                command: {
                  role: null,
                  designatedBy: null,
                  designatedAt: null,
                  demotedAt: null,
                  demotedReason: null,
                  promisedTo: null,
                  promisedDeadline: null,
                  identityUnknown: false,
                  cargoLink: null,
                  recurrenceRuleId: null,
                  constraints: { windowStart: null, windowEnd: null, scheduleLabel: null },
                },
              },
            ],
            dismissedPromptKeys: [],
            intelligenceAvailable: false,
          }) as never,
        getField: async () =>
          ({
            timeline: [
              { id: "route-b", kind: "pickup", title: "Pickup B", scheduledAt: null },
              { id: "route-a", kind: "delivery", title: "Delivery A", scheduledAt: null },
            ],
          }) as never,
        readDayLine,
      }
    );

    expect(readDayLine).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-a",
        operatorId: "operator-1",
        timeZone: "UTC",
      })
    );
    expect(work.currentDayLine?.items.map(item => item.id)).toEqual(["zzz-visit", "aaa-email"]);
    const spoken = speakDayWork(work, { kind: "remaining", day: "today" }, "text");
    expect(spoken).toContain("Bag the hangers, Pickup B, and Delivery A");
    expect(spoken.indexOf("Bag the hangers")).toBeLessThan(spoken.indexOf("Pickup B"));
    expect(spoken.indexOf("Pickup B")).toBeLessThan(spoken.indexOf("Delivery A"));
    expect(spoken).not.toContain("Visit Greystar");
    expect(spoken).not.toContain("Email the office");
  });

  it("does not attach today's line to tomorrow's read", async () => {
    const work = await loadDayWork(
      { ...input, businessDate: "2026-09-24" },
      {
        getState: async () =>
          ({
            processingLocation: null,
            commitments: [],
            dismissedPromptKeys: [],
            intelligenceAvailable: false,
          }) as never,
        getField: async () => ({ timeline: [] }) as never,
        readDayLine: async () => line,
      }
    );
    expect(work.currentDayLine).toBeNull();
    expect(speakDayWork(work, { kind: "day", day: "tomorrow" }, "text")).not.toContain("Visit Greystar");
  });
});
