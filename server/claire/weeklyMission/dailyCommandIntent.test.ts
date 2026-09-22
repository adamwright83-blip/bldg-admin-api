import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DailyCommand } from "../dailyCommandContract";
import type { WeeklyIntentDay } from "../../../shared/weeklyMissionReadiness";
import {
  applyWeeklyIntentToCommand,
  explicitOperatorMissionDisplacement,
  loadDailyCommandWithWeeklyIntent,
  playableToday,
} from "./dailyCommandIntent";

function command(
  primaryTitle: string | null,
  primaryId: string | null,
  businessDate = "2026-09-17",
  primaryPatch: Partial<NonNullable<DailyCommand["primary"]>> = {}
): DailyCommand {
  return {
    businessDate,
    actorId: "actor-1",
    primary: primaryTitle
      ? {
          id: primaryId ?? "day-director:live",
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
        }
      : null,
    fixed: [],
    externalCommitments: [],
    tomorrowPrep: [],
    growthDebt: [],
    operations: [],
    housekeeping: [],
    cargo: [],
    constraints: {
      fingerprint: "fp",
      protectDiscretionary: Boolean(primaryTitle),
      occupancies: [],
      primaryOpen: Boolean(primaryTitle),
      prepOpenIds: [],
    },
    epistemic: {
      businessTruthItemIds: [],
      executiveJudgment: { discretionaryOwnerId: primaryId, policy: [] },
    },
  };
}

const intentDay: WeeklyIntentDay = {
  businessDate: "2026-09-17",
  weekday: "Thursday",
  disposition: "primary",
  primary: { text: "Field the six buildings", source: "operator_stated", commitmentId: "intent-primary" },
  fixedConstraints: [],
  readinessRequirements: [
    {
      text: "Print six packets",
      kind: "document",
      neededForDate: "2026-09-18",
      completeByDate: "2026-09-17",
      status: "open",
    },
    {
      text: "Clean jacket",
      kind: "physical",
      neededForDate: "2026-09-18",
      completeByDate: "2026-09-16",
      status: "open",
    },
  ],
};

const wednesdayJacket: WeeklyIntentDay = {
  businessDate: "2026-09-23",
  weekday: "Wednesday",
  disposition: "primary",
  primary: { text: "Property run", source: "operator_stated", commitmentId: "wed-primary" },
  fixedConstraints: [],
  readinessRequirements: [
    {
      text: "wash jacket",
      kind: "physical",
      neededForDate: "2026-09-23",
      completeByDate: "2026-09-21",
      status: "open",
    },
  ],
};

const mondayMission: WeeklyIntentDay = {
  businessDate: "2026-09-21",
  weekday: "Monday",
  disposition: "primary",
  primary: { text: "Field the six buildings", source: "operator_stated", commitmentId: "mon-primary" },
  fixedConstraints: [],
  readinessRequirements: [],
};

describe("Daily Command weekly intent", () => {
  it("fails closed to the locked primary when Daily Command runs something else", () => {
    const original = structuredClone(intentDay);
    const base = command("Emergency pickup", "day-director:emergency");
    const pictured = applyWeeklyIntentToCommand(base, intentDay);
    expect(pictured.primary?.title).toBe("Field the six buildings");
    expect(pictured.weeklyIntentOverride).toBeNull();
    expect(pictured.fixed).toBe(base.fixed);
    expect(pictured.externalCommitments).toBe(base.externalCommitments);
    expect(pictured.weeklyIntentReadiness?.map(item => item.text)).toEqual(["Print six packets"]);
    expect(pictured.weeklyIntentReadiness?.[0]?.provenance).toBe("weekly_intent_readiness");
    expect(intentDay).toEqual(original);
  });

  it("rejects a tautological Daily Command displacement", () => {
    const base = command("Emergency pickup", "day-director:emergency");
    const pictured = applyWeeklyIntentToCommand(base, intentDay, {
      allowed: true,
      reason: "Daily Command is running Emergency pickup. The locked week still records Field the six buildings.",
      evidenceQuote: "Emergency pickup",
    });
    expect(pictured.primary?.title).toBe("Field the six buildings");
    expect(pictured.weeklyIntentOverride).toBeNull();
  });

  it("allows an evidenced operator replacement of the locked primary", () => {
    const base = command("Emergency pickup", "day-director:emergency");
    base.primary!.provenance.quote = "burst pipe at the dock";
    const pictured = applyWeeklyIntentToCommand(base, intentDay, {
      allowed: true,
      reason: "Operator said burst pipe at the dock and took the emergency.",
      evidenceQuote: "burst pipe at the dock",
    });
    expect(pictured.primary?.title).toBe("Emergency pickup");
    expect(pictured.weeklyIntentOverride?.code).toBe("operator_replaced_weekly_primary");
    expect(pictured.weeklyIntentOverride?.evidenceQuote).toBe("burst pipe at the dock");
  });

  it("surfaces Wednesday readiness due Tuesday on Tuesday", () => {
    const tuesdayMission: WeeklyIntentDay = {
      businessDate: "2026-09-22",
      weekday: "Tuesday",
      disposition: "primary",
      primary: { text: "Field the six buildings", source: "operator_stated", commitmentId: "tue-primary" },
      fixedConstraints: [],
      readinessRequirements: [],
    };
    const dueTuesday: WeeklyIntentDay = {
      ...wednesdayJacket,
      readinessRequirements: [
        {
          text: "wash jacket",
          kind: "physical",
          neededForDate: "2026-09-23",
          completeByDate: "2026-09-22",
          status: "open",
        },
      ],
    };
    const pictured = applyWeeklyIntentToCommand(
      command("Emergency pickup", "day-director:emergency", "2026-09-22"),
      [tuesdayMission, dueTuesday]
    );
    expect(pictured.primary?.title).toBe("Field the six buildings");
    expect(pictured.weeklyIntentOverride).toBeNull();
    expect(pictured.weeklyIntentReadiness).toEqual([
      expect.objectContaining({
        text: "wash jacket",
        neededForDate: "2026-09-23",
        completeByDate: "2026-09-22",
        missionTitle: "Property run",
      }),
    ]);
    expect(JSON.stringify(pictured)).not.toContain("internalHypothesis");
  });

  it("surfaces Wednesday prep on Monday and keeps Monday's locked primary", () => {
    const base = command("Emergency pickup", "day-director:emergency", "2026-09-21");
    const pictured = applyWeeklyIntentToCommand(base, [mondayMission, wednesdayJacket]);
    expect(pictured.primary?.title).toBe("Field the six buildings");
    expect(pictured.weeklyIntentOverride).toBeNull();
    expect(pictured.weeklyIntentReadiness).toEqual([
      expect.objectContaining({
        text: "wash jacket",
        neededForDate: "2026-09-23",
        completeByDate: "2026-09-21",
        missionTitle: "Property run",
      }),
    ]);
  });

  it("does not steal Monday's primary from a later mission when Monday has none", () => {
    const pictured = applyWeeklyIntentToCommand(
      command("Emergency pickup", "day-director:emergency", "2026-09-21"),
      wednesdayJacket
    );
    expect(pictured.primary?.title).toBe("Emergency pickup");
    expect(pictured.weeklyIntentReadiness?.[0]?.text).toBe("wash jacket");
    expect(pictured.weeklyIntentReadiness?.[0]?.missionTitle).toBe("Property run");
  });

  it("uses the locked primary when today has no other primary", () => {
    const pictured = applyWeeklyIntentToCommand(command(null, null), intentDay);
    expect(pictured.primary?.title).toBe("Field the six buildings");
    expect(pictured.primary?.provenance.reader).toBe("weekly_intent");
    expect(pictured.constraints.protectDiscretionary).toBe(true);
    expect(pictured.weeklyIntentOverride).toBeNull();
  });

  it("Mission Director plays the locked primary and ignores a draft title", () => {
    const pictured = applyWeeklyIntentToCommand(command("Emergency pickup", "day-director:emergency"), intentDay);
    expect(playableToday({ command: pictured, draftTitle: "Fantasy Thursday mission" })).toEqual({
      title: "Field the six buildings",
      source: "daily_command",
    });
    const missionDirector = readFileSync(new URL("../../missionDirector/missionDirectorService.ts", import.meta.url), "utf8");
    const seam = readFileSync(new URL("./dailyCommandIntent.ts", import.meta.url), "utf8");
    expect(missionDirector).toMatch(/loadDailyCommand/);
    expect(missionDirector).toMatch(/applyWeeklyIntentToCommand/);
    expect(missionDirector).not.toMatch(/saveWeeklyIntent/);
    const compute = missionDirector.slice(
      missionDirector.indexOf("export async function computeMissionPlan"),
      missionDirector.indexOf("const activeRuns")
    );
    expect(compute).not.toMatch(/projectRecurrenceForDate/);
    expect(seam).toMatch(/from ["']\.\.\/dailyCommandContract["']/);
    expect(seam).not.toMatch(/workdayCommandService|projectRecurrenceForDate|saveWeeklyIntent/);
  });

  it("keeps a hard blocker and a fixed-time primary, and does not treat a different title as authority", () => {
    const blocker = applyWeeklyIntentToCommand(
      command("Payment hold", "route:pay", "2026-09-17", { importanceRank: 0 }),
      intentDay
    );
    expect(blocker.primary?.title).toBe("Payment hold");
    expect(blocker.weeklyIntentOverride?.code).toBe("hard_blocker");

    const fixed = applyWeeklyIntentToCommand(
      command("Dock window", "day-director:dock", "2026-09-17", {
        chronology: { axis: "fixed_window", windowStart: "08:00", windowEnd: "09:00", label: "08:00–09:00" },
      }),
      intentDay
    );
    expect(fixed.primary?.title).toBe("Dock window");
    expect(fixed.weeklyIntentOverride?.code).toBe("fixed_external_obligation");
    expect(intentDay.primary?.text).toBe("Field the six buildings");
  });

  it("loads the command through the stable contract and does not write the intent", async () => {
    const calls: string[] = [];
    const pictured = await loadDailyCommandWithWeeklyIntent(
      {
        tenantId: "tenant-1",
        actorId: "actor-1",
        dayDirectorActorId: "actor-1",
        operatorUserId: "operator-1",
        businessDate: "2026-09-17",
        weekStart: "2026-09-14",
      },
      {
        loadCommand: async () => {
          calls.push("load");
          return command("Emergency pickup", "day-director:emergency");
        },
        latestIntent: async () => {
          calls.push("intent");
          return {
            id: "intent-1",
            tenantId: "tenant-1",
            operatorId: "operator-1",
            weekStart: "2026-09-14",
            revision: 1,
            source: "operator_confirmed_proposal",
            lockedAt: "2026-09-14T16:00:00.000Z",
            days: [intentDay],
          };
        },
      }
    );
    expect(calls).toEqual(["load", "intent"]);
    expect(pictured.primary?.title).toBe("Field the six buildings");
    expect(pictured.weeklyIntentOverride).toBeNull();
  });

  it("displaces today's weekly primary only from stored explicit operator mission evidence", () => {
    const quote = "Make publishing the Instagram ad my mission today";
    const tuesday: WeeklyIntentDay = {
      ...intentDay,
      businessDate: "2026-09-22",
      weekday: "Tuesday",
      primary: { text: "Pitch three properties", source: "operator_stated", commitmentId: "pitch" },
    };
    const original = structuredClone(tuesday);
    const base = command("Publish the Instagram ad", "day-director:ad", "2026-09-22");
    base.primary!.provenance.quote = quote;
    base.primary!.provenance.sourceIds = ["commitment-ad"];
    base.explicitOperatorMission = {
      version: 1,
      source: "operator_explicit",
      scope: "today_only",
      completionCondition: "The Instagram ad is published.",
      verification: "operator_reported",
      operatorMissionKey: "om:test",
      requestedAt: "2026-09-22T15:00:00.000Z",
      weeklyIntentDisplacement: true,
      sourceCommandRef: "voice:conv:turn:1",
      evidenceQuote: quote,
      businessDate: "2026-09-22",
    };
    const pictured = applyWeeklyIntentToCommand(base, tuesday, explicitOperatorMissionDisplacement(base));
    expect(pictured.primary?.title).toBe("Publish the Instagram ad");
    expect(pictured.weeklyIntentOverride?.code).toBe("operator_replaced_weekly_primary");
    expect(pictured.weeklyIntentOverride?.reason).toMatch(/Explicit operator mission command/);
    expect(pictured.weeklyIntentOverride?.reason).not.toMatch(/daily command is running/i);
    expect(pictured.weeklyIntentOverride?.evidenceQuote).toBe(quote);
    expect(tuesday).toEqual(original);
    const drift = applyWeeklyIntentToCommand(
      command("Publish the Instagram ad", "day-director:ad", "2026-09-22"),
      tuesday
    );
    expect(drift.primary?.title).toBe("Pitch three properties");
    expect(explicitOperatorMissionDisplacement(drift)).toBeNull();
    expect(drift.weeklyIntentOverride).toBeNull();
  });

  it("leaves Brain V2 without authority and without a weekly_planning task set", () => {
    const contracts = readFileSync(new URL("../" + "brain/contracts/index.ts", import.meta.url), "utf8");
    expect(contracts).toMatch(/BRAIN_V2_PRODUCTION_AUTHORITY\s*=\s*false/);
    const control = readFileSync(new URL("../" + "brain/contracts/control.ts", import.meta.url), "utf8");
    expect(control).not.toMatch(/weekly_planning/);
    const advance = readFileSync(new URL("./advance.ts", import.meta.url), "utf8");
    expect(advance).toMatch(/writesBusinessTruth: false/);
    expect(advance).not.toMatch(/productionAuthority:\s*true/);
  });
});
