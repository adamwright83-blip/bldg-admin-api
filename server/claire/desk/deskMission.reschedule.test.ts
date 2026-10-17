import { describe, expect, it, vi } from "vitest";

const briefing = vi.hoisted(() => ({
  objective: "Win back lapsed customers",
  today: [],
  tomorrow: [],
  pendingDecision: {
    proposalId: "proposal-1",
    revision: "r".repeat(64),
    summary: "1 proposed item(s) await your approval.",
    items: [{ id: "2026-10-16:next", date: "2026-10-16", title: "Tomorrow's mission", window: null }],
  },
  needsReschedule: [{ id: "2026-10-15:late", date: "2026-10-15", title: "Today's mission", window: null }],
  uncertain: [],
  adaptations: [],
  weekPlan: null,
  weekToDate: { reportedOutcomes: [], planChanges: [] },
}));
vi.mock("../showrunner/showrunnerBriefing", () => ({
  buildShowrunnerBriefing: vi.fn(async () => briefing),
  DESK_PREPARATION_SOURCE: "claire_desk_preparation",
}));
vi.mock("../../strategy/strategicStore", () => ({ latestStrategicProposal: vi.fn(async () => null) }));
vi.mock("../../strategy/winBackDossier", () => ({ readWinBackDossier: vi.fn(async () => null) }));
vi.mock("../../agents/daphne/observationStore", () => ({ listRecentDaphneObservationsBySource: vi.fn(async () => []) }));
vi.mock("../../agents/persistentOperator/dailyCallAuthorization", () => ({ readDailyClaireCallStatus: vi.fn(async () => null) }));
vi.mock("../workdayPlanService", () => ({ loadConfirmedWorkdayPlan: vi.fn(async () => null) }));

import { buildDeskMission } from "./deskMission";

describe("desk mission after an execution window has passed", () => {
  it("keeps expired work visible as needing rescheduling and out of the approval scope", async () => {
    const m = await buildDeskMission({
      identity: { tenantId: "t", canonicalOperatorId: "o", dayDirectorActorId: "1" } as any,
      timeZone: "America/Los_Angeles",
      // 2026-10-15 18:00 PDT.
      now: new Date("2026-10-16T01:00:00Z"),
    });
    expect(m.items.map(i => [i.id, i.status])).toEqual([
      ["2026-10-15:late", "needs_reschedule"],
      ["2026-10-16:next", "awaiting_approval"],
    ]);
    expect(m.items[0]!.note).toMatch(/Choose a new day before approving/);
    expect(m.pendingApproval?.itemIds).toEqual(["2026-10-16:next"]);
  });
});
