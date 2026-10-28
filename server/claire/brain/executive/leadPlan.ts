/**
 * Executive lead composition.
 *
 * "What do you have for me tomorrow? What do you want me to do?" is not a fact
 * question and not a report. The operator wants the next move. On the 2026-10-20
 * evening debrief that turn fell to the showrunner's analysis reader and Claire
 * read a Day Line row aloud. This module is the executive's answer instead:
 *
 *   the goal and the distance to it   (Business Memory: goal progress)
 * + the day's work                    (Business Memory: operations for the day asked about)
 * + where the operator is in the game (Business Memory: game master view)
 * → goal first, one first action, the named buildings, the game move, and a Day
 *   Line move Claire can OFFER — never save — until the operator says yes.
 *
 * Every name and number comes from the evidence payloads. Nothing here mutates;
 * the offer is minted by `decideTurn` as a `propose_day_line` grant and held
 * pending by the existing adapter until the operator's explicit approval.
 */

import type { EvidenceItem } from "../contracts/evidence";
import type { DayWork } from "../../knowledge/operationsKnowledge";
import {
  isNoRecord,
  speakColosseumPosition,
  speakNoRecordStages,
  type GameMasterView,
} from "../businessMemory/gameMasterView";
import { speakGoalOnRecord, speakGoalProgress, type GoalProgress } from "../businessMemory/goalProgress";
import { addDaysYmd } from "../../../analytics/businessPeriods";
import { dedupeSpokenTitles as dedupeTitles } from "../../speech/dedupeSpokenTitles";

export type LeadHorizon = "today" | "tomorrow" | null;

export type LeadPlan = {
  horizon: LeadHorizon;
  /** The business date the plan is for. */
  businessDate: string;
  goal: string | null;
  firstAction: string | null;
  /** Buildings / work named by the evidence, in the order Claire would say them. */
  buildings: string[];
  gameMove: null | { kingdomId: string | null; targets: string[]; pitched: number; total: number };
  /** A move not yet on the Day Line that Claire offers to put there. */
  dayLineMove: null | { title: string; businessDate: string };
  /** Deterministic speech, goal first. Phrased by Claire's organ when one is available. */
  text: string;
  evidenceIds: string[];
};

const DAY_WORK_TYPES = new Set(["operations", "day_line_read", "field_today"]);

function dayWorkFor(evidence: readonly EvidenceItem[], businessDate: string): { item: EvidenceItem; work: DayWork } | null {
  const chosen = evidence.find(
    item =>
      DAY_WORK_TYPES.has(item.type) &&
      item.authoritativeFor.includes("current_business_truth") &&
      (item.payload as DayWork | null)?.businessDate === businessDate
  );
  const work = (chosen?.payload ?? null) as DayWork | null;
  return chosen && work && Array.isArray(work.open) ? { item: chosen, work } : null;
}

/** "Follow up with The Louise" reads as "follow up with The Louise" mid-sentence; names keep their case. */
function spokenAction(title: string): string {
  return /^(?:follow|call|visit|pitch|pick|drop|deliver|email|text|meet|check|send|walk|knock|stop|swing|go|head|drive|publish|post|prepare|run)\b/i.test(title)
    ? `${title.charAt(0).toLowerCase()}${title.slice(1)}`
    : title;
}

function list(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

export function buildLeadPlan(input: {
  evidence: readonly EvidenceItem[];
  horizon: LeadHorizon;
  today: string;
  /** The operator asked for the goal itself ("what is my goal?"). */
  goalAsked?: boolean;
  /**
   * The operator asked to be relieved of the decision ("I'm overwhelmed, tell
   * me what to do"). One move, one breath: no goal recital, no "after that",
   * no game position, and no Day Line offer, because an offer is a question
   * handed back to someone who just said they are out of decisions.
   */
  relief?: boolean;
}): LeadPlan {
  const businessDate = input.horizon === "tomorrow" ? addDaysYmd(input.today, 1) : input.today;

  const goalItem = input.evidence.find(item => item.type === "goal_progress" && item.authoritativeFor.includes("current_business_truth"));
  const goalProgress = (goalItem?.payload ?? null) as GoalProgress | null;
  const goalAdvice = input.evidence.find(
    item => item.type === "goal_recommendation" && (item.payload as { kind?: string } | null)?.kind === "macro_goal"
  );
  const goal = goalProgress?.objective ?? ((goalAdvice?.payload as { title?: string } | null)?.title?.trim() || null);

  const dayWork = dayWorkFor(input.evidence, businessDate);
  const open = dedupeTitles((dayWork?.work.open ?? []).map(item => item.title));

  const gameItem = input.evidence.find(item => item.type === "game_state" && item.authoritativeFor.includes("current_business_truth"));
  const view = (gameItem?.payload ?? null) as GameMasterView | null;
  const colosseum = view && !isNoRecord(view.colosseum) && !view.colosseum.satisfied ? view.colosseum : null;
  const gameMove = colosseum
    ? {
        kingdomId: view?.activeKingdom?.kingdomId ?? null,
        targets: colosseum.remaining.map(target => target.name),
        pitched: colosseum.pitched.length,
        total: colosseum.targetIds.length,
      }
    : null;

  const firstAction = open[0]
    ? spokenAction(open[0])
    : gameMove?.targets.length
      ? `pitching ${gameMove.targets[0]} in person`
      : null;
  const buildings = dedupeTitles([...open, ...(gameMove?.targets ?? [])]);

  // A move is offered only when it is not already on that day's line.
  const alreadyOnLine = (name: string) => open.some(title => title.toLowerCase().includes(name.toLowerCase()));
  const offered = gameMove ? gameMove.targets.filter(name => !alreadyOnLine(name)) : [];
  const dayLineMove = offered.length
    ? { title: `Pitch ${list(offered)} in person (Greystar Koreatown)`, businessDate }
    : null;

  const when = input.horizon === "tomorrow" ? "Tomorrow" : input.horizon === "today" ? "Today" : "Next";
  const evidenceIds = [goalItem?.id, goalAdvice?.id, dayWork?.item.id, gameItem?.id].filter((id): id is string => Boolean(id));

  if (input.relief) {
    const slot = input.horizon === "tomorrow" ? " tomorrow" : input.horizon === "today" ? " tonight" : "";
    const text = firstAction
      ? `One thing${slot}: ${firstAction}. That's it; the rest can wait.`
      : `Nothing is open on the line${slot}, so the one thing is to stop for the night.`;
    return {
      horizon: input.horizon,
      businessDate,
      goal,
      firstAction,
      buildings: firstAction && open[0] ? [open[0]] : buildings.slice(0, 1),
      gameMove,
      dayLineMove: null,
      text,
      evidenceIds,
    };
  }

  const sentences: string[] = [];
  // Goal first, always: the operator should never have to bring it up.
  if (goalProgress) sentences.push(input.goalAsked ? speakGoalOnRecord(goalProgress) : speakGoalProgress(goalProgress));
  else if (goal) sentences.push(`The goal is ${goal}. I don't have a verified current count.`);
  else sentences.push("I don't have a goal on record for you yet.");
  if (firstAction) sentences.push(`${when}, the first move is ${firstAction}.`);
  const rest = open.slice(1, 4);
  if (rest.length) sentences.push(`After that: ${list(rest.map(spokenAction))}.`);
  const position = view ? speakColosseumPosition(view) : null;
  if (position) sentences.push(position);
  else if (view && isNoRecord(view.day1TenDoors)) sentences.push("The Colosseum has no record of a visit yet.");
  const missing = view ? speakNoRecordStages(view) : null;
  if (missing) sentences.push(missing);
  if (!firstAction && !gameMove) sentences.push(`${when}'s line has nothing open yet, so the move is to pick one.`);

  return {
    horizon: input.horizon,
    businessDate,
    goal,
    firstAction,
    buildings,
    gameMove,
    dayLineMove,
    text: sentences.join(" "),
    evidenceIds,
  };
}

/** The approval ask that accompanies an offered Day Line move. It is a question and claims no save. */
export function leadPlanApprovalAsk(move: NonNullable<LeadPlan["dayLineMove"]>, today: string): string {
  const day =
    move.businessDate === today ? "today's" : move.businessDate === addDaysYmd(today, 1) ? "tomorrow's" : `the ${move.businessDate}`;
  return `Want me to put that on ${day} Day Line?`;
}
