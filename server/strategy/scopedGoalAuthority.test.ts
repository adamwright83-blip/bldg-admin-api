import { beforeEach, describe, expect, it } from "vitest";
import { getActiveMacroGoal, setActiveMacroGoal } from "../claire/macroGoalService";
import { resetInMemoryGoalsForTesting } from "../planning/macroGoalStore";
import { buildStrategySnapshot, getLatestStrategySnapshot, _clearSnapshotStore } from "./snapshotBuilder";

beforeEach(() => { resetInMemoryGoalsForTesting(); _clearSnapshotStore(); });
async function goal(operatorUserId: string, targetValue: number) {
  return setActiveMacroGoal({ tenantId: "scoped-goals", operatorUserId, objective: "Get customers", metricKey: "active_customers", unit: "customers", targetValue,
    source: "operator_attested", sourceNote: "confirmed" });
}
describe("operator goal authority", () => {
  it("does not return another operator's goal in the test persistence adapter", async () => {
    await goal("alice", 12);
    expect(await getActiveMacroGoal({ tenantId: "scoped-goals", operatorUserId: "bob" })).toBeNull();
    await goal("bob", 24);
    expect((await getActiveMacroGoal({ tenantId: "scoped-goals", operatorUserId: "alice" }))?.targetValue).toBe(12);
  });
  it("keeps operator snapshots separate and does not reuse an old goal-less snapshot", async () => {
    await buildStrategySnapshot("scoped-goals", { customerAggregates: [] });
    expect(await getLatestStrategySnapshot("scoped-goals", { operatorUserId: "alice" })).toBeNull();
    await goal("alice", 12);
    const snapshot = await buildStrategySnapshot("scoped-goals", { operatorUserId: "alice", customerAggregates: [] });
    expect(snapshot.payload.goal.target).toBe(12);
    expect(await getLatestStrategySnapshot("scoped-goals", { operatorUserId: "bob" })).toBeNull();
  });
});
