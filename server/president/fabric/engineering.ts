import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type { PresidentCycleMission } from "../../../shared/presidentCycle";
import { commandLabel, runPresidentCommand, type PresidentCommandResult } from "./exec";

const PROTECTED_PATTERNS: RegExp[] = [
  /^server\/mitch\//,
  /^shared\/mitch/i,
  /^server\/commercialPipeline\//,
  /^server\/commercialCampaigns\//,
  /^server\/authority\//,
  /^\.env(?:\.|$)/,
  /^\.github\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^scripts\/reconcileCommercialPipelineRevenue/i,
];

export type PresidentEngineeringExecutionResult = {
  executorId: string;
  baseSha: string;
  branch: string;
  commitSha: string;
  pullRequestUrl: string;
  changedFiles: string[];
  validation: PresidentCommandResult[];
  agentSummary: string;
  artifactId: string;
};

type TestCommand = {
  command: string;
  args: string[];
  timeoutMs?: number;
};

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function protectedPath(value: string): boolean {
  const normalized = normalizePath(value);
  return PROTECTED_PATTERNS.some(pattern => pattern.test(normalized));
}

function safeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function defaultTestCommands(): TestCommand[] {
  return [
    { command: "pnpm", args: ["check"], timeoutMs: 10 * 60 * 1000 },
    {
      command: "pnpm",
      args: ["exec", "vitest", "run"],
      timeoutMs: 15 * 60 * 1000,
    },
  ];
}

function configuredTestCommands(): TestCommand[] {
  const raw = process.env.PRESIDENT_ENGINEERING_TESTS_JSON?.trim();
  if (!raw) return defaultTestCommands();
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 8)
    throw new Error("PRESIDENT_ENGINEERING_TESTS_JSON must contain 1-8 commands");
  return parsed.map((value, index) => {
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as { command?: unknown }).command !== "string" ||
      !Array.isArray((value as { args?: unknown }).args)
    )
      throw new Error(`Invalid President engineering test command at index ${index}`);
    return {
      command: (value as { command: string }).command,
      args: (value as { args: unknown[] }).args.map(String),
      timeoutMs:
        typeof (value as { timeoutMs?: unknown }).timeoutMs === "number"
          ? (value as { timeoutMs: number }).timeoutMs
          : undefined,
    };
  });
}

function repoRoot(): string {
  const configured = process.env.PRESIDENT_REPO_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

async function invokeClaudeEngineer(input: {
  cwd: string;
  mission: PresidentCycleMission;
  repairContext?: string;
}): Promise<string> {
  const binary = process.env.PRESIDENT_CLAUDE_BINARY?.trim() || "claude";
  const model = process.env.PRESIDENT_CLAUDE_MODEL?.trim() || "sonnet";
  const system = `You are an autonomous software engineering executor working for JOYSTICK's President seat.
You are NOT Mitch and must not send work to Mitch.
You are inside an isolated git worktree on a President mission branch.
Implement only the approved mission. Inspect the repository before editing.
Do not merge, push, create a pull request, modify git remotes, or rewrite history; the execution wrapper owns git publication.
Do not modify server/mitch/**, shared/mitch*, server/commercialPipeline/**, server/commercialCampaigns/**, server/authority/**, .github/**, package.json, pnpm-lock.yaml, or reconcileCommercialPipelineRevenue.
Do not write production data or credentials.
You do not have a shell tool. The wrapper owns commands, tests, git, network publication and pull-request creation.
The wrapper will independently run mandatory validation after you finish editing.
If the mission cannot be completed safely, make no speculative broad changes and explain the blocker in your final response.`;

  const prompt = JSON.stringify({
    missionId: input.mission.id,
    cycleId: input.mission.cycleId,
    title: input.mission.title,
    objective: input.mission.objective,
    acceptanceCriteria: input.mission.acceptanceCriteria,
    evidenceIds: input.mission.evidenceIds,
    attemptCount: input.mission.attemptCount,
    repairContext: input.repairContext ?? null,
  });

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      binary,
      [
        "--print",
        "--output-format",
        "json",
        "--model",
        model,
        "--max-budget-usd",
        process.env.PRESIDENT_ENGINEERING_MAX_USD?.trim() || "8",
        "--tools",
        "Read,Write,Edit,Glob,Grep",
        "--allowedTools",
        "Read,Write,Edit,Glob,Grep",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--setting-sources",
        "user",
        "--settings",
        '{"disableAllHooks":true}',
        "--disable-slash-commands",
        "--no-session-persistence",
        "--system-prompt",
        system,
      ],
      {
        cwd: input.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          USER: process.env.USER,
          LOGNAME: process.env.LOGNAME,
          TMPDIR: process.env.TMPDIR,
        },
      }
    );
    let stdout = "";
    const timer = setTimeout(
      () => {
        child.kill("SIGTERM");
        reject(new Error("President engineering agent timed out"));
      },
      Number(process.env.PRESIDENT_ENGINEERING_TIMEOUT_MS ?? 45 * 60 * 1000)
    );
    child.stdout.on("data", chunk => {
      stdout += String(chunk);
      if (stdout.length > 2_000_000) {
        child.kill("SIGTERM");
        reject(new Error("President engineering agent output exceeded bound"));
      }
    });
    child.stderr.resume();
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`President engineering agent exited ${code}`));
        return;
      }
      try {
        const envelope = JSON.parse(stdout) as {
          is_error?: boolean;
          result?: string;
          structured_output?: unknown;
        };
        if (envelope.is_error)
          reject(new Error("President engineering agent returned an error"));
        else
          resolve(
            envelope.structured_output !== undefined
              ? JSON.stringify(envelope.structured_output)
              : envelope.result ?? "Engineering agent completed"
          );
      } catch {
        resolve(stdout.trim() || "Engineering agent completed");
      }
    });
    child.stdin.end(prompt);
  });
}

export class PresidentEngineeringExecutor {
  readonly actorId = "president-executor:claude-cli";

  async available(): Promise<boolean> {
    const root = repoRoot();
    const git = await runPresidentCommand({
      command: "git",
      args: ["rev-parse", "--is-inside-work-tree"],
      cwd: root,
      timeoutMs: 10_000,
    });
    const gh = await runPresidentCommand({
      command: "gh",
      args: ["auth", "status"],
      cwd: root,
      timeoutMs: 10_000,
    });
    const claude = await runPresidentCommand({
      command: process.env.PRESIDENT_CLAUDE_BINARY?.trim() || "claude",
      args: ["--version"],
      cwd: root,
      timeoutMs: 10_000,
    });
    return git.exitCode === 0 && gh.exitCode === 0 && claude.exitCode === 0;
  }

  async execute(mission: PresidentCycleMission): Promise<PresidentEngineeringExecutionResult> {
    if (mission.executionDomain !== "ENGINEERING")
      throw new Error("President engineering executor received a non-engineering mission");

    const root = repoRoot();
    const fetch = await runPresidentCommand({
      command: "git",
      args: ["fetch", "origin", "main"],
      cwd: root,
      timeoutMs: 120_000,
    });
    if (fetch.exitCode !== 0)
      throw new Error(`Unable to fetch main: ${fetch.stderr || fetch.stdout}`);

    const baseResult = await runPresidentCommand({
      command: "git",
      args: ["rev-parse", mission.baseSha ?? "origin/main"],
      cwd: root,
      timeoutMs: 10_000,
    });
    if (baseResult.exitCode !== 0)
      throw new Error("President executor cannot resolve authorized base SHA");
    const baseSha = baseResult.stdout.trim();
    if (!/^[a-f0-9]{40}$/.test(baseSha))
      throw new Error("President executor resolved an invalid base SHA");

    const branch =
      "president/" +
      safeSlug(mission.title) +
      "-" +
      mission.id.slice(0, 8);
    const worktreeBase =
      process.env.PRESIDENT_WORKTREE_ROOT?.trim() ||
      path.join(root, ".president-worktrees");
    mkdirSync(worktreeBase, { recursive: true });
    const worktree = path.join(worktreeBase, branch.replace(/\//g, "__"));

    if (existsSync(worktree)) {
      await runPresidentCommand({
        command: "git",
        args: ["worktree", "remove", "--force", worktree],
        cwd: root,
        timeoutMs: 60_000,
      });
      rmSync(worktree, { recursive: true, force: true });
    }
    await runPresidentCommand({
      command: "git",
      args: ["branch", "-D", branch],
      cwd: root,
      timeoutMs: 20_000,
    });

    const add = await runPresidentCommand({
      command: "git",
      args: ["worktree", "add", "-b", branch, worktree, baseSha],
      cwd: root,
      timeoutMs: 120_000,
    });
    if (add.exitCode !== 0)
      throw new Error(`President executor could not create worktree: ${add.stderr}`);

    try {
      let agentSummary = await invokeClaudeEngineer({ cwd: worktree, mission });
      const testCommands = configuredTestCommands();
      let validation: PresidentCommandResult[] = [];

      for (let repair = 0; repair < 3; repair++) {
        const changed = await runPresidentCommand({
          command: "git",
          args: ["status", "--porcelain"],
          cwd: worktree,
          timeoutMs: 10_000,
        });
        const changedPaths = changed.stdout
          .split("\n")
          .flatMap(line => {
            const value = line.slice(3).trim();
            if (!value) return [];
            return value.includes(" -> ")
              ? value.split(" -> ").map(part => part.trim())
              : [value];
          });
        const forbidden = changedPaths.find(protectedPath);
        if (forbidden)
          throw new Error(`President executor modified protected path: ${forbidden}`);
        if (!changedPaths.length)
          throw new Error("President engineering agent produced no repository changes");

        validation = [];
        for (const spec of testCommands) {
          const result = await runPresidentCommand({
            ...spec,
            cwd: worktree,
          });
          validation.push(result);
          if (result.exitCode !== 0) break;
        }
        if (validation.every(result => result.exitCode === 0)) break;
        if (repair === 2) {
          const failure = validation.find(result => result.exitCode !== 0)!;
          throw new Error(
            `President engineering validation failed after repairs: ${commandLabel(failure)}\n${failure.stderr || failure.stdout}`
          );
        }
        const failureContext = validation
          .filter(result => result.exitCode !== 0)
          .map(result =>
            [
              commandLabel(result),
              "exit=" + result.exitCode,
              result.stdout.slice(-6000),
              result.stderr.slice(-6000),
            ].join("\n")
          )
          .join("\n---\n");
        agentSummary = await invokeClaudeEngineer({
          cwd: worktree,
          mission,
          repairContext:
            "Mandatory wrapper validation failed. Repair the repository without broadening scope:\n" +
            failureContext,
        });
      }

      const fileList = await runPresidentCommand({
        command: "git",
        args: ["diff", "--name-status", "-M", baseSha],
        cwd: worktree,
        timeoutMs: 10_000,
      });
      const changedFiles = fileList.stdout
        .split("\n")
        .flatMap(line => {
          const parts = line.split("\t").map(value => value.trim()).filter(Boolean);
          return parts.slice(1);
        });
      const forbidden = changedFiles.find(protectedPath);
      if (forbidden)
        throw new Error(`President executor changed protected path: ${forbidden}`);

      const addAll = await runPresidentCommand({
        command: "git",
        args: ["add", "-A"],
        cwd: worktree,
        timeoutMs: 30_000,
      });
      if (addAll.exitCode !== 0)
        throw new Error("President executor could not stage changes");

      const staged = await runPresidentCommand({
        command: "git",
        args: ["diff", "--cached", "--quiet"],
        cwd: worktree,
        timeoutMs: 10_000,
      });
      if (staged.exitCode === 0)
        throw new Error("President executor has no staged change to commit");

      const commit = await runPresidentCommand({
        command: "git",
        args: ["commit", "-m", `president: ${mission.title.slice(0, 64)}`],
        cwd: worktree,
        timeoutMs: 120_000,
        env: {
          GIT_AUTHOR_NAME: "JOYSTICK President Executor",
          GIT_AUTHOR_EMAIL: "president-executor@goldline.internal",
          GIT_COMMITTER_NAME: "JOYSTICK President Executor",
          GIT_COMMITTER_EMAIL: "president-executor@goldline.internal",
        },
      });
      if (commit.exitCode !== 0)
        throw new Error(`President executor commit failed: ${commit.stderr}`);

      const sha = await runPresidentCommand({
        command: "git",
        args: ["rev-parse", "HEAD"],
        cwd: worktree,
        timeoutMs: 10_000,
      });
      const commitSha = sha.stdout.trim();
      if (!/^[a-f0-9]{40}$/.test(commitSha) || commitSha === baseSha)
        throw new Error("President executor did not produce a new immutable commit");

      const push = await runPresidentCommand({
        command: "git",
        args: ["push", "--force-with-lease", "-u", "origin", branch],
        cwd: worktree,
        timeoutMs: 180_000,
      });
      if (push.exitCode !== 0)
        throw new Error(`President executor push failed: ${push.stderr}`);

      const existing = await runPresidentCommand({
        command: "gh",
        args: ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--jq", ".[0].url"],
        cwd: worktree,
        timeoutMs: 30_000,
      });
      let pullRequestUrl = existing.stdout.trim();
      if (!pullRequestUrl) {
        const body = [
          "President approved mission: " + mission.title,
          "",
          "Cycle: " + mission.cycleId,
          "Mission: " + mission.id,
          "",
          "Acceptance criteria:",
          ...mission.acceptanceCriteria.map(item => "- " + item),
          "",
          "Validation actually run:",
          ...validation.map(
            result => `- ${commandLabel(result)} — exit ${result.exitCode}`
          ),
          "",
          "Human merge required. President is not authorized to merge this PR.",
        ].join("\n");
        const pr = await runPresidentCommand({
          command: "gh",
          args: [
            "pr",
            "create",
            "--base",
            "main",
            "--head",
            branch,
            "--title",
            `President: ${mission.title.slice(0, 180)}`,
            "--body",
            body,
          ],
          cwd: worktree,
          timeoutMs: 120_000,
        });
        if (pr.exitCode !== 0)
          throw new Error(`President executor could not create PR: ${pr.stderr}`);
        pullRequestUrl = pr.stdout.trim().split("\n").pop()?.trim() ?? "";
      }
      if (!/^https:\/\//.test(pullRequestUrl))
        throw new Error("President executor did not obtain a real PR URL");

      return {
        executorId: this.actorId,
        baseSha,
        branch,
        commitSha,
        pullRequestUrl,
        changedFiles,
        validation,
        agentSummary,
        artifactId: createHash("sha256")
          .update([mission.id, baseSha, commitSha, pullRequestUrl].join(":"))
          .digest("hex"),
      };
    } finally {
      await runPresidentCommand({
        command: "git",
        args: ["worktree", "remove", "--force", worktree],
        cwd: root,
        timeoutMs: 60_000,
      });
      await runPresidentCommand({
        command: "git",
        args: ["worktree", "prune"],
        cwd: root,
        timeoutMs: 30_000,
      });
    }
  }
}

export { protectedPath as isPresidentProtectedPath };
