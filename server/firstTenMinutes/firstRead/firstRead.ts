import { and, eq } from "drizzle-orm";
import { FIRST_READ_DEADLINE_MS, type FirstReadView } from "../../../shared/firstTenMinutes";
import { fastDrive, fastGmail } from "../../businessKnowledge/firstRead/bench";
import { identityAnchors, PublicResearchRun } from "../../businessKnowledge/firstRead/publicResearch";
import { runReveal } from "../../businessKnowledge/firstRead/reveal";
import { groundSignificance, runSignificance } from "../../businessKnowledge/firstRead/significance";
import { checkClaims, geminiReading, judgeClaims, STATED, type GeminiConfig } from "../../businessKnowledge/firstRead/synthesis";
import { isMysqlDuplicateKeyError } from "../../mysqlErrors";
import { providerUrl } from "../providerFetch";
import { CoverageLedger } from "../research/coverage";
import { googleResearch } from "../research/googleResearch";
import { firstTenFirstReads } from "../schema";
import { firstTenDb, type JourneyRow } from "../store";
import { googleAccessFor } from "../understanding/deps";
import type { GoogleAccess } from "../understanding/googleReaders";

/**
 * The first read: within about a minute of the person connecting Google, a few lines that show JOYSTICK already sees
 * what they are actually doing, shown before Claire is named (docs/goldline/FIRST_READING_GOOGLE_SEARCH.md).
 *
 * It starts in the Google OAuth callback, runs once per journey in this server process, and never stands in the
 * experience's way: if it is slow, finds too little or fails, the person sees what they would have seen without it.
 *
 *   their sent mail + their own documents (read at once)  →  the reading  →  claims checked against quotes and dates
 *   →  why their work matters (checked against the source text)  →  the lines, each judged against the source text
 *
 * Public research runs beside it: Places for each business (a listing counts only when its website, phone or street
 * line is in the person's own mail), and searches for their profiles, anchored on organizations their own items show
 * they belong to. The first lines use only Places from it; everything verified later is kept for the experience after.
 *
 * Behind JOYSTICK_FIRST_READ_REVEAL=on, and only where the first ten minutes are open to the request (in `preview`,
 * only browsers holding the preview pass reach the callback at all).
 */

/** Public findings that land by then go into the first lines (in practice, Places); the rest is kept for later. */
const PUBLIC_CUTOFF_MS = 20_000;
/** Deeper public research (profiles, X) is waited for this long after consent, then kept; never shown here. */
const DEEP_CAP_MS = 150_000;
/** A run still marked running this long after consent belongs to a server that went away. */
const ABANDONED_MS = 4 * 60_000;
/** Fewer of their own items than this, and there is nothing honest to say. */
const MIN_EVIDENCE = 4;
/** Fewer lines than this survive the checks: show nothing rather than a thin remark. */
const MIN_LINES = 2;

export function firstReadOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JOYSTICK_FIRST_READ_REVEAL?.trim().toLowerCase() === "on";
}

type Row = typeof firstTenFirstReads.$inferSelect;
type Patch = Partial<Pick<Row, "status" | "revealJson" | "understandingJson" | "publicJson" | "timingsJson">>;

async function save(journeyId: string, patch: Patch): Promise<void> {
  const db = await firstTenDb();
  await db.update(firstTenFirstReads).set(patch).where(eq(firstTenFirstReads.journeyId, journeyId));
}

/** A failure never overwrites lines already written: only a run still marked running becomes failed. */
async function markFailed(journeyId: string): Promise<void> {
  const db = await firstTenDb();
  await db.update(firstTenFirstReads).set({ status: "failed" }).where(and(eq(firstTenFirstReads.journeyId, journeyId), eq(firstTenFirstReads.status, "running")));
}

const iso = (date: Date | null | undefined) => (date && !Number.isNaN(date.getTime()) ? date.toISOString() : null);

/** One per journey: a second callback (a reconnect, a refresh) never pays for it again. */
async function claim(journeyId: string, startedAt: Date): Promise<boolean> {
  const db = await firstTenDb();
  try {
    await db.insert(firstTenFirstReads).values({ journeyId, status: "running", startedAt });
    return true;
  } catch (error) {
    if (isMysqlDuplicateKeyError(error)) return false;
    throw error;
  }
}

export type FirstReadInput = { startedAt: Date; ownerName: string | null; ownerEmail: string };

/**
 * Called from the Google OAuth callback once the connection is saved. Returns at once; never throws into the callback.
 */
export async function beginFirstRead(journey: JourneyRow, input: FirstReadInput, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  // only when the person is connecting to begin: a Google connection made later (after Slack, at the portrait) would
  // pay for lines nobody is there to see
  if (!firstReadOn(env) || journey.kind !== "own" || !["connect", "understanding"].includes(journey.stage)) return false;
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[FirstRead] GEMINI_API_KEY isn't set: no first read");
    return false;
  }
  try {
    if (!(await claim(journey.id, input.startedAt))) return false;
  } catch (error) {
    console.warn("[FirstRead] couldn't start:", error instanceof Error ? error.name : "unknown");
    return false;
  }
  void (async () => {
    try {
      const access = await googleAccessFor(journey);
      if (!access) throw new Error("no Google connection");
      const gemini: GeminiConfig = { apiKey, model: env.JOYSTICK_FIRST_READ_MODEL?.trim() || "gemini-3.8-flash", thinking: "low" };
      await runFirstRead({ ...input, access, gemini, save: patch => save(journey.id, patch) });
    } catch (error) {
      console.warn("[FirstRead] failed:", error instanceof Error ? error.message.slice(0, 120) : "unknown");
      await markFailed(journey.id).catch(() => undefined);
    }
  })();
  return true;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));

/**
 * The read itself, with its effects passed in (`save`) so the same code runs in onboarding and in the local harness.
 * Timings are logged without content: which stage finished when, after consent.
 */
export async function runFirstRead(args: FirstReadInput & {
  access: GoogleAccess;
  gemini: GeminiConfig;
  save: (patch: Patch) => Promise<void>;
  fetch?: typeof fetch;
  publicDeps?: ConstructorParameters<typeof PublicResearchRun>[1];
}): Promise<"revealed" | "empty" | "failed"> {
  const t0 = args.startedAt.getTime();
  const at = () => Date.now() - t0;
  const times: Record<string, number> = {};
  const mark = (stage: string) => (times[stage] = at());
  const now = new Date();
  const owner = args.access.ownerEmail;
  const name = args.ownerName?.trim() || owner;
  const fetcher = args.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(providerUrl(String(input)), init));
  const research = googleResearch(args.access, new CoverageLedger(), { fetch: fetcher as typeof fetch });
  const finish = async (status: "revealed" | "empty" | "failed", patch: Patch = {}) => {
    mark(status);
    await args.save({ ...patch, status, timingsJson: { ...times } });
    console.log(`[FirstRead] ${status}: ${Object.entries(times).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)}s`).join(", ")}`);
    return status;
  };

  const [gmail, drive] = await Promise.all([fastGmail(research, now), fastDrive(research, now, owner, { onlyOwn: true })]);
  mark("retrieved");
  const evidence = [...gmail, ...drive];
  if (evidence.length < MIN_EVIDENCE) return finish("empty");

  const free = /^(gmail|googlemail|yahoo|hotmail|outlook|icloud|me|aol|proton|protonmail)\./i;
  const domains = [...new Set(gmail.map(e => /from [^<]*<[^@]+@([^>]+)>/.exec(e.people)?.[1]?.toLowerCase()).filter((d): d is string => Boolean(d) && !free.test(d!)))];
  const ownText = evidence.map(e => `${e.title} ${e.people} ${e.text}`).join("\n");
  const readingP = geminiReading(args.gemini, { question: "combined", evidence, today: now });
  const anchors = await identityAnchors(args.gemini, evidence, name);
  mark("anchors");
  const pub = new PublicResearchRun(
    { name, email: owner, domains, businesses: [], organizations: anchors.organizations.map(o => o.name), city: null, ownText },
    { fastModel: "claude-sonnet-5-5", ...args.publicDeps, t0 }
  ).start();

  const { value: reading } = await readingP;
  mark("reading");
  if (!reading) return finish("failed");
  const checked = checkClaims(reading, evidence, now);
  // "Laundry Farm, a laundry business" → "Laundry Farm"
  const nameOf = (statement: string) =>
    statement.replace(/^.*?\b(?:operates|runs|owns|manages|is developing|is building|develops|builds|is working on)\s+/i, "").split(/[,.;:(]| - | — | is | was | located | at /)[0].trim();
  pub.withBusinesses([...new Set(checked.filter(c => (c.kind === "business" || c.kind === "project") && c.verdict !== "unsupported").map(c => nameOf(c.statement)))].slice(0, 6));
  const judged = await judgeClaims(args.gemini, checked, evidence, now, reading.opening);
  mark("judged");
  const stated = judged.claims.filter(c => STATED.includes(c.verdict));
  if (stated.length < 2) {
    pub.stop();
    return finish("empty");
  }

  await Promise.race([pub.settled(), sleep(PUBLIC_CUTOFF_MS - at())]);
  // the first lines use public research only where it is a listing tied to them; profiles and posts come later
  const listings = pub.snapshot().filter(f => f.source === "places");
  const input = { claims: judged.claims, publicFindings: listings, evidence, today: now, ownerName: name };
  const significance = await runSignificance(args.gemini, input, { thinking: "low" });
  mark("significance");
  const groundedP = significance.significance ? groundSignificance(args.gemini, significance.significance, input) : null;
  const reveal = await runReveal(args.gemini, { ...input, significance: significance.significance, grounded: groundedP }, { thinking: "low" });
  const grounded = groundedP ? await groundedP : null;
  const lines = reveal.lines.filter(l => l.kept).map(l => l.line);
  const understandingJson = {
    claims: judged.claims.filter(c => STATED.includes(c.verdict) || c.verdict === "status_unknown").map(c => ({ kind: c.kind, statement: c.statement, verdict: c.verdict, partOf: c.partOf, lastSeen: iso(c.lastSeen) })),
    significance: grounded?.significance ?? null,
    organizations: anchors.organizations,
  };
  const status = await finish(lines.length >= MIN_LINES ? "revealed" : "empty", {
    revealJson: lines.length >= MIN_LINES ? { lines, readyMs: at() } : null,
    understandingJson,
  });

  // what public research verifies afterwards is kept for the experience that follows; it is never forced into words,
  // and nothing that goes wrong here touches the lines already written
  try {
    await Promise.race([pub.settled(), sleep(DEEP_CAP_MS - at())]);
    mark("public research");
    await args.save({
      publicJson: {
        profiles: pub.handles,
        candidates: pub.candidates,
        findings: pub.snapshot().map(f => ({ id: f.id, source: f.source, signal: f.signal, text: f.text, url: f.url, at: iso(f.at), identity: f.identity })),
        rejected: pub.rejected.length,
      },
      timingsJson: { ...times },
    });
    console.log(`[FirstRead] public research kept at ${(at() / 1000).toFixed(1)}s: ${pub.snapshot().length} findings, profiles ${Object.keys(pub.handles).join(", ") || "none"}`);
  } catch (error) {
    console.warn("[FirstRead] public research couldn't be kept:", error instanceof Error ? error.name : "unknown");
  }
  return status;
}

/** What the browser may see: the lines, and how long it has been. Nothing else leaves the server. */
export async function firstReadView(journeyId: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): Promise<FirstReadView> {
  const off: FirstReadView = { status: "off", lines: [], elapsedMs: 0, deadlineMs: FIRST_READ_DEADLINE_MS };
  if (!firstReadOn(env)) return off;
  const db = await firstTenDb();
  const [row] = await db.select().from(firstTenFirstReads).where(eq(firstTenFirstReads.journeyId, journeyId)).limit(1);
  if (!row) return off;
  return viewOf(row, now);
}

export function viewOf(row: Pick<Row, "status" | "startedAt" | "revealJson">, now: number): FirstReadView {
  const elapsedMs = Math.max(0, now - row.startedAt.getTime());
  const status = row.status === "running" && elapsedMs > ABANDONED_MS ? "failed" : row.status;
  return { status, lines: status === "revealed" ? (row.revealJson?.lines ?? []) : [], elapsedMs, deadlineMs: FIRST_READ_DEADLINE_MS };
}
