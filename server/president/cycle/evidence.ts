import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { EvidenceItem } from "../../../shared/presidentCycle";
import { runCommand } from "../fabric/exec";
import { redactSecrets } from "./models";

const FOREIGN = /mitch/i;

function item(
  source: string,
  kind: string,
  summary: string,
  ref: string,
  basis: "EVIDENCE" | "JUDGMENT" = "EVIDENCE"
): EvidenceItem {
  const observedAt = new Date().toISOString();
  return {
    // Id is content-derived from source+kind+ref only, so it is stable across reads.
    id: `ev_${createHash("sha256")
      .update(`${source}|${kind}|${ref}`)
      .digest("hex")
      .slice(0, 12)}`,
    source,
    kind,
    observedAt,
    summary: redactSecrets(summary),
    ref,
    basis,
  };
}

async function githubJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(
      "https://api.github.com/repos/adamwright83-blip/bldg-admin-api" + path,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "joystick-president-evidence",
        },
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function publicGithubEvidence(): Promise<EvidenceItem[]> {
  const out: EvidenceItem[] = [];
  const [commits, pulls] = await Promise.all([
    githubJson<
      Array<{
        sha: string;
        commit?: { message?: string; committer?: { date?: string } };
      }>
    >("/commits?sha=main&per_page=40"),
    githubJson<
      Array<{
        number: number;
        title: string;
        updated_at: string;
        head?: { ref?: string };
      }>
    >("/pulls?state=open&per_page=30&sort=updated&direction=desc"),
  ]);

  for (const commit of commits ?? []) {
    const subject = commit.commit?.message?.split("\n")[0]?.trim();
    if (!subject || !commit.sha) continue;
    out.push(
      item(
        "github-public",
        "recent-commit",
        `${commit.commit?.committer?.date?.slice(0, 10) ?? "unknown date"}: ${subject}`,
        `commit:${commit.sha.slice(0, 12)}`
      )
    );
  }
  for (const pr of pulls ?? []) {
    out.push(
      item(
        "github-public",
        "open-pr",
        `#${pr.number} ${pr.title} (updated ${pr.updated_at})`,
        `pr:${pr.number}`
      )
    );
  }
  return out;
}

/**
 * Gathers company truth from neutral company sources: git history, open PRs,
 * repository scans, and an optional operator-supplied evidence file. A neutral
 * git/PR fact may mention any product area; the boundary is ownership of the
 * source itself, not whether its human-readable summary contains a seat name.
 */
export async function gatherCompanyEvidence(input: {
  repoRoot: string;
  operatorEvidenceFile?: string;
}): Promise<EvidenceItem[]> {
  const out: EvidenceItem[] = [];
  const git = await runCommand(
    "git log origin/main -n 40 --pretty=format:%h%x09%ad%x09%s --date=short",
    input.repoRoot,
    { timeoutMs: 30_000 }
  );
  if (git.exitCode === 0)
    for (const line of git.stdout.split("\n").filter(Boolean)) {
      const [sha, date, subject] = line.split("\t");
      out.push(
        item(
          "git",
          "recent-commit",
          `${date}: ${subject}`,
          `commit:${sha}`
        )
      );
    }

  const prs = await runCommand(
    "gh pr list --state open --limit 30 --json number,title,headRefName,updatedAt",
    input.repoRoot,
    { timeoutMs: 45_000 }
  );
  if (prs.exitCode === 0) {
    for (const p of JSON.parse(prs.stdout || "[]") as any[])
      out.push(
        item(
          "github",
          "open-pr",
          `#${p.number} ${p.title} (updated ${p.updatedAt})`,
          `pr:${p.number}`
        )
      );
  }

  // Railway runtime images are not guaranteed to contain .git or gh. Fall
  // back to the repository's public GitHub API so nightly President cycles
  // still have current code/PR evidence in production.
  if (git.exitCode !== 0 || prs.exitCode !== 0) {
    const fallback = await publicGithubEvidence();
    out.push(
      ...fallback.filter(
        evidence =>
          (git.exitCode !== 0 && evidence.kind === "recent-commit") ||
          (prs.exitCode !== 0 && evidence.kind === "open-pr")
      )
    );
  }

  let todo = await runCommand(
    "git grep -c -E 'TODO|FIXME' -- 'server/*.ts' 'client/src/*.tsx' | awk -F: '{s+=$2} END {print s+0}'",
    input.repoRoot,
    { timeoutMs: 30_000 }
  );
  if (todo.exitCode !== 0)
    todo = await runCommand(
      "grep -R -E 'TODO|FIXME' server client/src --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l",
      input.repoRoot,
      { timeoutMs: 30_000 }
    );
  if (todo.exitCode === 0)
    out.push(
      item(
        "repo-scan",
        "todo-fixme-count",
        `${todo.stdout.trim()} TODO/FIXME markers in server and client source`,
        "git-grep:TODO|FIXME"
      )
    );

  let tests = await runCommand(
    "git ls-files 'server/**/*.test.ts' | wc -l",
    input.repoRoot,
    { timeoutMs: 20_000 }
  );
  let srcs = await runCommand(
    "git ls-files 'server/**/*.ts' | grep -v '.test.ts' | wc -l",
    input.repoRoot,
    { timeoutMs: 20_000 }
  );
  if (tests.exitCode !== 0 || srcs.exitCode !== 0) {
    tests = await runCommand(
      "find server -type f -name '*.test.ts' | wc -l",
      input.repoRoot,
      { timeoutMs: 20_000 }
    );
    srcs = await runCommand(
      "find server -type f -name '*.ts' ! -name '*.test.ts' | wc -l",
      input.repoRoot,
      { timeoutMs: 20_000 }
    );
  }
  if (tests.exitCode === 0 && srcs.exitCode === 0)
    out.push(
      item(
        "repo-scan",
        "test-coverage-shape",
        `${tests.stdout.trim()} server test files vs ${srcs.stdout.trim()} server source files`,
        "git-ls-files:server"
      )
    );

  if (input.operatorEvidenceFile && existsSync(input.operatorEvidenceFile)) {
    const extra = JSON.parse(
      readFileSync(input.operatorEvidenceFile, "utf8")
    ) as Partial<EvidenceItem>[];
    for (const e of extra)
      out.push(
        item(
          e.source ?? "operator",
          e.kind ?? "operator-note",
          e.summary ?? "",
          e.ref ?? "operator-file",
          e.basis ?? "EVIDENCE"
        )
      );
  }

  // Seat boundary: reject peer-seat-owned sources/refs. Neutral company evidence
  // is not hidden merely because the fact itself mentions that product area.
  return out.filter(
    e => !FOREIGN.test(e.source) && !FOREIGN.test(e.ref) && !FOREIGN.test(e.kind)
  );
}
