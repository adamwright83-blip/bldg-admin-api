/**
 * Executes a validated work-ledger plan through the existing Day Director
 * writers, then reads the Day Line back. Only what the readback shows is
 * reported as done; the spoken confirmation is rendered from that readback,
 * never from the model's plan.
 */
import { commitBriefing, type BriefingCommitResult } from "../briefing/briefingCommit";
import { parseTiming, spokenDay } from "../briefing/briefingTiming";
import type { BriefingItem, ParsedBriefing } from "../briefing/briefingTypes";
import type { MutationReceipt } from "../assertionGuard";
import {
  completeDayDirectorCommitment,
  getDayDirectorState,
  moveDayDirectorCommitment,
  updateDayDirectorCommitment,
} from "../../planning/dayDirector/dayDirectorService";
import { cancelDayLineItem, editDayLineItem } from "../../planning/dayline/dayLineMutationService";
import { joinList } from "../business/businessSpeech";
import type { DayLineItemRef } from "../../../shared/goldlineDayLine";
import type {
  LedgerDayLineItem,
  LedgerExecutionType,
  LedgerHeldItem,
  WorkLedgerPlan,
} from "./workLedgerPlanner";

export type WorkLedgerTarget = {
  tenantId: string;
  dayDirectorActorId: string;
  operatorUserId: string;
  conversationKey: string;
};

export type WorkLedgerApplyDeps = {
  commit: typeof commitBriefing;
  update: typeof updateDayDirectorCommitment;
  complete: typeof completeDayDirectorCommitment;
  edit: typeof editDayLineItem;
  cancel: typeof cancelDayLineItem;
  move: typeof moveDayDirectorCommitment;
  readState: typeof getDayDirectorState;
};

export function defaultWorkLedgerApplyDeps(): WorkLedgerApplyDeps {
  return {
    commit: commitBriefing,
    update: updateDayDirectorCommitment,
    complete: completeDayDirectorCommitment,
    edit: editDayLineItem,
    cancel: cancelDayLineItem,
    move: moveDayDirectorCommitment,
    readState: getDayDirectorState,
  };
}

export type VerifiedLedgerChange =
  | { kind: "created"; id: string; title: string; businessDate: string; executionType: LedgerExecutionType; timing: string; ref: string }
  | { kind: "updated"; id: string; title: string; businessDate: string; executionType: LedgerExecutionType; previousTitle: string; what: string[] }
  | { kind: "moved"; id: string; title: string; businessDate: string; fromDate: string }
  | { kind: "completed"; id: string; title: string; businessDate: string }
  | { kind: "removed"; id: string; title: string; businessDate: string; reason: string }
  | { kind: "confirmed"; id: string; title: string; businessDate: string; executionType: LedgerExecutionType; status: string };

export type WorkLedgerApplyResult = {
  changes: VerifiedLedgerChange[];
  failures: Array<{ title: string; error: string }>;
  receipts: MutationReceipt[];
  /** Held refs that are now on the Day Line. */
  savedRefs: string[];
  savedIds: string[];
};

function dayLineRef(item: LedgerDayLineItem): DayLineItemRef {
  return {
    sourceType: "day_director_commitment",
    sourceId: item.id,
    displayTitle: item.title,
    accountName: item.title,
    actionId: item.id,
    editableCapabilities: ["dayline.edit", "dayline.cancel", "dayline.complete"],
    status: item.status === "completed" ? "completed" : "active",
  };
}

function briefingItemFor(held: { title: string; quote: string; businessDate: string; timing: string; executionType: LedgerExecutionType }, today: string, minutesNow: number): BriefingItem {
  const timing = held.timing
    ? parseTiming(held.timing, { isToday: held.businessDate === today, minutesNow }).timing
    : { kind: "none" as const };
  return {
    kind: "new_work",
    title: held.title,
    quote: held.quote,
    businessDate: held.businessDate,
    timing: timing.kind === "none" && held.timing
      ? { kind: "daypart", label: held.timing }
      : timing.kind !== "none" && !/\b(?:a\.?m\.?|p\.?m\.?|morning|afternoon|evening|tonight|noon|midnight)\b/i.test(held.timing)
        // "at 11" said without am/pm: the clock guess ("11 PM" after 11 AM) is not the operator's
        // meaning. Keep their words as the label; the inferred start stays for ordering only.
        ? { ...timing, label: held.timing }
        : timing,
    quantity: null,
    people: [],
    place: null,
    needs: null,
    existing: null,
    executionType: held.executionType,
  };
}

function detailNoteFor(detail: string): string | null {
  const text = detail.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 900) : null;
}

type Readback = Map<string, { id: string; title: string; businessDate: string; status: string; executionType: LedgerExecutionType; detailNote: string | null; scheduleLabel: string | null }>;

async function readBack(deps: WorkLedgerApplyDeps, target: WorkLedgerTarget, dates: string[]): Promise<Readback> {
  const map: Readback = new Map();
  for (const businessDate of Array.from(new Set(dates))) {
    const state = await deps.readState({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, businessDate });
    for (const row of state.commitments ?? []) {
      map.set(row.id, {
        id: row.id,
        title: row.title,
        businessDate: row.businessDate,
        status: row.status,
        executionType: (row as { executionType?: LedgerExecutionType }).executionType ?? null,
        detailNote: row.detailNote ?? null,
        scheduleLabel: row.scheduleLabel ?? null,
      });
    }
  }
  return map;
}

export async function applyWorkLedgerPlan(input: {
  plan: WorkLedgerPlan;
  dayLine: LedgerDayLineItem[];
  target: WorkLedgerTarget;
  clock: { today: string; minutesNow: number };
  deps?: Partial<WorkLedgerApplyDeps>;
}): Promise<WorkLedgerApplyResult> {
  const deps: WorkLedgerApplyDeps = { ...defaultWorkLedgerApplyDeps(), ...input.deps };
  const { plan, target, clock } = input;
  const byId = new Map(input.dayLine.map(item => [item.id, item]));
  const failures: WorkLedgerApplyResult["failures"] = [];
  const expected: Array<
    | { kind: "created"; id: string; ref: string; held: LedgerHeldItem }
    | { kind: "updated"; id: string; previous: LedgerDayLineItem; title: string | null; executionType: LedgerExecutionType | "unchanged"; detailNote: string | null; scheduleLabel: string | null }
    | { kind: "moved"; id: string; previous: LedgerDayLineItem; toDate: string; newId: string }
    | { kind: "completed"; id: string; previous: LedgerDayLineItem }
    | { kind: "removed"; id: string; previous: LedgerDayLineItem; reason: string }
  > = [];
  const touchedDates = new Set<string>();

  // 1. New work the operator authorized. One write per item so each id maps to its item.
  const toSave = plan.held.filter(item => plan.saveRefs.includes(item.ref));
  for (const held of toSave) {
    const parsed: ParsedBriefing = {
      items: [briefingItemFor(held, clock.today, clock.minutesNow)],
      context: [],
      questions: [],
      unparsed: [],
      source: "model",
    };
    let result: BriefingCommitResult;
    try {
      result = await deps.commit(parsed, {
        tenantId: target.tenantId,
        dayDirectorActorId: target.dayDirectorActorId,
        conversationKey: `${target.conversationKey}:ledger`,
        vehicleId: target.operatorUserId,
      });
    } catch (error) {
      failures.push({ title: held.title, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const id = result.commitmentIds[0];
    if (result.failed.length || !id) {
      failures.push({ title: held.title, error: result.failed[0]?.error ?? "Day Line write returned no id" });
      continue;
    }
    const note = detailNoteFor(held.detail);
    if (note) {
      await deps
        .update({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, commitmentId: id, patch: { detailNote: note } })
        .catch(error => console.warn("[ClaireWorkLedger] detail note not saved", error instanceof Error ? error.message : error));
    }
    expected.push({ kind: "created", id, ref: held.ref, held });
    touchedDates.add(held.businessDate);
  }

  // 2. Changes to work already on the line.
  for (const edit of plan.edits) {
    const previous = byId.get(edit.id);
    if (!previous) continue;
    try {
      if (edit.moveTo) {
        // Move in place: one conditional write keeps the same item, id and details.
        // Creating a new item and cancelling the old one could leave the work on both
        // days if the second write failed, and dropped the detail note.
        const moved = await deps.move({
          tenantId: target.tenantId,
          actorId: target.dayDirectorActorId,
          commitmentId: previous.id,
          fromBusinessDate: previous.businessDate,
          toBusinessDate: edit.moveTo,
        });
        if (!moved) throw new Error("the item changed before it could be moved");
        expected.push({ kind: "moved", id: previous.id, previous, toDate: edit.moveTo, newId: previous.id });
        touchedDates.add(previous.businessDate);
        touchedDates.add(edit.moveTo);
        const movedItem = { ...previous, businessDate: edit.moveTo };
        if (edit.title) {
          await deps
            .edit({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, item: dayLineRef(movedItem), actionTitle: edit.title })
            .catch(error => failures.push({ title: previous.title, error: `moved, but the new title did not save: ${error instanceof Error ? error.message : String(error)}` }));
        }
        const patch: Parameters<typeof updateDayDirectorCommitment>[0]["patch"] = {};
        if (edit.executionType !== "unchanged") patch.executionType = edit.executionType;
        if (edit.timing) patch.scheduleLabel = edit.timing;
        if (Object.keys(patch).length) {
          await deps
            .update({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, commitmentId: previous.id, patch })
            .catch(error => failures.push({ title: previous.title, error: `moved, but the timing did not save: ${error instanceof Error ? error.message : String(error)}` }));
        }
        continue;
      }
      if (edit.title) {
        await deps.edit({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, item: dayLineRef(previous), actionTitle: edit.title });
      }
      const patch: Parameters<typeof updateDayDirectorCommitment>[0]["patch"] = {};
      if (edit.executionType !== "unchanged") patch.executionType = edit.executionType;
      const note = edit.detail ? detailNoteFor(edit.detail) : null;
      if (note) patch.detailNote = note;
      if (edit.timing) patch.scheduleLabel = edit.timing;
      if (Object.keys(patch).length) {
        await deps.update({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, commitmentId: previous.id, patch });
      }
      expected.push({
        kind: "updated",
        id: previous.id,
        previous,
        title: edit.title,
        executionType: edit.executionType,
        detailNote: note,
        scheduleLabel: edit.timing,
      });
      touchedDates.add(previous.businessDate);
    } catch (error) {
      failures.push({ title: previous.title, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 3. Done and removed.
  for (const id of plan.completeIds) {
    const previous = byId.get(id);
    if (!previous) continue;
    try {
      await deps.complete({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, commitmentId: id });
      expected.push({ kind: "completed", id, previous });
      touchedDates.add(previous.businessDate);
    } catch (error) {
      failures.push({ title: previous.title, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const removal of plan.removeIds) {
    const previous = byId.get(removal.id);
    if (!previous) continue;
    try {
      await deps.cancel({ tenantId: target.tenantId, actorId: target.dayDirectorActorId, item: dayLineRef(previous), reason: removal.reason || null });
      expected.push({ kind: "removed", id: removal.id, previous, reason: removal.reason });
      touchedDates.add(previous.businessDate);
    } catch (error) {
      failures.push({ title: previous.title, error: error instanceof Error ? error.message : String(error) });
    }
  }

  // 4. Read the Day Line back. Nothing is reported that the readback does not show.
  const confirmTargets = plan.confirmIds
    .map(id => byId.get(id))
    .filter((item): item is LedgerDayLineItem => Boolean(item))
    .filter(item => !expected.some(entry => entry.id === item.id && entry.kind !== "updated"));
  for (const item of confirmTargets) touchedDates.add(item.businessDate);
  const changes: VerifiedLedgerChange[] = [];
  const receipts: MutationReceipt[] = [];
  const savedRefs: string[] = [];
  const savedIds: string[] = [];
  if (expected.length || confirmTargets.length) {
    let rows: Readback;
    try {
      rows = await readBack(deps, target, Array.from(touchedDates));
    } catch (error) {
      for (const entry of expected) {
        const title = entry.kind === "created" ? entry.held.title : entry.previous.title;
        failures.push({ title, error: `readback failed: ${error instanceof Error ? error.message : String(error)}` });
      }
      return { changes, failures, receipts, savedRefs, savedIds };
    }
    for (const entry of expected) {
      if (entry.kind === "created") {
        const row = rows.get(entry.id);
        if (!row || (entry.held.executionType && row.executionType !== entry.held.executionType)) {
          failures.push({ title: entry.held.title, error: "Day Line readback did not show the saved item" });
          continue;
        }
        changes.push({ kind: "created", id: row.id, title: row.title, businessDate: row.businessDate, executionType: row.executionType, timing: entry.held.timing, ref: entry.ref });
        receipts.push({ claimedState: "created", entityId: row.id, statement: `Added ${row.title} on the Day Line` });
        savedRefs.push(entry.ref);
        savedIds.push(row.id);
        continue;
      }
      if (entry.kind === "updated") {
        const row = rows.get(entry.id);
        const titleOk = !entry.title || row?.title === entry.title;
        const typeOk = entry.executionType === "unchanged" || row?.executionType === entry.executionType;
        const noteOk = !entry.detailNote || row?.detailNote === entry.detailNote;
        if (!row || !titleOk || !typeOk || !noteOk) {
          failures.push({ title: entry.previous.title, error: "Day Line readback did not show the change" });
          continue;
        }
        const what = [
          entry.title ? "title" : null,
          entry.executionType !== "unchanged" ? "type" : null,
          entry.detailNote ? "detail" : null,
        ].filter((value): value is string => Boolean(value));
        changes.push({ kind: "updated", id: row.id, title: row.title, businessDate: row.businessDate, executionType: row.executionType, previousTitle: entry.previous.title, what });
        receipts.push({ claimedState: "updated", entityId: row.id, statement: `Updated ${row.title} on the Day Line` });
        continue;
      }
      if (entry.kind === "moved") {
        const fresh = rows.get(entry.newId);
        // An in-place move keeps its id, so the proof is the new date, not the old id's absence.
        const stale = entry.newId !== entry.id && rows.get(entry.id);
        if (!fresh || stale || fresh.businessDate !== entry.toDate) {
          failures.push({ title: entry.previous.title, error: "Day Line readback did not show the move" });
          continue;
        }
        changes.push({ kind: "moved", id: fresh.id, title: fresh.title, businessDate: fresh.businessDate, fromDate: entry.previous.businessDate });
        receipts.push({ claimedState: "updated", entityId: fresh.id, statement: `Moved ${fresh.title} to ${fresh.businessDate}` });
        savedIds.push(fresh.id);
        continue;
      }
      if (entry.kind === "completed") {
        const row = rows.get(entry.id);
        if (!row || row.status !== "completed") {
          failures.push({ title: entry.previous.title, error: "Day Line readback did not show it done" });
          continue;
        }
        changes.push({ kind: "completed", id: row.id, title: row.title, businessDate: row.businessDate });
        receipts.push({ claimedState: "completed", entityId: row.id, statement: `Marked ${row.title} done` });
        continue;
      }
      const row = rows.get(entry.id);
      if (row) {
        failures.push({ title: entry.previous.title, error: "Day Line readback still shows the item" });
        continue;
      }
      changes.push({ kind: "removed", id: entry.id, title: entry.previous.title, businessDate: entry.previous.businessDate, reason: entry.reason });
      receipts.push({ claimedState: "removed", entityId: entry.id, statement: `Removed ${entry.previous.title} from the Day Line` });
    }
    for (const item of confirmTargets) {
      const row = rows.get(item.id);
      if (!row) continue;
      changes.push({ kind: "confirmed", id: row.id, title: row.title, businessDate: row.businessDate, executionType: row.executionType, status: row.status });
    }
  }
  return { changes, failures, receipts, savedRefs, savedIds };
}

function lowerFirst(text: string): string {
  if (!text) return text;
  // Keep acronyms and proper names ("KITH", "Laundry Farm") as said.
  const first = text.split(/\s+/)[0] ?? "";
  if (/^[A-Z]{2,}/.test(first) || /^[A-Z][a-z]+[A-Z]/.test(first)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function typePhrase(type: LedgerExecutionType): string {
  if (type === "challenge") return " as a marketing challenge";
  if (type === "mission") return " as a sales mission";
  if (type === "hybrid_objective") return " as a hybrid objective";
  return "";
}

function dayLabel(ymd: string, today: string): string {
  const label = spokenDay(ymd, today);
  if (label === "today") return "today's line";
  if (label === "tomorrow") return "tomorrow's line";
  return `the line for ${label}`;
}

/**
 * The receipt-backed sentence Claire speaks for verified changes, in plain
 * spoken English: "On today's line: check whether the three dry-cleaning
 * orders were charged, and deliver two of them tonight."
 */
export function speakVerifiedLedgerChanges(result: WorkLedgerApplyResult, today: string): string {
  const sentences: string[] = [];
  const created = result.changes.filter((change): change is Extract<VerifiedLedgerChange, { kind: "created" }> => change.kind === "created");
  const byDate = new Map<string, typeof created>();
  for (const change of created) byDate.set(change.businessDate, [...(byDate.get(change.businessDate) ?? []), change]);
  for (const [date, items] of Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const phrases = items.map(item => `${lowerFirst(item.title)}${typePhrase(item.executionType)}`);
    sentences.push(`On ${dayLabel(date, today)}: ${joinList(phrases)}.`);
  }
  const completed = result.changes.filter(change => change.kind === "completed");
  if (completed.length) sentences.push(`Marked done: ${joinList(completed.map(change => lowerFirst(change.title)))}.`);
  const updatedIds = new Set<string>();
  for (const change of result.changes) {
    if (change.kind === "updated") {
      const renamed = change.what.includes("title") && change.previousTitle !== change.title;
      const typed = change.what.includes("type");
      // A detail-only update is recorded but not read aloud; it is not news to the operator.
      if (!renamed && !typed) continue;
      updatedIds.add(change.id);
      if (renamed) sentences.push(`Now it reads: ${lowerFirst(change.title)}${typed ? typePhrase(change.executionType) : ""}, on ${dayLabel(change.businessDate, today)}.`);
      else sentences.push(`${change.title} is on ${dayLabel(change.businessDate, today)}${change.executionType ? typePhrase(change.executionType) : " with no classification"}.`);
    } else if (change.kind === "moved") {
      sentences.push(`Moved ${lowerFirst(change.title)} to ${dayLabel(change.businessDate, today)}.`);
    }
  }
  const confirmed = result.changes.filter(
    (change): change is Extract<VerifiedLedgerChange, { kind: "confirmed" }> => change.kind === "confirmed" && !updatedIds.has(change.id)
  );
  if (confirmed.length === 1) {
    const only = confirmed[0]!;
    sentences.push(
      only.status === "completed"
        ? `${only.title} is already marked done.`
        : `${only.title} is on ${dayLabel(only.businessDate, today)}${typePhrase(only.executionType)}.`
    );
  } else if (confirmed.length > 1) {
    const byDay = new Map<string, typeof confirmed>();
    for (const change of confirmed) byDay.set(change.businessDate, [...(byDay.get(change.businessDate) ?? []), change]);
    const parts = Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => {
        const label = spokenDay(date, today);
        const phrases = items.map(item => `${lowerFirst(item.title)}${item.status === "completed" ? " (done)" : typePhrase(item.executionType)}`);
        return `${label === "today" ? "Today" : label === "tomorrow" ? "Tomorrow" : label.charAt(0).toUpperCase() + label.slice(1)}: ${joinList(phrases)}.`;
      });
    sentences.push(`Here's what I have. ${parts.join(" ")}`);
  }
  const removed = result.changes.filter(change => change.kind === "removed");
  if (removed.length) {
    sentences.push(
      removed.length > 2
        ? `Took ${removed.length} stray items off the line.`
        : `Took ${joinList(removed.map(change => `"${change.title}"`))} off the line.`
    );
  }
  if (result.failures.length) {
    const titles = Array.from(new Set(result.failures.map(failure => lowerFirst(failure.title))));
    sentences.push(
      result.changes.length
        ? `But ${joinList(titles)} didn't save, so I'm still holding ${titles.length === 1 ? "it" : "those"}. Want me to try again?`
        : `I couldn't verify the save for ${joinList(titles)}, so nothing changed there. Want me to try again?`
    );
  }
  return sentences.join(" ");
}
