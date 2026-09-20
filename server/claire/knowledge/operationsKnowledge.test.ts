import { describe, expect, it } from "vitest";
import { loadDayWork } from "./operationsKnowledge";

describe("Claire operations visibility", () => {
  it("does not surface synthetic verification work from Day Line or route projections", async () => {
    const work = await loadDayWork(
      {
        tenantId: "default",
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        businessDate: "2026-09-20",
        now: new Date("2026-09-20T18:00:00Z"),
        timeZone: "America/Los_Angeles",
      },
      {
        getState: (async () => ({
          commitments: [
            {
              id: "bad",
              title: "Follow up: Mission 6",
              detailNote: "Synthetic verification follow-up",
              status: "active",
              completedAt: null,
            },
            {
              id: "good",
              title: "Call Dana at The Louise",
              detailNote: "Tuesday",
              status: "active",
              completedAt: null,
            },
          ],
        })) as never,
        getField: (async () => ({
          timeline: [
            { id: "route-bad", kind: "follow_up", title: "Synthetic verification follow-up", scheduledAt: null },
            { id: "route-good", kind: "commercial_call", title: "Call Dana", scheduledAt: null },
          ],
        })) as never,
      }
    );
    expect(work.open.map(item => item.title)).toEqual(["Call Dana at The Louise", "Call Dana"]);
    expect(JSON.stringify(work)).not.toMatch(/Synthetic verification|Mission 6/);
  });
});
