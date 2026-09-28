import { afterEach, describe, expect, it, vi } from "vitest";
import { remainingWeekHorizon, type WeeklyIntentRecord } from "../../../shared/weeklyMissionReadiness";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { commitWeeklyPlan, reopenWeeklySession, type WeeklyCommitPorts } from "./commit";
import { loadWeeklyDossier } from "./dossier";
import { loadWeeklySession, newWeeklySession } from "./session";
import { lockBindApplies } from "./route";

const HORIZON = remainingWeekHorizon({ businessDate: "2026-09-15", localTime: "09:00" });

describe("commitWeeklyPlan", () => {
  afterEach(() => setClaireConversationStateStoreForTests(null));

  function session() {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const base = newWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-1",
      weekStart: HORIZON.weekStart,
      draft: {
        weekStart: HORIZON.weekStart,
        days: HORIZON.remainingDates.map(businessDate => ({
          businessDate,
          weekday:
            businessDate === "2026-09-15"
              ? "Tuesday"
              : businessDate === "2026-09-16"
                ? "Wednesday"
                : businessDate === "2026-09-17"
                  ? "Thursday"
                  : "Friday",
          disposition: "primary" as const,
          primary: {
            text: `Mission ${businessDate}`,
            source: "operator_stated" as const,
            existingCommitmentId: null,
          },
          fixedConstraints:
            businessDate === "2026-09-15"
              ? [{ sourceRef: "day-director:jetro", title: "JETRO", businessDate, scheduleLabel: "14:00" }]
              : [],
          readinessRequirements:
            businessDate === "2026-09-15"
              ? [
                  {
                    text: "Clean jacket",
                    kind: "physical" as const,
                    neededForDate: businessDate,
                    completeByDate: "2026-09-14",
                    status: "open" as const,
                  },
                  {
                    text: "Call Russell at 11",
                    kind: "information" as const,
                    neededForDate: businessDate,
                    completeByDate: "2026-09-14",
                    status: "open" as const,
                  },
                ]
              : [],
          uncertainty: null,
        })),
      },
    });
    base.phase = "awaiting_confirmation";
    return base;
  }

  it("does not copy fixed constraints, keeps unscheduled readiness off the task list, and retries without a second primary", async () => {
    const created = new Map<string, string>();
    let allowThursday = false;
    let intentSaves = 0;
    const accept = vi.fn(async (input: { businessDate: string; proposal: { promptKey: string; title: string; command?: { role?: string | null } } }) => {
      expect(input.proposal.title).not.toBe("JETRO");
      expect(input.proposal.title).not.toBe("Clean jacket");
      if (input.businessDate === "2026-09-17" && !allowThursday) throw new Error("thursday down");
      const id = created.get(input.proposal.promptKey) ?? `id-${created.size + 1}`;
      created.set(input.proposal.promptKey, id);
      return { id };
    });
    const designate = vi.fn(async (input: { commitmentId: string }) => ({
      commitmentId: input.commitmentId,
      idempotent: true,
    }));
    let saved: WeeklyIntentRecord | null = null;
    const ports = {
      acceptProposal: accept,
      designatePrimary: designate,
      saveIntent: async (intent: WeeklyIntentRecord) => {
        intentSaves += 1;
        saved = intent;
      },
      latestIntent: async () => saved,
    } as unknown as WeeklyCommitPorts;

    const first = session();
    const failed = await commitWeeklyPlan({ session: first, now: new Date("2026-09-15T16:00:00Z") }, ports);
    expect(failed.locked).toBe(false);
    expect(failed.speech).toMatch(/Thursday did not lock/);
    expect(failed.speech).toMatch(/not locked/);
    expect(failed.speech).not.toMatch(/^Locked/);
    expect(intentSaves).toBe(0);
    expect(saved).toBeNull();
    const titles = accept.mock.calls.map(call => call[0].proposal.title);
    expect(titles.filter(title => title.startsWith("Mission 2026-09-15"))).toHaveLength(1);
    expect(titles).toContain("Call Russell at 11");
    expect(accept.mock.calls.find(call => call[0].proposal.title === "Call Russell at 11")?.[0].businessDate).toBe(
      "2026-09-14"
    );
    expect(titles).not.toContain("Clean jacket");
    expect(titles).not.toContain("JETRO");

    allowThursday = true;
    const retried = await commitWeeklyPlan({ session: first, now: new Date("2026-09-15T16:05:00Z") }, ports);
    expect(retried.locked).toBe(true);
    expect(retried.speech).toMatch(/^Locked/);
    expect(intentSaves).toBe(1);
    expect(saved!.source).toBe("operator_confirmed_proposal");
    expect(JSON.stringify(saved)).not.toContain("internalHypothesis");
    expect(saved!.days.find(day => day.businessDate === "2026-09-15")?.fixedConstraints[0]?.sourceRef).toBe(
      "day-director:jetro"
    );
    const tuesdayMissions = accept.mock.calls.filter(call => call[0].proposal.title.startsWith("Mission 2026-09-15"));
    expect(tuesdayMissions).toHaveLength(1);
    expect(designate).toHaveBeenCalled();
    expect(await loadWeeklySession({ tenantId: "default", operatorId: "adam", weekStart: HORIZON.weekStart })).toBeNull();
  });

  it("refuses to lock from an interview and treats a day move as not a bind", () => {
    const open = newWeeklySession({
      tenantId: "t",
      operatorId: "o",
      dayDirectorActorId: "a",
      weekStart: HORIZON.weekStart,
      draft: { weekStart: HORIZON.weekStart, days: [] },
    });
    expect(lockBindApplies(open, "Lock it")).toBe(false);
    open.phase = "proposal";
    expect(lockBindApplies(open, "")).toBe(false);
    expect(lockBindApplies(open, "   ")).toBe(false);
    expect(lockBindApplies(open, "Lock it.")).toBe(true);
    expect(lockBindApplies(open, "Looks good")).toBe(true);
    expect(lockBindApplies(open, "No, Tuesday won't work. Thursday.")).toBe(false);
  });

  it("reopens the same week without erasing the prior intent", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await loadWeeklyDossier({ horizon: HORIZON }, { factsForDates: async () => [] });
    const prior: WeeklyIntentRecord = {
      id: "intent-1",
      tenantId: "default",
      operatorId: "adam",
      weekStart: HORIZON.weekStart,
      revision: 1,
      source: "operator_confirmed_proposal",
      lockedAt: "2026-09-15T16:00:00.000Z",
      days: dossier.horizon.remainingDates.map(businessDate => ({
        businessDate,
        weekday: businessDate === "2026-09-15" ? "Tuesday" : businessDate === "2026-09-16" ? "Wednesday" : businessDate === "2026-09-17" ? "Thursday" : "Friday",
        disposition: "primary",
        primary: { text: "Original mission", source: "operator_stated", commitmentId: "c1" },
        fixedConstraints: [],
        readinessRequirements: [],
      })),
    };
    const session = await reopenWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-1",
      dossier,
      prior,
    });
    expect(session.adjust).toBe(true);
    expect(session.phase).toBe("interview");
    expect(session.draft.days[0]?.primary?.existingCommitmentId).toBe("c1");
    expect(prior.days[0]?.primary?.text).toBe("Original mission");
  });
});
