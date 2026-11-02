import { CoverageLedger } from "../../firstTenMinutes/research/coverage";
import { googleResearch, type DriveEntry, type MailHeader } from "../../firstTenMinutes/research/googleResearch";
import type { GoogleAccess } from "../../firstTenMinutes/understanding/googleReaders";
import { readOnlyFetch } from "../coldTest";
import type { BenchResult } from "./bench";

/**
 * Where did a fact go missing? For each term (a name the owner expected; never a production special case), trace it
 * through the stages:
 *
 *   exists      does the account hold it at all (Drive full text, Gmail all mail, Gmail Sent)?
 *   reachable   would a strategy's retrieval have fetched it (its newest item vs the windows the strategy reads)?
 *   retrieved   was it in the evidence a saved run actually read?
 *   stated      did a verified answer state it?
 *
 * Reads metadata only (counts, file names, dates, subjects) through `readOnlyFetch`.
 */

export type TermTrace = {
  term: string;
  drive: { count: number; newest: Array<{ name: string; modifiedAt: string; mine: boolean; mimeType: string }> };
  gmail: { all: number | null; sent: number | null; newestSent: Array<{ at: string; subject: string; to: string }> };
  /** runs whose evidence held it, and runs whose stated claims mention it */
  retrievedIn: string[];
  statedIn: string[];
  diagnosis: string;
};

const quoted = (term: string) => `"${term.replace(/"/g, "")}"`;

export async function traceTerms(access: GoogleAccess, terms: readonly string[], saved: BenchResult | null, deps: { fetch?: typeof fetch; now?: () => Date } = {}): Promise<TermTrace[]> {
  const now = deps.now ?? (() => new Date());
  const research = googleResearch(access, new CoverageLedger(now), { fetch: readOnlyFetch(deps.fetch), now });
  const owner = access.ownerEmail.toLowerCase();
  return Promise.all(
    terms.map(async term => {
      const [files, all, sent, sentItems] = await Promise.all([
        research.searchDrive([term], { limit: 50 }),
        research.countMail(quoted(term)),
        research.countMail(`in:sent ${quoted(term)}`),
        research.searchMail(`in:sent ${quoted(term)}`, { limit: 5 }),
      ]);
      const mine = (file: DriveEntry) => file.owners.some(p => p.email === owner) || file.lastModifiedBy?.email === owner;
      const lower = term.toLowerCase();
      const runs = saved?.runs ?? [];
      const retrievedIn = runs.filter(run => run.answers.some(a => a.evidence.some(e => `${e.title} ${e.text}`.toLowerCase().includes(lower)))).map(run => `${run.variant}#${run.run}`);
      const statedIn = runs
        .filter(run => run.answers.some(a => a.claims.some(c => ["active", "open_problem", "happened", "ended", "relationship", "in_progress"].includes(c.verdict) && `${c.statement} ${c.people.join(" ")}`.toLowerCase().includes(lower))))
        .map(run => `${run.variant}#${run.run}`);
      const driveFiles = files ?? [];
      const newestSent = (sentItems?.items ?? []).sort((a: MailHeader, b: MailHeader) => b.at.getTime() - a.at.getTime());
      const newestFile = driveFiles[0]?.modifiedAt;
      const age = (date: Date | undefined) => (date ? Math.round((now().getTime() - date.getTime()) / 86_400_000) : null);
      const diagnosis = !driveFiles.length && !all
        ? "not in the account under this name: nothing to find (or it's called something else)"
        : retrievedIn.length === 0
          ? `exists (Drive ${driveFiles.length}${newestFile ? `, newest edited ${age(newestFile)} days ago` : ""}; mail ${all ?? "?"}, Sent ${sent ?? "?"}${newestSent[0] ? `, newest sent ${age(newestSent[0].at)} days ago` : ""}) but no run retrieved it: a retrieval miss`
          : statedIn.length === 0
            ? `retrieved in ${retrievedIn.length} run(s) but never stated: a synthesis or verification miss`
            : `stated in ${statedIn.length} of ${runs.length} runs`;
      return {
        term,
        drive: { count: driveFiles.length, newest: driveFiles.slice(0, 5).map(file => ({ name: file.name, modifiedAt: file.modifiedAt.toISOString().slice(0, 10), mine: mine(file), mimeType: file.mimeType.replace("application/vnd.google-apps.", "") })) },
        gmail: { all, sent, newestSent: newestSent.slice(0, 3).map(item => ({ at: item.at.toISOString().slice(0, 10), subject: item.subject, to: item.to.map(p => p.name ?? p.email).join(", ") })) },
        retrievedIn,
        statedIn,
        diagnosis,
      };
    })
  );
}

export function traceReport(traces: readonly TermTrace[]): string {
  return traces
    .map(t =>
      [
        `## ${t.term}`,
        `- ${t.diagnosis}`,
        `- Drive (full text or name): ${t.drive.count}${t.drive.newest.length ? `; newest: ${t.drive.newest.map(f => `“${f.name}” (${f.mimeType}, ${f.modifiedAt}${f.mine ? ", yours" : ""})`).join("; ")}` : ""}`,
        `- Gmail: all mail ${t.gmail.all ?? "?"}, Sent ${t.gmail.sent ?? "?"}${t.gmail.newestSent.length ? `; newest sent: ${t.gmail.newestSent.map(m => `${m.at} to ${m.to}: “${m.subject}”`).join("; ")}` : ""}`,
        `- retrieved in: ${t.retrievedIn.join(", ") || "none"}; stated in: ${t.statedIn.join(", ") || "none"}`,
      ].join("\n")
    )
    .join("\n\n");
}
