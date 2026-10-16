/**
 * One operator turn through Claire's work ledger.
 *
 * Returns a complete turn result when the turn was about work (or ended the
 * call), and null when it was ordinary conversation. On null the caller runs
 * Claire's conversational pipeline with Day Line writes switched off for that
 * turn, so the ledger stays the only writer in a conversation it owns.
 */
import { formatInTimeZone } from "date-fns-tz";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { briefingClock } from "../briefing/briefingTiming";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { VerifiedFactInventory, lintPostGenerationStateVerbs } from "../assertionGuard";
import type { ClaireTurnResult, ClaireTurnState } from "../turn/claireTurn";
import {
  emptyWorkLedgerState,
  planWorkLedgerTurn,
  type LedgerDayLineItem,
  type LedgerExecutionType,
  type LedgerTranscriptTurn,
  type WorkLedgerPlan,
  type WorkLedgerPlannerDeps,
  type WorkLedgerState,
} from "./workLedgerPlanner";
import {
  applyWorkLedgerPlan,
  speakVerifiedLedgerChanges,
  type WorkLedgerApplyDeps,
  type WorkLedgerApplyResult,
} from "./workLedgerApply";
import { recordWorkLedgerOperatorSignal } from "./workLedgerSignals";

const HISTORY_LIMIT = 32;

export type WorkLedgerTurnInput = {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  conversationKey: string;
  surface: "voice" | "text";
  utterance: string;
  state: ClaireTurnState;
  timeZone: string;
  sessionKind: string;
  callFacts?: string[];
  sourceEventId?: string;
};

export type WorkLedgerTurnDeps = {
  now: () => Date;
  planner: WorkLedgerPlannerDeps;
  apply: Partial<WorkLedgerApplyDeps>;
  readState: typeof getDayDirectorState;
  recordSignal: typeof recordWorkLedgerOperatorSignal;
};

export type WorkLedgerTurnOutcome =
  | { handled: true; result: ClaireTurnResult; plan: WorkLedgerPlan; applied: WorkLedgerApplyResult; latencyMs: number }
  | { handled: false; reason: "not_work" | "planner_unavailable" | "empty"; plan?: WorkLedgerPlan };

export function workLedgerStateOf(state: ClaireTurnState): WorkLedgerState {
  const existing = state.workLedger;
  if (existing && existing.version === 1) return existing;
  const fresh = emptyWorkLedgerState();
  state.workLedger = fresh;
  return fresh;
}

function transcriptOf(state: ClaireTurnState): LedgerTranscriptTurn[] {
  return (state.history ?? [])
    .filter(entry => entry.text?.trim())
    .map(entry => ({ speaker: entry.speaker, text: entry.text }));
}

async function loadDayLine(
  deps: WorkLedgerTurnDeps,
  input: WorkLedgerTurnInput,
  dates: string[],
  savedIds: Set<string>
): Promise<LedgerDayLineItem[]> {
  const items: LedgerDayLineItem[] = [];
  for (const businessDate of dates) {
    const state = await deps.readState({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, businessDate });
    for (const row of state.commitments ?? []) {
      items.push({
        id: row.id,
        title: row.title,
        businessDate: row.businessDate,
        status: row.status === "completed" ? "completed" : "open",
        executionType: ((row as { executionType?: LedgerExecutionType }).executionType ?? null) as LedgerExecutionType,
        detail: row.detailNote ?? null,
        sourceText: row.sourceText ?? null,
        scheduleLabel: row.scheduleLabel ?? null,
        savedThisConversation: savedIds.has(row.id),
      });
    }
  }
  return items;
}

/** What the conversational model should know about work on non-work turns. */
export function workLedgerPromptSection(state: ClaireTurnState, today: string): string | null {
  const ledger = state.workLedger;
  if (!ledger || (!ledger.held.length && !ledger.savedIds.length && !ledger.signals?.length && !ledger.degradedAt && !state.workLedgerCallFacts?.length)) return null;
  const lines: string[] = [];
  if (ledger.degradedAt) {
    lines.push("Claire's work recorder could not process the operator's last message. If it contained work to record, say plainly that you couldn't record it just now and ask them to say it again in a moment. Never imply it was saved.");
  }
  if (state.workLedgerCallFacts?.length) lines.push(`Call facts: ${state.workLedgerCallFacts.join(" ")}`);
  const declined = (ledger.signals ?? []).filter(signal => signal.kind === "declined_topic" && signal.about);
  if (declined.length) {
    lines.push(`Earlier in this conversation the operator declined to discuss: ${declined.map(signal => signal.about).join("; ")}. Do not bring ${declined.length === 1 ? "it" : "those"} up again unless they do.`);
  }
  const repeated = (ledger.signals ?? []).filter(signal => signal.kind === "repeated_instruction" || signal.kind === "complaint_about_claire");
  if (repeated.length) {
    lines.push(`The operator has had to repeat themselves this call ("${repeated.at(-1)!.quote}"). Never ask them to repeat what is already in the conversation; use it.`);
  }
  if (ledger.lastSaved?.length) {
    lines.push(
      `Work saved to the Day Line earlier in this conversation (verified): ${ledger.lastSaved
        .map(item => `${item.title} (${item.businessDate === today ? "today" : item.businessDate}${item.executionType ? `, ${item.executionType}` : ""})`)
        .join("; ")}.`
    );
  }
  if (ledger.held.length) {
    lines.push(`Work discussed but not saved yet: ${ledger.held.map(item => item.title).join("; ")}.`);
  }
  lines.push("Work changes are handled by the server; do not claim to save or change anything yourself.");
  return lines.join(" ");
}

/** Sentences in which the model narrates a write itself; those belong to the receipt-backed confirmation. */
const SELF_REPORTED_WRITE =
  /\b(?:added|adding|saved|saving|updated|changed|reclassif\w*|tagged|logged|recorded|moved|removed|deleted|dropped|scratched|cleared|cancell?ed|scheduled|marked|took (?:it|that|them|those) off|put (?:it|that|them|those)|on (?:the|your|today'?s|tomorrow'?s) (?:day ?)?line|done\.)/i;

export function cleanLedgerReply(reply: string): string {
  if (!reply.trim()) return "";
  const kept = reply
    .replace(/\s*\bsay yes or no\b\.?/gi, "")
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => sentence.trim() && !SELF_REPORTED_WRITE.test(sentence))
    .join(" ")
    .replace(/^(?:[-—,;:]\s*)+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!kept) return "";
  const lint = lintPostGenerationStateVerbs(kept, new VerifiedFactInventory([]));
  if (!lint.pass) {
    console.warn("[ClaireWorkLedger] reply dropped: it claimed a write itself", { violations: lint.violations });
    return "";
  }
  return kept;
}

function remember(state: ClaireTurnState, speaker: "operator" | "claire", text: string, at: number): void {
  if (!text.trim()) return;
  state.history = [
    ...(state.history ?? []),
    { speaker, text: text.slice(0, 1_200), at, ...(speaker === "claire" ? { delivery: "generated" as const } : {}) },
  ].slice(-HISTORY_LIMIT);
}

export async function runWorkLedgerTurn(
  input: WorkLedgerTurnInput,
  overrides: Partial<WorkLedgerTurnDeps> = {}
): Promise<WorkLedgerTurnOutcome> {
  const deps: WorkLedgerTurnDeps = {
    now: () => new Date(),
    planner: {},
    apply: {},
    readState: getDayDirectorState,
    recordSignal: recordWorkLedgerOperatorSignal,
    ...overrides,
  };
  const utterance = input.utterance.trim();
  if (!utterance) return { handled: false, reason: "empty" };
  const startedAt = Date.now();
  const now = deps.now();
  const clock = briefingClock(now, input.timeZone);
  const tomorrow = addDaysYmd(clock.today, 1);
  const ledger = workLedgerStateOf(input.state);
  if (input.callFacts?.length) input.state.workLedgerCallFacts = input.callFacts;

  let dayLine: LedgerDayLineItem[];
  try {
    dayLine = await loadDayLine(deps, input, [clock.today, tomorrow], new Set(ledger.savedIds));
  } catch (error) {
    console.warn("[ClaireWorkLedger] Day Line read failed", error instanceof Error ? error.message : error);
    return { handled: false, reason: "planner_unavailable" };
  }

  const planned = await planWorkLedgerTurn(
    {
      tenantId: input.tenantId,
      utterance,
      transcript: transcriptOf(input.state),
      dayLine,
      held: ledger.held,
      clock: {
        today: clock.today,
        tomorrow,
        localTime: formatInTimeZone(now, input.timeZone, "h:mm a"),
        timeZone: input.timeZone,
      },
      sessionKind: input.sessionKind,
      callFacts: input.state.workLedgerCallFacts ?? [],
    },
    ledger.nextRef,
    deps.planner
  );
  if (!planned) {
    // The conversational pipeline answers this turn; it must not imply the work was recorded.
    ledger.degradedAt = now.getTime();
    return { handled: false, reason: "planner_unavailable" };
  }
  ledger.degradedAt = null;
  ledger.nextRef = planned.nextRef;

  if (planned.operatorSignal.kind !== "none") {
    ledger.signals = [...(ledger.signals ?? []), { ...planned.operatorSignal, at: now.getTime() }].slice(-8);
    // Awaited (briefly) so Daphne's card on this same turn already carries it.
    const write = deps
      .recordSignal({
        tenantId: input.tenantId,
        operatorUserId: input.operatorUserId,
        conversationKey: input.conversationKey,
        sourceEventId: input.sourceEventId ?? `${input.conversationKey}:${input.state.history?.length ?? 0}`,
        signal: planned.operatorSignal,
        surface: input.surface,
        occurredAt: now,
        businessDate: clock.today,
      })
      .catch(error => {
        console.warn("[ClaireWorkLedger] Daphne signal not recorded", error instanceof Error ? error.message : error);
        return null;
      });
    await Promise.race([write, new Promise(resolve => setTimeout(resolve, 900))]);
  }

  if (!planned.workChanged && !planned.endCall) {
    console.info("[ClaireWorkLedger]", {
      event: "claire_work_ledger_turn",
      handled: false,
      conversationKey: input.conversationKey,
      latencyMs: planned.latencyMs,
      model: planned.model,
      held: ledger.held.length,
    });
    return { handled: false, reason: "not_work", plan: planned };
  }

  const applied = await applyWorkLedgerPlan({
    plan: planned,
    dayLine,
    target: {
      tenantId: input.tenantId,
      dayDirectorActorId: input.dayDirectorActorId,
      operatorUserId: input.operatorUserId,
      conversationKey: input.conversationKey,
    },
    clock: { today: clock.today, minutesNow: clock.minutesNow },
    deps: deps.apply,
  });

  // Held work after this turn: the plan's list, minus what is now verifiably on the line.
  const saved = new Set(applied.savedRefs);
  ledger.held = planned.held.filter(item => !saved.has(item.ref));
  ledger.savedIds = Array.from(new Set([...ledger.savedIds, ...applied.savedIds]));
  const removedIds = new Set(applied.changes.filter(change => change.kind === "removed").map(change => change.id));
  const priorSaved = (ledger.lastSaved ?? []).filter(item => !removedIds.has(item.id));
  const nextSaved = new Map(priorSaved.map(item => [item.id, item]));
  for (const change of applied.changes) {
    if (change.kind === "created" || change.kind === "updated" || change.kind === "moved") {
      nextSaved.set(change.id, {
        id: change.id,
        title: change.title,
        businessDate: change.businessDate,
        executionType: "executionType" in change ? change.executionType : null,
      });
    }
  }
  ledger.lastSaved = Array.from(nextSaved.values()).slice(-20);

  const confirmation = speakVerifiedLedgerChanges(applied, clock.today);
  const reply = cleanLedgerReply(planned.reply);
  const speak = [confirmation, reply].filter(Boolean).join(" ").trim() || (planned.endCall ? "Talk soon." : "Got it.");

  const at = now.getTime();
  remember(input.state, "operator", utterance, at);
  remember(input.state, "claire", speak, at + 1);

  const latencyMs = Date.now() - startedAt;
  console.info("[ClaireWorkLedger]", {
    event: "claire_work_ledger_turn",
    handled: true,
    conversationKey: input.conversationKey,
    surface: input.surface,
    latencyMs,
    plannerLatencyMs: planned.latencyMs,
    model: planned.model,
    created: applied.changes.filter(change => change.kind === "created").length,
    updated: applied.changes.filter(change => change.kind === "updated" || change.kind === "moved").length,
    completed: applied.changes.filter(change => change.kind === "completed").length,
    removed: applied.changes.filter(change => change.kind === "removed").length,
    failures: applied.failures.length,
    held: ledger.held.length,
    refused: planned.refused,
    endCall: planned.endCall,
  });

  const actionIds = applied.changes.map(change => change.id);
  const result: ClaireTurnResult = {
    speak,
    kind: applied.changes.length ? "briefing_saved" : "answered",
    assembledUtterance: utterance,
    thoughtCompleteness: "complete",
    actionIds,
    ...(applied.receipts.length ? { mutationReceipts: applied.receipts } : {}),
    ...(confirmation ? { receiptBackedCommit: confirmation } : {}),
    answerPath: "work_ledger",
    ...(planned.endCall && !applied.failures.length ? { endCall: true, endCallReason: "work_ledger_call_end" } : {}),
  };
  return { handled: true, result, plan: planned, applied, latencyMs };
}
