import { describe, expect, it } from "vitest";
import { deterministicOpenChannelPlan } from "./openChannelService";

describe("Open Channel deterministic mission planner", () => {
  it("turns the operator's Sunday gap briefing into individual board spaces", () => {
    const plan = deterministicOpenChannelPlan(
      "I am hungry but should not spend money. I have printed collateral and should approach three local barbershops in Huntington Park. I brought personal dirty clothes to wash and dry. I need to collect quarters and count cash for Russell."
    );
    expect(plan.tasks.map(task => task.title)).toEqual([
      "Secure a low-cost meal",
      "Local shop outreach 1 of 3",
      "Local shop outreach 2 of 3",
      "Local shop outreach 3 of 3",
      "Start personal laundry",
      "Collect the quarters",
      "Count and reconcile cash",
    ]);
    expect(plan.tasks.filter(task => task.category === "sales")).toHaveLength(
      3
    );
    expect(plan.tasks[1].navigationQuery).toBe(
      "barbershops in Huntington Park CA"
    );
  });

  it("never fabricates an end time or address in its fallback mission", () => {
    const plan = deterministicOpenChannelPlan(
      "I need to organize the supplies in my car and write down what is missing before tomorrow."
    );
    expect(plan.tasks).toHaveLength(1);
    expect(plan.tasks[0].navigationQuery).toBeNull();
    expect(JSON.stringify(plan)).not.toMatch(/\b(?:am|pm)\b/i);
  });
});
