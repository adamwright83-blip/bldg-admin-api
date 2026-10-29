/**
 * Claire prototype tools — the model-facing interface to the Day Line, the
 * ledger and standing instructions, built on the production services and
 * their authorization (Day Line admission, tenant scoping, canonical identity).
 *
 * Design follows Anthropic's tool guidance: few tools, each a complete
 * workflow; `apply_day_line_changes` takes a whole batch and returns one
 * receipt per item, including refusals and partial failures, so the model can
 * say exactly what landed. The server resolves spoken days to business dates
 * and refuses vague ones; the model never guesses a calendar date.
 *
 * Nothing here is wired into production Claire. It is exercised by the
 * evaluation runner against a disposable database.
 */
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { defaultBusinessQuery, runBusinessQuery, type BusinessMetric } from "../../analytics/businessQuery";
import type { PeriodSpec } from "../../analytics/businessPeriods";
import {
  acceptProposalWithReceipt,
  completeDayDirectorCommitment,
  getDayDirectorState,
  listOpenDayDirectorCommitmentsBetween,
  moveDayDirectorCommitment,
  updateDayDirectorCommitment,
} from "../../planning/dayDirector/dayDirectorService";
import { DayLineAdmissionRefusedError, operatorInstructionAdmission } from "../../planning/dayDirector/dayLineAdmission";
import { removeDayDirectorCommitmentsFromDay } from "../../planning/dayline/dayLineMutationService";
import { authorizeExistingRowChange, changesOutsideOffer, offerText, verifyOperatorAuthorization } from "./authorization";
import { drizzleStandingInstructionStore, type StandingInstructionStore } from "../../agents/daphne/standingInstructions";
import { addDaysYmd, businessDateToday, resolveSpokenDate, spokenDay } from "./spokenDate";
import { matchWork, plausibleSameWork } from "./workMatch";

export type ToolContext = {
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  canonicalOperatorId: string;
  timeZone: string;
  now: () => Date;
  conversationId: string;
  /** A new id per tool call, for admission sourceRef and standing-instruction provenance. */
  nextTurnId: () => string;
  /** Everything the operator has said on this call, oldest first. Authorization quotes are checked against it. */
  operatorTurns: () => readonly string[];
  /** Claire's last spoken line before the operator's latest turn; a bare "yes" binds to the offer it made and the work it named. */
  lastClaireText: () => string | null;
  /** Ids of rows this call added. Anything else on the Day Line predates the call and is changed only on an explicit, named instruction. */
  callRowIds: Set<string>;
  standingInstructionStore?: StandingInstructionStore;
};

export type DayLineRow = { id: string; title: string; status: "open" | "completed"; businessDate: string; detail: string | null };

export type ChangeReceipt = {
  index: number;
  op: "add" | "move" | "remove" | "complete";
  title: string;
  status: "applied" | "already_present" | "needs_resolution" | "refused" | "not_found" | "ambiguous" | "failed";
  id: string | null;
  businessDate: string | null;
  day: string | null;
  reason: string | null;
};

export type ToolEvent = {
  name: string;
  input: unknown;
  output: unknown;
  /** True when the call changed the database. */
  wrote: boolean;
  latencyMs: number;
};

const METRICS = ["revenue", "orders", "aov", "active_customers", "new_customers", "dormant_customers", "top_customers", "latest_sales", "biggest_orders", "open_orders"] as const satisfies readonly BusinessMetric[];
const PERIODS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "this_year", "trailing_days", "all_time"] as const;

export const CLAIRE_PROTOTYPE_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_day_line",
    description:
      "Read the operator's Day Line (their committed work) for one day. Returns every open and completed row with its id. Use it to answer 'what's on tomorrow', to check what is already there before adding, and to find the row an operator means when they ask to move, finish or remove something.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: "The day in the operator's words: 'today', 'tomorrow', 'Friday', 'next Tuesday', 'the 3rd', or YYYY-MM-DD. A bare weekday means the coming one (said on that same weekday, next week's); pass it as said and read the resolved date back." },
      },
      required: ["day"],
      additionalProperties: false,
    },
  },
  {
    name: "find_day_line_item",
    description:
      "Find existing work on the Day Line by what the operator calls it, across days (two weeks back to six weeks ahead by default). Returns candidate rows with id, title, date and status. Use it BEFORE moving, finishing, removing or re-adding anything the operator refers to as already existing ('move the Dubois job', 'put it back', 'the Medeco order'), when you do not already know its day. Never add a new row for work that is already on the Day Line; find it and change it.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The work as the operator described it, e.g. 'the Dubois regulation' or 'Medeco cylinder order'." },
        days_back: { type: "integer", minimum: 0, maximum: 60, description: "How many days before today to search (default 14)." },
        days_ahead: { type: "integer", minimum: 0, maximum: 120, description: "How many days after today to search (default 42)." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "apply_day_line_changes",
    description:
      "Write the operator's authorized Day Line changes in one batch: add new work, move a row to another day, mark a row completed, or take a row off a day. Call it once with every item the operator has authorized, in the order they belong. You must quote the operator's authorizing words in operator_words; the server checks they were actually said on this call, and a bare 'yes' only counts right after you asked a question. Work the operator merely mentioned ('I might…', 'at some point I should…') is not authorized until they tell you to put it on or say yes to your offer. Rows that were on the Day Line before this call are changed (move/complete/remove) only when the operator names that item and says what to do with it; 'I didn't say anything about X' is not 'take X off', and the server will refuse: ask them. Each change gets its own receipt: 'applied' means it is on the Day Line now; 'already_present' means an equivalent open row was already there and nothing was duplicated; 'refused' means the day was ambiguous or the write was not allowed; 'not_found'/'ambiguous' mean the row to move/complete/remove could not be identified (read the day and retry with the id). Only say something is saved when its receipt says applied or already_present.",
    input_schema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["add", "move", "remove", "complete"] },
              title: {
                type: "string",
                description: "For add: a short imperative title in the operator's terms (e.g. 'Pick up the Gentiles' laundry at Opus'). For move/remove/complete: the row id from read_day_line, or enough of the existing title to identify it. 'remove' takes the row off that day only; it does not abandon the work.",
              },
              day: { type: "string", description: "The day the row is on (move/remove/complete) or should be added to (add), in the operator's words. A bare weekday is a date: pass it as said ('Thursday'), the server resolves it (on a Thursday, next week's), and you read the date back." },
              to_day: { type: "string", description: "move only: the day to move it to, in the operator's words." },
              detail: {
                type: "string",
                description: "add only, optional: timing or sequence the operator gave ('flexible, usually 9 or 10 PM', 'after the Wilshire Vermont stop', 'then drop the towels at Opus'). Never invent a time.",
              },
              operator_words: {
                type: "string",
                description: "Optional, for a move/complete/remove of work that predates this call: the operator's exact words naming this item and the action ('take the Pham session off tomorrow'). Defaults to the batch's operator_words.",
              },
              confirm_new: {
                type: "boolean",
                description: "add only: set true when the operator confirmed this is a separate job even though similar work exists on another day (a recurring job, a second visit). Without it, an add that looks like existing work on another day is returned as needs_resolution instead of creating a duplicate.",
              },
            },
            required: ["op", "title", "day"],
            additionalProperties: false,
          },
        },
        operator_words: {
          type: "string",
          description: "The operator's exact words that authorize this batch, copied from what they said on this call (e.g. 'Put them on tomorrow's day line' or 'Yes').",
        },
      },
      required: ["changes", "operator_words"],
      additionalProperties: false,
    },
  },
  {
    name: "read_business_numbers",
    description:
      "Read verified business figures from the ledger: revenue, orders, average order value, active/new/dormant customers, top customers, latest or biggest orders, open orders. Returns the period actually covered and the records. If it returns no records or 'unavailable', say that plainly; never state a figure that did not come from this tool.",
    input_schema: {
      type: "object",
      properties: {
        metric: { type: "string", enum: [...METRICS] },
        period: { type: "string", enum: [...PERIODS] },
        trailing_days: { type: "integer", minimum: 1, maximum: 365, description: "Only with period 'trailing_days'." },
      },
      required: ["metric", "period"],
      additionalProperties: false,
    },
  },
  {
    name: "save_standing_instruction",
    description:
      "Save a durable rule the operator gives about how you behave on calls ('from now on don't bring up X', 'keep it short', 'always start with tomorrow'). The rule binds this call and every later call until the operator revokes it. Returns whether it is now active.",
    input_schema: {
      type: "object",
      properties: {
        rule: { type: "string", description: "The rule in plain terms you will follow." },
        operator_words: { type: "string", description: "What the operator actually said." },
      },
      required: ["rule", "operator_words"],
      additionalProperties: false,
    },
  },
  {
    name: "end_call",
    description: "Call this when the operator is done (they say bye, that's all, hang up). Your final text is spoken before the line closes.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|at|to|for|of|and|then|my|our|up|in|on)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameWork(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const shared = [...ta].filter(token => tb.has(token)).length;
  return shared >= 2 && shared / Math.min(ta.size, tb.size) >= 0.8;
}

export async function readDayLineRows(ctx: ToolContext, businessDate: string): Promise<DayLineRow[]> {
  const state = await getDayDirectorState({ tenantId: ctx.tenantId, actorId: ctx.dayDirectorActorId, businessDate });
  return state.commitments.map(row => ({
    id: row.id,
    title: row.title,
    status: row.status === "completed" ? "completed" : "open",
    businessDate: row.businessDate,
    detail: row.detailNote ?? null,
  }));
}

function findRow(rows: DayLineRow[], key: string): { kind: "one"; row: DayLineRow } | { kind: "none" } | { kind: "many"; rows: DayLineRow[] } {
  const byId = rows.find(row => row.id === key.trim());
  if (byId) return { kind: "one", row: byId };
  const matches = rows.filter(row => sameWork(row.title, key));
  if (matches.length === 1) return { kind: "one", row: matches[0]! };
  if (matches.length === 0) {
    const loose = rows.filter(row => normalizeTitle(row.title).includes(normalizeTitle(key)) || normalizeTitle(key).split(" ").some(token => token.length >= 4 && normalizeTitle(row.title).includes(token)));
    if (loose.length === 1) return { kind: "one", row: loose[0]! };
    if (loose.length > 1) return { kind: "many", rows: loose };
    return { kind: "none" };
  }
  return { kind: "many", rows: matches };
}

type Change = { op: ChangeReceipt["op"]; title: string; day: string; to_day?: string; detail?: string; operator_words?: string; confirm_new?: boolean };

export type FoundRow = DayLineRow & { match: { sharedNames: string[]; sharedWords: string[] } };

/** Existing open work that plausibly matches `query`, across a bounded window, best matches first. */
export async function findDayLineItems(ctx: ToolContext, query: string, window: { daysBack?: number; daysAhead?: number } = {}): Promise<{ from: string; through: string; candidates: FoundRow[] }> {
  const today = businessDateToday(ctx.now(), ctx.timeZone);
  const from = addDaysYmd(today, -(window.daysBack ?? 14));
  const through = addDaysYmd(today, window.daysAhead ?? 42);
  const rows = await listOpenDayDirectorCommitmentsBetween({ tenantId: ctx.tenantId, actorIds: [ctx.dayDirectorActorId], fromBusinessDate: from, throughBusinessDate: through });
  const candidates = rows
    .map(row => ({ row, match: matchWork(query, row.title) }))
    .filter(item => item.match.candidate)
    .sort((a, b) => b.match.sharedProper.length + b.match.sharedStems.length - (a.match.sharedProper.length + a.match.sharedStems.length) || a.row.businessDate.localeCompare(b.row.businessDate))
    .slice(0, 8)
    .map(item => ({ id: item.row.id, title: item.row.title, status: "open" as const, businessDate: item.row.businessDate, detail: null, match: { sharedNames: item.match.sharedProper, sharedWords: item.match.sharedStems } }));
  return { from, through, candidates };
}

export async function applyDayLineChanges(
  ctx: ToolContext,
  changes: Change[],
  operatorWords: string | null | undefined
): Promise<{ receipts: ChangeReceipt[]; wrote: boolean; authorization: { ok: boolean; quote: string | null; reason: string | null } }> {
  const today = businessDateToday(ctx.now(), ctx.timeZone);
  const receipts: ChangeReceipt[] = [];
  let wrote = false;
  const verdict = verifyOperatorAuthorization({ quote: operatorWords, operatorTurns: ctx.operatorTurns(), lastClaireText: ctx.lastClaireText() });
  if (!verdict.ok) {
    return {
      receipts: changes.map((change, index) => ({ index, op: change.op, title: change.title, status: "refused", id: null, businessDate: null, day: null, reason: `not authorized: ${verdict.reason}` })),
      wrote: false,
      authorization: { ok: false, quote: null, reason: verdict.reason },
    };
  }
  const authorizedQuote = verdict.quote;
  // A bare yes authorizes what the OFFER said: the offer's sentences are the instruction,
  // for naming the item and for the action ("Want me to take the Pham session off tomorrow?").
  const instructionText = verdict.bareAck ? (offerText(ctx.lastClaireText()) ?? "") : authorizedQuote;
  for (const [index, change] of changes.entries()) {
    const base = { index, op: change.op, title: change.title, id: null, businessDate: null, day: null, reason: null } as ChangeReceipt;
    const resolved = resolveSpokenDate(change.day ?? "", { today });
    if (resolved.kind !== "resolved") {
      receipts.push({ ...base, status: "refused", reason: resolved.reason });
      continue;
    }
    const businessDate = resolved.businessDate;
    const day = spokenDay(businessDate, today);
    try {
      if (change.op === "add") {
        // A bare yes binds only to the work the offer named; an item the offer did not mention is not authorized by it.
        if (verdict.bareAck && changesOutsideOffer(ctx.lastClaireText(), [change.title]).length) {
          receipts.push({ ...base, status: "refused", businessDate, day, reason: `not authorized: "${authorizedQuote}" answers your offer, and your offer did not name "${change.title}"; ask about it plainly` });
          continue;
        }
        const existing = (await readDayLineRows(ctx, businessDate)).filter(row => row.status === "open");
        const duplicate = existing.find(row => sameWork(row.title, change.title) || plausibleSameWork(row.title, change.title));
        if (duplicate) {
          receipts.push({ ...base, status: "already_present", id: duplicate.id, businessDate, day, reason: `an open row "${duplicate.title}" is already on ${day}` });
          continue;
        }
        // Plausibly the same work on ANOTHER day: never merge silently, never duplicate silently.
        // The model resolves it (move the existing row, or confirm it is a separate job) unless the
        // operator already confirmed a separate job (confirm_new).
        if (!change.confirm_new) {
          const elsewhere = (await findDayLineItems(ctx, change.title)).candidates.filter(row => row.businessDate !== businessDate && !ctx.callRowIds.has(row.id) && plausibleSameWork(row.title, change.title));
          if (elsewhere.length) {
            receipts.push({
              ...base,
              status: "needs_resolution",
              businessDate,
              day,
              reason: `work like this is already on the Day Line: ${elsewhere.map(row => `"${row.title}" on ${spokenDay(row.businessDate, today)} [${row.id}]`).join("; ")}. If the operator means that item, move it (op "move" with its id). If it is a separate job (recurring, a second visit), confirm with them and re-send with confirm_new: true.`,
            });
            continue;
          }
        }
        const title = change.title.trim().replace(/\s+/g, " ").slice(0, 255);
        const detail = change.detail?.trim().slice(0, 500) || null;
        const sourceRef = `claire-prototype:${ctx.conversationId}:${ctx.nextTurnId()}:"${authorizedQuote.slice(0, 80)}"`;
        const result = await acceptProposalWithReceipt({
          tenantId: ctx.tenantId,
          actorId: ctx.dayDirectorActorId,
          businessDate,
          proposal: {
            promptKey: `claire-prototype:${randomUUID()}`,
            title,
            kind: "operations",
            quantity: null,
            sourceText: change.title,
            prerequisites: [],
            question: null,
            intelligence: "manual_fallback",
            detailState: "COMPLETE",
            missingDetails: [],
            detailNote: detail,
            references: [],
            targetBusinessDate: businessDate,
          },
          admission: operatorInstructionAdmission({ operatorUserId: ctx.operatorUserId, surface: "claire_turn", sourceRef }),
        });
        const id = String((result as { stored?: { id?: string } }).stored?.id ?? "");
        // Read back: the receipt is what the table holds, not what the call returned.
        const after = await readDayLineRows(ctx, businessDate);
        const landed = after.find(row => (id && row.id === id) || (row.status === "open" && sameWork(row.title, title)));
        if (!landed) {
          receipts.push({ ...base, status: "failed", businessDate, day, reason: "the write returned but the row is not on the Day Line" });
          continue;
        }
        wrote = true;
        ctx.callRowIds.add(landed.id);
        receipts.push({ ...base, status: "applied", id: landed.id, title: landed.title, businessDate, day });
        continue;
      }

      const rows = await readDayLineRows(ctx, businessDate);
      const found = findRow(rows, change.title);
      if (found.kind === "none") {
        receipts.push({ ...base, status: "not_found", businessDate, day, reason: `nothing on ${day} matches "${change.title}"; rows there: ${rows.map(row => `${row.title} [${row.id}]`).join("; ") || "none"}` });
        continue;
      }
      if (found.kind === "many") {
        receipts.push({ ...base, status: "ambiguous", businessDate, day, reason: `several rows on ${day} match: ${found.rows.map(row => `${row.title} [${row.id}]`).join("; ")}; retry with the id` });
        continue;
      }
      const row = found.row;
      // Work that predates this call: the operator's words must name it and carry the action.
      if (!ctx.callRowIds.has(row.id)) {
        const guard = authorizeExistingRowChange({
          op: change.op as "move" | "remove" | "complete",
          rowTitle: row.title,
          rowId: row.id,
          quote: change.operator_words?.trim() || instructionText,
          lastClaireText: ctx.lastClaireText(),
          toDay: change.to_day ?? null,
        });
        if (!guard.ok) {
          receipts.push({ ...base, status: "refused", id: row.id, title: row.title, businessDate, day, reason: guard.reason });
          continue;
        }
        if (change.operator_words?.trim()) {
          const said = verifyOperatorAuthorization({ quote: change.operator_words, operatorTurns: ctx.operatorTurns(), lastClaireText: ctx.lastClaireText() });
          if (!said.ok) {
            receipts.push({ ...base, status: "refused", id: row.id, title: row.title, businessDate, day, reason: `not authorized: ${said.reason}` });
            continue;
          }
        }
      }
      if (change.op === "move") {
        const target = resolveSpokenDate(change.to_day ?? "", { today });
        if (target.kind !== "resolved") {
          receipts.push({ ...base, status: "refused", id: row.id, businessDate, day, reason: target.reason });
          continue;
        }
        const moved = await moveDayDirectorCommitment({ tenantId: ctx.tenantId, actorId: ctx.dayDirectorActorId, commitmentId: row.id, fromBusinessDate: businessDate, toBusinessDate: target.businessDate });
        const stillThere = (await readDayLineRows(ctx, target.businessDate)).some(item => item.id === row.id);
        if (!moved || !stillThere) {
          receipts.push({ ...base, status: "failed", id: row.id, businessDate, day, reason: "the row did not move (it may no longer be open)" });
          continue;
        }
        wrote = true;
        receipts.push({ ...base, status: "applied", id: row.id, title: row.title, businessDate: target.businessDate, day: spokenDay(target.businessDate, today), reason: `moved from ${day}` });
        continue;
      }
      if (change.op === "complete") {
        if (row.status === "completed") {
          receipts.push({ ...base, status: "already_present", id: row.id, title: row.title, businessDate, day, reason: "already marked completed" });
          continue;
        }
        await completeDayDirectorCommitment({ tenantId: ctx.tenantId, actorId: ctx.dayDirectorActorId, commitmentId: row.id });
        const after = (await readDayLineRows(ctx, businessDate)).find(item => item.id === row.id);
        if (after?.status !== "completed") {
          receipts.push({ ...base, status: "failed", id: row.id, businessDate, day, reason: "the row is not marked completed" });
          continue;
        }
        wrote = true;
        receipts.push({ ...base, status: "applied", id: row.id, title: row.title, businessDate, day });
        continue;
      }
      // remove: off this day only (removedFromDay), never notPursuing, never cancelling follow-ups (#764).
      if (row.status === "completed") {
        receipts.push({ ...base, status: "refused", id: row.id, title: row.title, businessDate, day, reason: "completed history is not rewritten" });
        continue;
      }
      const removed = await removeDayDirectorCommitmentsFromDay({
        tenantId: ctx.tenantId,
        actorId: ctx.dayDirectorActorId,
        businessDate,
        commitmentIds: [row.id],
        removedBy: ctx.operatorUserId,
        reason: `operator asked on a call: "${authorizedQuote.slice(0, 200)}"`,
      });
      if (!removed.includes(row.id)) {
        receipts.push({ ...base, status: "failed", id: row.id, businessDate, day, reason: "the row is still on the Day Line" });
        continue;
      }
      wrote = true;
      receipts.push({ ...base, status: "applied", id: row.id, title: row.title, businessDate, day });
    } catch (error) {
      const reason = error instanceof DayLineAdmissionRefusedError ? error.message : error instanceof Error ? error.message : String(error);
      receipts.push({ ...base, status: error instanceof DayLineAdmissionRefusedError ? "refused" : "failed", businessDate, day, reason });
    }
  }
  return { receipts, wrote, authorization: { ok: true, quote: authorizedQuote, reason: null } };
}

function periodSpec(period: (typeof PERIODS)[number], trailingDays?: number): PeriodSpec {
  if (period === "trailing_days") return { kind: "trailing_days", days: Math.max(1, Math.min(365, trailingDays ?? 30)) };
  return { kind: period } as PeriodSpec;
}

async function readBusinessNumbers(ctx: ToolContext, input: { metric: BusinessMetric; period: (typeof PERIODS)[number]; trailing_days?: number }) {
  const query = { ...defaultBusinessQuery(input.metric), period: periodSpec(input.period, input.trailing_days) };
  const result = await runBusinessQuery(ctx.tenantId, query);
  if (result.status !== "ok") {
    return { status: "unavailable", metric: input.metric, period: { start: result.period.start, end: result.period.end }, reason: result.reason };
  }
  const json = JSON.stringify(result.data);
  return {
    status: "ok",
    metric: input.metric,
    period: { start: result.period.start, end: result.period.end },
    coverage: result.coverage,
    records: json.length > 6000 ? `${json.slice(0, 6000)}… (truncated)` : result.data,
    note: "Figures above are the ledger's records for the period. Zero orders means no sales are recorded for that period, not that sales were zero in the world; say which.",
  };
}

export async function saveStandingInstruction(ctx: ToolContext, input: { rule: string; operator_words: string }) {
  const store = ctx.standingInstructionStore ?? drizzleStandingInstructionStore();
  const text = input.rule.trim().replace(/\s+/g, " ").slice(0, 400);
  const quote = input.operator_words.trim().slice(0, 400);
  const scope = { tenantId: ctx.tenantId, canonicalOperatorId: ctx.canonicalOperatorId };
  const record = await store.append({
    ...scope,
    operatorUserId: ctx.operatorUserId,
    detected: {
      kind: "call_rule",
      subjectKey: `call_rule:${normalizeTitle(text).slice(0, 80)}`,
      status: "active",
      text: `Operator rule for calls: ${text}`,
      quote,
      payload: null,
    },
    sourceConversationKey: ctx.conversationId,
    sourceTurnId: ctx.nextTurnId(),
  });
  const active = (await store.listActive(scope)).some(row => row.id === record.id);
  return { status: active ? "active" : "not_active", id: record.id, rule: text };
}

export async function executeTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<{ output: unknown; wrote: boolean; endCall?: boolean }> {
  const today = businessDateToday(ctx.now(), ctx.timeZone);
  switch (name) {
    case "read_day_line": {
      const resolved = resolveSpokenDate(String(input.day ?? ""), { today });
      if (resolved.kind !== "resolved") return { output: { status: "refused", reason: resolved.reason }, wrote: false };
      const rows = await readDayLineRows(ctx, resolved.businessDate);
      return { output: { businessDate: resolved.businessDate, day: spokenDay(resolved.businessDate, today), rows }, wrote: false };
    }
    case "find_day_line_item": {
      const found = await findDayLineItems(ctx, String(input.query ?? ""), { daysBack: typeof input.days_back === "number" ? input.days_back : undefined, daysAhead: typeof input.days_ahead === "number" ? input.days_ahead : undefined });
      return { output: { query: input.query, searched: { from: found.from, through: found.through }, candidates: found.candidates.map(row => ({ id: row.id, title: row.title, day: spokenDay(row.businessDate, today), businessDate: row.businessDate, status: row.status, match: row.match })), note: found.candidates.length ? "Change the existing row by id; do not add a new one for the same work." : "Nothing like this is on the Day Line in that window." }, wrote: false };
    }
    case "apply_day_line_changes": {
      const changes = Array.isArray(input.changes) ? (input.changes as Change[]) : [];
      const result = await applyDayLineChanges(ctx, changes, typeof input.operator_words === "string" ? input.operator_words : null);
      return { output: { authorization: result.authorization, receipts: result.receipts }, wrote: result.wrote };
    }
    case "read_business_numbers":
      return { output: await readBusinessNumbers(ctx, input as never), wrote: false };
    case "save_standing_instruction": {
      const result = await saveStandingInstruction(ctx, input as never);
      return { output: result, wrote: result.status === "active" };
    }
    case "end_call":
      return { output: { status: "ending" }, wrote: false, endCall: true };
    default:
      return { output: { status: "unknown_tool", name }, wrote: false };
  }
}
