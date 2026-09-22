import { afterEach, describe, expect, it } from "vitest";
import { remainingWeekHorizon } from "../../../shared/weeklyMissionReadiness";
import { draftFromDossier, loadWeeklyDossier } from "./dossier";
import {
  clearWeeklySession,
  loadWeeklySession,
  newWeeklySession,
  saveWeeklySession,
} from "./session";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";

describe("weekly planning session", () => {
  afterEach(() => {
    setClaireConversationStateStoreForTests(null);
  });

  it("persists under weekly-planning:{tenant}:{operator}:{weekStart} and is not business truth", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const horizon = remainingWeekHorizon({ businessDate: "2026-09-21", localTime: "09:00" });
    const dossier = await loadWeeklyDossier({ horizon }, { factsForDates: async () => [] });
    const session = newWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-1",
      weekStart: horizon.weekStart,
      draft: draftFromDossier(dossier),
    });
    expect(session.key).toBe("weekly-planning:default:adam:2026-09-21");
    await saveWeeklySession(session, 1_000);
    const loaded = await loadWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      weekStart: "2026-09-21",
      now: 1_500,
    });
    expect(loaded?.phase).toBe("interview");
    expect(loaded?.draft.days).toHaveLength(5);
    await clearWeeklySession(session);
    expect(
      await loadWeeklySession({ tenantId: "default", operatorId: "adam", weekStart: "2026-09-21", now: 1_600 })
    ).toBeNull();
  });
});
