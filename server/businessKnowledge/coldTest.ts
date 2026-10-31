import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNotNull, like, sql } from "drizzle-orm";
import type { MySqlColumn, MySqlTable } from "drizzle-orm/mysql-core";
import type { KnowledgeQuestionView } from "../../shared/businessKnowledge";
import { LETTER_STEPS } from "../../shared/firstTenMinutesChapter";
import { listTenantProviderUsage } from "../db";
import { chapterView, prepareDraft, recordChapterStep } from "../firstTenMinutes/chapter/chapter";
import { portraitView, portraitWriterFor, preparePortrait } from "../firstTenMinutes/portrait/portrait";
import type { PortraitWriter } from "../firstTenMinutes/portrait/write";
import { CoverageLedger, type CoverageEntry } from "../firstTenMinutes/research/coverage";
import { googleResearch } from "../firstTenMinutes/research/googleResearch";
import {
  firstTenConnections,
  firstTenDrafts,
  firstTenEvents,
  firstTenFindings,
  firstTenJourneys,
  firstTenPortraits,
  firstTenReadings,
} from "../firstTenMinutes/schema";
import { connectionSecrets, journeyById, type JourneyRow } from "../firstTenMinutes/store";
import { readingDepsWith, type ReadingConnections } from "../firstTenMinutes/understanding/deps";
import type { Extractor } from "../firstTenMinutes/understanding/extract";
import type { GoogleAccess } from "../firstTenMinutes/understanding/googleReaders";
import { runReading } from "../firstTenMinutes/understanding/run";
import type { Geocoder } from "../firstTenMinutes/understanding/sources";
import { claimReading } from "../firstTenMinutes/understanding/store";
import { understandingView } from "../firstTenMinutes/understanding/view";
import { ONBOARDING_INTELLIGENCE_FLAG } from "./flag";
import { investigate } from "./investigation/loop";
import { INVESTIGATOR_MODEL_FLAG, investigatorFor, type ModelUsage } from "./investigation/models";
import { answerOnboardingQuestion, onboardingQuestionState } from "./onboarding";
import { bkAssertions, bkEntities, bkEvidence, bkQuestions, bkRuns, bkTimeline } from "./schema";
import { knowledgeDb, liveAssertions, runs, timeline, type KnowledgeScope } from "./store";
import { readBusinessUnderstanding } from "./understanding";
import { coldTestOutcome, type ColdTestOutcome, type JourneyOutcome, type StageUsage } from "./coldTestReport";

/**
 * Cold-start tests of onboarding intelligence against a person's real, connected Google account. The operator command
 * is scripts/onboarding-intelligence-real-account.ts; docs/goldline/ONBOARDING_INTELLIGENCE.md says how to run it.
 *
 * Each run reads the source journey's accounts into a throwaway test journey whose id says what it is: "coldtest-" and
 * 27 hex characters. A real journey id is a UUID and can never take that form. The run proves it starts from nothing
 * (no row anywhere carries its id), writes only rows keyed by that id, and deletes exactly those at the end.
 *
 *  - Google is read only: every request goes through `readOnlyFetch`, which lets GETs and token refreshes through
 *    and refuses everything else. A refreshed token stays in this process; the person's connection row is never
 *    written. Nothing is sent, revoked or disconnected, and no draft leaves the table.
 *  - Of the source journey, only its connection is read: never its knowledge, findings, answers or portrait.
 *  - Model spend is attributed to the test id ("first_ten:coldtest-…"), so it never lands on the person's journey;
 *    those spend rows stay, so JOYSTICK's cost ledger keeps matching the provider's bill.
 *  - Deletion (`forgetColdTest`) refuses anything that isn't a cold-test id, and any id that has a journey, a
 *    connection or a workspace stamp, and deletes by exact id only.
 */

export const COLD_TEST_ID = /^coldtest-[0-9a-f]{27}$/;

export const isColdTestId = (id: unknown): id is string => typeof id === "string" && COLD_TEST_ID.test(id);

/** 36 characters, like the journey_id columns: "coldtest-" and 108 random bits. */
export function newColdTestId(): string {
  return `coldtest-${randomBytes(14).toString("hex").slice(0, 27)}`;
}

type Keyed = { name: string; table: MySqlTable; journeyId: MySqlColumn; tenantId: MySqlColumn | null };

/** Every table a test run writes, each keyed by the run's id. */
const WRITTEN: Keyed[] = [
  { name: "business_knowledge_entities", table: bkEntities, journeyId: bkEntities.journeyId, tenantId: bkEntities.tenantId },
  { name: "business_knowledge_evidence", table: bkEvidence, journeyId: bkEvidence.journeyId, tenantId: bkEvidence.tenantId },
  { name: "business_knowledge_timeline", table: bkTimeline, journeyId: bkTimeline.journeyId, tenantId: bkTimeline.tenantId },
  { name: "business_knowledge_assertions", table: bkAssertions, journeyId: bkAssertions.journeyId, tenantId: bkAssertions.tenantId },
  { name: "business_knowledge_questions", table: bkQuestions, journeyId: bkQuestions.journeyId, tenantId: bkQuestions.tenantId },
  { name: "business_knowledge_runs", table: bkRuns, journeyId: bkRuns.journeyId, tenantId: bkRuns.tenantId },
  { name: "first_ten_readings", table: firstTenReadings, journeyId: firstTenReadings.journeyId, tenantId: null },
  { name: "first_ten_findings", table: firstTenFindings, journeyId: firstTenFindings.journeyId, tenantId: null },
  { name: "first_ten_events", table: firstTenEvents, journeyId: firstTenEvents.journeyId, tenantId: null },
  { name: "first_ten_portraits", table: firstTenPortraits, journeyId: firstTenPortraits.journeyId, tenantId: null },
  { name: "first_ten_drafts", table: firstTenDrafts, journeyId: firstTenDrafts.journeyId, tenantId: null },
];

/** Tables a test run never writes. An id found in them was made by something else, so nothing is deleted. */
const NEVER_WRITTEN: Keyed[] = [
  { name: "first_ten_journeys", table: firstTenJourneys, journeyId: firstTenJourneys.id, tenantId: firstTenJourneys.tenantId },
  { name: "first_ten_connections", table: firstTenConnections, journeyId: firstTenConnections.journeyId, tenantId: null },
];

export const COLD_TEST_TABLES = WRITTEN.map(entry => entry.name);

async function countWhere(entry: Keyed, where: ReturnType<typeof eq>): Promise<number> {
  const db = await knowledgeDb();
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(entry.table).where(where);
  return Number(row?.n ?? 0);
}

/** How many rows carry this id, table by table (the tables a run writes and the two it never does). */
export async function coldTestRowCounts(id: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entry of [...WRITTEN, ...NEVER_WRITTEN]) counts[entry.name] = await countWhere(entry, eq(entry.journeyId, id));
  return counts;
}

const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

/** A run begins only on an id no row has ever carried: the proof that it starts from nothing. */
export async function assertColdStart(id: string): Promise<Record<string, number>> {
  if (!isColdTestId(id)) throw new Error("A cold test runs only on a cold-test id");
  const counts = await coldTestRowCounts(id);
  if (total(counts) !== 0) throw new Error(`Not a cold start: ${Object.entries(counts).filter(([, n]) => n).map(([name, n]) => `${name} ${n}`).join(", ")}`);
  return counts;
}

/**
 * Delete everything a test run wrote, by exact id, and prove nothing is left. Refuses (deleting nothing) unless the id
 * is a cold-test id that no journey, connection or workspace has ever carried.
 */
export async function forgetColdTest(id: string): Promise<{ deleted: Record<string, number> }> {
  if (!isColdTestId(id)) throw new Error("Refusing to delete: not a cold-test id");
  for (const entry of NEVER_WRITTEN) {
    if (await countWhere(entry, eq(entry.journeyId, id))) throw new Error(`Refusing to delete: ${entry.name} has a row for this id, so a test didn't make it`);
  }
  for (const entry of WRITTEN) {
    if (entry.tenantId && (await countWhere(entry, and(eq(entry.journeyId, id), isNotNull(entry.tenantId))!))) {
      throw new Error(`Refusing to delete: ${entry.name} is stamped with a workspace for this id`);
    }
  }
  const db = await knowledgeDb();
  const deleted: Record<string, number> = {};
  for (const entry of WRITTEN) {
    const result = await db.delete(entry.table).where(eq(entry.journeyId, id));
    const header = Array.isArray(result) ? result[0] : result;
    deleted[entry.name] = Number((header as { affectedRows?: number })?.affectedRows ?? 0);
  }
  const left = await coldTestRowCounts(id);
  if (total(left)) throw new Error("Cleanup incomplete: rows remain for this test id");
  return { deleted };
}

/** Test ids still in the database (a run that was killed, or kept with --keep). */
export async function leftoverColdTests(): Promise<string[]> {
  const db = await knowledgeDb();
  const ids = new Set<string>();
  for (const entry of WRITTEN) {
    const rows = await db.selectDistinct({ id: entry.journeyId }).from(entry.table).where(like(entry.journeyId, "coldtest-%"));
    for (const row of rows) if (isColdTestId(row.id)) ids.add(row.id as string);
  }
  return [...ids].sort();
}

// ------------------------------------------------------------------ reading a person's accounts, read-only

const TOKEN_HOST = "oauth2.googleapis.com";

/** The URL and method of a fetch call, whatever form it was made in. */
function requestOf(input: Parameters<typeof fetch>[0], init?: RequestInit): { url: URL; method: string } {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  return { url: new URL(href), method };
}

/** A token refresh: POST to Google's token endpoint (or its local stand-in) asking for a refresh grant, nothing else. */
function isTokenRefresh(url: URL, init?: RequestInit): boolean {
  const endpoint = (url.host === TOKEN_HOST && url.pathname === "/token") || url.pathname.endsWith(`/${TOKEN_HOST}/token`);
  return endpoint && typeof init?.body === "string" && new URLSearchParams(init.body).get("grant_type") === "refresh_token";
}

/**
 * A fetch that only reads. GETs pass; so does a token refresh; anything else (a send, a change, a delete, a revoke) is
 * refused before it leaves the process.
 */
export function readOnlyFetch(base: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const { url, method } = requestOf(input, init);
    if (method === "GET" || method === "HEAD" || (method === "POST" && isTokenRefresh(url, init))) return base(input, init);
    throw new Error(`Refused by the cold-test harness, which only reads: ${method} ${url.host}${url.pathname}`);
  }) as typeof fetch;
}

export type ColdTestSource = { journey: JourneyRow; google: GoogleAccess; slack: ReadingConnections["slack"] };

/**
 * The person's own journey, for its connections only. Google access is theirs, used as it stands; a token renewed
 * during the test stays in memory and is never written back.
 */
export async function coldTestSource(journeyId: string): Promise<ColdTestSource> {
  if (isColdTestId(journeyId)) throw new Error("The source is a person's own journey, not a test");
  const journey = await journeyById(journeyId);
  if (!journey || journey.kind !== "own") throw new Error("No own journey with that id");
  const google = await connectionSecrets(journey.id, "google");
  if (!google) throw new Error("That journey has no Google connection");
  const slack = await connectionSecrets(journey.id, "slack");
  return {
    journey,
    google: {
      accessToken: google.accessToken,
      refreshToken: google.refreshToken,
      accessExpiresAt: google.accessExpiresAt,
      grantedScopes: google.grantedScopes,
      ownerEmail: google.row.accountLabel ?? "",
      onRefreshed: async () => undefined,
    },
    slack: slack ? { accessToken: slack.accessToken, userId: slack.row.accountSubject } : null,
  };
}

export type InvestigatorChoice = { investigator?: "claude" | "gemini" | "heuristic"; model?: string };

/** The investigator model this run asked for, as the environment `investigatorFor` reads. */
export function investigatorEnv(choice: InvestigatorChoice, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  if (choice.investigator) out[INVESTIGATOR_MODEL_FLAG] = choice.investigator;
  const chosen = (out[INVESTIGATOR_MODEL_FLAG] ?? "claude").trim().toLowerCase();
  if (choice.model) out[chosen === "gemini" ? "JOYSTICK_INVESTIGATOR_GEMINI_MODEL" : "JOYSTICK_INVESTIGATOR_CLAUDE_MODEL"] = choice.model;
  return out;
}

// ------------------------------------------------------------------ runs

export type ColdTestInput = {
  source: ColdTestSource;
  choice?: InvestigatorChoice;
  /** keep the test's rows for inspection (delete later with the sweep) */
  keep?: boolean;
  /** tests: the controlled Google, its clock and a no-wait retry */
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
};

const emptyUsage = (): ModelUsage => ({ calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 });

/** What the investigation spent, from its run record (it holds the model's own counts). */
function investigatorUsage(run: Awaited<ReturnType<typeof runs>>[number] | undefined, fallback: ModelUsage): ModelUsage {
  const used = run?.usedJson ?? {};
  const pick = (key: keyof ModelUsage) => Number(used[`model_${key}`] ?? fallback[key] ?? 0);
  return { calls: pick("calls"), failures: pick("failures"), inputTokens: pick("inputTokens"), outputTokens: pick("outputTokens"), latencyMs: pick("latencyMs") };
}

/** Claude calls made under the test id, from JOYSTICK's own spend ledger (null when it can't be read here). */
async function stageUsage(id: string): Promise<StageUsage[] | null> {
  try {
    const rows = await listTenantProviderUsage(`first_ten:${id}`);
    return rows.map(row => ({ category: row.category, tokens: Number(row.usageQuantity ?? 0), costCents: Number(row.estimatedCostCents ?? 0) }));
  } catch {
    return null;
  }
}

async function knowledgeOf(scope: KnowledgeScope) {
  const [understanding, live, events, latest] = await Promise.all([readBusinessUnderstanding(scope), liveAssertions(scope), timeline(scope), runs(scope, 1)]);
  return { understanding, live, events, run: latest[0] };
}

/**
 * The investigation alone, from a cold start: what JOYSTICK concludes about the person's working life, the questions
 * Claire would ask, and what it couldn't read.
 */
export async function runIntelligenceColdTest(input: ColdTestInput): Promise<ColdTestOutcome> {
  const id = newColdTestId();
  const scope: KnowledgeScope = { journeyId: id, tenantId: null };
  const startedAt = new Date();
  await assertColdStart(id);
  const now = input.now ?? (() => new Date());
  const ledger = new CoverageLedger(now);
  const usage = emptyUsage();
  const notes: string[] = [];
  const { model, configured } = investigatorFor(id, usage, notes, { env: investigatorEnv(input.choice ?? {}, input.env) });
  const research = googleResearch(input.source.google, ledger, { fetch: readOnlyFetch(input.fetch), now, sleep: input.sleep });
  try {
    const began = Date.now();
    const result = await investigate(scope, { research, ledger, model, ownerEmail: input.source.google.ownerEmail, now, trigger: "cold test", notes, usage: usage as unknown as Record<string, number> });
    const investigationMs = Date.now() - began;
    const known = await knowledgeOf(scope);
    const cleanup = input.keep ? ({ kept: true } as const) : await forgetColdTest(id);
    return coldTestOutcome({
      id,
      mode: "intelligence",
      source: input.source.journey.id,
      startedAt,
      finishedAt: new Date(),
      cleanup,
      investigator: { configured, model: model.name, status: result.status, rounds: result.rounds, toolCalls: result.used.toolCalls ?? 0, stoppedBecause: result.stoppedBecause, notes },
      investigatorUsage: investigatorUsage(known.run, usage),
      stages: null,
      timings: { investigation: investigationMs },
      coverage: ledger.all(),
      ...known,
    });
  } catch (error) {
    if (!input.keep) await forgetColdTest(id).catch(() => undefined);
    throw error;
  }
}

export type JourneyColdTestInput = ColdTestInput & {
  /** the investigation runs inside the reading, as in production with JOYSTICK_ONBOARDING_INTELLIGENCE=on (default) */
  intelligence?: boolean;
  /** the person's answer to each of Claire's questions, or null to leave it (default: leave every one) */
  answer?: (question: KnowledgeQuestionView) => Promise<string | null>;
  /** tests: stand-ins for the model reading, the geocoder and the portrait writer */
  extractor?: Extractor;
  geocoder?: Geocoder;
  portraitWriter?: { writer: PortraitWriter; name: string };
};

/**
 * The whole first ten minutes, from a cold start, on a test journey that exists only in this process: the crew's
 * reading (with the investigation inside it), Claire's questions, the portrait, and the chapter played through to the
 * writing table. The draft is prepared and never sent; nothing is activated.
 */
export async function runJourneyColdTest(input: JourneyColdTestInput): Promise<ColdTestOutcome> {
  const id = newColdTestId();
  const scope: KnowledgeScope = { journeyId: id, tenantId: null };
  const startedAt = new Date();
  await assertColdStart(id);
  const journey: JourneyRow = { id, acquisitionSessionId: id, tenantId: null, kind: "own", stage: "connect", version: 1, createdAt: startedAt, updatedAt: startedAt };
  const flagBefore = process.env[ONBOARDING_INTELLIGENCE_FLAG];
  process.env[ONBOARDING_INTELLIGENCE_FLAG] = input.intelligence === false ? "off" : "on";
  const timings: Record<string, number> = {};
  const timed = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    const began = Date.now();
    try {
      return await work();
    } finally {
      timings[stage] = Date.now() - began;
    }
  };
  try {
    // the crew's reading, exactly as production composes it, over the person's connections, read-only
    const built = readingDepsWith(journey, { google: input.source.google, slack: input.source.slack }, { fetch: readOnlyFetch(input.fetch), env: investigatorEnv(input.choice ?? {}, input.env), now: input.now });
    const deps = { ...built, ...(input.extractor ? { extractor: input.extractor } : {}), ...(input.geocoder ? { geocoder: input.geocoder } : {}) };
    const readingRun = randomUUID();
    if (!(await claimReading(id, readingRun, { again: false }))) throw new Error("The test reading couldn't start");
    const readingStatus = await timed("reading", () => runReading(id, readingRun, deps));
    const reading = await understandingView(id);

    // Claire's questions, one at a time, answered (or left) as the operator chose
    const asked: JourneyOutcome["questions"] = [];
    await timed("questions", async () => {
      for (let turn = 0; turn < 12; turn += 1) {
        const state = await onboardingQuestionState(journey);
        if (!state.question) break;
        const answer = await (input.answer ?? (async () => null))(state.question);
        const after = await answerOnboardingQuestion(journey, state.question.id, answer);
        asked.push({ question: state.question.followUp ?? state.question.question, answered: answer !== null, understood: after.explanation });
      }
    });

    // the portrait, from what the reading found and what was understood
    let portrait: JourneyOutcome["portrait"] = null;
    let portraitNote: string | null = null;
    await timed("portrait", async () => {
      try {
        const prepared = await preparePortrait(journey, input.portraitWriter ?? portraitWriterFor(journey));
        await prepared.started;
        const view = await portraitView(id);
        portrait = view ? { status: view.status, greeting: view.greeting, lines: view.paragraphs.flat().map(line => line.text), closing: view.closing?.text ?? null } : null;
      } catch (error) {
        portraitNote = error instanceof Error ? error.message.slice(0, 160) : "the portrait wasn't written";
      }
    });

    // the chapter, played through to the writing table: the revelation, Hazel's errand, the letter, the draft
    const played: string[] = [];
    let chapter = await chapterView(journey);
    await timed("chapter", async () => {
      if (!chapter.opportunity) return;
      for (const step of ["revealed", ...LETTER_STEPS, "letter_written"] as const) {
        chapter = await recordChapterStep(journey, step);
        played.push(step);
      }
      chapter = await prepareDraft(journey);
    });

    const known = await knowledgeOf(scope);
    const stages = await stageUsage(id);
    const run = known.run;
    const cleanup = input.keep ? ({ kept: true } as const) : await forgetColdTest(id);
    return coldTestOutcome({
      id,
      mode: "journey",
      source: input.source.journey.id,
      startedAt,
      finishedAt: new Date(),
      cleanup,
      investigator: run
        ? {
            configured: (investigatorEnv(input.choice ?? {}, input.env)[INVESTIGATOR_MODEL_FLAG] ?? "claude").trim().toLowerCase(),
            model: run.model ?? "unknown",
            status: run.status,
            rounds: Number(run.usedJson?.rounds ?? 0),
            toolCalls: Number(run.usedJson?.toolCalls ?? 0),
            stoppedBecause: (run.notesJson ?? []).find(note => note.startsWith("stopped: "))?.slice("stopped: ".length) ?? "",
            notes: (run.notesJson ?? []).filter(note => !note.startsWith("stopped: ")),
          }
        : null,
      investigatorUsage: investigatorUsage(run, emptyUsage()),
      stages,
      timings,
      coverage: (run?.coverageJson ?? []) as CoverageEntry[],
      ...known,
      journey: { readingStatus, reading, questions: asked, portrait, portraitNote, chapter, played },
    });
  } catch (error) {
    if (!input.keep) await forgetColdTest(id).catch(() => undefined);
    throw error;
  } finally {
    if (flagBefore === undefined) delete process.env[ONBOARDING_INTELLIGENCE_FLAG];
    else process.env[ONBOARDING_INTELLIGENCE_FLAG] = flagBefore;
  }
}
