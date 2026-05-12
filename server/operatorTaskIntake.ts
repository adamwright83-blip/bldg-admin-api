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
    .split(/\n|;|,(?=\s*(?:and\s+)?(?:charge|collect|call|text|email|follow|fix|debug|test|ship|review|close|sell|ask|intro|schedule|pickup|deliver|pay|invoice)\b)/i)
    .flatMap((part) => part.split(/\s+\band\b\s+(?=(?:charge|collect|call|text|email|follow|fix|debug|test|ship|review|close|sell|ask|intro|schedule|pickup|deliver|pay|invoice)\b)/i))
    .map((part) => part.trim())
    .filter((part) => part.length >= 3);
}

function inferLevel(text: string): OperatorTaskLevel {
  const lower = text.toLowerCase();
  if (/\b(level\s*4|boss|building\s*\d+|building intro|intro|landlord|property manager|gm\b|revenue-critical|seed|sell|close|partnership|launch|expansion)\b/.test(lower)) {
    return "level_4";
  }
  if (/\b(charge|collect|payment|pay|invoice|cash|refund|stripe)\b/.test(lower)) {
    return "level_1";
  }
  if (/\b(fix|bug|debug|test|qa|flow|signup|sign up|api|webhook|deploy|repo|admin\.bldg|app\.bldg|product|system|broken)\b/.test(lower)) {
    return "level_3";
  }
  if (/\b(call|text|email|message|follow up|follow-up|vendor|customer|resident|karin|daniel|remind|reply)\b/.test(lower)) {
    return "level_2";
  }
  if (/\b(pickup|deliver|route|order|laundry|dry clean|receipt|intake)\b/.test(lower)) {
    return "level_1";
  }
  return "level_1";
}

function inferPriority(text: string, level: OperatorTaskLevel): EmergencyTaskDraft["priority"] {
  const lower = text.toLowerCase();
  if (/\b(emergency|urgent|asap|now|today|can't trust|critical|blocked)\b/.test(lower)) return "emergency";
  if (level === "level_4" || level === "level_1") return "high";
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
    const level = inferLevel(fragment);
    return [{
      level,
      title,
      details: fragment === source ? null : source,
      priority: inferPriority(source + " " + fragment, level),
      target: inferTarget(fragment),
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
