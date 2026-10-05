import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import type { PresidentCycleMission } from "../../../shared/presidentCycle";
import { ENV } from "../../_core/env";
import { commandLabel, runPresidentCommand, type PresidentCommandResult } from "./exec";
import type { PresidentEngineeringExecutionResult } from "./engineering";

export type PresidentReviewVerdict = "PASS" | "FAIL" | "BLOCKED";

export type PresidentIndependentReviewResult = {
  reviewerId: string;
  verdict: PresidentReviewVerdict;
  acceptanceResults: Array<{
    criterion: string;
    passed: boolean;
    evidence: string;
  }>;
  observedRisks: string[];
  requiredRevision: string | null;
  validation: PresidentCommandResult[];
  reviewedAt: string;
};

type TestCommand = {
  command: string;
  args: string[];
  timeoutMs?: number;
};

function testCommands(): TestCommand[] {
  const raw = process.env.PRESIDENT_ENGINEERING_TESTS_JSON?.trim();
  if (!raw)
    return [
      { command: "pnpm", args: ["check"], timeoutMs: 10 * 60 * 1000 },
      {
        command: "pnpm",
        args: ["exec", "vitest", "run"],
        timeoutMs: 15 * 60 * 1000,
      },
    ];
  const parsed = JSON.parse(raw) as Array<{
    command: string;
    args: string[];
    timeoutMs?: number;
  }>;
  if (!Array.isArray(parsed) || !parsed.length)
    throw new Error("President reviewer test commands are invalid");
  return parsed.map(item => ({
    command: String(item.command),
    args: Array.isArray(item.args) ? item.args.map(String) : [],
    timeoutMs: typeof item.timeoutMs === "number" ? item.timeoutMs : undefined,
  }));
}

function repositoryRoot(): string {
  const configured = process.env.PRESIDENT_REPO_ROOT?.trim();
  if (configured) return path.resolve(configured);
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

async function invokeIndependentReviewer(input: {
  cwd: string;
  mission: PresidentCycleMission;
  execution: PresidentEngineeringExecutionResult;
  validation: PresidentCommandResult[];
  diff: string;
}): Promise<PresidentIndependentReviewResult> {
  const binary = process.env.PRESIDENT_CLAUDE_BINARY?.trim() || "claude";
  const useApi = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const model = useApi
    ? process.env.PRESIDENT_REVIEW_MODEL?.trim() ||
      process.env.PRESIDENT_MODEL?.trim() ||
      ENV.anthropicModel
    : process.env.PRESIDENT_REVIEW_MODEL?.trim() ||
      process.env.PRESIDENT_CLAUDE_MODEL?.trim() ||
      "sonnet";
  const reviewerId = useApi
    ? "president-reviewer:anthropic-api"
    : "president-reviewer:claude-cli";
  if (reviewerId === input.execution.executorId)
    throw new Error("President reviewer must be different from executor");

  const system = `You are the independent reviewer for a JOYSTICK President engineering mission.
You are not the executor and are running in a fresh process/context.
You are NOT Mitch. Do not route work to Mitch.
You have read-only repository tools. Do not modify files, commit, push, merge, or create pull requests.
Review the exact approved acceptance criteria against the supplied diff and independently executed validation.
Be adversarial. A missing witness is not a pass.
Return JSON only:
{
  "verdict":"PASS|FAIL|BLOCKED",
  "acceptanceResults":[{"criterion":"exact criterion","passed":true,"evidence":"..."}],
  "observedRisks":["..."],
  "requiredRevision":null
}
PASS requires every exact criterion to appear once and pass.`;

  const prompt = JSON.stringify({
    mission: {
      id: input.mission.id,
      title: input.mission.title,
      objective: input.mission.objective,
      acceptanceCriteria: input.mission.acceptanceCriteria,
    },
    execution: {
      executorId: input.execution.executorId,
      baseSha: input.execution.baseSha,
      commitSha: input.execution.commitSha,
      branch: input.execution.branch,
      pullRequestUrl: input.execution.pullRequestUrl,
      changedFiles: input.execution.changedFiles,
      artifactId: input.execution.artifactId,
    },
    validation: input.validation.map(item => ({
      command: commandLabel(item),
      exitCode: item.exitCode,
    })),
    diff: input.diff.slice(0, 180_000),
  });

  let raw: unknown;
  if (useApi) {
    const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
    const response: any = await client.messages.create({
      model,
      max_tokens: 8192,
      temperature: 0,
      system,
      messages: [{ role: "user", content: prompt }],
      tools: [
        {
          name: "submit_review",
          description: "Submit the independent President mission review.",
          input_schema: {
            type: "object",
            properties: {
              verdict: {
                type: "string",
                enum: ["PASS", "FAIL", "BLOCKED"],
              },
              acceptanceResults: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    criterion: { type: "string" },
                    passed: { type: "boolean" },
                    evidence: { type: "string" },
                  },
                  required: ["criterion", "passed", "evidence"],
                  additionalProperties: false,
                },
              },
              observedRisks: {
                type: "array",
                items: { type: "string" },
              },
              requiredRevision: {
                anyOf: [{ type: "string" }, { type: "null" }],
              },
            },
            required: [
              "verdict",
              "acceptanceResults",
              "observedRisks",
              "requiredRevision",
            ],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: { type: "tool", name: "submit_review" },
    } as any);
    const toolBlock = (response.content ?? []).find(
      (block: any) =>
        block.type === "tool_use" && block.name === "submit_review"
    );
    if (!toolBlock)
      throw new Error("President Anthropic reviewer returned no structured review");
    raw = toolBlock.input;
  } else {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        binary,
        [
          "--print",
          "--output-format",
          "json",
          "--model",
          model,
          "--max-budget-usd",
          process.env.PRESIDENT_REVIEW_MAX_USD?.trim() || "3",
          "--tools",
          "Read,Glob,Grep",
          "--allowedTools",
          "Read,Glob,Grep",
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
      let output = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("President independent review timed out"));
      }, 20 * 60 * 1000);
      child.stdout.on("data", chunk => {
        output += String(chunk);
        if (output.length > 1_000_000) {
          child.kill("SIGTERM");
          reject(new Error("President independent review output exceeded bound"));
        }
      });
      child.stderr.resume();
      child.on("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", code => {
        clearTimeout(timer);
        code === 0
          ? resolve(output)
          : reject(new Error(`President reviewer exited ${code}`));
      });
      child.stdin.end(prompt);
    });

    const envelope = JSON.parse(stdout) as {
      is_error?: boolean;
      result?: string;
      structured_output?: unknown;
    };
    if (envelope.is_error)
      throw new Error("President reviewer returned an error");
    raw =
      envelope.structured_output !== undefined
        ? envelope.structured_output
        : JSON.parse(
            String(envelope.result ?? "")
              .trim()
              .replace(/^\`\`\`(?:json)?\s*/i, "")
              .replace(/\s*\`\`\`$/, "")
          );
  }

  if (typeof raw !== "object" || raw === null)
    throw new Error("President reviewer returned invalid JSON");
  const value = raw as {
    verdict?: unknown;
    acceptanceResults?: unknown;
    observedRisks?: unknown;
    requiredRevision?: unknown;
  };
  const verdict = String(value.verdict ?? "") as PresidentReviewVerdict;
  if (!["PASS", "FAIL", "BLOCKED"].includes(verdict))
    throw new Error("President reviewer returned invalid verdict");
  if (!Array.isArray(value.acceptanceResults))
    throw new Error("President reviewer omitted acceptance results");
  const acceptanceResults = value.acceptanceResults.map(item => {
    const row = item as {
      criterion?: unknown;
      passed?: unknown;
      evidence?: unknown;
    };
    return {
      criterion: String(row.criterion ?? ""),
      passed: row.passed === true,
      evidence: String(row.evidence ?? ""),
    };
  });
  if (
    acceptanceResults.length !== input.mission.acceptanceCriteria.length ||
    acceptanceResults.some(
      (result, index) =>
        result.criterion !== input.mission.acceptanceCriteria[index]
    )
  )
    throw new Error("President reviewer did not evaluate each exact acceptance criterion");

  const validationPassed = input.validation.every(item => item.exitCode === 0);
  let finalVerdict = verdict;
  let requiredRevision =
    value.requiredRevision == null ? null : String(value.requiredRevision);
  if (!validationPassed && finalVerdict === "PASS") {
    finalVerdict = "FAIL";
    requiredRevision = "Independent mandatory validation failed.";
  }
  if (
    finalVerdict === "PASS" &&
    acceptanceResults.some(result => !result.passed)
  )
    throw new Error("President reviewer cannot PASS a failed acceptance criterion");

  return {
    reviewerId,
    verdict: finalVerdict,
    acceptanceResults,
    observedRisks: Array.isArray(value.observedRisks)
      ? value.observedRisks.map(String).slice(0, 20)
      : [],
    requiredRevision,
    validation: input.validation,
    reviewedAt: new Date().toISOString(),
  };
}

export class PresidentIndependentReviewer {
  get actorId() {
    return process.env.ANTHROPIC_API_KEY?.trim()
      ? "president-reviewer:anthropic-api"
      : "president-reviewer:claude-cli";
  }

  async review(
    mission: PresidentCycleMission,
    execution: PresidentEngineeringExecutionResult
  ): Promise<PresidentIndependentReviewResult> {
    if (execution.executorId === this.actorId)
      throw new Error("President executor and reviewer are the same actor");
    const root = repositoryRoot();
    const reviewRoot =
      process.env.PRESIDENT_REVIEW_WORKTREE_ROOT?.trim() ||
      path.join(root, ".president-review-worktrees");
    mkdirSync(reviewRoot, { recursive: true });
    const directory = path.join(reviewRoot, mission.id + "-" + randomUUID());
    const added = await runPresidentCommand({
      command: "git",
      args: ["worktree", "add", "--detach", directory, execution.commitSha],
      cwd: root,
      timeoutMs: 120_000,
    });
    if (added.exitCode !== 0)
      throw new Error("President reviewer could not create detached review worktree");

    try {
      const validation: PresidentCommandResult[] = [];
      for (const spec of testCommands()) {
        validation.push(
          await runPresidentCommand({
            ...spec,
            cwd: directory,
          })
        );
      }
      const diffResult = await runPresidentCommand({
        command: "git",
        args: ["diff", "--no-ext-diff", execution.baseSha, execution.commitSha],
        cwd: directory,
        timeoutMs: 60_000,
      });
      if (diffResult.exitCode !== 0)
        throw new Error("President reviewer could not inspect exact diff");

      return invokeIndependentReviewer({
        cwd: directory,
        mission,
        execution,
        validation,
        diff: diffResult.stdout,
      });
    } finally {
      await runPresidentCommand({
        command: "git",
        args: ["worktree", "remove", "--force", directory],
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
