import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { OperatorMacroGoal } from "../../../drizzle/schema";
import { parseBriefingDeterministically } from "../briefing/deterministicBriefing";
import { answerClaireBusinessTurn, parseBusinessTurn } from "../businessConversation";
import { lintPostGenerationStateVerbs, VerifiedFactInventoryBuilder } from "../assertionGuard";
import { getActiveMacroGoal, type MacroGoalPersistence } from "../macroGoalService";
import { defaultClaireTurnDeps, runClaireTurn, type ClaireTurnDeps } from "../turn/claireTurn";
import {
  BUSINESS_GOAL_ENGINE_NOTE_PREFIX,
  BUSINESS_GOAL_METRIC_KEY,
  runBusinessGoalEngine,
  type BusinessGoalPlan,
} from "./businessGoalEngine";
import { parseBusinessGoal } from "./parseBusinessGoal";

const NOW = new Date("2026-10-16T17:00:00.000Z");
const TZ = "America/Los_Angeles";
const SPOKEN_NUMBER = /\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g;

function row(overrides: Partial<OperatorMacroGoal> = {}): OperatorMacroGoal {
  return {
    id: "goal-1",
    tenantId: "tenant-1",
    operatorUserId: "operator-1",
    objective: "Get to 50 active customers",
    metricKey: "active_customers",
    targetValue: "50.00",
    unit: "customers",
    urgencyText: null,
    targetDate: null,
    source: "operator_attested",
    sourceNote: "Operator attested",
    status: "active",
    supersededById: null,
    secondaryTargetsJson: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function memoryPersistence(initial: OperatorMacroGoal[] = []): MacroGoalPersistence {
  const rows = [...initial];
  return {
    async getActive(input) {
      return (
        rows.find(
          candidate =>
            candidate.tenantId === input.tenantId &&
            candidate.operatorUserId === input.operatorUserId &&
            candidate.status === "active" &&
            (!input.metricKey || candidate.metricKey === input.metricKey)
        ) ?? null
      );
    },
    async replaceActive(input) {
      for (const candidate of rows) {
        if (
          candidate.tenantId === input.tenantId &&
          candidate.operatorUserId === input.operatorUserId &&
          candidate.metricKey === input.metricKey &&
          candidate.status === "active"
        ) {
          candidate.status = "superseded";
          candidate.supersededById = input.id;
        }
      }
      const saved = row({
        id: input.id,
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        objective: input.objective,
        metricKey: input.metricKey,
        targetValue: input.targetValue.toFixed(2),
        unit: input.unit,
        urgencyText: input.urgencyText ?? null,
        targetDate: input.targetDate ?? null,
        source: input.source,
        sourceNote: input.sourceNote,
        secondaryTargetsJson: input.secondaryTargets ?? null,
        status: "active",
        supersededById: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      rows.push(saved);
      return saved;
    },
  };
}

function expectGrounded(plan: BusinessGoalPlan) {
  const numbers = plan.speak.match(SPOKEN_NUMBER) ?? [];
  for (const number of numbers) {
    expect(plan.facts.some(fact => fact.includes(number)), `ungrounded number "${number}" in: ${plan.speak}`).toBe(true);
  }
  const lint = lintPostGenerationStateVerbs(plan.speak, new VerifiedFactInventoryBuilder().build());
  expect(lint.pass, lint.violations.join("; ")).toBe(true);
}

const openOrders = async () => ({
  status: "available" as const,
  items: [
    { id: "order:12", title: "Jordan Lee, order 12", issue: "ready and unpaid", recordedCents: 18000 },
    { id: "order:18", title: "Order 18", issue: "delivered and unpaid", recordedCents: 14000 },
  ],
});

const growth = async () => ({
  status: "available" as const,
  items: [{ id: "growth-dana", title: "Win back Dana", motion: "customer_recovery" }],
});

function engine(utterance: string, persistence = memoryPersistence(), readers?: Parameters<typeof runBusinessGoalEngine>[0]["readers"]) {
  return runBusinessGoalEngine({
    tenantId: "tenant-earnings",
    operatorUserId: "operator-earnings",
    dayDirectorActorId: "actor-earnings",
    utterance,
    now: NOW,
    timeZone: TZ,
    persistence,
    readers: readers ?? { openCollections: openOrders, growthMotions: growth },
  });
}

describe("business goal parser", () => {
  it("reads the first goal as another $500 for the Monday-Sunday week", () => {
    const parsed = parseBusinessGoal("Help me earn another $500 this week.", NOW, TZ);
    expect(parsed.status).toBe("goal");
    if (parsed.status !== "goal") return;
    expect(parsed.goal).toMatchObject({
      kind: "incremental_earnings",
      amountCents: 50000,
      explicitAnother: true,
      horizon: { startYmd: "2026-10-12", endYmd: "2026-10-18", label: "this week" },
    });
  });

  it("accepts other amounts and horizons", () => {
    const month = parseBusinessGoal("I want to earn another $1,250 this month", NOW, TZ);
    const today = parseBusinessGoal("Can you help me earn an extra 40 dollars today?", NOW, TZ);
    const next = parseBusinessGoal("Help me earn another $75.50 in the next 7 days.", NOW, TZ);
    expect(month.status === "goal" && month.goal.amountCents).toBe(125000);
    expect(month.status === "goal" && month.goal.horizon).toMatchObject({ startYmd: "2026-10-01", endYmd: "2026-10-31" });
    expect(today.status === "goal" && today.goal.horizon.label).toBe("today");
    expect(next.status === "goal" && next.goal.amountCents).toBe(7550);
    expect(next.status === "goal" && next.goal.horizon).toMatchObject({ startYmd: "2026-10-16", endYmd: "2026-10-22" });
  });

  it("leaves revenue questions and past periods alone", () => {
    expect(parseBusinessGoal("How much did we earn this week?", NOW, TZ).status).toBe("not_a_goal");
    expect(parseBusinessGoal("What was revenue this week?", NOW, TZ).status).toBe("not_a_goal");
    expect(parseBusinessGoal("Help me make the deposit", NOW, TZ).status).toBe("not_a_goal");
    expect(parseBusinessGoal("Help me earn another $500 last week.", NOW, TZ).status).toBe("past_period");
    expect(parseBusinessGoal("Help me earn another $500", NOW, TZ).status).toBe("needs_period");
  });
});

describe("business goal engine", () => {
  it("stores the weekly earnings goal and drafts source-backed motions without executing them", async () => {
    const persistence = memoryPersistence([
      row({
        tenantId: "tenant-earnings",
        operatorUserId: "operator-earnings",
        metricKey: "active_customers",
        objective: "Keep the customer goal",
      }),
    ]);
    const plan = await engine("Help me earn another $500 this week.", persistence);
    expect(plan.status).toBe("planned");
    expect(plan.persisted).toBe(true);
    expect(plan.recordedOpenCents).toBe(32000);
    expect(plan.uncoveredCents).toBe(18000);
    expect(plan.executions).toEqual({ sms: false, calls: false, charges: false });
    expect(plan.speak).toContain("The active goal is another $500.00 for this week.");
    expect(plan.speak).toContain("Scored unpaid orders total $320.00.");
    expect(plan.speak).toContain("not earnings");
    expect(plan.speak).toContain("Jordan Lee, order 12, ready and unpaid, $180.00");
    expect(plan.speak).toContain("Win back Dana");
    expect(plan.speak).toContain("does not text, charge, or call");
    expect(plan.speak).not.toMatch(/\b(?:sent|charged|called|texted)\b/i);
    expectGrounded(plan);

    const stored = await getActiveMacroGoal(
      { tenantId: "tenant-earnings", operatorUserId: "operator-earnings", metricKey: BUSINESS_GOAL_METRIC_KEY },
      persistence
    );
    expect(stored).toMatchObject({
      objective: "Help me earn another $500 this week.",
      targetValue: 500,
      unit: "USD",
      targetDate: "2026-10-18",
      status: "active",
    });
    expect(stored?.sourceNote.startsWith(BUSINESS_GOAL_ENGINE_NOTE_PREFIX)).toBe(true);
    expect(stored?.sourceNote).toContain("comparison=period_increment");
    expect(stored?.sourceNote).toContain("cents=50000");
    const customers = await getActiveMacroGoal(
      { tenantId: "tenant-earnings", operatorUserId: "operator-earnings", metricKey: "active_customers" },
      persistence
    );
    expect(customers?.objective).toBe("Keep the customer goal");
  });

  it("does not treat a missing open-order read as zero", async () => {
    const plan = await engine("Help me earn another $500 this week.", memoryPersistence(), {
      openCollections: async () => ({ status: "unavailable", reason: "Database unavailable" }),
      growthMotions: async () => ({ status: "unavailable", reason: "Database unavailable" }),
    });
    expect(plan.recordedOpenCents).toBeNull();
    expect(plan.uncoveredCents).toBeNull();
    expect(plan.speak).toContain("gap stays unknown");
    expect(plan.speak).not.toContain("$0.00");
    expectGrounded(plan);
  });

  it("refuses a finished period and an amount with no period without writing a goal", async () => {
    const persistence = memoryPersistence();
    const past = await engine("Help me earn another $500 last week.", persistence);
    const open = await engine("Help me earn another $500", persistence);
    expect(past.persisted).toBe(false);
    expect(open.persisted).toBe(false);
    expect(past.speak).toContain("already ended");
    expect(open.speak).toContain("needs a period");
    expect(await getActiveMacroGoal({ tenantId: "tenant-earnings", operatorUserId: "operator-earnings" }, persistence)).toBeNull();
    expectGrounded(past);
    expectGrounded(open);
  });

  it("replaces only the active sales goal when the operator sets another amount", async () => {
    const persistence = memoryPersistence();
    await engine("Help me earn another $500 this week.", persistence);
    const second = await engine("Help me earn another $1,250 this month.", persistence);
    expect(second.persisted).toBe(true);
    const active = await getActiveMacroGoal(
      { tenantId: "tenant-earnings", operatorUserId: "operator-earnings", metricKey: BUSINESS_GOAL_METRIC_KEY },
      persistence
    );
    expect(active?.targetValue).toBe(1250);
    expect(active?.targetDate).toBe("2026-10-31");
  });

  it("does not call the reminder sender", () => {
    const source = readFileSync(resolve(__dirname, "businessGoalEngine.ts"), "utf8");
    const readers = readFileSync(resolve(__dirname, "productionReaders.ts"), "utf8");
    expect(source).not.toContain("sendPaymentReminderForOrder");
    expect(readers).not.toContain("sendPaymentReminderForOrder");
    expect(source).not.toContain("activateMacroGoalAndQueue");
  });
});

describe("Claire answers the earnings goal", () => {
  it("answers from the business turn without running a revenue query", async () => {
    const runQuery = vi.fn();
    const plan = await engine("Help me earn another $500 this week.");
    const turn = await answerClaireBusinessTurn(
      {
        tenantId: "tenant-earnings",
        operatorUserId: "operator-earnings",
        dayDirectorActorId: "actor-earnings",
        utterance: "Help me earn another $500 this week.",
        state: {},
        surface: "text",
      },
      {
        now: () => NOW,
        timeZone: () => TZ,
        plan: async () => null,
        runQuery,
        runBusinessGoal: async () => plan,
      }
    );
    expect(runQuery).not.toHaveBeenCalled();
    expect(turn.handled).toBe(true);
    if (!turn.handled) return;
    expect(turn.reader).toBe("business_goal");
    expect(turn.speak).toContain("another $500.00");
    expect(parseBusinessTurn("How much did we earn this week?", null, NOW, TZ).kind).not.toBe("business_goal");
    expect(parseBusinessTurn("Help me earn another $500 this week.", null, NOW, TZ).kind).toBe("business_goal");
  });

  it("answers inside a Claire turn and does not commit Day Line work", async () => {
    const commit = vi.fn();
    const commitment = vi.fn(async () => ({ kind: "not_applicable" as const }));
    const persistence = memoryPersistence();
    const defaults = defaultClaireTurnDeps();
    const deps: ClaireTurnDeps = {
      ...defaults,
      now: () => NOW,
      timeZone: () => TZ,
      brainV3: null,
      extractModel: null,
      encyclopedia: null,
      commitment: commitment as never,
      commit: commit as never,
      business: {
        now: () => NOW,
        timeZone: () => TZ,
        plan: async () => null,
        runQuery: vi.fn() as never,
        runBusinessGoal: input =>
          runBusinessGoalEngine({
            ...input,
            persistence,
            readers: { openCollections: openOrders, growthMotions: growth },
          }),
      },
    };
    const result = await runClaireTurn(
      {
        tenantId: "tenant-earnings",
        operatorUserId: "operator-earnings",
        dayDirectorActorId: "actor-earnings",
        surface: "text",
        utterance: "Help me earn another $500 this week.",
        state: {},
        conversationKey: "claire-text:earnings",
        context: {
          businessDate: "2026-10-16",
          actorId: "actor-earnings",
          macroGoalKnown: false,
          blockers: [],
          relevantTimeline: [],
        } as never,
      },
      deps
    );
    expect(result.speak).toContain("The active goal is another $500.00 for this week.");
    expect(result.speak).toContain("does not text, charge, or call");
    expect(result.kind).toBe("answered");
    expect(commit).not.toHaveBeenCalled();
    expect(commitment).not.toHaveBeenCalled();
    const stored = await getActiveMacroGoal(
      { tenantId: "tenant-earnings", operatorUserId: "operator-earnings", metricKey: BUSINESS_GOAL_METRIC_KEY },
      persistence
    );
    expect(stored?.targetValue).toBe(500);
    const briefing = parseBriefingDeterministically("Help me earn another $500 this week.", {
      now: NOW,
      today: "2026-10-16",
      minutesNow: 600,
      timeZone: TZ,
    });
    expect(briefing.items).toEqual([]);
  });
});
