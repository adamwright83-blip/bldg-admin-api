import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const access = vi.hoisted(() => ({
  resolveMembership: vi.fn(),
  hasEntitlement: vi.fn(),
}));
const workday = vi.hoisted(() => ({
  previewWorkdayLoop: vi.fn(),
  confirmWorkdayPlan: vi.fn(),
  assembleTomorrowCandidates: vi.fn(),
}));
const assemble = vi.hoisted(() => ({
  assembleClaireDriveContext: vi.fn(),
}));

vi.mock("../saas/tenantAccess", () => ({
  resolveDayforgeMembership: access.resolveMembership,
  hasDayforgeEntitlement: access.hasEntitlement,
  roleAllows: (actual: string, allowed: readonly string[]) => allowed.includes(actual),
}));
vi.mock("./contextAssembler", () => ({
  assembleClaireDriveContext: assemble.assembleClaireDriveContext,
}));
vi.mock("./workdayPlanService", async importOriginal => {
  const actual = await importOriginal<typeof import("./workdayPlanService")>();
  return {
    ...actual,
    previewWorkdayLoop: workday.previewWorkdayLoop,
    confirmWorkdayPlan: workday.confirmWorkdayPlan,
    assembleTomorrowCandidates: workday.assembleTomorrowCandidates,
  };
});

import { claireRouter } from "./claireRouter";
import {
  assembleTomorrowCandidates,
  confirmWorkdayPlan,
  previewWorkdayLoop,
} from "./workdayPlanService";

const context = {
  phase: "pre_drive",
  generatedAt: "2026-09-15T02:00:00.000Z",
  businessDate: "2026-09-15",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: null,
  blockers: [],
  relevantTimeline: [],
  mission: null,
  clock: {
    isoTimestamp: "2026-09-15T02:00:00.000Z",
    timeZone: "America/Los_Angeles",
    businessDate: "2026-09-15",
    weekday: "Monday",
    localTime: "19:00",
    daypart: "evening",
    fieldSalesDayState: "over",
    tomorrowBusinessDate: "2026-09-16",
  },
} as const;

function caller() {
  return claireRouter.createCaller({
    req: undefined,
    res: undefined,
    user: { id: 7, openId: "operator-1", role: "admin" },
    vendorSession: null,
    tenantId: "tenant-1",
  } as unknown as TrpcContext);
}

describe("Claire workday router identifiers", () => {
  beforeEach(() => {
    access.resolveMembership.mockResolvedValue({ role: "owner" });
    access.hasEntitlement.mockResolvedValue(true);
    assemble.assembleClaireDriveContext.mockResolvedValue(context);
    workday.previewWorkdayLoop.mockResolvedValue({
      session: "evening_planning",
      eveningSpeak: "Tomorrow draft.",
      morningSpeak: "",
      tomorrowDraft: [{ id: "item-1", title: "Call Dana" }],
      deltas: [],
      confirmed: null,
    });
    workday.assembleTomorrowCandidates.mockReturnValue([{ id: "item-1", title: "Call Dana" }]);
    workday.confirmWorkdayPlan.mockResolvedValue({
      confirmedAt: "2026-09-15T02:01:00.000Z",
      items: [{ id: "item-1", title: "Call Dana" }],
    });
  });

  it("resolves previewWorkdayLoop, confirmWorkdayPlan, and assembleTomorrowCandidates", () => {
    expect(previewWorkdayLoop).toBe(workday.previewWorkdayLoop);
    expect(confirmWorkdayPlan).toBe(workday.confirmWorkdayPlan);
    expect(assembleTomorrowCandidates).toBe(workday.assembleTomorrowCandidates);
    expect(typeof previewWorkdayLoop).toBe("function");
    expect(typeof confirmWorkdayPlan).toBe("function");
    expect(typeof assembleTomorrowCandidates).toBe("function");
  });

  it("previewWorkday reaches the workday implementation and does not throw ReferenceError", async () => {
    const result = await caller().previewWorkday({ timeZone: "America/Los_Angeles" });
    expect(workday.previewWorkdayLoop).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      actorId: "7",
      context,
    });
    expect(result).toMatchObject({
      session: "evening_planning",
      eveningSpeak: "Tomorrow draft.",
      writesBusinessTruth: false,
      confirmedAt: null,
    });
  });

  it("confirmTomorrow reaches plan confirmation and candidate assembly", async () => {
    const result = await caller().confirmTomorrow({ timeZone: "America/Los_Angeles" });
    expect(workday.assembleTomorrowCandidates).toHaveBeenCalledWith(context);
    expect(workday.confirmWorkdayPlan).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      actorId: "7",
      businessDate: "2026-09-16",
      items: [{ id: "item-1", title: "Call Dana" }],
    });
    expect(result).toEqual({ confirmedAt: "2026-09-15T02:01:00.000Z", itemCount: 1 });
  });
});
