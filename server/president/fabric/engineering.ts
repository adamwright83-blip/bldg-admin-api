import { spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import type { Mission } from "../../../shared/presidentCycle";
import {
  assertSafeAppStartCommand,
  runCommand,
  type CommandResult,
} from "./exec";

export const PROTECTED_PATHS: RegExp[] = [
  /^server\/commercialPipeline\//,
  /^server\/commercialCampaigns\//,
  /^server\/authority\//,
  /^server\/geography\//,
  /^server\/goldlineWorld\//,
  /^server\/lanternCity\//,
  /^server\/mitch\//,
  /^drizzle\/schema\.ts$/,
  /^server\/routers\.ts$/,
  /^package\.json$/,
  /^scripts\/migrate\.mjs$/,
  /^\.env/,
  /^\.github\/workflows\//,
];

export function protectedViolations(files: string[], extra: RegExp[] = []): string[] {
  return files.filter(f => [...PROTECTED_PATHS, ...extra].some(p => p.test(f)));
}

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export type Workspace = { dir: string; branch: string; baseSha: string };

export async function prepareWorkspace(
  repoRoot: string,
  workRoot: string,
  mission: Mission,
  baseSha: string
): Promise<Workspace> {
  mkdirSync(workRoot, { recursive: true });
  const dir = join(workRoot, mission.missionId);
  const branch = `president/${mission.missionId}`;
  if (!existsSync(dir)) {
    // A worker host may disappear after the branch has already been created/pushed.
    // Prune dead worktree registrations, then resume the mission branch when it
    // exists instead of trying to recreate it from the original base.
    await runCommand("git worktree prune", repoRoot, { timeoutMs: 30_000 });
    const local = await runCommand(
      `git show-ref --verify --quiet refs/heads/${branch}`,
      repoRoot
    );
    const remote = await runCommand(
      `git show-ref --verify --quiet refs/remotes/origin/${branch}`,
      repoRoot
    );
    let command: string;
    if (local.exitCode === 0) {
      command = `git worktree add ${sh(dir)} ${sh(branch)}`;
    } else if (remote.exitCode === 0) {
      command =
        `git branch --track ${sh(branch)} ${sh(`origin/${branch}`)} && ` +
        `git worktree add ${sh(dir)} ${sh(branch)}`;
    } else {
      command = `git worktree add -b ${sh(branch)} ${sh(dir)} ${sh(baseSha)}`;
    }
    const r = await runCommand(command, repoRoot, { timeoutMs: 120_000 });
    if (r.exitCode !== 0)
      throw new Error(`worktree add/resume failed: ${r.stderr.slice(0, 300)}`);
    const nm = join(repoRoot, "node_modules");
    if (existsSync(nm) && !existsSync(join(dir, "node_modules")))
      symlinkSync(nm, join(dir, "node_modules"));
  }
  return { dir, branch, baseSha };
}

/** Files changed relative to the pinned base: committed + staged + unstaged + untracked. */
export async function changedFiles(dir: string, baseSha?: string): Promise<string[]> {
  const a = await runCommand(`git diff --name-only ${baseSha ?? "HEAD"}`, dir);
  const b = await runCommand("git ls-files --others --exclude-standard", dir);
  return [...new Set([...a.stdout.split("\n"), ...b.stdout.split("\n")])]
    .filter(Boolean)
    .filter(f => !f.startsWith("node_modules"));
}

/** Agent port: the thing that actually edits the repo inside the isolated workspace. */
export interface EngineeringAgent {
  readonly actorId: string;
  run(input: {
    workdir: string;
    mission: Mission;
    feedback?: string;
  }): Promise<{ summary: string }>;
}

function missionBrief(m: Mission, feedback?: string) {
  return `You are the President engineering executor. Implement exactly this Adam-approved mission in the current git worktree.

MISSION ${m.missionId} (cycle ${m.cycleId}, candidate ${m.candidateId})
Title: ${m.title}
Objective: ${m.objective}
Business reason: ${m.businessReason}
Scope (do not exceed): ${m.scope}
Acceptance criteria:
${m.acceptanceCriteria.map(c => `- ${c}`).join("\n")}
Constraints: ${m.constraints.join("; ")}.
Required validation commands (will be run by the harness): ${m.requiredValidation.commands.join(" ; ") || "none"}

Rules: edit only files needed for this mission. Do not touch package.json, drizzle/schema.ts, server/routers.ts, .github, or any commercial/authority/geography/lantern/mitch directories. Do not commit, push, or merge; the harness does that. Do not run git commands that change history. Add or update tests that prove the acceptance criteria.
${feedback ? `\nPREVIOUS ATTEMPT FAILED. Fix these problems:\n${feedback}` : ""}`;
}

/** Real repo-editing agent backed by the Claude Code CLI inside the worktree. */
export class ClaudeCodeEngineeringAgent implements EngineeringAgent {
  readonly actorId = "president-engineering-executor";
  constructor(
    private readonly model = process.env.PRESIDENT_EXECUTOR_MODEL || "sonnet",
    private readonly maxUsd = process.env.PRESIDENT_EXECUTOR_MAX_USD || "3",
    private readonly timeoutMs = 25 * 60_000
  ) {}
  run({ workdir, mission, feedback }: { workdir: string; mission: Mission; feedback?: string }) {
    return new Promise<{ summary: string }>((resolve, reject) => {
      const child = spawn(
        "claude",
        [
          "--print",
          "--output-format",
          "json",
          "--model",
          this.model,
          "--permission-mode",
          "acceptEdits",
          "--allowedTools",
          "Read,Edit,Write,Glob,Grep,Bash(npx vitest:*),Bash(npx tsc:*),Bash(ls:*),Bash(cat:*)",
          "--max-budget-usd",
          this.maxUsd,
        ],
        { cwd: workdir, stdio: ["pipe", "pipe", "pipe"] }
      );
      let out = "",
        err = "";
      child.stdout.on("data", d => (out += d));
      child.stderr.on("data", d => (err += d));
      const timer = setTimeout(() => child.kill("SIGKILL"), this.timeoutMs);
      child.on("error", reject);
      child.on("close", code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`executor agent exited ${code}: ${err.slice(0, 300)}`));
        try {
          const p = JSON.parse(out);
          if (p.is_error) return reject(new Error(String(p.result).slice(0, 300)));
          resolve({ summary: String(p.result).slice(0, 4000) });
        } catch {
          reject(new Error("executor agent returned non-JSON"));
        }
      });
      child.stdin.end(missionBrief(mission, feedback));
    });
  }
}

export interface GitHost {
  /** Returns existing PR URL for the head branch if any. */
  findPr(branch: string): Promise<string | null>;
  createPr(input: { branch: string; title: string; body: string }): Promise<string>;
}

export class GhCliGitHost implements GitHost {
  constructor(private readonly repoRoot: string) {}
  async findPr(branch: string) {
    const r = await runCommand(
      `gh pr list --head ${sh(branch)} --state open --json url --jq '.[0].url // empty'`,
      this.repoRoot,
      { timeoutMs: 60_000 }
    );
    if (r.exitCode !== 0) throw new Error(`gh pr list failed: ${r.stderr.slice(0, 300)}`);
    return r.stdout.trim() || null;
  }
  async createPr({ branch, title, body }: { branch: string; title: string; body: string }) {
    const r = await runCommand(
      `gh pr create --base main --head ${sh(branch)} --title ${sh(title)} --body ${sh(body)}`,
      this.repoRoot,
      { timeoutMs: 90_000 }
    );
    if (r.exitCode !== 0) throw new Error(`gh pr create failed: ${r.stderr.slice(0, 300)}`);
    const url = r.stdout.trim().split("\n").pop()!;
    if (!/^https:\/\//.test(url)) throw new Error("gh pr create returned no URL");
    return url;
  }
}

export function prBody(m: Mission, p: {
  summary: string;
  files: string[];
  checks: CommandResult[];
  browser?: string;
}) {
  return `## President mission \`${m.missionId}\`
**Cycle:** \`${m.cycleId}\` · **Candidate:** \`${m.candidateId}\`

### Adam approval provenance
Approved by \`${m.approvedBy.identity}\` via \`${m.approvedBy.mechanism}\` at ${m.approvedAt}.
Approval receipt: \`${m.approvalReceiptId}\`

### Objective
${m.objective}

### Business reason
${m.businessReason}

### Acceptance criteria
${m.acceptanceCriteria.map(c => `- ${c}`).join("\n") || "- (none listed)"}

### Changes
${p.files.map(f => `- \`${f}\``).join("\n")}

${p.summary.slice(0, 1500)}

### Tests / checks
${p.checks.map(c => `- \`${c.command}\` → exit ${c.exitCode}`).join("\n") || "- none required"}
${p.browser ? `\n### Browser validation\n${p.browser}\n` : ""}
### Known limitations
Implementation only. Not merged, not deployed, no business outcome observed. Independent review is recorded separately by \`president-independent-reviewer\`. **Human merge required.**
`;
}

/** Commit + push mission branch. Refuses main. Idempotent when nothing new to commit. */
export async function commitAndPush(
  ws: Workspace,
  m: Mission,
  message: string
): Promise<{ commitSha: string }> {
  if (ws.branch === "main" || ws.branch === "master")
    throw new Error("Refusing to push to main");
  const env = {
    GIT_AUTHOR_NAME: "President Executor",
    GIT_AUTHOR_EMAIL: "president-executor@users.noreply.github.com",
    GIT_COMMITTER_NAME: "President Executor",
    GIT_COMMITTER_EMAIL: "president-executor@users.noreply.github.com",
  };
  await runCommand("git add -A -- . ':!node_modules'", ws.dir, { env });
  const staged = await runCommand("git diff --cached --quiet", ws.dir);
  if (staged.exitCode !== 0) {
    const c = await runCommand(
      `git commit --no-verify -m ${sh(message)} -m ${sh(`Mission: ${m.missionId}\nCycle: ${m.cycleId}\nApproval-Receipt: ${m.approvalReceiptId}`)}`,
      ws.dir,
      { env }
    );
    if (c.exitCode !== 0) throw new Error(`commit failed: ${c.stderr.slice(0, 300)}`);
  }
  const head = (await runCommand("git rev-parse HEAD", ws.dir)).stdout.trim();
  if (head === ws.baseSha) throw new Error("No commit was produced");
  const push = await runCommand(
    `git push --force-with-lease origin HEAD:refs/heads/${ws.branch}`,
    ws.dir,
    { timeoutMs: 180_000 }
  );
  if (push.exitCode !== 0) throw new Error(`push failed: ${push.stderr.slice(0, 300)}`);
  return { commitSha: head };
}

const SAFE_BROWSER_START =
  /^(pnpm (dev|run dev|exec vite)|npx vite)(?:\s+[A-Za-z0-9_./:=@-]+)*$/;

export function assertSafeBrowserStartCommand(command: string) {
  if (!SAFE_BROWSER_START.test(command.trim()))
    throw new Error(
      `Browser start command not allowed: ${command.slice(0, 120)}`
    );
}

/** Real browser validation via Playwright. Fails on console errors or missing text. */
export async function runBrowserCheck(
  check: { url: string; expectText?: string; startCommand?: string },
  cwd: string,
  screenshotPath: string
): Promise<{ ok: boolean; consoleErrors: string[]; screenshotPath?: string; detail: string }> {
  let server: ReturnType<typeof spawn> | null = null;
  try {
    if (check.startCommand) {
      assertSafeBrowserStartCommand(check.startCommand);
      server = spawn("sh", ["-c", check.startCommand], { cwd, detached: true, stdio: "ignore" });
      const deadline = Date.now() + 90_000;
      for (;;) {
        try {
          const r = await fetch(check.url, { signal: AbortSignal.timeout(2000) });
          if (r.status < 500) break;
        } catch {
          /* not ready */
        }
        if (Date.now() > deadline)
          return { ok: false, consoleErrors: [], detail: "app did not become ready" };
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on("console", msg => msg.type() === "error" && errors.push(msg.text()));
      page.on("pageerror", e => errors.push(String(e)));
      await page.goto(check.url, { waitUntil: "networkidle", timeout: 60_000 });
      mkdirSync(join(screenshotPath, ".."), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const text = check.expectText ? await page.locator("body").innerText() : "";
      const textOk = !check.expectText || text.includes(check.expectText);
      return {
        ok: errors.length === 0 && textOk,
        consoleErrors: errors,
        screenshotPath,
        detail: textOk ? "ok" : `expected text not found: ${check.expectText}`,
      };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { ok: false, consoleErrors: [], detail: `browser validation error: ${(e as Error).message}` };
  } finally {
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGKILL");
      } catch {
        /* gone */
      }
    }
  }
}
