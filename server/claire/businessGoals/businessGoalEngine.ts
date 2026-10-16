import {
  setActiveMacroGoal,
  type MacroGoalPersistence,
} from "../macroGoalService";
import { lintPostGenerationStateVerbs, VerifiedFactInventoryBuilder } from "../assertionGuard";
import {
  parseBusinessGoal,
  type IncrementalEarningsGoal,
} from "./parseBusinessGoal";
import {
  readBusinessGoalGrowthMotions,
  readBusinessGoalOpenCollections,
  type GrowthMotionItem,
  type GrowthMotionRead,
  type OpenCollectionItem,
  type OpenCollectionRead,
} from "./productionReaders";

export type { GrowthMotionItem, OpenCollectionItem };

/**
 * Stable note written onto the existing operator macro goal.
 * `net_sales_per_period` is the registered sales metric. The note says the
 * target is an amount to earn inside the horizon, not the trailing-30 level
 * that metric's reader measures. Financial results must read this note
 * before treating targetValue as a level.
 */
export const BUSINESS_GOAL_ENGINE_NOTE_PREFIX = "business_goal_engine:v1";

export const BUSINESS_GOAL_METRIC_KEY = "net_sales_per_period";

export type BusinessGoalReaders = {
  openCollections?: (input: { tenantId: string; now: Date }) => Promise<OpenCollectionRead>;
  growthMotions?: (input: {
    tenantId: string;
    operatorUserId: string;
    dayDirectorActorId: string;
    now: Date;
    timeZone: string;
    horizonStart: string;
    horizonEnd: string;
  }) => Promise<GrowthMotionRead>;
};

export type BusinessGoalEngineInput = {
  tenantId: string;
  operatorUserId?: string | null;
  dayDirectorActorId?: string | null;
  utterance: string;
  now: Date;
  timeZone: string;
  persistence?: MacroGoalPersistence;
  readers?: BusinessGoalReaders;
};

export type BusinessGoalPlan = {
  status: "planned" | "needs_period" | "past_period" | "not_a_goal";
  persisted: boolean;
  goalId: string | null;
  goal: IncrementalEarningsGoal | null;
  openCollections: OpenCollectionRead | null;
  growthMotions: GrowthMotionRead | null;
  /** Sum of recorded positive open-order cents. Null when that read was unavailable. */
  recordedOpenCents: number | null;
  /** Target minus recorded open cents. Null when the open-order read was unavailable. */
  uncoveredCents: number | null;
  speak: string;
  facts: string[];
  executions: { sms: false; calls: false; charges: false };
};

const NO_EXECUTION = { sms: false, calls: false, charges: false } as const;

export function formatGoalDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${sign}$${dollars.toLocaleString("en-US")}.${String(remainder).padStart(2, "0")}`;
}

function amountPhrase(cents: number, explicitAnother: boolean): string {
  const money = formatGoalDollars(cents);
  return explicitAnother ? `another ${money}` : money;
}

function sourceNote(goal: IncrementalEarningsGoal): string {
  return [
    BUSINESS_GOAL_ENGINE_NOTE_PREFIX,
    "kind=incremental_earnings",
    "comparison=period_increment",
    `cents=${goal.amountCents}`,
    `horizon=${goal.horizon.startYmd}..${goal.horizon.endYmd}`,
    goal.explicitAnother ? "marker=another" : "marker=period",
  ].join(" ");
}

type SpeechDraft = { sentences: string[]; facts: string[] };

function pushMoney(draft: SpeechDraft, cents: number): string {
  const money = formatGoalDollars(cents);
  draft.facts.push(money);
  return money;
}

function pushCount(draft: SpeechDraft, value: number): string {
  const text = String(value);
  draft.facts.push(text);
  return text;
}

function speakMotions(
  draft: SpeechDraft,
  collections: OpenCollectionRead,
  growth: GrowthMotionRead
): void {
  const lines: string[] = [];
  if (collections.status === "available") {
    const shown = collections.items.slice(0, 3);
    for (const item of shown) {
      const money = item.recordedCents != null ? `, ${pushMoney(draft, item.recordedCents)}` : "";
      const id = /\border\s+(\d+)\b/i.exec(item.title);
      if (id) pushCount(draft, Number(id[1]));
      lines.push(`${item.title}, ${item.issue}${money}`);
    }
    const hidden = collections.items.length - shown.length;
    if (hidden > 0) lines.push(`${pushCount(draft, hidden)} more scored orders`);
  }
  if (growth.status === "available") {
    const shown = growth.items.slice(0, 3);
    for (const item of shown) lines.push(item.title);
    const hidden = growth.items.length - shown.length;
    if (hidden > 0) lines.push(`${pushCount(draft, hidden)} more growth motions`);
  }
  if (lines.length) {
    draft.sentences.push(`Draft motions: ${lines.join(". ")}.`);
  }
}

export function speakBusinessGoal(input: {
  status: BusinessGoalPlan["status"];
  persisted: boolean;
  goal: IncrementalEarningsGoal | null;
  amountCents?: number;
  explicitAnother?: boolean;
  periodLabel?: string;
  openCollections: OpenCollectionRead | null;
  growthMotions: GrowthMotionRead | null;
  recordedOpenCents: number | null;
}): { speak: string; facts: string[] } {
  const draft: SpeechDraft = { sentences: [], facts: [] };
  if (input.status === "not_a_goal") {
    return { speak: "", facts: [] };
  }
  if (input.status === "needs_period" && input.amountCents != null) {
    const money = amountPhrase(input.amountCents, Boolean(input.explicitAnother));
    draft.facts.push(formatGoalDollars(input.amountCents));
    draft.sentences.push(
      `${money[0]!.toUpperCase()}${money.slice(1)} needs a period before it can be stored. This week, this month, or today.`
    );
    draft.sentences.push("This plan does not text, charge, or call anyone.");
    return finishSpeech(draft);
  }
  if (input.status === "past_period" && input.amountCents != null) {
    const money = amountPhrase(input.amountCents, Boolean(input.explicitAnother));
    draft.facts.push(formatGoalDollars(input.amountCents));
    const label = input.periodLabel ?? "That period";
    draft.sentences.push(
      `${label[0]!.toUpperCase()}${label.slice(1)} already ended, so ${money} is not stored as a goal.`
    );
    draft.sentences.push("This plan does not text, charge, or call anyone.");
    return finishSpeech(draft);
  }
  const goal = input.goal;
  if (!goal) return { speak: "", facts: [] };
  const phrase = amountPhrase(goal.amountCents, goal.explicitAnother);
  draft.facts.push(formatGoalDollars(goal.amountCents));
  for (const match of goal.horizon.label.match(/\d{1,3}(?:,\d{3})*(?:\.\d+)?/g) ?? []) {
    draft.facts.push(match);
  }
  if (input.persisted) {
    draft.sentences.push(`The active goal is ${phrase} for ${goal.horizon.label}.`);
  } else {
    draft.sentences.push(`The goal is not stored. ${phrase[0]!.toUpperCase()}${phrase.slice(1)} for ${goal.horizon.label} stays a draft.`);
  }
  if (input.openCollections?.status === "unavailable") {
    draft.sentences.push("Scored unpaid orders are unavailable, so the gap stays unknown.");
  } else if (input.recordedOpenCents != null) {
    const recorded = pushMoney(draft, input.recordedOpenCents);
    draft.sentences.push(`Scored unpaid orders total ${recorded}. That is recorded open amount, not earnings.`);
    if (input.recordedOpenCents >= goal.amountCents) {
      draft.sentences.push(
        `Recorded open amount is at least the ${pushMoney(draft, goal.amountCents)} target. It is still unpaid on the books.`
      );
    } else {
      const uncovered = goal.amountCents - input.recordedOpenCents;
      draft.sentences.push(
        `${pushMoney(draft, uncovered)} of the target has no recorded dollar figure on those orders.`
      );
    }
  }
  if (input.growthMotions?.status === "unavailable") {
    draft.sentences.push("Growth motions are unavailable, so none are listed.");
  } else if (input.growthMotions?.status === "available" && input.growthMotions.items.length === 0 && input.openCollections?.status === "available") {
    draft.sentences.push("No growth motions are on the books.");
  }
  if (input.openCollections && input.growthMotions) {
    speakMotions(draft, input.openCollections, input.growthMotions);
  }
  draft.sentences.push("This plan does not text, charge, or call anyone.");
  const spoken = finishSpeech(draft);
  const sources = [
    ...(input.openCollections?.status === "available"
      ? input.openCollections.items.flatMap(item => [item.title, item.issue, item.id])
      : []),
    ...(input.growthMotions?.status === "available"
      ? input.growthMotions.items.flatMap(item => [item.title, item.id])
      : []),
  ].join(" ");
  return { speak: spoken.speak, facts: attributeSourceNumbers(spoken.speak, spoken.facts, sources) };
}

function attributeSourceNumbers(speak: string, facts: string[], sources: string): string[] {
  const known = new Set(facts);
  const next = [...facts];
  for (const match of speak.match(/\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g) ?? []) {
    if (known.has(match)) continue;
    const bare = match.replace(/[$,]/g, "");
    if (sources.includes(match) || sources.includes(bare)) {
      next.push(match);
      known.add(match);
    }
  }
  return next;
}

function finishSpeech(draft: SpeechDraft): { speak: string; facts: string[] } {
  const speak = draft.sentences.join(" ");
  const lint = lintPostGenerationStateVerbs(speak, new VerifiedFactInventoryBuilder().build());
  if (!lint.pass) {
    return {
      speak: "The earnings goal is recognized. This plan does not text, charge, or call anyone.",
      facts: [],
    };
  }
  return { speak, facts: draft.facts };
}

function sumRecorded(items: readonly OpenCollectionItem[]): number {
  return items.reduce((total, item) => total + (item.recordedCents ?? 0), 0);
}

export async function runBusinessGoalEngine(input: BusinessGoalEngineInput): Promise<BusinessGoalPlan> {
  const parsed = parseBusinessGoal(input.utterance, input.now, input.timeZone);
  if (parsed.status === "not_a_goal") {
    return {
      status: "not_a_goal",
      persisted: false,
      goalId: null,
      goal: null,
      openCollections: null,
      growthMotions: null,
      recordedOpenCents: null,
      uncoveredCents: null,
      speak: "",
      facts: [],
      executions: NO_EXECUTION,
    };
  }
  if (parsed.status === "needs_period" || parsed.status === "past_period") {
    const spoken = speakBusinessGoal({
      status: parsed.status,
      persisted: false,
      goal: null,
      amountCents: parsed.amountCents,
      explicitAnother: parsed.explicitAnother,
      periodLabel: parsed.status === "past_period" ? parsed.periodLabel : undefined,
      openCollections: null,
      growthMotions: null,
      recordedOpenCents: null,
    });
    return {
      status: parsed.status,
      persisted: false,
      goalId: null,
      goal: null,
      openCollections: null,
      growthMotions: null,
      recordedOpenCents: null,
      uncoveredCents: null,
      speak: spoken.speak,
      facts: spoken.facts,
      executions: NO_EXECUTION,
    };
  }

  const goal = parsed.goal;
  const openCollections = await (input.readers?.openCollections ?? readBusinessGoalOpenCollections)({
    tenantId: input.tenantId,
    now: input.now,
  });
  const operatorUserId = input.operatorUserId?.trim() ?? "";
  const dayDirectorActorId = input.dayDirectorActorId?.trim() ?? "";
  const growthMotions = !operatorUserId || !dayDirectorActorId
    ? { status: "unavailable" as const, reason: "Operator or day director is not on this turn" }
    : await (input.readers?.growthMotions ?? readBusinessGoalGrowthMotions)({
        tenantId: input.tenantId,
        operatorUserId,
        dayDirectorActorId,
        now: input.now,
        timeZone: input.timeZone,
        horizonStart: goal.horizon.startYmd,
        horizonEnd: goal.horizon.endYmd,
      });
  const recordedOpenCents = openCollections.status === "available" ? sumRecorded(openCollections.items) : null;
  const uncoveredCents =
    recordedOpenCents == null ? null : Math.max(0, goal.amountCents - recordedOpenCents);

  let persisted = false;
  let goalId: string | null = null;
  if (operatorUserId) {
    try {
      const saved = await setActiveMacroGoal(
        {
          tenantId: input.tenantId,
          operatorUserId,
          objective: goal.statement.slice(0, 512),
          metricKey: BUSINESS_GOAL_METRIC_KEY,
          targetValue: goal.amountCents / 100,
          unit: "USD",
          urgencyText: `period_increment ${goal.horizon.label}`.slice(0, 191),
          targetDate: goal.horizon.endYmd,
          source: "operator_attested",
          sourceNote: sourceNote(goal).slice(0, 512),
        },
        input.persistence
      );
      persisted = saved.status === "active";
      goalId = saved.id;
    } catch (error) {
      console.warn(
        "[Claire] business goal was not stored",
        error instanceof Error ? error.message : error
      );
    }
  }

  const spoken = speakBusinessGoal({
    status: "planned",
    persisted,
    goal,
    openCollections,
    growthMotions,
    recordedOpenCents,
  });
  return {
    status: "planned",
    persisted,
    goalId,
    goal,
    openCollections,
    growthMotions,
    recordedOpenCents,
    uncoveredCents,
    speak: spoken.speak,
    facts: spoken.facts,
    executions: NO_EXECUTION,
  };
}
