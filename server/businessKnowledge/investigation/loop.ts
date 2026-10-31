import type { CoverageEntry } from "../../firstTenMinutes/research/coverage";
import { CoverageLedger } from "../../firstTenMinutes/research/coverage";
import { GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, gmailAfter, type DriveEntry, type GoogleResearch } from "../../firstTenMinutes/research/googleResearch";
import { sameAddress } from "../../firstTenMinutes/understanding/text";
import { proposeQuestions } from "../clarify";
import { BUSINESS_KINDS, reconcileCollaborators, reconcileStatuses } from "../reconcile";
import type { ResearchRecord } from "../schema";
import { entities, finishRun, liveAssertions, renewRun, runs, startRun, timeline, upsertEntity, type KnowledgeScope } from "../store";
import { applyInterpretation, EntityIndex } from "./apply";
import type { InvestigatorModel, ToolCall } from "./interpretation";
import { MaterialBook, type Material } from "./material";

/**
 * The investigation: a bounded, tool-using research loop over the person's own Google account.
 *
 *  1. Survey, Sent first: the owner's outgoing mail month by month across two years, a few of their own messages in
 *     full (signatures), recent documents and spreadsheets, and the calendar's past year and next quarter.
 *  2. Interpret: the interpreter (a model with the deterministic floor beside it) names businesses, products,
 *     projects and people from what was read, with quotes, and proposes research questions and tool calls.
 *  3. Research: JOYSTICK forms its own questions for every name found (when was it last active; has it gone quiet;
 *     who is this person; how do these two names relate; what describes current operations) and runs targeted
 *     searches and reads for them, alongside the interpreter's own calls, within a budget.
 *  4. Repeat 2-3 until nothing new is learned, the interpreter is done, or the budget is spent.
 *  5. Reconcile: chronology decides each status from dated evidence and what was actually searched for it;
 *     collaborators are inferred; questions for the person are proposed.
 *
 * Every search and read is recorded (CoverageLedger) and every research question ends answered, unanswered, or
 * "insufficient evidence". Nothing is sent, changed or shared anywhere.
 */

export type InvestigationBudget = {
  rounds: number;
  toolCalls: number;
  mailSearches: number;
  threadReads: number;
  documentReads: number;
  spreadsheetReads: number;
  calendarSearches: number;
  driveSearches: number;
  durationMs: number;
};

export const FULL_BUDGET: InvestigationBudget = {
  rounds: 5,
  toolCalls: 60,
  mailSearches: 40,
  threadReads: 10,
  documentReads: 12,
  spreadsheetReads: 6,
  calendarSearches: 6,
  driveSearches: 10,
  durationMs: 150_000,
};

export const INCREMENTAL_BUDGET: InvestigationBudget = {
  rounds: 2,
  toolCalls: 16,
  mailSearches: 8,
  threadReads: 3,
  documentReads: 4,
  spreadsheetReads: 2,
  calendarSearches: 2,
  driveSearches: 3,
  durationMs: 60_000,
};

export type InvestigationDeps = {
  research: GoogleResearch;
  ledger: CoverageLedger;
  model: InvestigatorModel;
  ownerEmail: string;
  now: () => Date;
  budget?: InvestigationBudget;
  /** incremental: only material newer than `since` is surveyed */
  since?: Date | null;
  trigger?: string;
  /** model usage, recorded on the run */
  usage?: Record<string, number>;
  notes?: string[];
  /** called as the work goes on, e.g. to keep the onboarding reading's lease while the investigation runs */
  onProgress?: () => Promise<void>;
};

export type InvestigationResult = {
  runId: string | null;
  status: "complete" | "budget_exhausted" | "failed" | "busy" | "unchanged";
  rounds: number;
  used: Record<string, number>;
  research: ResearchRecord[];
  stoppedBecause: string;
  questionIds: string[];
};

/** `absenceAnswers`: a question like "has it gone quiet?", which a complete search that finds nothing does answer. */
type Agenda = { question: string; entityIds: string[]; calls: ToolCall[]; searches: CoverageEntry[]; handles: Set<string>; produced: number; done: boolean; absenceAnswers?: boolean };

const DAY = 86_400_000;
const call = (tool: ToolCall["tool"], fields: Partial<ToolCall>): ToolCall => ({ tool, query: "", terms: [], id: "", after: "", before: "", reason: "", ...fields });
const quoted = (name: string) => `"${name.replace(/"/g, "")}"`;

export async function investigate(scope: KnowledgeScope, deps: InvestigationDeps): Promise<InvestigationResult> {
  const budget = deps.budget ?? FULL_BUDGET;
  const kind = deps.since ? "incremental" : "full";
  const notes = deps.notes ?? [];
  const runId = await startRun(scope, { kind, trigger: deps.trigger ?? kind, budget: budget as unknown as Record<string, number>, model: deps.model.name }, deps.now());
  const used: Record<string, number> = { rounds: 0, toolCalls: 0, mailSearches: 0, threadReads: 0, documentReads: 0, spreadsheetReads: 0, calendarSearches: 0, driveSearches: 0, evidence: 0 };
  if (!runId) return { runId: null, status: "busy", rounds: 0, used, research: [], stoppedBecause: "another investigation is running", questionIds: [] };

  const started = Date.now();
  const now = deps.now();
  const book = new MaterialBook(deps.ownerEmail);
  const index = new EntityIndex(scope);
  const agenda: Agenda[] = [];
  const done = new Set<string>();
  const files = new Map<string, DriveEntry>();
  const lastTouched = new Set<string>();
  let stoppedBecause = "finished";
  let status: InvestigationResult["status"] = "complete";
  try {
    await index.load();
    const ownerName = await survey();
    const operatorId = await upsertEntity(scope, { kind: "operator", name: ownerName ?? deps.ownerEmail, email: deps.ownerEmail });
    index.remember(operatorId, "operator", ownerName ?? deps.ownerEmail, [], deps.ownerEmail);

    let quietRounds = 0;
    for (let round = 1; round <= budget.rounds; round += 1) {
      used.rounds = round;
      // new items, and items a later read expanded (a thread read in full after its snippet was seen)
      const fresh = book.takeChanged();
      const known = await knownSummary();
      const interpretation = await deps.model.interpret({
        ownerName,
        ownerEmail: deps.ownerEmail,
        now,
        material: fresh,
        known,
        agenda: agenda.filter(item => !item.done).map(item => item.question).slice(0, 20),
        remaining: remaining(),
      });
      const applied = await applyInterpretation({ scope, runId, book, now, operatorId, ownerEmail: deps.ownerEmail, ownerName }, interpretation, index);
      used.evidence += applied.evidenceIds.length;
      credit(applied.handles);
      quietRounds = applied.evidenceIds.length ? 0 : quietRounds + 1;

      // the interpreter's own questions, then JOYSTICK's: every name found gets researched
      for (const question of interpretation.questions) {
        const ids = question.about.map(name => index.find(name)?.id).filter((id): id is string => Boolean(id));
        addAgenda(question.question, ids, []);
      }
      await planResearch(round);
      const calls = [...interpretation.toolCalls.map(toolCall => ({ toolCall, owner: agenda.find(item => item.question === toolCall.reason) ?? null })), ...agenda.filter(item => !item.done).flatMap(item => item.calls.splice(0).map(toolCall => ({ toolCall, owner: item })))];
      if (!calls.length && (interpretation.done || quietRounds >= 1)) {
        stoppedBecause = interpretation.done ? "the interpreter had no more questions it could answer" : "no new evidence";
        break;
      }
      if (quietRounds >= 2) {
        stoppedBecause = "two rounds without new evidence";
        break;
      }
      const { ran, skipped } = await execute(calls);
      if (!ran) {
        if (skipped) {
          stoppedBecause = Date.now() - started > budget.durationMs ? "time budget spent" : "tool budget spent";
          status = "budget_exhausted";
        } else {
          stoppedBecause = "nothing left to search";
        }
        if (round > 1 || skipped) break;
      }
      await renewRun(scope, runId);
      await deps.onProgress?.();
      if (round === budget.rounds) {
        // read what the last round fetched before stopping
        const tail = book.takeChanged();
        if (tail.length) {
          const applied2 = await applyInterpretation(
            { scope, runId, book, now, operatorId, ownerEmail: deps.ownerEmail, ownerName },
            await deps.model.interpret({ ownerName, ownerEmail: deps.ownerEmail, now, material: tail, known: await knownSummary(), agenda: [], remaining: remaining() }),
            index
          );
          used.evidence += applied2.evidenceIds.length;
          credit(applied2.handles);
        }
        stoppedBecause = "round budget spent";
        status = agenda.some(item => !item.done && item.calls.length) ? "budget_exhausted" : "complete";
      }
    }

    // ---- reconcile: chronology decides, collaborators, questions for the person
    await deps.onProgress?.();
    const history = await priorCoverage();
    const coverageFor = (entityId: string) => {
      const entries = [...agenda.filter(item => item.entityIds.includes(entityId)).flatMap(item => item.searches), ...(history.get(entityId) ?? [])];
      return CoverageLedger.from(entries);
    };
    await reconcileStatuses(scope, { coverage: entity => coverageFor(entity.id), now });
    const operator = (await entities(scope, ["operator"]))[0];
    if (operator) await reconcileCollaborators(scope, operator, now);
    const questionIds = await proposeQuestions(scope, now);

    const research = agenda.map(item => ({
      question: item.question,
      entityIds: item.entityIds,
      status:
        item.searches.some(search => search.status === "failed" || search.status === "not_granted" || search.status === "skipped_budget")
          ? item.produced > 0
            ? ("answered" as const)
            : ("unanswered" as const)
          : item.produced > 0 || (item.absenceAnswers && item.searches.length > 0)
            ? ("answered" as const)
            : ("insufficient_evidence" as const),
      searches: item.searches.map(search => `${search.source}:${search.operation}:${search.target}:${search.status}`),
      coverage: item.searches,
    }));
    const watermark = latestMaterialTime(book.all(), now) ?? now;
    if (deps.usage) Object.assign(used, Object.fromEntries(Object.entries(deps.usage).map(([key, value]) => [`model_${key}`, value])));
    await finishRun(scope, runId, { status, used, coverage: deps.ledger.all(), research, notes: [...notes, `stopped: ${stoppedBecause}`], watermarkAt: watermark });
    return { runId, status, rounds: used.rounds, used, research, stoppedBecause, questionIds };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 120) : "unknown";
    console.warn("[BusinessKnowledge] the investigation failed:", error instanceof Error ? error.name : "unknown");
    await finishRun(scope, runId, { status: "failed", used, coverage: deps.ledger.all(), research: [], notes: [...notes, `failed: ${reason}`], watermarkAt: null }).catch(() => undefined);
    return { runId, status: "failed", rounds: used.rounds, used, research: [], stoppedBecause: reason, questionIds: [] };
  }

  // ------------------------------------------------------------------ survey

  async function survey(): Promise<string | null> {
    const since = deps.since ?? null;
    let ownerName: string | null = null;
    // the owner's own outgoing mail: month by month, or since the last run
    if (since) {
      const sent = await deps.research.searchMail(`in:sent ${gmailAfter(since)}`, { limit: 40 });
      used.mailSearches += 1;
      for (const item of sent?.items ?? []) if (!item.automated) book.mail(item);
    } else {
      const windows = (await deps.research.sentHistory({ months: 24, perWindow: 12 })) ?? [];
      used.surveyWindows = windows.length;
      for (const item of windows.flatMap(window => window.items)) book.mail(item);
    }
    // a few of the owner's own recent messages in full: signatures name the business
    const recentOwn = book.all().filter(item => item.kind === "mail" && item.ownerAuthored).sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    const threads = [...new Set(recentOwn.map(item => item.threadId!))].slice(0, since ? 3 : 6);
    for (const threadId of threads) {
      const messages = await deps.research.readThread(threadId);
      used.threadReads += 1;
      for (const message of messages ?? []) {
        if (message.automated) continue;
        book.mail(message);
        if (message.sentByOwner && !ownerName && message.from.name && sameAddress(message.from.email, deps.ownerEmail)) ownerName = message.from.name;
      }
    }
    // the person's own recent documents, spreadsheets and decks, and their calendar
    const files = await deps.research.recentFiles({ since: since ?? new Date(now.getTime() - 365 * DAY), limit: since ? 20 : 40, mimeTypes: [GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES] });
    used.driveSearches += 1;
    for (const file of files ?? []) book.file(file);
    const events = await deps.research.searchCalendar({ from: since ?? new Date(now.getTime() - 365 * DAY), to: new Date(now.getTime() + 90 * DAY) });
    used.calendarSearches += 1;
    book.events(events ?? [], now);
    return ownerName;
  }

  // ------------------------------------------------------------------ research planning

  function addAgenda(question: string, entityIds: string[], calls: ToolCall[]): Agenda | null {
    if (agenda.some(item => item.question === question)) return null;
    const item: Agenda = { question, entityIds, calls: calls.map(toolCall => ({ ...toolCall, reason: question })), searches: [], handles: new Set(), produced: 0, done: false };
    agenda.push(item);
    return item;
  }

  async function planResearch(round: number) {
    const known = await entities(scope);
    const rows = await timeline(scope, { entityIds: known.map(entity => entity.id) });
    const live = await liveAssertions(scope);
    for (const entity of known.filter(item => BUSINESS_KINDS.includes(item.kind))) {
      const name = entity.name;
      const keyword = name.replace(/s$/, "");
      addAgenda(`When was ${name} last active, and is it current?`, [entity.id], [
        call("search_mail", { query: `in:sent ${quoted(keyword)}`, after: new Date(now.getTime() - 365 * DAY).toISOString() }),
        call("search_mail", { query: `${quoted(keyword)} -in:sent -in:chats -category:promotions` }),
        call("search_drive", { terms: [keyword] }),
        call("search_calendar", { query: keyword.split(" ")[0] }),
      ]);
      const owned = rows.filter(row => row.entityId === entity.id && row.signal === "owner_action").sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      const last = owned[0]?.occurredAt;
      if (last && now.getTime() - last.getTime() > 90 * DAY) {
        // has it gone quiet? search the whole quiet period completely, mail and documents, before believing it
        const terms = keyword.split(/\s+/).filter(word => word.length > 3).slice(0, 2);
        const gap = addAgenda(`Has ${name} stopped showing activity since ${last.toISOString().slice(0, 10)}?`, [entity.id], [
          call("search_mail", { query: `in:sent ${terms.map(quoted).join(" ")}`, after: new Date(last.getTime() + DAY).toISOString(), before: now.toISOString() }),
          call("search_mail", { query: `in:sent ${quoted(terms[0] ?? keyword)}`, after: new Date(last.getTime() + DAY).toISOString(), before: now.toISOString() }),
          call("search_drive", { terms, after: new Date(last.getTime() + DAY).toISOString() }),
        ]);
        if (gap) gap.absenceAnswers = true;
      }
      // documents and spreadsheets that name it: read them, not just their titles
      for (const file of book.all().filter(item => item.kind === "file" && item.text.includes(name.split(" ")[0])).slice(0, 3)) {
        addAgenda(`What does "${file.text}" say about ${name}?`, [entity.id], [fileCall(file, [name])]);
      }
    }
    // people who show up beyond email, however rarely they're emailed
    const people = known.filter(entity => entity.kind === "person");
    for (const person of people) {
      const first = person.name.split(" ")[0];
      const hasRole = live.some(row => row.predicate === "role" && row.subjectEntityId === person.id);
      addAgenda(`Who is ${person.name}, and what do they do with the owner?`, [person.id], [
        ...(person.email ? [call("search_mail", { query: `from:${person.email} OR to:${person.email}` })] : [call("search_mail", { query: quoted(person.name) })]),
        call("search_drive", { terms: [person.name.includes(" ") ? person.name : first] }),
        call("search_calendar", { query: first }),
        ...(hasRole ? [] : book.all().filter(item => item.kind === "file" && item.people.some(box => person.email && sameAddress(box.email, person.email))).slice(0, 2).map(file => fileCall(file, [first]))),
      ]);
      // read their most recent conversation in full
      const thread = book.all().filter(item => item.kind === "mail" && item.threadId && item.people.some(box => person.email && sameAddress(box.email, person.email))).sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0))[0];
      if (thread) addAgenda(`What is ${first}'s latest conversation with the owner about?`, [person.id], [call("read_thread", { id: thread.threadId! })]);
    }
    // two business names: how do they relate?
    const businesses = known.filter(entity => entity.kind === "company" || entity.kind === "brand");
    for (let i = 0; i < businesses.length; i += 1) {
      for (let j = i + 1; j < businesses.length; j += 1) {
        const [a, b] = [businesses[i], businesses[j]];
        addAgenda(`How are ${a.name} and ${b.name} related?`, [a.id, b.id], [call("search_mail", { query: `${quoted(a.name)} ${quoted(b.name)}` }), call("search_drive", { terms: [a.name, b.name] })]);
      }
    }
    if (round === 1) {
      addAgenda("Which documents describe current operations?", [], [call("search_drive", { terms: ["operations", "process", "schedule", "pricing"], after: new Date(now.getTime() - 180 * DAY).toISOString() })]);
      addAgenda("Are there current customers, invoices and schedules?", [], [call("search_mail", { query: "in:sent (invoice OR schedule OR pickup OR booking OR order)", after: new Date(now.getTime() - 90 * DAY).toISOString() })]);
    }
    // anything the interpreter couldn't name yet stays researched by what it read: unread spreadsheets
    for (const sheet of book.all().filter(item => item.kind === "file" && item.mimeType === GOOGLE_SHEET).slice(0, 4)) {
      addAgenda(`What does the spreadsheet "${sheet.text}" track?`, [], [fileCall(sheet, [])]);
    }
  }

  function fileCall(file: Material, focus: string[]): ToolCall {
    return file.mimeType === GOOGLE_SHEET ? call("read_spreadsheet", { id: file.ref }) : call("read_document", { id: file.ref, terms: focus });
  }

  // ------------------------------------------------------------------ execution

  function remaining(): Record<string, number> {
    return {
      toolCalls: budget.toolCalls - used.toolCalls,
      mailSearches: budget.mailSearches - used.mailSearches,
      threadReads: budget.threadReads - used.threadReads,
      documentReads: budget.documentReads - used.documentReads,
      spreadsheetReads: budget.spreadsheetReads - used.spreadsheetReads,
      calendarSearches: budget.calendarSearches - used.calendarSearches,
      driveSearches: budget.driveSearches - used.driveSearches,
    };
  }

  /** A research question is answered when a finding that stood cites something its own searches fetched. */
  function credit(handles: Set<string>) {
    for (const item of agenda) if ([...item.handles].some(handle => handles.has(handle))) item.produced += 1;
  }

  async function execute(calls: Array<{ toolCall: ToolCall; owner: Agenda | null }>): Promise<{ ran: number; skipped: number }> {
    let ran = 0;
    let skipped = 0;
    for (const { toolCall, owner } of calls) {
      const key = `${toolCall.tool}|${toolCall.query}|${toolCall.terms.join(",")}|${toolCall.id}|${toolCall.after}|${toolCall.before}`;
      if (done.has(key)) continue;
      const left = remaining();
      const counter = ({ search_mail: "mailSearches", read_thread: "threadReads", search_drive: "driveSearches", read_document: "documentReads", read_spreadsheet: "spreadsheetReads", search_calendar: "calendarSearches" } as const)[toolCall.tool];
      if (left.toolCalls <= 0 || left[counter] <= 0 || Date.now() - started > budget.durationMs) {
        skipped += 1;
        deps.ledger.record({ source: toolCall.tool.includes("mail") || toolCall.tool === "read_thread" ? "gmail" : toolCall.tool === "search_calendar" ? "calendar" : toolCall.tool === "read_spreadsheet" ? "sheets" : "drive", operation: toolCall.tool, target: toolCall.query || toolCall.terms.join(" ") || toolCall.id, status: "skipped_budget", items: 0 });
        continue;
      }
      done.add(key);
      used.toolCalls += 1;
      used[counter] += 1;
      ran += 1;
      const before = deps.ledger.all().length;
      const firstHandle = book.size;
      await runTool(toolCall);
      if (owner) {
        owner.searches.push(...deps.ledger.all().slice(before));
        // what this call fetched (new items, and known items it found again) is this question's to cite
        for (const item of book.since(firstHandle)) owner.handles.add(item.handle);
        for (const handle of lastTouched) owner.handles.add(handle);
        if (!owner.calls.length) owner.done = true;
      }
      lastTouched.clear();
    }
    return { ran, skipped };
  }

  async function runTool(toolCall: ToolCall) {
    const date = (value: string) => (value && !Number.isNaN(Date.parse(value)) ? new Date(value) : null);
    const after = date(toolCall.after);
    const before = date(toolCall.before);
    switch (toolCall.tool) {
      case "search_mail": {
        const window = after ? { from: after, to: before ?? now } : undefined;
        const found = await deps.research.searchMail(toolCall.query, { limit: window ? 50 : 20, window });
        for (const item of found?.items ?? []) if (!item.automated) lastTouched.add(book.mail(item).handle);
        return;
      }
      case "read_thread": {
        for (const message of (await deps.research.readThread(toolCall.id)) ?? []) if (!message.automated) lastTouched.add(book.mail(message).handle);
        return;
      }
      case "search_drive": {
        for (const file of (await deps.research.searchDrive(toolCall.terms, { limit: 15, modifiedAfter: after ?? undefined, mimeTypes: [GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES] })) ?? []) {
          files.set(file.id, file);
          lastTouched.add(book.file(file).handle);
        }
        return;
      }
      case "read_document":
      case "read_spreadsheet": {
        const file = files.get(toolCall.id) ?? (await findFile(toolCall.id));
        if (!file) return;
        if (toolCall.tool === "read_spreadsheet" || file.mimeType === GOOGLE_SHEET) {
          const sheet = await deps.research.readSpreadsheet(file);
          if (sheet && !sheet.excluded) for (const item of book.sheet(sheet, now)) lastTouched.add(item.handle);
        } else {
          const document = await deps.research.readDocument(file, { focus: toolCall.terms, maxPassages: 8 });
          if (document && !document.excluded) for (const item of book.passages(document)) lastTouched.add(item.handle);
        }
        return;
      }
      case "search_calendar": {
        const events = await deps.research.searchCalendar({ from: after ?? new Date(now.getTime() - 365 * DAY), to: before ?? new Date(now.getTime() + 90 * DAY), query: toolCall.query });
        for (const item of book.events(events ?? [], now)) lastTouched.add(item.handle);
        return;
      }
    }
  }

  async function findFile(id: string): Promise<DriveEntry | null> {
    const item = book.all().find(material => material.kind === "file" && material.ref === id);
    if (!item) return null;
    const found = await deps.research.searchDrive([item.text], { limit: 5 });
    used.driveSearches += 1;
    const file = found?.find(entry => entry.id === id) ?? null;
    if (file) files.set(file.id, file);
    return file;
  }

  async function knownSummary() {
    const known = await entities(scope);
    const live = await liveAssertions(scope, { predicate: "status" });
    return {
      entities: known
        .filter(entity => BUSINESS_KINDS.includes(entity.kind) || entity.kind === "organization")
        .map(entity => ({ name: entity.name, kind: entity.kind, lastActivityAt: live.find(row => row.subjectEntityId === entity.id && row.state === "current")?.effectiveFrom?.toISOString() ?? null })),
      people: known.filter(entity => entity.kind === "person").map(entity => ({ name: entity.name, email: entity.email })),
    };
  }

  /** What earlier runs searched for each entity: a re-investigation still knows the quiet months were checked. */
  async function priorCoverage(): Promise<Map<string, CoverageEntry[]>> {
    const out = new Map<string, CoverageEntry[]>();
    for (const run of await runs(scope, 10)) {
      for (const record of run.researchJson ?? []) {
        for (const entityId of record.entityIds) out.set(entityId, [...(out.get(entityId) ?? []), ...(record.coverage ?? [])]);
      }
    }
    return out;
  }
}

/** The newest source time read (never later than now: a future meeting isn't a watermark). */
function latestMaterialTime(items: Material[], now: Date): Date | null {
  const times = items.map(item => Math.min(item.at?.getTime() ?? item.modifiedAt?.getTime() ?? 0, now.getTime())).filter(Boolean);
  return times.length ? new Date(Math.max(...times)) : null;
}
