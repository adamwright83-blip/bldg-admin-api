import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { routeActiveWeeklySession } from "./route";
import { loadWeeklySession, newWeeklySession, saveWeeklySession } from "./session";

vi.mock("./productionReaders", () => ({
  readWeeklyDossierFacts: async () => [],
  readWeeklyGrowthCandidatesForDossier: async () => [],
}));
vi.mock("./weeklyModel", () => ({
  classifyWeeklyTurnWithClaire: async () => null,
  completeWeeklyActWithClaire: async () => null,
}));

const now = new Date("2026-10-12T16:00:00Z");
const scope = {
  tenantId: "tenant-a",
  operatorId: "canonical-a",
  dayDirectorActorId: "11",
  now,
  timeZone: "America/Los_Angeles",
  weekStartOverride: "2026-10-12",
};

async function openAlias(operatorId = "driver-alias", dayDirectorActorId = "22") {
  const session = newWeeklySession({
    tenantId: scope.tenantId,
    operatorId,
    dayDirectorActorId,
    weekStart: scope.weekStartOverride,
    draft: { weekStart: scope.weekStartOverride, days: [] },
  });
  await saveWeeklySession(session);
  return session;
}

describe("weekly callback routing across authorized operator aliases", () => {
  beforeEach(() => setClaireConversationStateStoreForTests(createMemoryConversationStateStore()));
  afterEach(() => setClaireConversationStateStoreForTests(null));

  it("continues the alias-owned session that the callback opening resumed", async () => {
    await openAlias();
    const result = await routeActiveWeeklySession({
      ...scope,
      operatorIds: ["canonical-a", "driver-alias"],
      dayDirectorActorIds: ["11", "22"],
      utterance: "Cancel weekly planning.",
      authoritativeIntent: "weekly_cancel",
    });
    expect(result?.act).toBe("CANCEL");
    expect(result?.speak).toBe("All right. I won't lock a week.");
    expect(await loadWeeklySession({
      tenantId: scope.tenantId,
      operatorId: "driver-alias",
      weekStart: scope.weekStartOverride,
    })).toBeNull();
  });

  it("never resumes another operator merely because an open session exists", async () => {
    await openAlias("another-operator", "99");
    const result = await routeActiveWeeklySession({
      ...scope,
      operatorIds: ["canonical-a", "driver-alias"],
      dayDirectorActorIds: ["11", "22"],
      utterance: "Cancel weekly planning.",
      authoritativeIntent: "weekly_cancel",
    });
    expect(result).toBeNull();
    expect(await loadWeeklySession({
      tenantId: scope.tenantId,
      operatorId: "another-operator",
      weekStart: scope.weekStartOverride,
    })).not.toBeNull();
  });

  it("rejects an operator alias whose session contains an unauthorized Day Director actor", async () => {
    await openAlias("driver-alias", "99");
    const result = await routeActiveWeeklySession({
      ...scope,
      operatorIds: ["canonical-a", "driver-alias"],
      dayDirectorActorIds: ["11", "22"],
      utterance: "Cancel weekly planning.",
      authoritativeIntent: "weekly_cancel",
    });
    expect(result).toBeNull();
    expect(await loadWeeklySession({
      tenantId: scope.tenantId,
      operatorId: "driver-alias",
      weekStart: scope.weekStartOverride,
    })).not.toBeNull();
  });
});
