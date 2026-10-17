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
import { briefingClock, spokenDay } from "../briefing/briefingTiming";
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
import { ingestDaphneConversation } from "../../agents/daphne/conversationIngestion";
import {
  captureExplicitDaphnePreferenceCorrections,
  type DaphneExplicitPreferenceCaptureResult,
} from "../../agents/daphne/explicitPreferenceCorrection";

const HISTORY_LIMIT = 32;
/** Days of Day Line the planner can see and act on, starting today. */
export const LEDGER_HORIZON_DAYS = 14;

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
  /** False when the utterance is a forced flush of an unfinished thought; it is then never a durable preference. */
  inputComplete?: boolean;
};

export type WorkLedgerTurnDeps = {
  now: () => Date;
  planner: WorkLedgerPlannerDeps;
  apply: Partial<WorkLedgerApplyDeps>;
  readState: typeof getDayDirectorState;
  recordSignal: typeof recordWorkLedgerOperatorSignal;
  recordDaphneTurn: typeof recordLedgerTurnForDaphne;
};

export type WorkLedgerTurnOutcome =
  // A confirmation turn applies the closure Claire already asked about: no new plan is made.
  | { handled: true; result: ClaireTurnResult; plan?: WorkLedgerPlan; applied?: WorkLedgerApplyResult; latencyMs: number }
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
  savedIds: Set<string>,
  openOnlyAfter?: string
): Promise<LedgerDayLineItem[]> {
  const items: LedgerDayLineItem[] = [];
  const states = await Promise.all(
    dates.map(businessDate => deps.readState({ tenantId: input.tenantId, actorId: input.dayDirectorActorId, businessDate }))
  );
  for (const [index, state] of states.entries()) {
    const laterDay = openOnlyAfter != null && dates[index]! > openOnlyAfter;
    for (const row of state.commitments ?? []) {
      // Later days only matter for work that can still be moved, edited or closed.
      if (laterDay && row.status === "completed") continue;
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

/** Claire never promises an external action from the ledger: those need their own authorization. */
const PROMISED_EXTERNAL_ACTION =
  /\b(?:I'?ll|I will|I'm going to|let me|I can)\s+(?:go ahead and\s+)?(?:charge|text|message|send|email|call|ring|bill|refund|contact)\b|^\s*got it\s*[—–-]\s*(?:charge|text|send|call)\b/i;

export function cleanLedgerReply(reply: string): string {
  if (!reply.trim()) return "";
  const kept = reply
    .replace(/\s*\bsay yes or no\b\.?/gi, "")
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => sentence.trim() && !SELF_REPORTED_WRITE.test(sentence) && !PROMISED_EXTERNAL_ACTION.test(sentence))
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

const SAVE_STOP = new Set(["yes", "yeah", "save", "that", "this", "those", "them", "the", "to", "on", "day", "line", "now", "please", "put", "add", "it", "all", "of", "my", "and", "go", "ahead", "corrected", "work"]);

/** "Save that to the Day Line now", "put them on the line" — and not "don't save those yet". */
export function isExplicitSaveRequest(utterance: string): boolean {
  const text = utterance.toLowerCase();
  if (/\b(?:don'?t|do not|not yet|hold (?:off|on|those|them|it)|wait)\b/.test(text)) return false;
  return /\b(?:save|put|add|log|record)\b[^.?!]{0,80}\b(?:day ?line|the line|on the line|now)\b/.test(text) ||
    /^\s*(?:yes|yeah|yep|ok(?:ay)?)[,.!]?\s+(?:save|put|add)\b/.test(text);
}

function sharesContentWords(item: { title: string; quote: string }, utterance: string): boolean {
  const words = utterance.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(word => word.length > 3 && !SAVE_STOP.has(word));
  const target = `${item.title} ${item.quote}`.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
  return words.some(word => target.includes(word));
}

/** "Holding, not on the line yet: …" — what Claire is keeping for the operator, by day. */
export function speakHeldWork(held: WorkLedgerState["held"], today: string): string {
  const byDay = new Map<string, string[]>();
  for (const item of held) {
    const phrase = `${item.title.charAt(0).toLowerCase()}${item.title.slice(1)}${item.timing && !item.title.toLowerCase().includes(item.timing.toLowerCase()) ? ` ${item.timing}` : ""}`;
    byDay.set(item.businessDate, [...(byDay.get(item.businessDate) ?? []), phrase]);
  }
  const parts = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, phrases]) => `${date === today ? "today" : spokenDay(date, today)}: ${phrases.join("; ")}`);
  return parts.length ? `Holding, not on the line yet. ${parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(". ")}.` : "";
}

function remember(state: ClaireTurnState, speaker: "operator" | "claire", text: string, at: number): void {
  if (!text.trim()) return;
  state.history = [
    ...(state.history ?? []),
    { speaker, text: text.slice(0, 1_200), at, ...(speaker === "claire" ? { delivery: "generated" as const } : {}) },
  ].slice(-HISTORY_LIMIT);
}

const AFFIRMATIVE = /^(?:yes|yeah|yep|yup|correct|confirm(?:ed)?|sure|do it|go ahead|please do|that'?s right)\b/;
const QUALIFIER = /\b(?:no|not|don'?t|wait|but|except|actually|instead|only|hold)\b/;
const PLAIN_DECLINE = /^(?:no|nope|nah|don'?t|not yet|leave it|keep it|leave them|keep them)(?: thanks| thank you)?$/;
const words = (utterance: string) =>
  utterance.toLowerCase().replace(/[“”"’]/g, "'").replace(/[.,!?;:]+/g, " ").replace(/\s+/g, " ").trim();

/** A short, unqualified yes to Claire's own question: the only authorization that closes or removes work. */
export function isExplicitClosureAuthorization(utterance: string): boolean {
  const said = words(utterance);
  return AFFIRMATIVE.test(said) && !QUALIFIER.test(said) && said.split(" ").length <= 8;
}

export function isPlainClosureDecline(utterance: string): boolean {
  return PLAIN_DECLINE.test(words(utterance));
}

/** Claire's question before any completion or removal; it names every item exactly. */
export function closureQuestion(pending: NonNullable<WorkLedgerState["pendingClosure"]>): string {
  const quoted = (items: Array<{ title: string }>) => items.map(item => `"${item.title}"`).join(", ");
  const parts = [
    pending.complete.length ? `mark ${quoted(pending.complete)} done` : "",
    pending.remove.length ? `take ${quoted(pending.remove)} off your Day Line` : "",
  ].filter(Boolean);
  return `Before I change your Day Line: should I ${parts.join(" and ")}? Say yes to confirm.`;
}

/**
 * Daphne on a turn the ledger answered. Every surface (Claire turn, Desk, phone,
 * scheduled calls) returns the ledger's answer without reaching Claire's own Daphne
 * step, so "add the pickup, and stop calling me boss" saved the pickup and lost the
 * correction. Both writes are idempotent on (conversation, turn), so a surface that
 * also ingests after the turn (the phone adapter) records the turn once.
 */
export async function recordLedgerTurnForDaphne(input: {
  tenantId: string;
  operatorUserId: string;
  utterance: string;
  conversationKey: string;
  turnId: string;
  completed: boolean;
}): Promise<DaphneExplicitPreferenceCaptureResult | null> {
  await ingestDaphneConversation({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    utterance: input.utterance,
    conversationId: input.conversationKey,
    turnId: input.turnId,
    completed: input.completed,
  }).catch(() => null);
  if (!input.completed) return null;
  return captureExplicitDaphnePreferenceCorrections({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    utterance: input.utterance,
    conversationId: input.conversationKey,
    turnId: input.turnId,
  }).catch(() => null);
}

export async function runWorkLedgerTurn(
  input: WorkLedgerTurnInput,
  overrides: Partial<WorkLedgerTurnDeps> = {}
): Promise<WorkLedgerTurnOutcome> {
  const outcome = await runWorkLedgerTurnCore(input, overrides);
  if (!outcome.handled) return outcome;
  const record = overrides.recordDaphneTurn ?? recordLedgerTurnForDaphne;
  const captured = await record({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    utterance: input.utterance.trim(),
    conversationKey: input.conversationKey,
    // Same turn id Claire's own Daphne step uses, so the write is shared, not doubled.
    turnId: input.sourceEventId ?? `${input.conversationKey}:${(input.state.claireTurnCount ?? 0) + 1}`,
    completed: input.inputComplete !== false,
  }).catch(() => null);
  // Same read-back rule as the conversational path: only a verified save is spoken as saved.
  if (captured?.corrections.length && captured.status !== "disabled") {
    const readback = captured.readbackVerified
      ? "I'll remember that preference."
      : "I understood that preference, but I couldn't save it for next time.";
    return { ...outcome, result: { ...outcome.result, speak: `${outcome.result.speak} ${readback}`.trim() } };
  }
  return outcome;
}

async function runWorkLedgerTurnCore(
  input: WorkLedgerTurnInput,
  overrides: Partial<WorkLedgerTurnDeps> = {}
): Promise<WorkLedgerTurnOutcome> {
  const deps: WorkLedgerTurnDeps = {
    now: () => new Date(),
    planner: {},
    apply: {},
    readState: getDayDirectorState,
    recordSignal: recordWorkLedgerOperatorSignal,
    recordDaphneTurn: recordLedgerTurnForDaphne,
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
    // A fresh conversation must still see Friday's work to move or cancel it, not only
    // today, tomorrow and what this conversation saved.
    const horizon = Array.from({ length: LEDGER_HORIZON_DAYS }, (_, day) => addDaysYmd(clock.today, day));
    const dates = [...new Set([...horizon, ...(ledger.lastSaved ?? []).map(item => item.businessDate)])];
    dayLine = await loadDayLine(deps, input, dates, new Set(ledger.savedIds), tomorrow);
  } catch (error) {
    console.warn("[ClaireWorkLedger] Day Line read failed", error instanceof Error ? error.message : error);
    ledger.degradedAt = now.getTime();
    return { handled: false, reason: "planner_unavailable" };
  }

  // A completion or removal Claire asked about is applied only on the operator's explicit yes.
  const pending = ledger.pendingClosure ?? null;
  ledger.pendingClosure = null;
  if (pending && (isExplicitClosureAuthorization(utterance) || isPlainClosureDecline(utterance))) {
    const open = new Set(dayLine.filter(item => item.status === "open").map(item => item.id));
    const authorized = isExplicitClosureAuthorization(utterance);
    const applied = authorized
      ? await applyWorkLedgerPlan({
          plan: {
            workChanged: true,
            endCall: false,
            held: ledger.held,
            saveRefs: [],
            edits: [],
            completeIds: pending.complete.map(item => item.id).filter(id => open.has(id)),
            confirmIds: [],
            removeIds: pending.remove.filter(item => open.has(item.id)).map(item => ({ id: item.id, reason: item.reason })),
            reply: "",
            operatorSignal: { kind: "none", about: "", quote: "" },
            refused: [],
          },
          dayLine,
          target: {
            tenantId: input.tenantId,
            dayDirectorActorId: input.dayDirectorActorId,
            operatorUserId: input.operatorUserId,
            conversationKey: input.conversationKey,
          },
          clock: { today: clock.today, minutesNow: clock.minutesNow },
          deps: deps.apply,
        })
      : null;
    const speak = !applied
      ? "Okay, I left your Day Line as it was."
      : speakVerifiedLedgerChanges(applied, clock.today) ||
        (applied.failures.length ? "I couldn't change that just now. Want me to try again?" : "Those were already closed, so nothing changed.");
    remember(input.state, "operator", utterance, now.getTime());
    remember(input.state, "claire", speak, now.getTime() + 1);
    console.info("[ClaireWorkLedger]", {
      event: "claire_work_ledger_closure",
      authorized,
      conversationKey: input.conversationKey,
      completed: applied?.changes.filter(change => change.kind === "completed").length ?? 0,
      removed: applied?.changes.filter(change => change.kind === "removed").length ?? 0,
      failures: applied?.failures.length ?? 0,
    });
    const result: ClaireTurnResult = {
      speak,
      kind: applied?.changes.length ? "briefing_saved" : "answered",
      assembledUtterance: utterance,
      thoughtCompleteness: "complete",
      actionIds: applied?.changes.map(change => change.id) ?? [],
      ...(applied?.receipts.length ? { mutationReceipts: applied.receipts } : {}),
      answerPath: "work_ledger",
    };
    return { handled: true, result, ...(applied ? { applied } : {}), latencyMs: Date.now() - startedAt };
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

  // The operator's explicit authority wins over a plan that forgot it: "Yes, save that
  // corrected dry-cleaning work to the Day Line now" must save the held work it names
  // (live replay 2026-10-16: the plan saved nothing about one run in three).
  if (isExplicitSaveRequest(utterance) && !planned.saveRefs.length && !planned.edits.length && !planned.completeIds.length) {
    const candidates = planned.held.length ? planned.held : ledger.held;
    const named = candidates.filter(item => sharesContentWords(item, utterance));
    const toSave = named.length ? named : candidates;
    if (toSave.length) {
      for (const item of toSave) if (!planned.held.some(kept => kept.ref === item.ref)) planned.held.push(item);
      planned.saveRefs = toSave.map(item => item.ref);
      planned.workChanged = true;
      planned.refused.push(`explicit save guard: saving ${toSave.length} held item(s) the plan left unsaved`);
    }
  }

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

  // The plan's completions and removals are a model's reading of the conversation, so they
  // wait for the operator's explicit yes (release review 2026-10-17). Saves and edits proceed.
  const titleOf = new Map(dayLine.map(item => [item.id, item.title]));
  const closure: NonNullable<WorkLedgerState["pendingClosure"]> = {
    complete: planned.completeIds.map(id => ({ id, title: titleOf.get(id) ?? id })),
    remove: planned.removeIds.map(entry => ({ id: entry.id, title: titleOf.get(entry.id) ?? entry.id, reason: entry.reason })),
  };
  const asksClosure = closure.complete.length + closure.remove.length > 0;
  if (asksClosure) {
    planned.refused.push(`closure awaits operator confirmation: ${closure.complete.length} complete, ${closure.remove.length} remove`);
    planned.completeIds = [];
    planned.removeIds = [];
    planned.workChanged = true;
    // Whatever the model meant to say may describe the closure as done; Claire asks instead.
    planned.reply = "";
  }

  // A "work" turn that changes nothing, holds nothing new and reads nothing back would only
  // produce an empty "Got it." that sounds like a promise (live replay: "charge the Opus order
  // when it comes in"). Hand it to the conversational pipeline, which can say what it can do.
  const heldShape = (items: typeof ledger.held) => JSON.stringify(items.map(item => [item.title, item.businessDate, item.executionType, item.timing]));
  const heldBeforeItems = [...ledger.held];
  const heldBefore = heldShape(ledger.held);
  const heldAfter = heldShape(planned.held);
  const changesNothing =
    planned.workChanged &&
    !planned.endCall &&
    !planned.saveRefs.length &&
    !planned.edits.length &&
    !planned.completeIds.length &&
    !planned.removeIds.length &&
    !planned.confirmIds.length &&
    !asksClosure &&
    heldBefore === heldAfter;
  if (changesNothing) {
    console.info("[ClaireWorkLedger]", {
      event: "claire_work_ledger_turn", handled: false, reason: "no_operations", conversationKey: input.conversationKey,
      refused: planned.refused, heldTitles: planned.held.map(item => item.title), saveRefs: planned.saveRefs,
    });
    return { handled: false, reason: "not_work", plan: planned };
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
  // Held work that changed but is not saved is read back too, so a correction to it is
  // never answered with silence or "nothing saved" (CI replay 2026-10-16).
  // Only what is new or changed this turn: re-reading the whole held list every turn is noise.
  const previousShape = new Map(heldBeforeItems.map(item => [item.ref, heldShape([item])]));
  const changedHeld = ledger.held.filter(item => previousShape.get(item.ref) !== heldShape([item]));
  const heldReadback = !applied.changes.length && changedHeld.length ? speakHeldWork(changedHeld, clock.today) : "";
  const reply = cleanLedgerReply(planned.reply);
  // A detail-only edit is verified but not read aloud, so an empty confirmation is not "nothing saved".
  const fallback = planned.endCall
    ? "Talk soon."
    : applied.changes.length
      ? "Got it, noted on the line."
      : applied.failures.length
        ? "I couldn't save that just now. Want me to try again?"
        : "I haven't saved or carried out anything from that instruction.";
  if (asksClosure) ledger.pendingClosure = closure;
  const speak =
    [confirmation, heldReadback, reply, asksClosure ? closureQuestion(closure) : ""].filter(Boolean).join(" ").trim() || fallback;

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
