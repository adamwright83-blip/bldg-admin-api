import { beforeEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  enabled: true, ledger: vi.fn(), showrunner: vi.fn(), load: vi.fn(), save: vi.fn(),
}));
vi.mock("../../saas/tenantAccess", () => ({
  resolveLegacyDayforgeMembership: async () => ({ role: "owner" }),
  hasLegacyDayforgeEntitlement: async () => true,
  roleAllows: () => true,
}));
vi.mock("../../agents/persistentOperator/identity", async original => ({
  ...await original<typeof import("../../agents/persistentOperator/identity")>(),
  requireCanonicalOperatorIdentityForUser: async () => ({ tenantId: "t", canonicalOperatorId: "op", canonicalOpenId: "u", dayDirectorActorId: "1", dayDirectorActorIds: ["1"] }),
}));
vi.mock("../../agents/persistentOperator/operatorAppointmentPolicy", async original => ({
  ...await original<typeof import("../../agents/persistentOperator/operatorAppointmentPolicy")>(),
  resolveOperatorTimeZone: async () => "America/Los_Angeles",
}));
vi.mock("../turn/conversationStateStore", () => ({ claireConversationStateStore: () => ({ load: ports.load, save: ports.save }) }));
vi.mock("../workLedger/workLedgerPlanner", async original => ({
  ...await original<typeof import("../workLedger/workLedgerPlanner")>(),
  isClaireWorkLedgerEnabled: () => ports.enabled,
}));
vi.mock("../workLedger/workLedgerTurn", async original => ({
  ...await original<typeof import("../workLedger/workLedgerTurn")>(), runWorkLedgerTurn: ports.ledger,
}));
vi.mock("../showrunner/showrunnerTurn", async original => ({
  ...await original<typeof import("../showrunner/showrunnerTurn")>(), runShowrunnerTurn: ports.showrunner,
}));
import { weeklyMissionRouter } from "./weeklyMissionRouter";

function caller() {
  return weeklyMissionRouter.createCaller({ user: { id: 1, openId: "u", role: "admin" }, tenantId: "t" } as never);
}
beforeEach(() => {
  vi.clearAllMocks(); ports.enabled = true;
  let stored = { tenantId: "t", operatorUserId: "u", state: {
    history: [{ speaker: "claire", text: "What do you need?" }],
    showrunner: { turns: 0, businessDate: "2026-10-17", replan: null },
  } };
  ports.load.mockImplementation(async () => structuredClone(stored));
  ports.save.mockImplementation(async (_key, owner, state) => { stored = { ...owner, state: structuredClone(state) }; });
  ports.showrunner.mockImplementation(async input => ({ speak: "Hello.", state: input.state, end: false }));
});
describe("OPEN COMMS work ownership", () => {
  it("persists ledger state across reload and keeps Showrunner from interpreting ordinary turns as work", async () => {
    ports.ledger.mockImplementationOnce(async input => {
      input.state.workLedger = { version: 1, held: [], savedIds: ["saved-1"], nextRef: 2 };
      input.state.history.push({ speaker: "operator", text: input.utterance, at: 1 }, { speaker: "claire", text: "On today's line: Call Louise.", at: 2 });
      return { handled: true, result: { speak: "On today's line: Call Louise.", actionIds: ["saved-1"] } };
    }).mockResolvedValueOnce({ handled: false, reason: "not_work" });
    const saved = await caller().deskComms({ sessionId: "test-session", utterance: "Add call Louise." });
    expect(saved.saved).toEqual(["On today's line: Call Louise."]);
    expect(ports.showrunner).not.toHaveBeenCalled();
    await caller().deskComms({ sessionId: "test-session", utterance: "How are you?" });
    expect(ports.ledger.mock.calls[1][0].state.workLedger.savedIds).toEqual(["saved-1"]);
    expect(ports.ledger.mock.calls[1][0].state.history.map((t: {text:string}) => t.text)).toContain("Add call Louise.");
    expect(ports.showrunner).toHaveBeenCalledWith(expect.objectContaining({ workLedger: expect.any(Object) }));
    expect(ports.save.mock.calls.at(-1)?.[2].ledgerState.workLedger.savedIds).toEqual(["saved-1"]);
  });
  it("the kill switch restores the existing Showrunner path", async () => {
    ports.enabled = false;
    await caller().deskComms({ sessionId: "test-session", utterance: "Hello." });
    expect(ports.ledger).not.toHaveBeenCalled();
    expect(ports.showrunner.mock.calls[0][0].workLedger).toBeUndefined();
  });
});
