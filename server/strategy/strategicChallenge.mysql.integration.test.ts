import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_DOCTRINE } from "../../shared/claireProactive";
import { createIsolatedGoalCycleDb } from "../agents/persistentOperator/goalCycleIsolatedDb.testSupport";
import { createGoalLoopHarness, DAY, startLosAngelesMorning, ZONE } from "../agents/persistentOperator/goalLoopHarness.testSupport";
import { saveOperatorDoctrine } from "../agents/persistentOperator/operatorDoctrineStore";
import { persistentOperatorRouter } from "../agents/persistentOperator/persistentOperatorRouter";
import { prepareStrategicProposal } from "./strategicPreparation";
import { SILVER_LAKE_LEDGER, type WorkThreadTenant } from "./workThreadTenant.testSupport";

/**
 * Real-MySQL proof for Phase 2 · Slice E: when the operator states a method
 * and recorded evidence favors another approach for the same goal, the
 * Strategic Diagnosis carries a challenge built from real artifacts (the
 * lapsed-customer cohort and who is left out). It abstains, with the reason,
 * when the evidence agrees or the operator's own rules rule the alternative
 * out. Mission Director carries it without ranking it, and nothing is
 * contacted or spent. Production preparation, goal-cycle occurrences and the
 * operator router throughout; only `Date` is faked.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const FAY = { name: "Fay Ng", customerId: "c9", address: "2900 Rowena Ave Los Angeles CA 90039", daysAgo: [130, 100], total: "20.00" };
const OUTREACH = "Find new Silver Lake customers through building and door outreach";

describeMysql("evidence-backed strategic challenge on MySQL", () => {
  let sql: mysql.Connection;
  let iso: Awaited<ReturnType<typeof createIsolatedGoalCycleDb>>;
  let loop: ReturnType<typeof createGoalLoopHarness>;
  const previousKey = process.env.ANTHROPIC_API_KEY;

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = "";
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    iso = await createIsolatedGoalCycleDb(process.env.DATABASE_URL!);
    loop = createGoalLoopHarness(sql, iso);
  }, 120_000);
  beforeEach(() => startLosAngelesMorning());
  afterEach(async () => {
    await loop.retireTenants();
    vi.useRealTimers();
  });
  afterAll(async () => {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
    await sql?.end();
    await iso?.drop();
  });

  const operator = (t: WorkThreadTenant) =>
    persistentOperatorRouter.createCaller({
      tenantId: t.tenantId,
      user: { id: t.userId, openId: t.openId, role: "user", name: "Op" },
      req: undefined,
      res: undefined,
      vendorSession: null,
    } as never);
  const proposalOf = (t: WorkThreadTenant) => prepareStrategicProposal({ identity: t.identity, timeZone: t.zone });
  const strategyItem = (proposal: Awaited<ReturnType<typeof proposalOf>>) => proposal.items.find(i => i.planId.startsWith("strategic_diagnosis:"))!;
  const stateMethod = async (t: WorkThreadTenant, method: { lever: "acquisition" | "retention"; population: "new_customers" | "lapsed_customers"; statement: string }) => {
    const goalId = (await operator(t).operatingMandate())!.mandate.outcomes[0]!.id;
    return (await operator(t).decideOperatingMandate({ kind: "method", outcomeId: goalId, area: "Silver Lake", ...method }))!;
  };
  /** Rows that would mean Claire contacted someone, scheduled contact, or spent. */
  const contactAndSpend = async (tenantId: string) => {
    const count = async (table: string) => Number((await loop.rows(`SELECT COUNT(*) AS n FROM ${table} WHERE tenantId = ?`, [tenantId]))[0]!.n);
    return {
      obligations: await count("claire_proactive_obligations"),
      spend: await count("strategy_spend_ledger"),
      commitments: await count("day_director_commitments"),
    };
  };
  const doctrineRef = (t: WorkThreadTenant, key: string) => `claire_operator_doctrine:${t.tenantId}:${t.openId}:${key}`;

  it("challenges a stated method with the goal, its thread, evidence both ways and a real cohort; Mission Director carries it unranked; no one is contacted", async () => {
    const { t, store } = await loop.tenant({ prefix: "e1" });
    const before = await proposalOf(t);
    // No stated method: nothing to challenge, and no abstention either.
    expect(before.diagnosis.challenge).toBeUndefined();
    expect(before.diagnosis.challengeAbstained).toBeUndefined();
    const winBackThread = strategyItem(before).workThreadId!;
    const baseline = await contactAndSpend(t.tenantId);

    const method = await stateMethod(t, { lever: "acquisition", population: "new_customers", statement: "Find new Silver Lake customers door to door" });
    const proposal = await proposalOf(t);
    const d = proposal.diagnosis;
    // The operator's method is still the plan; the challenge sits beside it.
    expect(d.selectedApproach).toBe(OUTREACH);
    const c = d.challenge!;
    expect(c).toMatchObject({
      status: "raised",
      statedMethod: { id: `operating_mandate_decisions:${method.decision.id}`, lever: "acquisition", population: "new_customers", area: "silver_lake" },
      outcome: { id: method.mandate.outcomes[0]!.id, statement: "Get to 50 active customers" },
      workThreadId: strategyItem(proposal).workThreadId,
    });
    expect(c.workThreadId).not.toBe(winBackThread);
    expect(c.evidenceAgainst[0]!.ref).toMatch(/^objective_area_dormant:/);
    expect(c.evidenceAgainst[0]!.statement).toMatch(/^2 Silver Lake customers ordered before and have no order in the last 60 days; 2 can be followed up\./);
    expect(c.alternative).toMatchObject({
      approach: "Win back lapsed Silver Lake customers",
      opportunity: { lever: "retention", population: "lapsed_customers", area: "silver_lake" },
      // The open win-back thread from before the method was stated; none was opened for the challenge.
      workThreadId: winBackThread,
    });
    expect(c.alternative.cohort.members.map(m => [m.displayName, m.paidOrders, m.revenueCents])).toEqual([
      ["Bea Lund", 3, 18300],
      ["Alma Reyes", 3, 14400],
    ]);
    expect(c.alternative.cohort.exclusions).toEqual([]);
    expect(c.autonomy.requiresApproval).toContain("Contacting anyone on the list");
    expect(JSON.stringify(c)).not.toMatch(/\$|ROI|return on|will (earn|make|generate)/i);

    // The goal cycle decides under it: the challenged work is selected, the
    // challenge travels with it, and the alternative is never ranked.
    const decided = await loop.runOccurrence(t, store);
    const [decision] = await loop.rows(
      "SELECT selectedRef, missionDirectorPlanId, sourceCoverageJson FROM goal_cycle_decisions WHERE tenantId = ? AND cycleId = ?",
      [t.tenantId, decided.cycleId]
    );
    expect(decision!.selectedRef).toBe(`work_thread:${c.workThreadId}`);
    expect(loop.json(decision!.sourceCoverageJson).strategicChallenge).toEqual({ status: "raised", id: c.id });
    const [plan] = await loop.rows("SELECT outcomeJson FROM mission_director_plans WHERE id = ?", [decision!.missionDirectorPlanId]);
    const ranking = (loop.json(plan!.outcomeJson) as { workPlan: { ranking: Array<{ workId: string; factors: Array<{ name: string; value: unknown; effect: number }> }> } }).workPlan.ranking;
    const challenged = ranking.find(r => r.workId === `work_thread:${c.workThreadId}`)!;
    expect(challenged.factors.find(f => f.name === "strategic_challenge")).toMatchObject({ value: c.id, effect: 0 });
    expect(ranking.map(r => r.workId)).not.toContain(`work_thread:${winBackThread}`);

    // Preparing, challenging and deciding contacted no one, scheduled nothing and spent nothing.
    expect(await contactAndSpend(t.tenantId)).toEqual(baseline);
  }, 300_000);

  it("abstains, and says why, when the evidence agrees with the stated method", async () => {
    const { t } = await loop.tenant({ prefix: "e2" });
    await stateMethod(t, { lever: "retention", population: "lapsed_customers", statement: "Win back lapsed Silver Lake customers first" });
    const d = (await proposalOf(t)).diagnosis;
    expect(d.challenge).toBeUndefined();
    expect(d.challengeAbstained).toEqual({
      reason: "method_matches_evidence",
      detail: "The evidence also favors winning back lapsed Silver Lake customers first.",
      constraintRefs: [],
    });
    expect(d.selectedApproach).toBe("Win back lapsed Silver Lake customers");
  }, 300_000);

  it("lets the operator's confirmed constraints decide first: their rules shape the cohort, and a pause on sales rules the alternative out", async () => {
    const { t } = await loop.tenant({ prefix: "e3", ledger: [...SILVER_LAKE_LEDGER, FAY] });
    await saveOperatorDoctrine({ tenantId: t.tenantId, operatorUserId: t.openId, rules: { ...DEFAULT_DOCTRINE, minPriorOrders: 3 } });
    await stateMethod(t, { lever: "acquisition", population: "new_customers", statement: "Find new Silver Lake customers door to door" });
    const ruled = (await proposalOf(t)).diagnosis.challenge!;
    expect(ruled.alternative.cohort.members.map(m => m.displayName)).toEqual(["Bea Lund", "Alma Reyes"]);
    expect(ruled.alternative.cohort.exclusions).toEqual([
      { identityKey: expect.any(String), displayName: "Fay Ng", reason: "Fewer than 3 paid orders (your rule).", constraintRef: doctrineRef(t, "minPriorOrders") },
    ]);

    // The operator pauses sales outreach: winning customers back is not proposed at all.
    const until = formatInTimeZone(new Date(Date.now() + 10 * DAY), ZONE, "yyyy-MM-dd");
    await saveOperatorDoctrine({ tenantId: t.tenantId, operatorUserId: t.openId, rules: { ...DEFAULT_DOCTRINE, minPriorOrders: 3, skipSalesUntil: until, skipSalesReason: "inventory move" } });
    const paused = (await proposalOf(t)).diagnosis;
    expect(paused.challenge).toBeUndefined();
    expect(paused.challengeAbstained).toEqual({
      reason: "constraint_precludes_alternative",
      detail: `No sales outreach until ${until} (inventory move). Winning customers back means contacting them, so it is not proposed.`,
      constraintRefs: [doctrineRef(t, "skipSalesUntil")],
    });
    // The diagnosis's own alternative option is unavailable too, not a next step.
    expect(paused.options.find(o => o.approach === "Win back lapsed Silver Lake customers")).toMatchObject({
      eligible: false,
      reason: expect.stringMatching(/^Not available under your rules: No sales outreach until/),
      nextMeasurableAction: "None while your rule applies.",
    });
  }, 300_000);
});
