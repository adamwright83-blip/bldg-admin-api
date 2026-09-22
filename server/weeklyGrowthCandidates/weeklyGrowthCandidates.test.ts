import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canonicalWeeklyGrowthFeed } from "../../shared/weeklyGrowthCandidates";
import { isDealable } from "../churnRadar/hustlerLeverSelection";
import { loadWeeklyGrowthCandidates } from "./loadWeeklyGrowthCandidates";
import { emptyRawRecord, type WeeklyGrowthRawRecord, type WeeklyGrowthSourceBundle } from "./rawRecord";

const TENANT = "tenant-a";
const OTHER = "tenant-b";
const OPERATOR = "operator-a";
const ACTOR = "actor-a";
const TODAY = "2026-09-21";
const DATES = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25"];

function rec(overrides: Partial<WeeklyGrowthRawRecord> & Pick<WeeklyGrowthRawRecord, "origin" | "sourceId">): WeeklyGrowthRawRecord {
  return emptyRawRecord({ tenantId: TENANT, operatorUserId: OPERATOR, actorId: ACTOR, ...overrides });
}

function available<T>(records: T[]): { status: "available"; records: T[] } {
  return { status: "available", records };
}

function bundle(partial: Partial<WeeklyGrowthSourceBundle> = {}): WeeklyGrowthSourceBundle {
  return {
    unfinished: available([]),
    commercialFollowUps: available([]),
    proactiveObligations: available([]),
    recovery: available([]),
    campaigns: available([]),
    macroGoal: available([]),
    ...partial,
  };
}

function load(sources: WeeklyGrowthSourceBundle, now = "2026-09-21T18:00:00.000Z") {
  return loadWeeklyGrowthCandidates(
    {
      tenantId: TENANT,
      operatorUserId: OPERATOR,
      dayDirectorActorId: ACTOR,
      remainingDates: DATES,
      now: new Date(now),
      timeZone: "America/Los_Angeles",
    },
    { readSources: async () => sources, today: () => TODAY }
  );
}

function growth(sourceId: string, title: string, status = "open") {
  return rec({
    origin: "day_director_commitment",
    sourceId,
    commitmentId: sourceId,
    title,
    objective: title,
    status,
    grounding: "growth_tagged",
    alreadyInFlight: status === "open",
  });
}

function followUp(sourceId: string, note: string, status: string, dueDate: string, extra: Partial<WeeklyGrowthRawRecord> = {}) {
  return rec({
    origin: "commercial_follow_up",
    sourceId,
    followUpId: sourceId,
    title: note,
    objective: note,
    status,
    grounding: "commercial_follow_up",
    motionHint: "commercial_follow_up",
    dueDate,
    missionId: extra.missionId ?? sourceId,
    ...extra,
  });
}

function campaign(sourceId: string, title: string, enabled = true, extra: Partial<WeeklyGrowthRawRecord> = {}) {
  return rec({
    origin: "campaign_template",
    sourceId,
    campaignId: sourceId,
    title,
    objective: title,
    status: enabled ? "enabled" : "disabled",
    motionHint: "account_acquisition",
    confidence: "low",
    operatorUserId: null,
    actorId: null,
    ...extra,
  });
}

function recovery(sourceId: string, extra: Partial<WeeklyGrowthRawRecord>) {
  return rec({
    origin: "churn_snapshot",
    sourceId,
    title: sourceId,
    objective: sourceId,
    status: "scored",
    customerKey: sourceId,
    existingScore: 80,
    historyOrderCount: 4,
    daysSinceLastOrder: 40,
    activeOrderCount: 0,
    estimatedMonthlyImpactCents: 1000,
    averageOrderValueCents: 4500,
    churnGrade: "high",
    recommendedAction: "contact_now",
    confidence: "high",
    operatorUserId: null,
    actorId: null,
    ...extra,
  });
}

describe("weekly growth candidates", () => {
  it("turns growth-tagged unfinished work into a candidate and drops completed growth", async () => {
    const feed = await load(bundle({
      unfinished: available([growth("g-open", "Finish the Louise introduction"), growth("g-done", "Finished hunt", "completed")]),
    }));
    expect(feed.candidates.map(item => item.id)).toEqual([`wgc:${TENANT}:day_director_commitment:g-open`]);
    expect(feed.candidates[0]?.alreadyInFlight).toBe(true);
    expect(feed.candidates[0]?.rankReasons).toContain("CONTINUE_EXISTING_WORK");
  });

  it("excludes pickups, drop-offs, route stops, plant work, and ordinary ops", async () => {
    const feed = await load(bundle({
      unfinished: available([
        growth("pickup", "Tuesday pickup"),
        growth("dropoff", "Drop-off at the dock"),
        growth("route", "Route stop 4"),
        growth("plant", "Plant work at the laundry plant"),
        rec({ origin: "ops_task", sourceId: "ops-1", opsTaskId: "ops-1", title: "Fold the rush", status: "open", operationalClass: "admin", grounding: null }),
        rec({ origin: "day_director_commitment", sourceId: "ops-kind", title: "Housekeeping round", status: "open", grounding: "growth_tagged", operationalClass: "housekeeping" }),
      ]),
    }));
    expect(feed.candidates).toEqual([]);
  });

  it("excludes ambiguous work that is not already grounded as growth", async () => {
    const feed = await load(bundle({
      unfinished: available([
        rec({ origin: "day_director_commitment", sourceId: "maybe", commitmentId: "maybe", title: "Check the thing", objective: "Check the thing", status: "open", grounding: null }),
      ]),
    }));
    expect(feed.candidates).toEqual([]);
  });

  it("keeps an open commercial follow-up and drops completed and cancelled ones", async () => {
    const feed = await load(bundle({
      commercialFollowUps: available([
        followUp("fu-open", "Call Louise about the towel account", "open", "2026-09-21"),
        followUp("fu-done", "Call Louise about the towel account", "completed", "2026-09-21"),
        followUp("fu-cancel", "Call Louise about the towel account", "cancelled", "2026-09-21"),
      ]),
    }));
    expect(feed.candidates).toHaveLength(1);
    expect(feed.candidates[0]?.sourceRefs.map(ref => ref.sourceId)).toEqual(["fu-open"]);
    expect(feed.candidates[0]?.rankReasons).toContain("FOLLOW_UP_DUE");
  });

  it("drops finished, superseded, data-health, and fixture obligations", async () => {
    const feed = await load(bundle({
      proactiveObligations: available([
        rec({ origin: "proactive_obligation", sourceId: "sales:done", obligationId: "sales:done", obligationKind: "sales_follow_up", title: "Done", objective: "Done", status: "completed", grounding: "sales" }),
        rec({ origin: "proactive_obligation", sourceId: "sales:stop", obligationId: "sales:stop", obligationKind: "sales_follow_up", title: "Stopped", objective: "Stopped", status: "cancelled", grounding: "sales" }),
        rec({ origin: "proactive_obligation", sourceId: "sales:old", obligationId: "sales:old", obligationKind: "sales_follow_up", title: "Superseded", objective: "Superseded", status: "superseded", grounding: "sales" }),
        rec({ origin: "proactive_obligation", sourceId: "data:fresh", obligationId: "data:fresh", obligationKind: "data_health", title: "Import Gumball", objective: "Import Gumball", status: "scheduled" }),
        rec({ origin: "proactive_obligation", sourceId: "fixture:demo", obligationId: "fixture:demo", obligationKind: "sales_follow_up", title: "Fixture", objective: "Fixture", status: "scheduled", fixture: true, grounding: "sales" }),
        rec({ origin: "proactive_obligation", sourceId: "sales:live", obligationId: "sales:live", obligationKind: "sales_follow_up", title: "Live follow-up", objective: "Live follow-up", status: "awaiting_result", grounding: "sales", motionHint: "commercial_follow_up", dueDate: TODAY, alreadyInFlight: true }),
      ]),
    }));
    expect(feed.candidates.map(item => item.title)).toEqual(["Live follow-up"]);
  });

  it("reads obligations without creating any and never references the board sweep", async () => {
    const obligations = [
      rec({
        origin: "proactive_obligation",
        sourceId: "sales:9:2026-09-21",
        obligationId: "sales:9:2026-09-21",
        obligationKind: "sales_follow_up",
        title: "Follow up: Louise",
        objective: "She asked for pricing",
        status: "scheduled",
        dueDate: "2026-09-21",
        motionHint: "commercial_follow_up",
        grounding: "sales",
      }),
    ];
    const before = obligations.length;
    const feed = await load(bundle({ proactiveObligations: available(obligations) }));
    expect(obligations).toHaveLength(before);
    expect(feed.candidates).toHaveLength(1);
    expect(feed.candidates[0]?.rankReasons).toContain("PROACTIVE_OBLIGATION_ACTIVE");
    const source = productionSource();
    expect(source).not.toContain("ensureAdamBoard");
    expect(source).not.toMatch(/import[^;]*ensureAdamBoard/);
  });

  it("emits only customers the existing recovery lever would deal", async () => {
    const eligible = recovery("cust-ok", {});
    const below = recovery("cust-low", { existingScore: 39, churnGrade: "low", recommendedAction: "watch" });
    const active = recovery("cust-active", { activeOrderCount: 1 });
    const thin = recovery("cust-thin", { historyOrderCount: 1 });
    expect(isDealable(lever(eligible))).toBe(true);
    expect(isDealable(lever(below))).toBe(false);
    expect(isDealable(lever(active))).toBe(false);
    expect(isDealable(lever(thin))).toBe(false);
    const feed = await load(bundle({ recovery: available([eligible, below, active, thin]) }));
    expect(feed.candidates.map(item => item.title)).toEqual(["cust-ok"]);
    expect(feed.sources.customer_recovery).toMatchObject({ status: "available", observedCount: 4, eligibleCount: 1, shownCount: 1 });
    const assembleSource = readFileSync(path.join(dir(), "assemble.ts"), "utf8");
    expect(assembleSource).toContain("hustlerLeverSelection");
    expect(assembleSource).not.toContain("scoreCustomerChurn");
    expect(assembleSource).not.toContain("score >=");
  });

  it("caps recovery at three using the warm lever order", async () => {
    const rows = [
      recovery("a", { historyOrderCount: 10, daysSinceLastOrder: 30, existingScore: 50 }),
      recovery("b", { historyOrderCount: 10, daysSinceLastOrder: 10, existingScore: 90 }),
      recovery("c", { historyOrderCount: 4, daysSinceLastOrder: 100, existingScore: 80 }),
      recovery("e", { historyOrderCount: 3, daysSinceLastOrder: 20, existingScore: 70 }),
      recovery("d", { historyOrderCount: 2, daysSinceLastOrder: 5, existingScore: 40, churnGrade: "medium", recommendedAction: "prepare_win_back" }),
    ];
    const feed = await load(bundle({ recovery: available(rows) }));
    expect(feed.candidates.map(item => item.title)).toEqual(["a", "b", "c"]);
    expect(feed.sources.customer_recovery).toMatchObject({ eligibleCount: 5, rankedCount: 5, shownCount: 3 });
    expect(feed.candidates[0]?.observedSignals.map(signal => signal.label)).toEqual(
      expect.arrayContaining(["churn_score", "history_order_count", "days_since_last_paid_order", "warm_lever_rank", "big_swing_lever_rank"])
    );
    expect(JSON.stringify(feed.candidates)).not.toMatch(/estimatedMonthly|conversion|projected|likelyCustomers|"roi"/i);
  });

  it("includes an enabled campaign, drops a disabled one, and keeps the template out of flight", async () => {
    const assumption = {
      text: "Weekday late-afternoon distribution sees more hangers stay up.",
      source: "Adam's own field notes, informal",
      recordedAt: "2026-09-11",
      confidence: null,
      evidenceClass: null,
    };
    const feed = await load(bundle({
      campaigns: available([
        campaign("greystar-koreatown-colosseum", "Greystar Hunt", true, {
          assumptions: [assumption],
          prepLeadDays: 2,
          prepCondition: "Packets are printed",
          pocketKind: "between_stops",
          minimumMinutes: 30,
          motionHint: "account_acquisition",
        }),
        campaign("old-hunt", "Disabled Hunt", false),
      ]),
    }));
    expect(feed.candidates).toHaveLength(1);
    const candidate = feed.candidates[0]!;
    expect(candidate.alreadyInFlight).toBe(false);
    expect(candidate.sourceKind).toBe("campaign_library");
    expect(candidate.rankReasons).toContain("CAMPAIGN_ENABLED");
    expect(candidate.assumptions).toEqual([assumption]);
    expect(candidate.observedSignals).toEqual([]);
    expect(JSON.stringify(candidate.observedSignals)).not.toContain("hangers stay up");
    expect(candidate.confidence).toBe("low");
    expect(candidate.rankReasons).toContain("LOW_CONFIDENCE_ASSUMPTION");
  });

  it("caps campaigns at 8, follow-ups at 5, and the feed at 15", async () => {
    const campaigns = Array.from({ length: 10 }, (_, index) => campaign(`c-${String(index).padStart(2, "0")}`, `Template ${index}`));
    const followUps = [
      followUp("fu-o1", "Overdue one", "open", "2026-09-18"),
      followUp("fu-o2", "Overdue two", "open", "2026-09-19"),
      followUp("fu-o3", "Overdue three", "open", "2026-09-20"),
      followUp("fu-d1", "Due one", "open", "2026-09-21"),
      followUp("fu-d2", "Due two", "open", "2026-09-22"),
      followUp("fu-d3", "Due three", "open", "2026-09-23"),
      followUp("fu-f1", "Later one", "open", "2026-10-01"),
      followUp("fu-f2", "Later two", "open", "2026-10-02"),
    ];
    const unfinished = Array.from({ length: 20 }, (_, index) => growth(`g-${String(index).padStart(2, "0")}`, `Growth ${index}`));
    const campaignFeed = await load(bundle({ campaigns: available(campaigns) }));
    expect(campaignFeed.candidates).toHaveLength(8);
    expect(campaignFeed.sources.campaign_library).toMatchObject({ observedCount: 10, eligibleCount: 10, rankedCount: 10, shownCount: 8 });
    const followFeed = await load(bundle({ commercialFollowUps: available(followUps) }));
    expect(followFeed.candidates.map(item => item.sourceRefs[0]?.sourceId)).toEqual(["fu-o1", "fu-o2", "fu-o3", "fu-d1", "fu-d2"]);
    expect(followFeed.sources.commercial_follow_up).toMatchObject({ eligibleCount: 8, rankedCount: 8, shownCount: 5 });
    const totalFeed = await load(bundle({ unfinished: available(unfinished) }));
    expect(totalFeed.candidates).toHaveLength(15);
    expect(totalFeed.sources.unfinished_growth_work).toMatchObject({ eligibleCount: 20, rankedCount: 20, shownCount: 15 });
  });

  it("lets a macro goal change relevance and never mint a candidate", async () => {
    const onlyGoal = await load(bundle({
      macroGoal: available([{ id: "goal-1", metricKey: "active_customers", objective: "500 active customers" }]),
    }));
    expect(onlyGoal.candidates).toEqual([]);
    expect(onlyGoal.sources.macro_goal).toMatchObject({ status: "available", observedCount: 1, shownCount: 0 });
    const ranked = await load(bundle({
      macroGoal: available([{ id: "goal-1", metricKey: "new_paying_customers", objective: "Win accounts" }]),
      campaigns: available([
        campaign("reputation", "Ask for reviews", true, { motionHint: "reputation" }),
        campaign("acquire", "Pitch the leasing office", true, { motionHint: "account_acquisition" }),
      ]),
    }));
    expect(ranked.candidates.map(item => item.title)).toEqual(["Pitch the leasing office", "Ask for reviews"]);
    expect(ranked.candidates[0]?.rankReasons).toContain("MACRO_GOAL_ALIGNED");
    expect(ranked.candidates[1]?.rankReasons).not.toContain("MACRO_GOAL_ALIGNED");
  });

  it("flags prep that cannot fit the horizon and still emits the candidate", async () => {
    const feed = await load(bundle({
      campaigns: available([
        campaign("needs-print", "Door hangers", true, { prepLeadDays: 14, prepCondition: "Hangers must already be printed" }),
      ]),
    }));
    expect(feed.candidates).toHaveLength(1);
    expect(feed.candidates[0]?.prep.feasibleWithinHorizon).toBe(false);
    expect(feed.candidates[0]?.rankReasons).toEqual(expect.arrayContaining(["PREP_REQUIRED", "INSUFFICIENT_PREP"]));
    expect(JSON.stringify(feed)).not.toContain("recommendedBusinessDate");
    expect(JSON.stringify(feed)).not.toContain("businessDate");
  });

  it("drops strategy snapshot fixtures and sequencer placeholders", async () => {
    const feed = await load(bundle({
      unfinished: available([
        rec({
          origin: "strategy_snapshot",
          sourceId: "comm_1",
          title: "Deliver sample kit to Wilshire Grand front desk",
          objective: "Downtown Corridor Commercial Expansion",
          status: "open",
          grounding: "growth_tagged",
          fixture: true,
        }),
        rec({
          origin: "mission_sequencer",
          sourceId: "mis_placeholder",
          title: "Property Expansion Outing: Downtown Core (3 properties)",
          objective: "On-site Manager",
          status: "open",
          grounding: "growth_tagged",
        }),
        growth("real", "Louise towel follow-up"),
      ]),
    }));
    expect(feed.candidates.map(item => item.title)).toEqual(["Louise towel follow-up"]);
    const body = JSON.stringify(feed);
    expect(body).not.toContain("Wilshire Grand");
    expect(body).not.toContain("Downtown Core");
    expect(body).not.toContain("On-site Manager");
    expect(body).not.toContain("Century Plaza");
  });

  it("dedupes one follow-up across systems and keeps similar titles apart", async () => {
    const feed = await load(bundle({
      unfinished: available([
        rec({
          origin: "day_director_commitment",
          sourceId: "commit-louise",
          commitmentId: "commit-louise",
          title: "Follow up: Louise",
          objective: "Follow up: Louise",
          status: "open",
          grounding: "sales",
          obligationId: "sales:9:2026-09-20",
          alreadyInFlight: true,
          dueDate: "2026-09-21",
        }),
      ]),
      commercialFollowUps: available([
        followUp("fu-louise", "Call Louise about the towel account", "open", "2026-09-20", {
          missionId: "9",
          aliasKeys: ["obligation:sales:9:2026-09-20"],
        }),
        followUp("fu-louise-other", "Call Louise about the towel account", "open", "2026-09-20", { missionId: "10" }),
      ]),
      proactiveObligations: available([
        rec({
          origin: "proactive_obligation",
          sourceId: "sales:9:2026-09-20",
          obligationId: "sales:9:2026-09-20",
          obligationKind: "sales_follow_up",
          title: "Follow up: Louise",
          objective: "Pricing follow-up",
          status: "scheduled",
          grounding: "sales",
          motionHint: "commercial_follow_up",
          dueDate: "2026-09-20",
          missionId: "9",
        }),
      ]),
    }));
    const louise = feed.candidates.find(item => item.id === `wgc:${TENANT}:followup:fu-louise`);
    const other = feed.candidates.find(item => item.sourceRefs.some(ref => ref.sourceId === "fu-louise-other"));
    expect(louise?.sourceRefs.map(ref => ref.sourceId).sort()).toEqual(["commit-louise", "fu-louise", "sales:9:2026-09-20"]);
    expect(louise?.alreadyInFlight).toBe(true);
    expect(louise?.sourceKind).toBe("unfinished_growth_work");
    expect(louise?.provenance).toMatchObject({
      reader: "dayDirectorCommitments",
      sourceType: "day_director_commitment",
      sourceIds: ["commit-louise", "fu-louise", "sales:9:2026-09-20"],
    });
    expect(other).toBeTruthy();
    expect(feed.candidates.filter(item => item.title === "Call Louise about the towel account" || item.title === "Follow up: Louise").length).toBeGreaterThan(1);
  });

  it("ranks unfinished growth ahead of a merely enabled template", async () => {
    const feed = await load(bundle({
      unfinished: available([growth("louise", "Louise follow-up")]),
      campaigns: available([campaign("greystar-koreatown-colosseum", "Greystar Hunt")]),
    }));
    expect(feed.candidates.map(item => item.sourceKind)).toEqual(["unfinished_growth_work", "campaign_library"]);
    expect(feed.candidates[1]?.alreadyInFlight).toBe(false);
  });

  it("does not treat an unavailable source as an observed empty result", async () => {
    const feed = await load(bundle({
      recovery: { status: "unavailable", reason: "scan_failed" },
    }));
    expect(feed.sources.customer_recovery).toEqual({ status: "unavailable", reason: "scan_failed" });
    expect(feed.sources.customer_recovery).not.toHaveProperty("observedCount");
    expect(JSON.stringify(feed)).not.toContain("0 dormant");
    expect(feed.candidates).toEqual([]);
  });

  it("is deterministic, and the fingerprint ignores generatedAt and key order", async () => {
    const sources = bundle({
      unfinished: available([growth("b", "Second"), growth("a", "First")]),
      campaigns: available([campaign("z-template", "Template")]),
    });
    const first = await load(sources, "2026-09-21T18:00:00.000Z");
    const second = await load(sources, "2026-09-22T01:00:00.000Z");
    expect(first.candidates.map(item => item.id)).toEqual(second.candidates.map(item => item.id));
    expect(first.fingerprint).toEqual(second.fingerprint);
    expect(first.generatedAt).not.toEqual(second.generatedAt);
    expect(first.candidates[0]?.provenance.observedAt).not.toEqual(second.candidates[0]?.provenance.observedAt);
    const hashed = createHash("sha256").update(canonicalWeeklyGrowthFeed(first)).digest("hex");
    expect(hashed).toEqual(first.fingerprint);
    const reversed = canonicalWeeklyGrowthFeed(reverseKeys(first) as typeof first);
    expect(reversed).toEqual(canonicalWeeklyGrowthFeed(first));
  });

  it("isolates tenants and operators, including a shared template title", async () => {
    const sources = bundle({
      unfinished: available([
        growth("mine", "My Louise follow-up"),
        rec({ origin: "day_director_commitment", sourceId: "other-actor", commitmentId: "other-actor", title: "Other actor growth", status: "open", grounding: "growth_tagged", actorId: "actor-b", alreadyInFlight: true }),
      ]),
      commercialFollowUps: available([
        followUp("fu-mine", "My open follow-up", "open", "2026-09-21"),
        followUp("fu-other-operator", "Their follow-up", "open", "2026-09-21", { operatorUserId: "operator-b" }),
        followUp("fu-other-tenant", "Other tenant follow-up", "open", "2026-09-21", { tenantId: OTHER }),
      ]),
      campaigns: available([
        campaign("greystar-koreatown-colosseum", "Greystar Hunt"),
        campaign("greystar-koreatown-colosseum", "Greystar Hunt", true, { tenantId: OTHER }),
      ]),
    });
    const mine = await load(sources);
    expect(mine.candidates.map(item => item.title).sort()).toEqual(["Greystar Hunt", "My Louise follow-up", "My open follow-up"]);
    expect(JSON.stringify(mine)).not.toContain("Other tenant");
    expect(JSON.stringify(mine)).not.toContain("Their follow-up");
    expect(JSON.stringify(mine)).not.toContain("Other actor");
    const otherTenant = await loadWeeklyGrowthCandidates(
      {
        tenantId: OTHER,
        operatorUserId: "operator-b",
        dayDirectorActorId: "actor-b",
        remainingDates: DATES,
        now: new Date("2026-09-21T18:00:00.000Z"),
        timeZone: "America/Los_Angeles",
      },
      { readSources: async () => sources, today: () => TODAY }
    );
    expect(otherTenant.candidates.map(item => item.title)).toEqual(["Greystar Hunt"]);
    expect(otherTenant.candidates[0]?.alreadyInFlight).toBe(false);
    expect(JSON.stringify(otherTenant)).not.toContain("My Louise");
    expect(JSON.stringify(otherTenant)).not.toContain("fu-mine");
  });

  it("returns a clean empty feed with no primary and no business date", async () => {
    const feed = await load(bundle());
    expect(feed.candidates).toEqual([]);
    expect(feed.caps).toEqual({ total: 15, followUp: 5, recovery: 3, campaign: 8 });
    for (const key of ["unfinished_growth_work", "commercial_follow_up", "proactive_obligation", "customer_recovery", "campaign_library"] as const) {
      expect(feed.sources[key]).toEqual({ status: "available", observedCount: 0, eligibleCount: 0, rankedCount: 0, shownCount: 0 });
    }
    const body = JSON.stringify(feed);
    expect(body).not.toContain("businessDate");
    expect(body).not.toContain("\"primary\"");
    expect(body).not.toContain("recommendedBusinessDate");
    expect(feed.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exposes a public port that does not require source internals", async () => {
    const inputKeys = Object.keys({
      tenantId: TENANT,
      operatorUserId: OPERATOR,
      dayDirectorActorId: ACTOR,
      remainingDates: DATES,
      now: new Date("2026-09-21T18:00:00.000Z"),
      timeZone: "America/Los_Angeles",
    }).sort();
    expect(inputKeys).toEqual(["dayDirectorActorId", "now", "operatorUserId", "remainingDates", "tenantId", "timeZone"]);
    const shared = readFileSync(path.resolve(dir(), "../../shared/weeklyGrowthCandidates.ts"), "utf8");
    expect(shared).not.toContain("loadObligations");
    expect(shared).not.toContain("hustlerLever");
    expect(shared).not.toContain("campaignLibrary");
    const feed = await load(bundle({ unfinished: available([growth("only", "Only growth")]) }));
    expect(feed.candidates[0]?.sourceKind).toBe("unfinished_growth_work");
  });

  it("does not call writer, planner, recurrence, or mutation paths", () => {
    const source = productionSource();
    const banned = [
      "ensureAdamBoard(",
      "planForDate(",
      "projectRecurrenceForDate(",
      "sequenceDailyMissions(",
      "createCustomerRecoveryIntervention(",
      "runCustomerChurnScan(",
      "reserveSpend(",
      "upsertCampaign(",
      "setCampaignEnabled(",
      "patchCampaign(",
      "seedCampaignsIfMissing(",
      "proposeCommitment(",
      "startCampaignRun(",
      "commitWeeklyPlan(",
      "WeeklyIntent",
    ];
    for (const token of banned) expect(source).not.toContain(token);
    expect(source).not.toMatch(/from ["'][^"']*snapshotBuilder["']/);
    expect(source).not.toMatch(/from ["'][^"']*missionSequencer["']/);
  });
});

function lever(record: WeeklyGrowthRawRecord) {
  return {
    id: record.sourceId,
    score: record.existingScore ?? 0,
    activeOrderCount: record.activeOrderCount ?? 0,
    historyOrderCount: record.historyOrderCount ?? 0,
    daysSinceLastOrder: record.daysSinceLastOrder,
    estimatedMonthlyImpactCents: record.estimatedMonthlyImpactCents,
  };
}

function dir() {
  return path.dirname(fileURLToPath(import.meta.url));
}

function productionSource(): string {
  return readdirSync(dir())
    .filter(file => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map(file => readFileSync(path.join(dir(), file), "utf8"))
    .join("\n");
}

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const reversed: Record<string, unknown> = {};
    for (const key of Object.keys(record).reverse()) reversed[key] = reverseKeys(record[key]);
    return reversed;
  }
  return value;
}
