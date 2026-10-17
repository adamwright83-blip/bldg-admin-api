import { describe, expect, it } from "vitest";
import { proposalItemsForApproval } from "./showrunnerBriefing";
import type { StrategicPlanningProposal } from "../../../shared/strategicIntelligence";

// 2026-10-16 is a Friday. Its calendar week starts 2026-10-12; next week starts 2026-10-19.
const item = (businessDate: string, time?: string) => ({
  id: `${businessDate}:mission${time ? `@${time}` : ""}`,
  businessDate,
  title: `Mission ${businessDate}${time ? ` at ${time}` : ""}`,
  ...(time ? { timeWindow: { window: "evening", time, reason: "Time you reported.", sourceObservationId: "operator_report" } } : {}),
});
const proposal = (items: ReturnType<typeof item>[]) => ({ items: items as unknown as StrategicPlanningProposal["items"] });
const ids = (items: StrategicPlanningProposal["items"]) => items.map(i => i.id);

describe("proposalItemsForApproval", () => {
  it("a Friday-evening fallback to the calendar week offers none of its expired work, but keeps it visible", () => {
    const split = proposalItemsForApproval({
      proposal: proposal([item("2026-10-15"), item("2026-10-16")]),
      businessDate: "2026-10-16",
      localTime: "21:00",
    });
    expect(split.approvable).toEqual([]);
    expect(ids(split.needsReschedule)).toEqual(["2026-10-16:mission"]);
  });

  it("a weekend fallback to the week just ended offers and shows nothing", () => {
    const split = proposalItemsForApproval({ proposal: proposal([item("2026-10-16")]), businessDate: "2026-10-17", localTime: "09:00" });
    expect(split).toEqual({ approvable: [], needsReschedule: [] });
  });

  it("before the cutoff today's work is approvable", () => {
    const split = proposalItemsForApproval({
      proposal: proposal([item("2026-10-15"), item("2026-10-16")]),
      businessDate: "2026-10-16",
      localTime: "10:00",
    });
    expect(ids(split.approvable)).toEqual(["2026-10-16:mission"]);
    expect(split.needsReschedule).toEqual([]);
  });

  it("after 5 PM on a weekday today's work needs rescheduling while later days stay approvable", () => {
    const split = proposalItemsForApproval({
      proposal: proposal([item("2026-10-14"), item("2026-10-15"), item("2026-10-16")]),
      businessDate: "2026-10-15",
      localTime: "18:00",
    });
    expect(ids(split.approvable)).toEqual(["2026-10-16:mission"]);
    expect(ids(split.needsReschedule)).toEqual(["2026-10-15:mission"]);
  });

  it("an explicit later time tonight stays approvable after 5 PM", () => {
    const split = proposalItemsForApproval({
      proposal: proposal([item("2026-10-15", "19:30"), item("2026-10-15", "17:30")]),
      businessDate: "2026-10-15",
      localTime: "18:00",
    });
    expect(ids(split.approvable)).toEqual(["2026-10-15:mission@19:30"]);
    expect(ids(split.needsReschedule)).toEqual(["2026-10-15:mission@17:30"]);
  });

  it("next week's prepared proposal is offered in full on a Friday evening", () => {
    const split = proposalItemsForApproval({
      proposal: proposal([item("2026-10-19"), item("2026-10-20")]),
      businessDate: "2026-10-16",
      localTime: "21:00",
    });
    expect(ids(split.approvable)).toEqual(["2026-10-19:mission", "2026-10-20:mission"]);
    expect(split.needsReschedule).toEqual([]);
  });
});
