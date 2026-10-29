/**
 * The operator decides what a day is for, and Claire makes the Day Line say so.
 *
 * Production 2026-10-28, call cb980810 (17:38 PT). Adam said tomorrow is the marketing challenge
 * (publish the Instagram landing page), five different ways:
 *   "I think that should take priority over the Louise"
 *   "tomorrow is about the marketing challenge. It's not about the Louise."
 *   "I don't want those on my day line."
 *   "Remove the sales stops from the dayline and put the marketing challenge."
 * Claire answered "I can't remove or add anything from here", and his one "Yes" saved the Greystar
 * pitch she had been pushing instead. Brain V2 had no action for taking a row off a day, and no
 * reader that turned the operator's chosen priority into the day's challenge.
 *
 * This lane does three things, all through existing governed writers, all read back:
 *   - the chosen work becomes that day's operator mission (a real challenge with a completion
 *     condition, game-bound and playable), via executeOperatorMissionCommand;
 *   - named rows, or "the sales stops", come off THAT DAY only (removedFromDay). The opportunity
 *     behind them is not abandoned: no notPursuing, no follow-up cancelled;
 *   - Claire speaks only what the read-back confirms.
 *
 * An imperative ("remove…", "put…") is done now. A stated preference ("that should take priority")
 * is offered once, by name, and only a yes to THAT offer, on the very next turn, carries it out.
 *
 * The reader is a model (Adam does not speak in command frames), bounded: closed fields, the title
 * must come from the operator's own recent words, and rows to remove are matched against the rows
 * actually on that day. It never invents work and never removes an operator-designated mission.
 */

import { invokeLLM } from "../../../_core/llm";
import { ENV } from "../../../_core/env";
import { CURRENT_HAIKU_MODEL, normalizeAnthropicModel } from "../../../_core/modelCapabilities";
import { addDaysYmd } from "../../../analytics/businessPeriods";

export type DayPlanDay = "today" | "tomorrow";

export type DayPlanEditReading = {
  /** The operator is deciding what a day's line holds (not reporting, not asking). */
  applies: boolean;
  /** Told Claire to do it now (imperative), as opposed to stating a preference for Claire to confirm. */
  explicit: boolean;
  day: DayPlanDay;
  /** The work the operator chose as that day's main challenge, imperative, in their words. */
  primaryTitle: string | null;
  /** Take Claire's sales stops (pitches, visits, door knocks) off that day. */
  removeSales: boolean;
  /** Other items the operator named for removal from that day, in their words. */
  removeTitles: string[];
};

export type DayPlanRow = {
  id: string;
  title: string;
  kind: string;
  status: "open" | "completed";
  /** The operator designated this row the day's mission. Never removed by this lane. */
  operatorPrimary: boolean;
};

export type DayPlanEditPending = {
  reading: DayPlanEditReading;
  /** The utterance whose words licensed the title (the mission's evidence quote). */
  sourceUtterance: string;
  /** Claire turn ordinal that spoke the offer. A yes binds only on the very next turn. */
  askedAtTurn: number;
  businessDate: string;
};

export type DayPlanEditDeps = {
  readDay: (businessDate: string) => Promise<DayPlanRow[]>;
  removeFromDay: (input: { businessDate: string; commitmentIds: string[]; reason: string }) => Promise<string[]>;
  designateMission: (input: {
    businessDate: string;
    title: string;
    utterance: string;
    sourceCommandRef: string;
  }) => Promise<{ ok: true; title: string; completionCondition: string; commitmentId: string; outcome: "created" | "already" | "updated" } | { ok: false }>;
};

export type DayPlanEditOutcome = {
  speak: string;
  mutationReceipts: Array<{ claimedState: "created" | "updated" | "removed"; entityId: string; statement: string }>;
  actionIds: string[];
  /** Something was written and read back. */
  changed: boolean;
  /** The day's challenge is now the operator's (created, updated, or already so). */
  missionSet: boolean;
};

const EDIT_CUE =
  /\b(?:remove|take\s+(?:\w+\s+){0,4}off|pull\s+(?:\w+\s+){0,4}off|get\s+rid\s+of|clear\s+(?:\w+\s+){0,3}off|drop\s+(?:the|those|them|that|all)|delete|don'?t\s+want\s+(?:\w+\s+){0,6}(?:on|in)\s+(?:my|the)\s+(?:\S+\s+)?day\s?line)\b/i;
const DAY_WORD = /\b(?:today|tonight|tomorrow|day\s?line|dayline)\b/i;
const PRIORITY_NOUN = /\b(?:challenge|mission|priority|focus|main\s+thing)\b/i;
const PRIORITY_VERB = /\b(?:take|takes|taking|have|has|get)\s+priority\b|\bprioriti[sz]e\b/i;
const DAY_IS_ABOUT = /\b(?:today|tomorrow)\s+is\s+(?:all\s+)?about\b/i;

/** Cheap gate: only these turns pay for the reader. */
export function mayBeDayPlanEdit(utterance: string): boolean {
  const text = utterance.trim();
  if (!text) return false;
  if (EDIT_CUE.test(text) && (DAY_WORD.test(text) || /\b(?:stops?|visits?|pitch(?:es)?|sales|those|them)\b/i.test(text))) return true;
  if (PRIORITY_VERB.test(text) || DAY_IS_ABOUT.test(text)) return true;
  return PRIORITY_NOUN.test(text) && (DAY_WORD.test(text) || /\b(?:put|add|make|set)\b/i.test(text));
}

export function dayPlanEditModelId(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeAnthropicModel(env.ANTHROPIC_MODEL_CLAIRE_PERCEPTION?.trim() ?? "") || CURRENT_HAIKU_MODEL;
}

export function isDayPlanEditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CLAIRE_DAY_PLAN_EDIT?.trim() !== "0";
}

const SYSTEM = [
  "You read one turn of a phone call between a small-business operator and Claire, their chief of staff.",
  "Decide whether the operator's LATEST utterance decides what a day's Day Line (their work list) holds.",
  "applies=true only when the operator chooses that day's main work, or tells Claire to take items off that day. A report of what happened, a question, or feedback about how Claire talks is applies=false.",
  "explicit=true when the operator tells Claire to do it now (\"remove the sales stops and put the marketing challenge\", \"I don't want those on my day line\", \"make it tomorrow's challenge\"). explicit=false when they only state a preference or opinion (\"I think that should take priority\").",
  "day: the day being decided. On an evening call, or when the recent turns are about tomorrow, an unstated day is tomorrow.",
  "primaryTitle: the work the operator chose as that day's main challenge, as a short imperative using THEIR words and the recent turns to resolve references (\"the marketing challenge\" → what they said it is, e.g. \"Publish the Instagram landing page\"). Null when they chose nothing.",
  "removeSales: true when they want Claire's sales stops, pitches, visits or sales missions off that day.",
  "removeTitles: other items they named to take off that day, in their words. Empty when none.",
  "Never invent work the operator did not say.",
].join(" ");

/** Production reader: newest Haiku, closed schema. Any failure reads as not applicable. */
export async function readDayPlanEdit(input: {
  tenantId: string;
  utterance: string;
  recentTurns: Array<{ speaker: "operator" | "claire"; text: string }>;
  evening: boolean;
}): Promise<DayPlanEditReading | null> {
  if (!ENV.anthropicApiKey?.trim()) return null;
  const result = await invokeLLM({
    tenantId: input.tenantId,
    model: dayPlanEditModelId(),
    maxTokens: 250,
    timeoutMs: 6_000,
    feature: "claire_day_plan_edit",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          eveningCall: input.evening,
          recentTurns: input.recentTurns.slice(-8).map(turn => ({ speaker: turn.speaker, text: turn.text.slice(0, 400) })),
          utterance: input.utterance.slice(0, 1_000),
        }),
      },
    ],
    outputSchema: {
      name: "claire_day_plan_edit",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["applies", "explicit", "day", "primaryTitle", "removeSales", "removeTitles"],
        properties: {
          applies: { type: "boolean" },
          explicit: { type: "boolean" },
          day: { type: "string", enum: ["today", "tomorrow"] },
          primaryTitle: { type: ["string", "null"] },
          removeSales: { type: "boolean" },
          removeTitles: { type: "array", items: { type: "string" } },
        },
      },
    },
  });
  const raw = result.choices[0]?.message.content;
  return parseDayPlanEditReading(JSON.parse(typeof raw === "string" ? raw : "{}"));
}

export function parseDayPlanEditReading(value: unknown): DayPlanEditReading | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.applies !== "boolean" || typeof v.explicit !== "boolean") return null;
  if (v.day !== "today" && v.day !== "tomorrow") return null;
  const primaryTitle = typeof v.primaryTitle === "string" && v.primaryTitle.trim() ? v.primaryTitle.trim().slice(0, 200) : null;
  const removeTitles = Array.isArray(v.removeTitles)
    ? v.removeTitles.filter((title): title is string => typeof title === "string" && Boolean(title.trim())).map(title => title.trim()).slice(0, 6)
    : [];
  return { applies: v.applies, explicit: v.explicit, day: v.day, primaryTitle, removeSales: v.removeSales === true, removeTitles };
}

const STOP = new Set([
  "the", "and", "for", "with", "that", "this", "those", "them", "from", "into", "onto", "about", "your", "my", "our",
  "tomorrow", "today", "tonight", "challenge", "mission", "priority", "line", "dayline",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(word => word.length >= 3 && !STOP.has(word));
}

/** "publish" and "published", "launch" and "launching" are the same word for this check. */
function stem(word: string): string {
  return word.slice(0, 5);
}

/**
 * The title must be the operator's: most of its content words were spoken by the operator on this
 * call. A model that names work nobody said is ignored.
 */
export function titleGroundedInOperatorWords(title: string, operatorText: string): boolean {
  const wanted = [...new Set(tokens(title).map(stem))];
  if (!wanted.length) return false;
  const said = new Set(tokens(operatorText).map(stem));
  const hits = wanted.filter(word => said.has(word)).length;
  return hits >= Math.max(1, Math.ceil(wanted.length * 0.6));
}

const SALES_ROW = /\b(?:pitch|pitches|pitching|visit|visits|door|doors|knock|walk[- ]?in|prospect|canvass|sales|leasing office)\b/i;

/** Rows this edit takes off the day. Operator missions and completed history are never candidates. */
export function rowsToRemove(reading: DayPlanEditReading, rows: DayPlanRow[]): DayPlanRow[] {
  const candidates = rows.filter(row => row.status === "open" && !row.operatorPrimary);
  const chosen = new Map<string, DayPlanRow>();
  if (reading.removeSales) {
    for (const row of candidates) if (SALES_ROW.test(row.title)) chosen.set(row.id, row);
  }
  for (const named of reading.removeTitles) {
    const want = tokens(named);
    if (!want.length) continue;
    for (const row of candidates) {
      const have = new Set(tokens(row.title));
      const hits = want.filter(word => have.has(word)).length;
      if (hits >= Math.max(1, Math.ceil(want.length / 2))) chosen.set(row.id, row);
    }
  }
  return [...chosen.values()];
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function dayPossessive(day: DayPlanDay): string {
  return day === "tomorrow" ? "tomorrow's" : "today's";
}

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** A row title as Claire says it: no bookkeeping parentheticals, no trailing period. */
function spokenTitle(title: string): string {
  return title.replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s{2,}/g, " ").trim().replace(/[.!?]+$/, "");
}

export function businessDateFor(day: DayPlanDay, today: string): string {
  return day === "tomorrow" ? addDaysYmd(today, 1) : today;
}

/** The one offer for a stated (not commanded) preference. Names exactly what a yes will do. */
export function dayPlanOfferSpeech(reading: DayPlanEditReading): string {
  const day = dayPossessive(reading.day);
  const parts: string[] = [];
  if (reading.removeSales) parts.push(`take the sales stops off ${reading.day}`);
  else if (reading.removeTitles.length) parts.push(`take ${list(reading.removeTitles.map(spokenTitle))} off ${reading.day}`);
  const challenge = reading.primaryTitle ? lowerFirst(spokenTitle(reading.primaryTitle)) : null;
  if (challenge) parts.push(`set ${day} challenge to ${challenge}`);
  return `Want me to ${list(parts)}?`;
}

/**
 * Carry out an edit and speak only what the read-back confirms. Removal runs first so the day's
 * challenge is the last thing said.
 */
export async function applyDayPlanEdit(input: {
  reading: DayPlanEditReading;
  utterance: string;
  today: string;
  sourceCommandRef: string;
  deps: DayPlanEditDeps;
}): Promise<DayPlanEditOutcome> {
  const { reading, deps } = input;
  const businessDate = businessDateFor(reading.day, input.today);
  const day = reading.day;
  const sentences: string[] = [];
  const mutationReceipts: DayPlanEditOutcome["mutationReceipts"] = [];
  const actionIds: string[] = [];
  let missionSet = false;

  if (reading.removeSales || reading.removeTitles.length) {
    const rows = await deps.readDay(businessDate).catch(() => null);
    if (!rows) {
      sentences.push(`I couldn't read ${dayPossessive(day)} line, so I didn't take anything off.`);
    } else {
      const targets = rowsToRemove(reading, rows);
      if (!targets.length) {
        sentences.push(reading.removeSales ? `There were no sales stops on ${dayPossessive(day)} line.` : `I didn't find that on ${dayPossessive(day)} line.`);
      } else {
        const removed = await deps
          .removeFromDay({ businessDate, commitmentIds: targets.map(row => row.id), reason: input.utterance.slice(0, 300) })
          .catch(() => [] as string[]);
        const gone = targets.filter(row => removed.includes(row.id));
        const stuck = targets.filter(row => !removed.includes(row.id));
        for (const row of gone) {
          actionIds.push(row.id);
          mutationReceipts.push({ claimedState: "removed", entityId: row.id, statement: `${row.title} taken off ${businessDate}` });
        }
        if (gone.length) {
          sentences.push(
            `I took ${list(gone.map(row => spokenTitle(row.title)))} off ${dayPossessive(day)} line. ${gone.length > 1 ? "They stay" : "It stays"} on record; only ${day} changed.`
          );
        }
        if (stuck.length) sentences.push(`I couldn't take ${list(stuck.map(row => spokenTitle(row.title)))} off just now.`);
      }
    }
  }

  if (reading.primaryTitle) {
    const mission = await deps
      .designateMission({ businessDate, title: reading.primaryTitle, utterance: input.utterance, sourceCommandRef: input.sourceCommandRef })
      .catch(() => ({ ok: false as const }));
    if (mission.ok) {
      missionSet = true;
      if (mission.outcome !== "already") {
        actionIds.push(mission.commitmentId);
        mutationReceipts.push({
          claimedState: mission.outcome === "updated" ? "updated" : "created",
          entityId: mission.commitmentId,
          statement: `${mission.title} is the operator's challenge for ${businessDate}`,
        });
      }
      const condition = mission.completionCondition.replace(/[.]+$/, "");
      const counts = /^operator reports completion of/i.test(condition) ? "It counts when you tell me it's done." : `It counts when ${lowerFirst(condition)}.`;
      sentences.push(`${mission.outcome === "already" ? "Already set." : "Saved."} ${capitalize(dayPossessive(day))} challenge: ${lowerFirst(spokenTitle(mission.title))}. ${counts}`);
    } else {
      sentences.push(`I couldn't save ${lowerFirst(spokenTitle(reading.primaryTitle))} as ${dayPossessive(day)} challenge just now.`);
    }
  }

  return { speak: sentences.join(" ").trim(), mutationReceipts, actionIds, changed: actionIds.length > 0, missionSet };
}

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const BARE_YES = /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|do it|go ahead|please do|please|correct|right|exactly|that'?s right|yes please|yes,? do it)\b[\s,.!]*(?:please|do it|go ahead|thanks|thank you)?[\s.!]*$/i;
const BARE_NO = /^(?:no|nope|nah|not now|don'?t|leave it|never ?mind)\b[\s,.!]*$/i;

export function bareConfirmation(utterance: string): "yes" | "no" | null {
  const text = utterance.trim();
  if (BARE_YES.test(text)) return "yes";
  if (BARE_NO.test(text)) return "no";
  return null;
}
