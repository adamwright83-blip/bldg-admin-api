import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";

const store = vi.hoisted(() => ({
  proposal: null as unknown as StrategicPlanningProposal,
  recorded: [] as unknown[],
}));
vi.mock("./strategicStore", () => ({
  loadStrategicProposal: vi.fn(async () => store.proposal),
  strategicResponses: vi.fn(async () => []),
  // Reaching a write means the window guard let the request through; stop there.
  recordStrategicResponse: vi.fn(async (response: unknown) => {
    store.recorded.push(response);
    throw new Error("WRITE_REACHED");
  }),
  persistStrategicProposal: vi.fn(async () => {
    throw new Error("WRITE_REACHED");
  }),
}));

import { respondToStrategicProposal, reviseStrategicProposal } from "./strategicApproval";

const identity = {
  tenantId: "tenant-window",
  canonicalOperatorId: "op-window",
  canonicalOpenId: "open-window",
  dayDirectorActorId: "1",
  dayDirectorActorIds: ["1"],
  membership: { source: "owner", canonical: "owner" },
} as any;
// 2026-10-15 18:00 in Los Angeles (PDT, UTC-7), after the 5 PM cutoff.
const evening = new Date("2026-10-16T01:00:00Z");
const item = (id: string, businessDate: string, time?: string) => ({
  id,
  businessDate,
  title: `Mission ${id}`,
  objective: "Bounded test mission",
  executionType: "mission" as const,
  candidateId: id,
  planId: "plan",
  planRevision: 0,
  evidenceRefs: [],
  ...(time ? { timeWindow: { window: "evening" as const, time, reason: "Time you reported.", sourceObservationId: "operator_report" } } : {}),
});

beforeEach(() => {
  store.recorded = [];
  store.proposal = {
    id: "proposal-window",
    revision: "r".repeat(64),
    weekStart: "2026-10-12",
    businessDate: "2026-10-13",
    timeZone: "America/Los_Angeles",
    expiresAt: "2026-10-20T00:00:00Z",
    items: [item("today", "2026-10-15"), item("tonight", "2026-10-15", "19:30"), item("tomorrow", "2026-10-16")],
  } as unknown as StrategicPlanningProposal;
});

const approve = (itemIds: string[]) =>
  respondToStrategicProposal({
    identity,
    proposalId: "proposal-window",
    revision: "r".repeat(64),
    action: "approve",
    itemIds,
    source: "authenticated_app",
    now: evening,
  });

describe("approval after an execution window has passed", () => {
  it("refuses to approve today's work after 5 PM and writes nothing", async () => {
    await expect(approve(["today"])).rejects.toThrow(/has passed\. Reschedule it to a new day before approving; nothing was approved/);
    await expect(approve(["today", "tomorrow"])).rejects.toThrow(/"Mission today"/);
    expect(store.recorded).toEqual([]);
  });

  it("still approves work with an explicit later time tonight, and later days", async () => {
    await expect(approve(["tonight"])).rejects.toThrow("WRITE_REACHED");
    await expect(approve(["tomorrow"])).rejects.toThrow("WRITE_REACHED");
  });

  it("refuses to reschedule onto a day whose time has passed, and allows a later day", async () => {
    const revise = (businessDate: string) =>
      reviseStrategicProposal({
        identity,
        proposalId: "proposal-window",
        revision: "r".repeat(64),
        itemId: "today",
        title: "Mission today",
        businessDate,
        now: evening,
      });
    await expect(revise("2026-10-15")).rejects.toThrow("That day's time has already passed. Choose a later day.");
    await expect(revise("2026-10-16")).rejects.toThrow("WRITE_REACHED");
  });
});
