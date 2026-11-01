import { refreshGoogleAccess } from "../../firstTenMinutes/google";
import { CoverageLedger } from "../../firstTenMinutes/research/coverage";
import { GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, googleResearch, type DriveEntry, type MailHeader } from "../../firstTenMinutes/research/googleResearch";
import { mapLimit, type GoogleAccess } from "../../firstTenMinutes/understanding/googleReaders";
import type { Mailbox } from "../../firstTenMinutes/understanding/sources";
import { readOnlyFetch } from "../coldTest";
import {
  FIRST_READ_PROMPTS,
  geminiReading,
  scoreExpectations,
  verifyReading,
  type Evidence,
  type Expectations,
  type FirstReadSource,
  type ModelCall,
  type Verified,
} from "./synthesis";
import { searchCorpus, type WorkspaceSearch } from "./workspaceSearch";

/**
 * The first-sixty-seconds benchmark: how fast, and how well, can JOYSTICK answer the owner's two questions right after
 * Google is connected? Two retrieval paths, timed stage by stage, each answered by the same Gemini call:
 *
 *  - `rest`: JOYSTICK's own readers (server/firstTenMinutes/research/googleResearch.ts) on the already-granted
 *    gmail.readonly and drive.readonly scopes. Gmail and Drive run concurrently; each answer starts as soon as its
 *    own evidence is in.
 *  - `mcp`: Google's Universal Search MCP `search_corpus` (Developer Preview) with the same token, asked the
 *    questions verbatim. It returns snippets and links, no dates and no answer.
 *
 * Read-only throughout: REST goes through the cold-test harness's `readOnlyFetch`; MCP through `workspaceSearchFetch`,
 * which lets only `search_corpus` out. Nothing is written to the database; a refreshed token stays in memory.
 */

export type BenchPath = "rest" | "mcp";

export type PathRun = {
  path: BenchPath;
  /** retrieval wall time per source (MCP: per query) */
  retrievalMs: Record<FirstReadSource, number>;
  synthesisMs: Record<FirstReadSource, number>;
  /** connect → this source's answer is ready (auth + retrieval + synthesis) */
  readyMs: Record<FirstReadSource, number>;
  /** connect → both answers ready */
  totalMs: number;
  evidence: Record<FirstReadSource, Evidence[]>;
  coverage: Record<FirstReadSource, Record<string, number>>;
  calls: ModelCall[];
  verified: Partial<Record<FirstReadSource, Verified>>;
  mcp?: WorkspaceSearch[];
  notes: string[];
};

export type BenchResult = {
  startedAt: string;
  account: string;
  grantedScopes: string[];
  authMs: number;
  runs: PathRun[];
  costCents: number;
  expectations: ReturnType<typeof scoreExpectations> | null;
};

const DAY = 86_400_000;
const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);
const who = (people: readonly Mailbox[]) => people.slice(0, 4).map(p => (p.name ? `${p.name} <${p.email}>` : p.email)).join(", ");

/** The owner's own outgoing mail: the last four months closely, and one message a month before that, for contrast. */
async function gmailEvidence(research: ReturnType<typeof googleResearch>, now: Date, ledger: CoverageLedger): Promise<Evidence[]> {
  const [recent, history] = await Promise.all([
    research.searchMail("in:sent", { limit: 40, window: { from: new Date(now.getTime() - 120 * DAY), to: now } }),
    research.sentHistory({ months: 24, perWindow: 3 }),
  ]);
  const own = (items: readonly MailHeader[]) => items.filter(item => item.sentByOwner && !item.automated);
  const latest = own(recent?.items ?? []).sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 25);
  const seen = new Set(latest.map(item => item.threadId));
  const older = (history ?? [])
    .filter(window => window.to.getTime() < now.getTime() - 120 * DAY)
    .flatMap(window => own(window.items).filter(item => !seen.has(item.threadId)).slice(0, 1))
    .slice(0, 16);
  const picked = [...latest, ...older];
  const full = await mapLimit(picked, 8, item => research.readMessage(item.id));
  ledger.record({ source: "gmail", operation: "first_read_sample", target: "in:sent", status: "ok", items: picked.length });
  return picked.map((item, index) => ({
    id: `g${index + 1}`,
    source: "gmail",
    at: item.at,
    title: item.subject || "(no subject)",
    people: who(item.to),
    text: clipText(full[index]?.text || item.snippet, 900),
  }));
}

/** Recent Docs, Slides and Sheets, the owner's own first; the documents' text in two passages each. */
async function driveEvidence(research: ReturnType<typeof googleResearch>, now: Date, owner: string): Promise<Evidence[]> {
  const files = (await research.recentFiles({ since: new Date(now.getTime() - 730 * DAY), limit: 40, mimeTypes: [GOOGLE_DOC, GOOGLE_SLIDES, GOOGLE_SHEET] })) ?? [];
  const mine = (file: DriveEntry) => file.owners.some(p => p.email.toLowerCase() === owner.toLowerCase()) || file.lastModifiedBy?.email.toLowerCase() === owner.toLowerCase();
  const ordered = [...files.filter(mine), ...files.filter(file => !mine(file))].slice(0, 30);
  const documents = ordered.filter(file => file.mimeType !== GOOGLE_SHEET).slice(0, 10);
  const reads = await mapLimit(documents, 6, file => research.readDocument(file, { maxPassages: 2 }));
  const text = new Map(reads.flatMap(read => (read && !read.excluded ? [[read.file.id, read.passages.map(p => p.text).join(" … ")] as const] : [])));
  return ordered.map((file, index) => ({
    id: `d${index + 1}`,
    source: "drive",
    at: file.modifiedAt,
    title: `${file.name} (${file.mimeType === GOOGLE_SHEET ? "sheet" : file.mimeType === GOOGLE_SLIDES ? "slides" : "doc"}, modified)`,
    people: who([...file.owners, ...(file.lastModifiedBy ? [file.lastModifiedBy] : [])]),
    text: clipText(text.get(file.id) ?? "(not read: title and date only)", 1100),
  }));
}

function counts(evidence: readonly Evidence[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of evidence) out[item.source] = (out[item.source] ?? 0) + 1;
  return out;
}

export type BenchInput = {
  google: GoogleAccess;
  paths: BenchPath[];
  geminiKey: string;
  model: string;
  expect?: Expectations | null;
  centsPerMillion: { input: number; output: number };
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
};

export async function runFirstReadBench(input: BenchInput): Promise<BenchResult> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const google = readOnlyFetch(input.fetch);

  // Auth overhead: a fresh access token, as a new connection would have one. Kept in memory only.
  const authStarted = Date.now();
  const tokens = input.google.refreshToken
    ? await refreshGoogleAccess({ refreshToken: input.google.refreshToken }, { fetch: google, env: input.env })
    : { accessToken: input.google.accessToken, expiresAt: input.google.accessExpiresAt ?? new Date(Date.now() + 30 * 60_000) };
  const authMs = Date.now() - authStarted;
  const access: GoogleAccess = { ...input.google, accessToken: tokens.accessToken, accessExpiresAt: tokens.expiresAt, onRefreshed: async () => undefined };

  const answer = async (source: FirstReadSource, evidence: Evidence[], calls: ModelCall[]) => {
    if (!evidence.length) return { verified: undefined, ms: 0 };
    const { reading, call } = await geminiReading({ question: FIRST_READ_PROMPTS[source], evidence, today: now(), model: input.model, apiKey: input.geminiKey }, { fetch: input.fetch });
    calls.push(call);
    return { verified: reading ? verifyReading(reading, evidence, now()) : undefined, ms: call.latencyMs };
  };

  const runs: PathRun[] = [];
  for (const path of input.paths) {
    const started = Date.now();
    const run: PathRun = {
      path,
      retrievalMs: { gmail: 0, drive: 0 },
      synthesisMs: { gmail: 0, drive: 0 },
      readyMs: { gmail: 0, drive: 0 },
      totalMs: 0,
      evidence: { gmail: [], drive: [] },
      coverage: { gmail: {}, drive: {} },
      calls: [],
      verified: {},
      notes: [],
    };
    const ledger = new CoverageLedger(now);
    const research = googleResearch(access, ledger, { fetch: google, env: input.env, now });
    const retrieve = async (source: FirstReadSource): Promise<Evidence[]> => {
      if (path === "rest") return source === "gmail" ? gmailEvidence(research, now(), ledger) : driveEvidence(research, now(), access.ownerEmail);
      const search = await searchCorpus({ accessToken: access.accessToken, query: FIRST_READ_PROMPTS[source], pageSize: 50 }, { fetch: input.fetch });
      (run.mcp ??= []).push(search);
      return search.hits.map((hit, index) => ({
        id: `${source === "gmail" ? "m" : "n"}${index + 1}`,
        source: hit.corpus,
        at: null,
        title: hit.title || "(untitled)",
        people: hit.detail,
        text: clipText(hit.snippet, 900),
      }));
    };
    await Promise.all(
      (["gmail", "drive"] as const).map(async source => {
        const fetched = Date.now();
        const evidence = await retrieve(source);
        run.retrievalMs[source] = Date.now() - fetched;
        run.evidence[source] = evidence;
        run.coverage[source] = counts(evidence);
        const { verified, ms } = await answer(source, evidence, run.calls);
        run.synthesisMs[source] = ms;
        run.verified[source] = verified;
        run.readyMs[source] = authMs + (Date.now() - started);
      })
    );
    run.totalMs = authMs + (Date.now() - started);
    const failed = ledger.all().filter(entry => entry.status === "failed");
    if (failed.length) run.notes.push(`${failed.length} Google read(s) failed: ${[...new Set(failed.map(entry => `${entry.source} ${entry.operation}: ${entry.reason}`))].slice(0, 5).join("; ")}`);
    if (path === "mcp") run.notes.push("search_corpus returns no dates, so 'current' vs 'past' cannot be checked from its results alone.");
    if (path === "rest") run.notes.push("Drive dates are modification times: a starting point, never proof of activity.");
    runs.push(run);
  }

  const tokensIn = runs.flatMap(run => run.calls).reduce((sum, call) => sum + call.inputTokens, 0);
  const tokensOut = runs.flatMap(run => run.calls).reduce((sum, call) => sum + call.outputTokens, 0);
  const costCents = (tokensIn * input.centsPerMillion.input + tokensOut * input.centsPerMillion.output) / 1_000_000;
  const readings = runs.flatMap(run => Object.values(run.verified).flatMap(v => (v ? [v.reading] : [])));
  return {
    startedAt: startedAt.toISOString(),
    account: access.ownerEmail,
    grantedScopes: access.grantedScopes,
    authMs,
    runs,
    costCents,
    expectations: input.expect ? scoreExpectations(readings, input.expect) : null,
  };
}

// ------------------------------------------------------------------ report

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function benchReport(result: BenchResult): string {
  const lines: string[] = [
    `# First reading benchmark, ${result.startedAt}`,
    "",
    `Account: ${result.account}. Granted: ${result.grantedScopes.map(scope => scope.replace("https://www.googleapis.com/auth/", "")).join(", ")}.`,
    `Auth (token refresh): ${seconds(result.authMs)}. Model cost, all paths: ${result.costCents.toFixed(2)}¢.`,
    "",
    "| path | Gmail retrieval | Drive retrieval | Gmail answer | Drive answer | Gmail ready | Drive ready | both ready |",
    "|---|---|---|---|---|---|---|---|",
    ...result.runs.map(run => `| ${run.path} | ${seconds(run.retrievalMs.gmail)} | ${seconds(run.retrievalMs.drive)} | ${seconds(run.synthesisMs.gmail)} | ${seconds(run.synthesisMs.drive)} | ${seconds(run.readyMs.gmail)} | ${seconds(run.readyMs.drive)} | ${seconds(run.totalMs)} |`),
    "",
  ];
  if (result.expectations) {
    lines.push(
      "## Against your expectations",
      "",
      `- Found: ${result.expectations.found.join(", ") || "none"}`,
      `- Missed: ${result.expectations.missed.join(", ") || "none"}`,
      `- Called current but shouldn't be: ${result.expectations.wronglyCurrent.join(", ") || "none"}`,
      ""
    );
  }
  for (const run of result.runs) {
    lines.push(`## ${run.path.toUpperCase()}`, "");
    for (const note of run.notes) lines.push(`- ${note}`);
    for (const search of run.mcp ?? []) {
      lines.push(`- search_corpus (${seconds(search.latencyMs)}): ${search.ok ? `${search.hits.length} hits ${JSON.stringify(counts(search.hits.map(hit => ({ source: hit.corpus }) as Evidence)))}` : `REFUSED ${search.status}: ${search.error}`}`);
    }
    for (const call of run.calls) lines.push(`- ${call.model}: ${seconds(call.latencyMs)}, ${call.inputTokens} in / ${call.outputTokens} out${call.error ? `, FAILED: ${call.error}` : ""}`);
    lines.push("");
    for (const source of ["gmail", "drive"] as const) {
      const verified = run.verified[source];
      const evidence = new Map(run.evidence[source].map(item => [item.id, item]));
      lines.push(`### ${source === "gmail" ? "Sent mail" : "Drive"} (${run.evidence[source].length} evidence items: ${JSON.stringify(run.coverage[source])})`, "");
      if (!verified) {
        lines.push("No answer.", "");
        continue;
      }
      const cite = (ids: string[]) =>
        ids.map(id => {
          const item = evidence.get(id)!;
          return `${id} ${item.at ? item.at.toISOString().slice(0, 10) : "undated"} “${clipText(item.title, 60)}”`;
        }).join("; ");
      for (const p of verified.reading.priorities) lines.push(`- **${p.title}** (${p.status}, ${p.aim}): ${p.summary} People: ${p.people.join(", ") || "—"}. [${cite(p.evidence)}]`);
      if (verified.reading.olderAmbitions.length) {
        lines.push("", "Older ambitions:");
        for (const o of verified.reading.olderAmbitions) lines.push(`- ${o.title}: ${o.summary} [${cite(o.evidence)}]`);
      }
      if (verified.reading.people.length) lines.push("", `People: ${verified.reading.people.map(p => `${p.name} (${p.role})`).join("; ")}`);
      if (verified.reading.unsure.length) lines.push("", `Unsure: ${verified.reading.unsure.join("; ")}`);
      lines.push(
        "",
        `Checks: ${verified.citations.valid}/${verified.citations.total} citations real; struck ${verified.struck.length ? verified.struck.join(", ") : "nothing"}; "current" on old evidence only: ${verified.staleCurrent.join(", ") || "none"}; "current" on undated evidence only: ${verified.undatedCurrent.join(", ") || "none"}.`,
        ""
      );
    }
  }
  return lines.join("\n");
}
