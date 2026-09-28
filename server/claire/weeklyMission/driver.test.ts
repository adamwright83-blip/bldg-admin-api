/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { WeeklyIntentRecord } from "../../../shared/weeklyMissionReadiness";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { adjustWeeklyMission, beginWeeklyMission, declineWeeklyMission, loadWeeklyMissionPicture, replyWeeklyMission } from "./driver";
import { loadWeeklySession, loadWeeklySurface } from "./session";

const NOW = new Date("2026-09-21T16:00:00Z");
const SCOPE = {
  tenantId: "tenant-1",
  operatorId: "operator-1",
  dayDirectorActorId: "actor-1",
  timeZone: "America/Los_Angeles",
  now: NOW,
};

afterEach(() => setClaireConversationStateStoreForTests(null));

function memory() {
  setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
}

const isolated = {
  factsForDates: async () => [],
  latestIntent: async () => null as WeeklyIntentRecord | null,
};

describe("weekly mission driver", () => {
  it("surfaces the unplanned card once and decline does not open a session", async () => {
    memory();
    const first = await loadWeeklyMissionPicture(SCOPE, isolated);
    const second = await loadWeeklyMissionPicture(SCOPE, isolated);
    expect(first.status).toBe("UNPLANNED");
    expect(first.cta).toBe("plan");
    expect(second.showCard).toBe(true);
    const surface = await loadWeeklySurface({
      tenantId: SCOPE.tenantId,
      operatorId: SCOPE.operatorId,
      weekStart: first.weekStart,
    });
    expect(surface.surfacedAt).toBe(NOW.toISOString());
    expect(surface.declinedAt).toBeNull();

    const declined = await declineWeeklyMission(SCOPE, isolated);
    expect(declined.status).toBe("UNPLANNED");
    expect(declined.showCard).toBe(false);
    const session = await loadWeeklySession({
      tenantId: SCOPE.tenantId,
      operatorId: SCOPE.operatorId,
      weekStart: first.weekStart,
    });
    expect(session).toBeNull();
  });

  it("begins once and resumes the same session", async () => {
    memory();
    const started = await beginWeeklyMission(SCOPE, isolated);
    expect(started.resumed).toBe(false);
    expect(started.speech).toContain("Monday");
    const before = await loadWeeklySession({
      tenantId: SCOPE.tenantId,
      operatorId: SCOPE.operatorId,
      weekStart: started.card.weekStart,
    });
    const again = await beginWeeklyMission(SCOPE, isolated);
    const after = await loadWeeklySession({
      tenantId: SCOPE.tenantId,
      operatorId: SCOPE.operatorId,
      weekStart: started.card.weekStart,
    });
    expect(again.resumed).toBe(true);
    expect(again.card.status).toBe("IN_PROGRESS");
    expect(again.speech).toContain("still on this week");
    expect(after).toEqual(before);
  });

  it("does not open a session on a weekend", async () => {
    memory();
    const weekend = { ...SCOPE, now: new Date("2026-09-26T17:00:00Z") };
    const started = await beginWeeklyMission(weekend, isolated);
    expect(started.card.canBegin).toBe(false);
    expect(started.speech).toContain("already over");
    const session = await loadWeeklySession({
      tenantId: weekend.tenantId,
      operatorId: weekend.operatorId,
      weekStart: started.card.weekStart,
    });
    expect(session).toBeNull();
  });

  it("reopens a locked week without rewriting the intent", async () => {
    memory();
    const intent: WeeklyIntentRecord = {
      id: "intent-1",
      tenantId: SCOPE.tenantId,
      operatorId: SCOPE.operatorId,
      weekStart: "2026-09-21",
      revision: 1,
      source: "operator_confirmed_proposal",
      lockedAt: NOW.toISOString(),
      days: [
        {
          businessDate: "2026-09-21",
          weekday: "Monday",
          disposition: "primary",
          primary: { text: "Russell", source: "operator_stated", commitmentId: "c1" },
          fixedConstraints: [],
          readinessRequirements: [],
        },
      ],
    };
    let reads = 0;
    const latestIntent = async () => {
      reads += 1;
      return intent;
    };
    const opened = await adjustWeeklyMission(SCOPE, { factsForDates: async () => [], latestIntent });
    expect(opened.card.status).toBe("IN_PROGRESS");
    expect(opened.speech).toContain("open again");
    const session = await loadWeeklySession({
      tenantId: SCOPE.tenantId,
      operatorId: SCOPE.operatorId,
      weekStart: "2026-09-21",
    });
    expect(session?.adjust).toBe(true);
    expect(session?.draft.days[0]?.primary?.text).toBe("Russell");
    expect(intent.days[0]?.primary?.text).toBe("Russell");
    expect(reads).toBeGreaterThan(0);
  });

  it("does not answer a reply when no session is open", async () => {
    memory();
    const turn = await replyWeeklyMission(SCOPE, "Lock it.", isolated);
    expect(turn.speech).toContain("isn't open");
  });

  it("keeps the driver off Daily Command writes and on the canonical week contract", () => {
    const driver = readFileSync(new URL("./driver.ts", import.meta.url), "utf8");
    const intentStore = readFileSync(new URL("./intentStore.ts", import.meta.url), "utf8");
    const contract = readFileSync(new URL("../../../client/src/pages/goldline/week/weeklyIntentContract.ts", import.meta.url), "utf8");
    const shared = readFileSync(new URL("../../../shared/weeklyMissionReadiness.ts", import.meta.url), "utf8");
    expect(driver).not.toMatch(/loadDailyCommand\s*\(/);
    expect(driver).not.toMatch(/projectRecurrenceForDate\s*\(/);
    expect(driver).toMatch(/deps\.latestIntent \?\? latestWeeklyIntent/);
    expect(driver).toContain("readWeeklyGrowthCandidatesForDossier");
    expect(intentStore).not.toMatch(/ER_NO_SUCH_TABLE|DAYFORGE_RELEASE_TEST_MODE/);
    expect(contract).toContain('from "@shared/weeklyMissionReadiness"');
    expect(contract).toContain("isLockedWeeklyIntent");
    expect(contract).not.toMatch(/type WeeklyIntentRecord\s*=/);
    expect(shared).toContain("export function isLockedWeeklyIntent");
    expect(shared).not.toMatch(/type WeeklyGrowthCandidate/);
  });
});
