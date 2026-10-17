import { describe, expect, it } from "vitest";
import { proposalItemsAwaitingApproval } from "./showrunnerBriefing";
import { strategicPlanningHorizon } from "../../../shared/weeklyMissionReadiness";
import type { StrategicPlanningProposal } from "../../../shared/strategicIntelligence";

// 2026-10-16 is a Friday. Its calendar week starts 2026-10-12; next week starts 2026-10-19.
const item = (businessDate: string) => ({ id: `${businessDate}:mission`, businessDate, title: `Mission ${businessDate}` });
const proposal = (weekStart: string, dates: string[]) => ({
  weekStart,
  items: dates.map(item) as unknown as StrategicPlanningProposal["items"],
});
const ids = (items: StrategicPlanningProposal["items"]) => items.map(i => i.businessDate);

describe("proposalItemsAwaitingApproval", () => {
  it("a Friday-evening fallback to the calendar week offers none of its expired work", () => {
    const planningWeekStart = strategicPlanningHorizon({ businessDate: "2026-10-16", localTime: "21:00" }).weekStart;
    expect(planningWeekStart).toBe("2026-10-19");
    const open = proposalItemsAwaitingApproval({
      proposal: proposal("2026-10-12", ["2026-10-15", "2026-10-16"]),
      planningWeekStart,
      businessDate: "2026-10-16",
      localTime: "21:00",
    });
    expect(open).toEqual([]);
  });

  it("a weekend fallback to the week just ended offers nothing", () => {
    const planningWeekStart = strategicPlanningHorizon({ businessDate: "2026-10-17", localTime: "09:00" }).weekStart;
    expect(planningWeekStart).toBe("2026-10-19");
    const open = proposalItemsAwaitingApproval({
      proposal: proposal("2026-10-12", ["2026-10-16"]),
      planningWeekStart,
      businessDate: "2026-10-17",
      localTime: "09:00",
    });
    expect(open).toEqual([]);
  });

  it("a fallback still offers its work whose window is open", () => {
    const open = proposalItemsAwaitingApproval({
      proposal: proposal("2026-10-12", ["2026-10-15", "2026-10-16"]),
      planningWeekStart: "2026-10-19",
      businessDate: "2026-10-16",
      localTime: "10:00",
    });
    expect(ids(open)).toEqual(["2026-10-16"]);
  });

  it("the planned week's proposal offers today's and later work, never earlier", () => {
    const open = proposalItemsAwaitingApproval({
      proposal: proposal("2026-10-12", ["2026-10-14", "2026-10-15", "2026-10-16"]),
      planningWeekStart: "2026-10-12",
      businessDate: "2026-10-15",
      localTime: "09:00",
    });
    expect(ids(open)).toEqual(["2026-10-15", "2026-10-16"]);
  });

  it("next week's prepared proposal is offered in full on a Friday evening", () => {
    const open = proposalItemsAwaitingApproval({
      proposal: proposal("2026-10-19", ["2026-10-19", "2026-10-20"]),
      planningWeekStart: "2026-10-19",
      businessDate: "2026-10-16",
      localTime: "21:00",
    });
    expect(ids(open)).toEqual(["2026-10-19", "2026-10-20"]);
  });
});
