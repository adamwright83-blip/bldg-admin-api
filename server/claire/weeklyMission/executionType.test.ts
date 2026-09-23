import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DailyCommand } from "../dailyCommandContract";
import {
  READINESS_KINDS,
  classifyWeeklyExecutionType,
  defaultReadiness,
  isLockedWeeklyIntent,
  isWeeklyLockBind,
  remainingWeekHorizon,
  resolveWeeklyExecutionType,
  type WeeklyIntentDay,
  type WeeklyIntentRecord,
} from "../../../shared/weeklyMissionReadiness";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { advanceWeeklySession } from "./advance";
import { commitWeeklyPlan, reopenWeeklySession, type WeeklyCommitPorts } from "./commit";
import { applyWeeklyIntentToCommand, playableToday } from "./dailyCommandIntent";
import { loadWeeklyDossier } from "./dossier";
import { newWeeklySession } from "./session";
import { lockBindApplies } from "./route";

const HORIZON = remainingWeekHorizon({ businessDate: "2026-09-15", localTime: "09:00" });

describe("weekly execution type", () => {
  afterEach(() => setClaireConversationStateStoreForTests(null));

  it("carries mission, challenge, and hybrid from the execution contract", () => {
    expect(classifyWeeklyExecutionType({ contract: "Visit Greystar on-site" })).toBe("mission");
    expect(classifyWeeklyExecutionType({ contract: "Drop door hangers at Beverly Hills" })).toBe("mission");
    expect(classifyWeeklyExecutionType({ contract: "Physical pickup at the Wilshire plant" })).toBe("mission");
    expect(classifyWeeklyExecutionType({ contract: "Pitch three properties in person" })).toBe("mission");
    expect(classifyWeeklyExecutionType({ contract: "Cold call the dormant list" })).toBe("challenge");
    expect(classifyWeeklyExecutionType({ contract: "Email the pricing sheet" })).toBe("challenge");
    expect(classifyWeeklyExecutionType({ contract: "Publish the listing in the browser" })).toBe("challenge");
    expect(classifyWeeklyExecutionType({ contract: "Do the Admin work on the queue" })).toBe("challenge");
    expect(classifyWeeklyExecutionType({ contract: "Remote follow-up with Dana" })).toBe("challenge");
    expect(classifyWeeklyExecutionType({ contract: "Drop door hangers and email the manager" })).toBe("hybrid_objective");
    expect(classifyWeeklyExecutionType({ contract: "Visit the property, then text the leasing office" })).toBe(
      "hybrid_objective"
    );
  });

  it("does not infer a field Mission from an identifier or the word mission", () => {
    expect(
      classifyWeeklyExecutionType({
        contract: "Check the board",
        identifier: "commercial_mission_weekly_primary",
        motion: "digital_presence",
      })
    ).toBeNull();
    expect(
      classifyWeeklyExecutionType({
        contract: "One real mission for Tuesday",
        identifier: "weekly-mission-readiness",
      })
    ).toBeNull();
    expect(
      resolveWeeklyExecutionType({
        text: "Greystar Hunt",
        candidates: [
          {
            id: "wgc:tenant:commercial_mission:greystar",
            title: "Greystar Hunt",
            objective: "On-site property pitch",
            motion: "digital_presence",
          },
        ],
      })
    ).toBe("mission");
    expect(
      resolveWeeklyExecutionType({
        text: "Keep visibility up",
        candidates: [
          {
            id: "mission-digital",
            title: "Keep visibility up",
            objective: "Stay present",
            motion: "digital_presence",
          },
        ],
      })
    ).toBeNull();
  });

  it("leaves an ambiguous contract unknown", () => {
    expect(classifyWeeklyExecutionType({ contract: "Follow up with Louise" })).toBeNull();
    expect(classifyWeeklyExecutionType({ contract: "Visit the property or email the manager" })).toBeNull();
    expect(classifyWeeklyExecutionType({ contract: "Field the six buildings" })).toBeNull();
    expect(classifyWeeklyExecutionType({ contract: "" })).toBeNull();
  });

  it("keeps an old WeeklyIntent valid and does not default the missing type to mission", () => {
    const legacy: WeeklyIntentRecord = {
      id: "intent-old",
      tenantId: "default",
      operatorId: "adam",
      weekStart: HORIZON.weekStart,
      revision: 1,
      source: "operator_confirmed_proposal",
      lockedAt: "2026-09-15T16:00:00.000Z",
      days: [
        {
          businessDate: "2026-09-15",
          weekday: "Tuesday",
          disposition: "primary",
          primary: { text: "Original mission", source: "operator_stated", commitmentId: "c1" },
          fixedConstraints: [],
          readinessRequirements: [],
        },
      ],
    };
    expect(isLockedWeeklyIntent(legacy)).toBe(true);
    expect(legacy.days[0]?.primary?.executionType).toBeUndefined();
    expect(isLockedWeeklyIntent({ ...legacy, days: [{ ...legacy.days[0], primary: { ...legacy.days[0]!.primary!, executionType: null } }] })).toBe(
      true
    );
    expect(
      isLockedWeeklyIntent({
        ...legacy,
        days: [{ ...legacy.days[0], primary: { ...legacy.days[0]!.primary!, executionType: "Mission" } }],
      })
    ).toBe(false);
  });

  it("preserves execution type through commitWeeklyPlan and reopen", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const session = newWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-1",
      weekStart: HORIZON.weekStart,
      draft: {
        weekStart: HORIZON.weekStart,
        days: HORIZON.remainingDates.map((businessDate, index) => ({
          businessDate,
          weekday: (["Tuesday", "Wednesday", "Thursday", "Friday"] as const)[index]!,
          disposition: "primary" as const,
          primary: {
            text: index === 0 ? "Visit Greystar on-site" : index === 1 ? "Email the pricing sheet" : "Check the board",
            source: "operator_stated" as const,
            existingCommitmentId: null,
            executionType: index === 0 ? ("mission" as const) : index === 1 ? ("challenge" as const) : null,
          },
          fixedConstraints: [],
          readinessRequirements: [],
          uncertainty: null,
        })),
      },
    });
    session.phase = "awaiting_confirmation";
    let saved: WeeklyIntentRecord | null = null;
    const ports = {
      acceptProposal: vi.fn(async () => ({ id: "created-1" })),
      designatePrimary: vi.fn(async (input: { commitmentId: string }) => ({ commitmentId: input.commitmentId })),
      saveIntent: async (intent: WeeklyIntentRecord) => {
        saved = intent;
      },
      latestIntent: async () => saved,
    } as unknown as WeeklyCommitPorts;
    const locked = await commitWeeklyPlan({ session, now: new Date("2026-09-15T16:00:00Z") }, ports);
    expect(locked.locked).toBe(true);
    expect(saved).not.toBeNull();
    const days = saved!.days;
    expect(days[0]?.primary?.executionType).toBe("mission");
    expect(days[1]?.primary?.executionType).toBe("challenge");
    expect(days[2]?.primary?.executionType).toBeNull();
    expect(days[2]?.primary?.executionType).not.toBe("mission");
    expect(isLockedWeeklyIntent(saved)).toBe(true);

    const dossier = await loadWeeklyDossier({ horizon: HORIZON }, { factsForDates: async () => [] });
    const reopened = await reopenWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-1",
      dossier,
      prior: saved,
    });
    expect(reopened.draft.days[0]?.primary?.executionType).toBe("mission");
    expect(reopened.draft.days[2]?.primary?.executionType).toBeNull();
  });

  it("still accepts the existing confirmation family and does not require the literal Lock it", () => {
    for (const phrase of ["Lock it", "Lock the week", "That's the week", "yes", "yeah", "yep", "looks good", "do it"]) {
      expect(isWeeklyLockBind(phrase)).toBe(true);
    }
    expect(isWeeklyLockBind("lock")).toBe(false);
    const open = newWeeklySession({
      tenantId: "t",
      operatorId: "o",
      dayDirectorActorId: "a",
      weekStart: HORIZON.weekStart,
      draft: { weekStart: HORIZON.weekStart, days: [] },
    });
    open.phase = "awaiting_confirmation";
    expect(lockBindApplies(open, "yes")).toBe(true);
    expect(lockBindApplies(open, "Looks good")).toBe(true);
    expect(lockBindApplies(open, "Lock it.")).toBe(true);
    open.phase = "interview";
    expect(lockBindApplies(open, "Lock it")).toBe(false);
  });

  it("projects the type onto Daily Command without changing today's rank", () => {
    const day: WeeklyIntentDay = {
      businessDate: "2026-09-17",
      weekday: "Thursday",
      disposition: "primary",
      primary: {
        text: "Email the pricing sheet",
        source: "operator_stated",
        commitmentId: "intent-primary",
        executionType: "challenge",
      },
      fixedConstraints: [],
      readinessRequirements: [],
    };
    const base = command("Payment hold", "route:pay", { importanceRank: 0 });
    const pictured = applyWeeklyIntentToCommand(base, day);
    expect(pictured.primary?.title).toBe("Payment hold");
    expect(pictured.primary?.importanceRank).toBe(0);
    expect(pictured.fixed).toBe(base.fixed);
    expect(pictured.weeklyPrimaryExecutionType).toBe("challenge");
    expect(pictured.weeklyIntentOverride?.code).toBe("hard_blocker");
    expect(playableToday({ command: pictured, draftTitle: "Fantasy Thursday mission" })).toEqual({
      title: "Payment hold",
      source: "daily_command",
    });

    const unknown: WeeklyIntentDay = {
      ...day,
      primary: { text: "Original mission", source: "operator_stated", commitmentId: "old" },
    };
    const carried = applyWeeklyIntentToCommand(command("Emergency pickup", "day-director:emergency"), unknown);
    expect(carried.primary?.title).toBe("Original mission");
    expect(carried.weeklyPrimaryExecutionType).toBeNull();
    expect(carried.primary?.importanceRank).toBe(2);
  });

  it("stamps operator-stated primaries from the contract and does not invent challenge prep", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const dossier = await loadWeeklyDossier({ horizon: HORIZON }, { factsForDates: async () => [] });
    const session = newWeeklySession({
      tenantId: "default",
      operatorId: "adam",
      dayDirectorActorId: "actor-1",
      weekStart: dossier.horizon.weekStart,
      draft: {
        weekStart: dossier.horizon.weekStart,
        days: dossier.horizon.remainingDates.map((businessDate, index) => ({
          businessDate,
          weekday: (["Tuesday", "Wednesday", "Thursday", "Friday"] as const)[index]!,
          disposition: "primary" as const,
          primary: null,
          fixedConstraints: [],
          readinessRequirements: [],
          uncertainty: null,
        })),
      },
    });
    session.lastQuestionKind = "primary";
    session.lastQuestionDate = "2026-09-15";
    const stated = await advanceWeeklySession({
      dossier,
      session,
      operatorUtterance: "Text the dormant customers",
    });
    const tuesday = stated.draft.days.find(day => day.businessDate === "2026-09-15");
    expect(tuesday?.primary?.executionType).toBe("challenge");
    expect(tuesday?.readinessRequirements).toEqual([]);

    tuesday!.primary = {
      text: "Text the dormant customers",
      source: "operator_stated",
      existingCommitmentId: null,
      executionType: "challenge",
    };
    session.lastQuestionKind = "readiness";
    session.lastQuestionDate = "2026-09-15";
    session.readinessAskedDates = ["2026-09-15"];
    const ready = await advanceWeeklySession({
      dossier,
      session,
      operatorUtterance: "Call Russell",
    });
    const item = ready.draft.days.find(day => day.businessDate === "2026-09-15")?.readinessRequirements[0];
    expect(item?.text).toBe("Call Russell");
    expect(item?.kind).not.toBe("physical");
    expect(item?.kind).not.toBe("location");
    expect(ready.draft.days.find(day => day.businessDate === "2026-09-15")?.readinessRequirements).toHaveLength(1);
  });

  it("keeps the five readiness kinds and does not add a second planner", () => {
    expect(READINESS_KINDS).toEqual(["physical", "document", "information", "approval", "location"]);
    const remote = defaultReadiness({
      text: "Call Russell",
      neededForDate: "2026-09-16",
      executionType: "challenge",
    });
    expect(remote.kind).not.toBe("physical");
    expect(remote.kind).not.toBe("location");
    expect(remote.text).not.toMatch(/site visit/i);
    const statedVisit = defaultReadiness({
      text: "Visit the property",
      neededForDate: "2026-09-16",
      executionType: "challenge",
    });
    expect(statedVisit.kind).toBe("physical");
    const shared = readFileSync(new URL("../../../shared/weeklyMissionReadiness.ts", import.meta.url), "utf8");
    expect(shared).not.toMatch(/weeklyOperatingPlan|createDayLine|WeeklyIntentV2/);
    expect(shared).not.toMatch(/readCurrentDayLine|currentDayLine/);
    expect(existsSync(new URL("../../weeklyOperatingPlan.ts", import.meta.url))).toBe(false);
    const rank = readFileSync(new URL("../../missionDirector/missionRank.ts", import.meta.url), "utf8");
    const selection = readFileSync(new URL("../../missionDirector/planSelection.ts", import.meta.url), "utf8");
    const controller = readFileSync(
      new URL("../../../client/src/pages/driver/GoldlineDriverController.tsx", import.meta.url),
      "utf8"
    );
    expect(rank).not.toMatch(/weeklyPrimaryExecutionType|classifyWeeklyExecutionType/);
    expect(selection).not.toMatch(/weeklyPrimaryExecutionType|classifyWeeklyExecutionType/);
    expect(controller).not.toMatch(/weeklyPrimaryExecutionType|classifyWeeklyExecutionType/);
    const seam = readFileSync(new URL("./dailyCommandIntent.ts", import.meta.url), "utf8");
    expect(seam).toMatch(/weeklyPrimaryExecutionType/);
    expect(seam).not.toMatch(/importanceRank:\s*executionType|sort\(/);
  });
});

function command(
  primaryTitle: string,
  primaryId: string,
  primaryPatch: Partial<NonNullable<DailyCommand["primary"]>> = {}
): DailyCommand {
  return {
    businessDate: "2026-09-17",
    actorId: "actor-1",
    primary: {
      id: primaryId,
      title: primaryTitle,
      category: "primary",
      dayDirectorKind: "operations",
      status: "open",
      importanceRank: 2,
      chronology: { axis: "unscheduled_discretionary", windowStart: null, windowEnd: null, label: null },
      promisedTo: null,
      identityUnknown: false,
      cargoLink: null,
      recurrenceRuleId: null,
      detailState: "COMPLETE",
      provenance: { reader: "dayDirector", sourceType: "day_director", sourceIds: ["live"], quote: primaryTitle },
      ...primaryPatch,
    },
    fixed: [],
    externalCommitments: [],
    tomorrowPrep: [],
    growthDebt: [],
    operations: [],
    housekeeping: [],
    cargo: [],
    constraints: {
      fingerprint: "fp",
      protectDiscretionary: true,
      occupancies: [],
      primaryOpen: true,
      prepOpenIds: [],
    },
    epistemic: {
      businessTruthItemIds: [],
      executiveJudgment: { discretionaryOwnerId: primaryId, policy: [] },
    },
  };
}
