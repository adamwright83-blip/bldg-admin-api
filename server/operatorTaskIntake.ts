import { nanoid } from "nanoid";
import { runAgentTool } from "./agents/agentRuntime";
import type { AgentContext } from "./agents/permissions";

export type OperatorTaskLevel = "level_1" | "level_2" | "level_3" | "level_4";
export type EmergencyTaskDraft = {
  level: OperatorTaskLevel;
  title: string;
  details: string | null;
  priority: "emergency" | "high" | "normal" | "low";
  target: string | null;
  taskType: "intake_missing_price" | "unpaid_order" | "vague_intake" | "missed_pickup" | "stale_customer" | "revenue_leak" | "referral_ask" | "vendor_followup" | "gm_followup" | "manual_operator_task" | "dry_clean_receipt_intake" | "emergency_task";
  classificationReason: string;
};

const levelLabels: Record<OperatorTaskLevel, string> = {
  level_1: "Level 1",
  level_2: "Level 2",
  level_3: "Level 3",
  level_4: "Level 4",
};

function toTitle(fragment: string): string {
  const cleaned = fragment
    .replace(/^\s*(need to|i need to|please|can you|todo:?|task:?)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Untitled operator task";
  return cleaned[0].toUpperCase() + cleaned.slice(1);
}

function splitTaskFragments(note: string): string[] {
  return note
    .split(/\n|;|[.](?=\s|$)|,(?=\s*(?:and\s+)?(?:charge|charged|collect|call|text|email|follow|fix|debug|test|ship|review|close|sell|ask|intro|schedule|pickup|deliver|pay|invoice|order|create|pitch|launch|confirm)\b)/i)
    .flatMap((part) => part.split(/\s+\band\s+(?=(?:charge|charged|collect|call|text|email|follow|fix|debug|test|ship|review|close|sell|ask|intro|schedule|pickup|deliver|pay|invoice|order|create|pitch|launch|confirm)\b)/i))
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function classifyTask(text: string): Pick<EmergencyTaskDraft, "level" | "priority" | "taskType" | "classificationReason"> {
  const lower = text.toLowerCase();
  const hasMoney = /\b(charge|charged|collect|invoice|unpaid|paid|payment|card|stripe|refund|past due|overdue|money|revenue|price|pricing|cost|fee|missed charge)\b/.test(lower);
  const hasGrowth = /\b(flyer|building|gm\b|christopher|pitch|vendor signup|sales|referral|launch|ship|growth|intro|onboarding vendor|booking page|route expansion|vendor acquisition|acquisition)\b/.test(lower);
  const hasFollowup = /\b(call|text|follow up|follow-up|confirm|ask|reply|vendor|karin|customer update|status|schedule coordination|dry cleaner)\b/.test(lower);
  const hasOps = /\b(test|intake|order flow|verify|cleanup|clean up|missing info|add note|check order|pickup details)\b/.test(lower);

  if (hasMoney) {
    const taskType = /\b(price|pricing|cost|fee)\b/.test(lower) ? "intake_missing_price" : /\b(unpaid|past due|overdue|payment|charge|card|stripe|collect|invoice)\b/.test(lower) ? "unpaid_order" : "revenue_leak";
    return {
      level: "level_3",
      priority: "high",
      taskType,
      classificationReason: "Contains money, charge, collection, pricing, or past-due language, so Level 3 collections/revenue.",
    };
  }

  if (hasGrowth) {
    const taskType = /\b(referral|intro)\b/.test(lower) ? "referral_ask" : /\b(vendor|booking page|vendor signup|onboarding vendor)\b/.test(lower) ? "vendor_followup" : "gm_followup";
    return {
      level: "level_4",
      priority: "high",
      taskType,
      classificationReason: "Contains growth, flyer, building, sales, referral, launch, or vendor-acquisition language, so Level 4 high-value growth.",
    };
  }

  if (hasFollowup) {
    return {
      level: "level_2",
      priority: /\b(urgent|today|blocked|asap)\b/.test(lower) ? "high" : "normal",
      taskType: /\b(vendor|dry cleaner|karin)\b/.test(lower) ? "vendor_followup" : "manual_operator_task",
      classificationReason: "Contains call, text, confirm, vendor/customer status, or unresolved communication language, so Level 2 follow-up.",
    };
  }

  if (hasOps) {
    return {
      level: "level_1",
      priority: /\b(missing|broken|blocked)\b/.test(lower) ? "high" : "normal",
      taskType: /\b(intake|missing info|order flow|verify|check order)\b/.test(lower) ? "vague_intake" : "manual_operator_task",
      classificationReason: "Contains intake, order-flow, QA, missing-info, or basic cleanup language, so Level 1 operations cleanup.",
    };
  }

  return {
    level: "level_1",
    priority: "normal",
    taskType: "manual_operator_task",
    classificationReason: "No strong Level 2, Level 3, or Level 4 signal found, so defaulted safely to Level 1 capture.",
  };
}

function inferLevel(text: string): OperatorTaskLevel {
  return classifyTask(text).level;
}

function inferPriority(text: string, level: OperatorTaskLevel): EmergencyTaskDraft["priority"] {
  const lower = text.toLowerCase();
  if (/\b(emergency|urgent|asap|now|today|can't trust|critical|blocked)\b/.test(lower)) return "emergency";
  const classified = classifyTask(text);
  if (classified.level === level) {
    return classified.priority;
  }
  return "normal";
}

function inferTarget(text: string): string | null {
  const person = text.match(/\b(?:call|text|email|charge|collect from|follow up with|message)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/);
  if (person?.[1]) return person[1];
  const building = text.match(/\b(Building\s*\d+|Century Park East|OPUS LA|Opus LA|Karin|Daniel)\b/i);
  return building?.[1] ?? null;
}

export function parseEmergencyTaskIntake(note: string): EmergencyTaskDraft[] {
  const source = note.trim();
  if (!source) return [];

  const fragments = splitTaskFragments(source);
  const rawTasks = fragments.length ? fragments : [source];
  const seen = new Set<string>();

  return rawTasks.flatMap((fragment) => {
    const title = toTitle(fragment);
    const key = title.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const classification = classifyTask(fragment);
    const level = classification.level;
    return [{
      level,
      title,
      details: fragment === source ? null : source,
      priority: inferPriority(fragment, level),
      target: inferTarget(fragment),
      taskType: classification.taskType,
      classificationReason: classification.classificationReason,
    }];
  });
}

export async function runEmergencyTaskIntake(note: string, ctx: Omit<AgentContext, "agentType" | "actorType">) {
  const sessionId = ctx.sessionId ?? `emergency-${nanoid(10)}`;
  const drafts = parseEmergencyTaskIntake(note);
  const tasks = [];

  for (const draft of drafts) {
    const output = await runAgentTool("logOperatorTaskTool", {
      ...draft,
      sourceNote: note,
      source: "emergency_composer",
    }, {
      ...ctx,
      sessionId,
      agentType: "operator_task_agent",
      actorType: "human",
      trustedUiFlow: true,
    });
    tasks.push(output);
  }

  const grouped = drafts.reduce<Record<OperatorTaskLevel, number>>((acc, draft) => {
    acc[draft.level] += 1;
    return acc;
  }, { level_1: 0, level_2: 0, level_3: 0, level_4: 0 });

  return {
    sessionId,
    note,
    tasks,
    summary: Object.entries(grouped)
      .filter(([, count]) => count > 0)
      .map(([level, count]) => `${levelLabels[level as OperatorTaskLevel]}: ${count}`)
      .join(" / "),
  };
}

export function publicEmergencyTaskErrorMessage(_error: unknown): string {
  return "Task could not be saved. Please try again.";
}
