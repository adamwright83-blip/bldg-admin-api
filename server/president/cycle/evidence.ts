import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { EvidenceItem } from "../../../shared/presidentCycle";
import { runCommand } from "../fabric/exec";

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
    summary,
    ref,
    basis,
  };
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

  const todo = await runCommand(
    "git grep -c -E 'TODO|FIXME' -- 'server/*.ts' 'client/src/*.tsx' | awk -F: '{s+=$2} END {print s+0}'",
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

  const tests = await runCommand(
    "git ls-files 'server/**/*.test.ts' | wc -l",
    input.repoRoot,
    { timeoutMs: 20_000 }
  );
  const srcs = await runCommand(
    "git ls-files 'server/**/*.ts' | grep -v '.test.ts' | wc -l",
    input.repoRoot,
    { timeoutMs: 20_000 }
  );
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
