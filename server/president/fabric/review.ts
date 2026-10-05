import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { Mission, ReviewVerdict } from "../../../shared/presidentCycle";
import { runCommand, assertSafeValidationCommand, type CommandResult } from "./exec";
import {
  protectedViolations,
  runBrowserCheck,
  type GitHost,
} from "./engineering";
import { assertIndependentReviewer } from "./router";

/* ------------------------------------------------------------------ verdict */

export type VerdictInput = {
  evidencePresent: boolean;
  requiredChecks: { command: string; ok: boolean }[];
  browserRequired: boolean;
  browserOk: boolean | null;
  scopeViolations: string[];
  reviewerTreeClean: boolean;
  modelVerdict: ReviewVerdict | null;
  environmentBlock?: string;
};

/** Pure, exhaustively tested. Evidence and checks can veto PASS; a model can never grant it alone. */
export function decideVerdict(i: VerdictInput): { verdict: ReviewVerdict; reasons: string[] } {
  if (i.environmentBlock) return { verdict: "BLOCKED", reasons: [i.environmentBlock] };
  if (i.modelVerdict === null)
    return { verdict: "BLOCKED", reasons: ["Reviewer model unavailable; cannot certify"] };
  const fails: string[] = [];
  if (!i.evidencePresent) fails.push("Required evidence is missing");
  for (const c of i.requiredChecks) if (!c.ok) fails.push(`Required check failed: ${c.command}`);
  if (i.browserRequired && i.browserOk !== true) fails.push("Required browser validation did not pass");
  if (i.scopeViolations.length) fails.push(`Out-of-scope/protected files: ${i.scopeViolations.join(", ")}`);
  if (!i.reviewerTreeClean) fails.push("Reviewer working tree was modified; reviewers may not fix and certify");
  if (fails.length) return { verdict: "FAIL", reasons: fails };
  if (i.modelVerdict === "BLOCKED") return { verdict: "BLOCKED", reasons: ["Reviewer reported a real blocker"] };
  if (i.modelVerdict === "FAIL") return { verdict: "FAIL", reasons: ["Reviewer found a defect"] };
  return { verdict: "PASS", reasons: ["All gates and reviewer passed"] };
}

/* ---------------------------------------------------------- reviewer model */

export interface ReviewerModel {
  review(prompt: string, cwd: string): Promise<string>;
}

/** Read-only: Edit/Write/Bash are denied at the tool layer, not just by prompt. */
export class ClaudeReadOnlyReviewerModel implements ReviewerModel {
  constructor(private readonly model = process.env.PRESIDENT_REVIEWER_MODEL || "sonnet") {}
  review(prompt: string, cwd: string) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        "claude",
        [
          "--print",
          "--output-format",
          "json",
          "--model",
          this.model,
          "--allowedTools",
          "Read,Glob,Grep",
          "--disallowedTools",
          "Edit,Write,Bash,NotebookEdit",
          "--max-budget-usd",
          process.env.PRESIDENT_REVIEWER_MAX_USD || "2",
        ],
        { cwd, stdio: ["pipe", "pipe", "pipe"] }
      );
      let out = "",
        err = "";
      child.stdout.on("data", d => (out += d));
      child.stderr.on("data", d => (err += d));
      const t = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
      child.on("error", reject);
      child.on("close", code => {
        clearTimeout(t);
        if (code !== 0) return reject(new Error(`reviewer exited ${code}: ${err.slice(0, 200)}`));
        try {
          const p = JSON.parse(out);
          if (p.is_error) return reject(new Error(String(p.result).slice(0, 200)));
          resolve(String(p.result));
        } catch {
          reject(new Error("reviewer returned non-JSON"));
        }
      });
      child.stdin.end(prompt);
    });
  }
}

function parseModelVerdict(text: string): { verdict: ReviewVerdict; reasons: string[] } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    if (!["PASS", "FAIL", "BLOCKED"].includes(v.verdict)) return null;
    return { verdict: v.verdict, reasons: Array.isArray(v.reasons) ? v.reasons.map(String) : [] };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- reviewer */

export type EngineeringReviewContext = {
  mission: Mission;
  repoRoot: string;
  reviewRoot: string;
  branch: string;
  baseSha: string;
  commitSha: string;
  prUrl: string | null;
  executorActorId: string;
  executorChecks: { command: string; exitCode: number; ok: boolean }[];
  browserEvidencePath?: string;
};

export type ReviewResult = {
  verdict: ReviewVerdict;
  reasons: string[];
  checks: { command: string; exitCode: number; ok: boolean }[];
  browserOk: boolean | null;
  screenshotPath?: string;
  actorId: string;
};

export class IndependentReviewer {
  readonly actorId = "president-independent-reviewer";
  constructor(
    private readonly model: ReviewerModel | null,
    private readonly github: GitHost | null
  ) {}

  async reviewEngineering(ctx: EngineeringReviewContext): Promise<ReviewResult> {
    assertIndependentReviewer(ctx.executorActorId, this.actorId);
    const dir = join(ctx.reviewRoot, `${ctx.mission.missionId}-review-${ctx.commitSha.slice(0, 8)}`);
    const block = (why: string): ReviewResult => ({
      verdict: "BLOCKED",
      reasons: [why],
      checks: [],
      browserOk: null,
      actorId: this.actorId,
    });
    mkdirSync(ctx.reviewRoot, { recursive: true });
    if (!existsSync(dir)) {
      const w = await runCommand(`git worktree add --detach '${dir}' ${ctx.commitSha}`, ctx.repoRoot, {
        timeoutMs: 120_000,
      });
      if (w.exitCode !== 0) return block(`reviewer checkout failed: ${w.stderr.slice(0, 200)}`);
      const nm = join(ctx.repoRoot, "node_modules");
      if (existsSync(nm))
        await runCommand(`ln -s '${nm}' '${dir}/node_modules'`, ctx.repoRoot);
    }
    // The reviewer's own evidence: diff recomputed independently from git.
    const files = (
      await runCommand(`git diff --name-only ${ctx.baseSha} ${ctx.commitSha}`, ctx.repoRoot)
    ).stdout
      .split("\n")
      .filter(Boolean);
    const scopeViolations = protectedViolations(files);
    const prExists = this.github && ctx.prUrl ? (await this.github.findPr(ctx.branch)) === ctx.prUrl : false;
    const evidencePresent = files.length > 0 && !!ctx.prUrl && prExists;

    // Reviewer reruns critical checks itself; executor-reported results are not trusted.
    const checks: ReviewResult["checks"] = [];
    for (const cmd of ctx.mission.requiredValidation.commands) {
      assertSafeValidationCommand(cmd);
      const r: CommandResult = await runCommand(cmd, dir, { timeoutMs: 900_000 });
      checks.push({ command: cmd, exitCode: r.exitCode, ok: r.exitCode === 0 });
    }
    let browserOk: boolean | null = null;
    let screenshotPath: string | undefined;
    const browser = ctx.mission.requiredValidation.browser;
    if (browser) {
      const shot = join(ctx.reviewRoot, `${ctx.mission.missionId}-review.png`);
      const b = await runBrowserCheck(browser, dir, shot);
      browserOk = b.ok;
      screenshotPath = b.screenshotPath;
    }

    let modelVerdict: ReviewVerdict | null = null;
    let modelReasons: string[] = [];
    let environmentBlock: string | undefined;
    if (!this.model) environmentBlock = "Reviewer model not configured";
    else {
      const diff = (
        await runCommand(`git diff ${ctx.baseSha} ${ctx.commitSha}`, ctx.repoRoot, { maxBytes: 80_000 })
      ).stdout;
      const prompt = `You are the INDEPENDENT reviewer of a President mission. You did not write this code and you must not fix it.
Mission: ${ctx.mission.title}
Objective: ${ctx.mission.objective}
Scope: ${ctx.mission.scope}
Acceptance criteria:
${ctx.mission.acceptanceCriteria.map(c => `- ${c}`).join("\n")}
Adam approval receipt: ${ctx.mission.approvalReceiptId}
Check for: scope creep beyond the approved mission, invariant/security problems, tests that do not really prove the criteria, fake evidence.
Harness already reran checks: ${JSON.stringify(checks)}.
DIFF:
${diff}
Reply with ONLY JSON: {"verdict":"PASS"|"FAIL"|"BLOCKED","reasons":["..."]}. FAIL = repairable defect. BLOCKED = real dependency/authority/environment problem.`;
      try {
        const parsed = parseModelVerdict(await this.model.review(prompt, dir));
        if (parsed) {
          modelVerdict = parsed.verdict;
          modelReasons = parsed.reasons;
        } else environmentBlock = "Reviewer returned unparseable verdict";
      } catch (e) {
        environmentBlock = `Reviewer model error: ${(e as Error).message}`;
      }
    }
    const treeClean = (await runCommand("git status --porcelain --untracked-files=all", dir)).stdout
      .split("\n")
      .filter(l => l && !l.includes("node_modules")).length === 0;

    const d = decideVerdict({
      evidencePresent,
      requiredChecks: checks,
      browserRequired: !!browser,
      browserOk,
      scopeViolations,
      reviewerTreeClean: treeClean,
      modelVerdict,
      environmentBlock,
    });
    return {
      ...d,
      reasons: [...d.reasons, ...modelReasons],
      checks,
      browserOk,
      screenshotPath,
      actorId: this.actorId,
    };
  }

  async reviewResearch(ctx: {
    mission: Mission;
    artifactPath?: string;
    artifactText?: string;
    repoSnapshot: string;
    executorActorId: string;
  }): Promise<ReviewResult> {
    assertIndependentReviewer(ctx.executorActorId, this.actorId);
    const text =
      ctx.artifactText ??
      (ctx.artifactPath && existsSync(ctx.artifactPath)
        ? readFileSync(ctx.artifactPath, "utf8")
        : "");
    const problems = validateResearchArtifact(text, ctx.repoSnapshot);
    let modelVerdict: ReviewVerdict | null = null;
    let reasons: string[] = [];
    let environmentBlock: string | undefined;
    if (!this.model) environmentBlock = "Reviewer model not configured";
    else {
      try {
        const parsed = parseModelVerdict(
          await this.model.review(
            `You are the INDEPENDENT reviewer of a research artifact. Challenge unsupported claims, verify requested questions were answered, identify missing evidence. Do not rewrite it.
Objective: ${ctx.mission.objective}
Acceptance criteria:
${ctx.mission.acceptanceCriteria.map(c => `- ${c}`).join("\n")}
You may Read files in the repository to verify cited sources.
ARTIFACT:
${text.slice(0, 40_000)}
Reply ONLY JSON: {"verdict":"PASS"|"FAIL"|"BLOCKED","reasons":["..."]}`,
            ctx.repoSnapshot
          )
        );
        if (parsed) {
          modelVerdict = parsed.verdict;
          reasons = parsed.reasons;
        } else environmentBlock = "Reviewer returned unparseable verdict";
      } catch (e) {
        environmentBlock = `Reviewer model error: ${(e as Error).message}`;
      }
    }
    const d = decideVerdict({
      evidencePresent: text.length > 0 && problems.length === 0,
      requiredChecks: problems.map(p => ({ command: p, ok: false })),
      browserRequired: false,
      browserOk: null,
      scopeViolations: [],
      reviewerTreeClean: true,
      modelVerdict,
      environmentBlock,
    });
    return {
      ...d,
      reasons: [...d.reasons, ...reasons],
      checks: [],
      browserOk: null,
      actorId: this.actorId,
    };
  }
}

/* ------------------------------------------------------------------ research */

export const RESEARCH_SECTIONS = [
  "## Findings (evidence)",
  "## Inferences (judgment)",
  "## Sources",
  "## State changes",
];

/** Code-level provenance check: structure present and every cited source file exists. */
export function validateResearchArtifact(text: string, repoRoot: string): string[] {
  const problems: string[] = [];
  for (const s of RESEARCH_SECTIONS)
    if (!text.includes(s)) problems.push(`missing section "${s}"`);
  const sources = text.split("## Sources")[1]?.split(/\n## /)[0] ?? "";
  const refs = [...sources.matchAll(/`([^`\s:]+\.[A-Za-z0-9]+)(?::\d+(?:-\d+)?)?`/g)].map(m => m[1]);
  if (refs.length === 0) problems.push("no sources cited");
  for (const r of refs) if (!existsSync(join(repoRoot, r))) problems.push(`cited source does not exist: ${r}`);
  const changes = text.split("## State changes")[1] ?? "";
  if (!/none/i.test(changes.slice(0, 200))) problems.push("research must declare no production state change");
  return problems;
}

export interface ResearchAgent {
  readonly actorId: string;
  run(input: { repoSnapshot: string; mission: Mission; feedback?: string }): Promise<string>;
}

export class ClaudeReadOnlyResearchAgent implements ResearchAgent {
  readonly actorId = "president-research-executor";
  constructor(private readonly model = process.env.PRESIDENT_RESEARCH_MODEL || "sonnet") {}
  run({ repoSnapshot, mission, feedback }: { repoSnapshot: string; mission: Mission; feedback?: string }) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        "claude",
        [
          "--print",
          "--output-format",
          "json",
          "--model",
          this.model,
          "--allowedTools",
          "Read,Glob,Grep",
          "--disallowedTools",
          "Edit,Write,Bash,NotebookEdit",
          "--max-budget-usd",
          process.env.PRESIDENT_EXECUTOR_MAX_USD || "3",
        ],
        { cwd: repoSnapshot, stdio: ["pipe", "pipe", "pipe"] }
      );
      let out = "",
        err = "";
      child.stdout.on("data", d => (out += d));
      child.stderr.on("data", d => (err += d));
      const t = setTimeout(() => child.kill("SIGKILL"), 20 * 60_000);
      child.on("error", reject);
      child.on("close", code => {
        clearTimeout(t);
        if (code !== 0) return reject(new Error(`research agent exited ${code}: ${err.slice(0, 200)}`));
        try {
          const p = JSON.parse(out);
          if (p.is_error) return reject(new Error(String(p.result).slice(0, 200)));
          resolve(String(p.result));
        } catch {
          reject(new Error("research agent returned non-JSON"));
        }
      });
      child.stdin.end(`You are the President research executor. Produce a written markdown artifact for this Adam-approved mission by reading the repository.
Mission: ${mission.title}
Objective: ${mission.objective}
Scope: ${mission.scope}
Acceptance criteria:
${mission.acceptanceCriteria.map(c => `- ${c}`).join("\n")}
Output ONLY markdown with exactly these H2 sections, in order:
${RESEARCH_SECTIONS.join("\n")}
Findings = things you directly observed in files (cite each). Inferences = your reasoning, clearly labeled as such.
Sources = a bullet list of repo-relative file paths in backticks, optionally with :line, e.g. \`server/index.ts:12\`. Only cite files you actually read.
State changes = the single word "None" (research changes no production state).${feedback ? `\n\nPREVIOUS ATTEMPT REJECTED:\n${feedback}` : ""}`);
    });
  }
}

export function writeArtifact(root: string, cycleId: string, missionId: string, text: string) {
  const path = join(root, cycleId, `${missionId}.md`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return { path, sha256: createHash("sha256").update(text).digest("hex") };
}
