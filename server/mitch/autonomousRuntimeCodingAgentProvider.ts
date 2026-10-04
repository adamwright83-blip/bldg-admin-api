/**
 * Autonomous Runtime Coding-Agent Execution Provider
 *
 * Implements IMitchExecutionProvider behind Mitch's dispatcher boundary.
 *
 * EXECUTION CONTRACT:
 * 1. Checks out from exact authorized baseSha.
 * 2. Creates an isolated git worktree with dedicated branch.
 * 3. Verifies worktree HEAD equals authorized baseSha before work begins.
 * 4. Executes an autonomous coding worker inside that isolated worktree only.
 * 5. Strictly protects Mitch truth rules, schema, and server boundaries.
 * 6. Validates resulting diff against work-order scope and rejects out-of-scope mutations.
 * 7. Enforces that a real git commit is produced (resultingSha !== baseSha).
 * 8. Runs required targeted test commands and captures exit status / stdout.
 * 9. Returns structured handback containing exact build identity, branch, commit SHA, and test evidence.
 * 10. Cleans up isolated worktree while preserving git branch and commit provenance.
 */
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  MitchExecutionHandback,
  MitchWorkOrder,
} from "../../shared/mitchContracts";
import {
  assertValidBuildIdentity,
  mitchExecutionHandbackSchema,
} from "../../shared/mitchContracts";
import type { IMitchExecutionProvider } from "./mitchDispatcher";

const execFileAsync = promisify(execFile);

// --- Error Classes ---

export class AutonomousProviderUnavailableError extends Error {
  constructor(reason: string) {
    super(`AutonomousRuntimeCodingAgentProvider unavailable: ${reason}`);
    this.name = "AutonomousProviderUnavailableError";
  }
}

export class BaseCommitShaMismatchError extends Error {
  constructor(expectedSha: string, actualSha: string) {
    super(
      `Base commit SHA mismatch in isolated worktree: expected "${expectedSha}", but checked out "${actualSha}".`
    );
    this.name = "BaseCommitShaMismatchError";
  }
}

export class NoCommitProducedError extends Error {
  constructor(message: string) {
    super(`No commit produced: ${message}`);
    this.name = "NoCommitProducedError";
  }
}

export class ScopeViolationError extends Error {
  constructor(file: string, reason: string) {
    super(`Scope violation: file "${file}" violates work-order constraints. ${reason}`);
    this.name = "ScopeViolationError";
  }
}

export class TestExecutionFailedError extends Error {
  constructor(public readonly command: string, public readonly exitCode: number, public readonly output: string) {
    super(`Targeted test execution failed (exit code ${exitCode}) for command: ${command}\nOutput: ${output.slice(0, 500)}`);
    this.name = "TestExecutionFailedError";
  }
}

export class ExecutionTimeoutError extends Error {
  constructor(workOrderId: string, timeoutMs: number) {
    super(`Execution timed out for work order "${workOrderId}" after ${timeoutMs}ms.`);
    this.name = "ExecutionTimeoutError";
  }
}

// --- Protected Paths ---
// A coding worker must NEVER modify Mitch's own services, contracts, or truth rules,
// nor environment credentials or root lockfiles without explicit work-order authorization.
export const PROTECTED_PATH_PATTERNS = [
  /^server\/mitch\//,
  /^shared\/mitchContracts\.ts$/,
  /^\.env/,
  /^\.github\//,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
];

export function isPathProtected(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return PROTECTED_PATH_PATTERNS.some(p => p.test(normalized));
}

// --- Worker Engine Interface ---

export interface WorkerExecutionContext {
  workOrder: MitchWorkOrder;
  worktreeDir: string;
  repoRoot: string;
  branchName: string;
  readFile: (relPath: string) => Promise<string>;
  writeFile: (relPath: string, content: string) => Promise<void>;
  runCommand: (cmd: string, args: string[], options?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  gitDiff: () => Promise<string>;
  commit: (message: string) => Promise<string>;
}

export interface WorkerExecutionOutcome {
  status: "succeeded" | "failed";
  whatChanged?: string;
  error?: string;
}

export type AutonomousWorkerRunner = (
  ctx: WorkerExecutionContext
) => Promise<WorkerExecutionOutcome>;

export type TestCommandRunner = (
  testTarget: string,
  worktreeDir: string
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface AutonomousRuntimeCodingAgentProviderOptions {
  apiKey?: string;
  model?: string;
  repoRoot?: string;
  worktreeBaseDir?: string;
  workerRunner?: AutonomousWorkerRunner;
  testCommandRunner?: TestCommandRunner;
  timeoutMs?: number;
}

export class AutonomousRuntimeCodingAgentProvider implements IMitchExecutionProvider {
  public readonly id = "autonomous-runtime-coding-agent";
  public readonly name = "AutonomousRuntimeCodingAgentProvider";

  private readonly apiKey: string | null;
  private readonly model: string;
  private readonly repoRoot: string;
  private readonly worktreeBaseDir: string;
  private readonly customRunner?: AutonomousWorkerRunner;
  private readonly testCommandRunner?: TestCommandRunner;
  private readonly timeoutMs: number;

  constructor(options: AutonomousRuntimeCodingAgentProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.GOOGLE_API_KEY ?? null;
    this.model = options.model ?? process.env.MITCH_CODING_AGENT_MODEL ?? "gemini-flash-lite-latest";
    this.repoRoot = options.repoRoot ?? this.detectRepoRoot();
    this.worktreeBaseDir = options.worktreeBaseDir ?? path.join(this.repoRoot, ".mitch-worktrees");
    this.customRunner = options.workerRunner;
    this.testCommandRunner = options.testCommandRunner;
    this.timeoutMs = options.timeoutMs ?? 5 * 60 * 1000; // 5 minute default
  }

  private detectRepoRoot(): string {
    try {
      return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    } catch {
      return process.cwd();
    }
  }

  async isAvailable(): Promise<boolean> {
    if (this.customRunner) {
      return true;
    }
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async executeWorkOrder(order: MitchWorkOrder): Promise<MitchExecutionHandback> {
    if (!(await this.isAvailable())) {
      throw new AutonomousProviderUnavailableError(
        "Missing GOOGLE_API_KEY and no custom worker runner configured. Mitch execution requires an authentic runtime agent."
      );
    }

    const attemptNumber = order.attemptCount;
    const branchName = `mitch/wo-${order.id}-att-${attemptNumber}`;
    const worktreeDir = path.join(this.worktreeBaseDir, `${order.id}-att-${attemptNumber}`);

    // Ensure base directory exists
    if (!existsSync(this.worktreeBaseDir)) {
      mkdirSync(this.worktreeBaseDir, { recursive: true });
    }

    // Clean up any stale worktree or branch from a previous crashed run of this exact attempt
    this.cleanUpWorktreeQuietly(worktreeDir, branchName);

    // 1. Create isolated worktree from exact baseSha
    try {
      await execFileAsync("git", ["worktree", "add", "-b", branchName, worktreeDir, order.baseSha], {
        cwd: this.repoRoot,
      });
    } catch (err) {
      throw new Error(`Failed to create isolated git worktree at "${worktreeDir}" from baseSha "${order.baseSha}": ${err instanceof Error ? err.message : String(err)}`);
    }

    let worktreeCreated = true;

    try {
      // 2. Verify checked-out HEAD in isolated worktree equals authorized baseSha
      const { stdout: actualHeadRaw } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: worktreeDir,
      });
      const actualHead = actualHeadRaw.trim();
      const expectedShaPrefix = order.baseSha.trim().toLowerCase();

      if (!actualHead.toLowerCase().startsWith(expectedShaPrefix)) {
        throw new BaseCommitShaMismatchError(order.baseSha, actualHead);
      }

      // 3. Symlink node_modules for test execution without huge disk overhead
      const rootNodeModules = path.join(this.repoRoot, "node_modules");
      const wtNodeModules = path.join(worktreeDir, "node_modules");
      if (existsSync(rootNodeModules) && !existsSync(wtNodeModules)) {
        try {
          symlinkSync(rootNodeModules, wtNodeModules, "dir");
        } catch {
          // Non-fatal if symlink cannot be created
        }
      }

      // 4. Construct worker tool interface
      const context: WorkerExecutionContext = {
        workOrder: order,
        worktreeDir,
        repoRoot: this.repoRoot,
        branchName,
        readFile: async (relPath: string) => {
          const resolved = path.resolve(worktreeDir, relPath);
          if (!resolved.startsWith(worktreeDir)) {
            throw new Error(`Path traversal denied: ${relPath}`);
          }
          return readFileSync(resolved, "utf8");
        },
        writeFile: async (relPath: string, content: string) => {
          const resolved = path.resolve(worktreeDir, relPath);
          if (!resolved.startsWith(worktreeDir)) {
            throw new Error(`Path traversal denied: ${relPath}`);
          }
          const relNorm = path.relative(worktreeDir, resolved);
          if (isPathProtected(relNorm)) {
            throw new ScopeViolationError(
              relNorm,
              "Writing to protected files (including server/mitch, contracts, and root configs) is forbidden."
            );
          }
          const parentDir = path.dirname(resolved);
          if (!existsSync(parentDir)) {
            mkdirSync(parentDir, { recursive: true });
          }
          writeFileSync(resolved, content, "utf8");
        },
        runCommand: async (cmd: string, args: string[], options = {}) => {
          const cmdTimeout = options.timeoutMs ?? 60_000;
          try {
            const { stdout, stderr } = await execFileAsync(cmd, args, {
              cwd: worktreeDir,
              timeout: cmdTimeout,
              env: { ...process.env, CI: "true" },
            });
            return { exitCode: 0, stdout, stderr };
          } catch (cmdErr: unknown) {
            const anyErr = cmdErr as { code?: number; stdout?: string; stderr?: string };
            return {
              exitCode: typeof anyErr.code === "number" ? anyErr.code : 1,
              stdout: anyErr.stdout ?? "",
              stderr: anyErr.stderr ?? (cmdErr instanceof Error ? cmdErr.message : String(cmdErr)),
            };
          }
        },
        gitDiff: async () => {
          const { stdout } = await execFileAsync("git", ["diff"], { cwd: worktreeDir });
          return stdout;
        },
        commit: async (message: string) => {
          await execFileAsync("git", ["add", "-A"], { cwd: worktreeDir });
          await execFileAsync("git", ["commit", "-m", message], {
            cwd: worktreeDir,
            env: {
              ...process.env,
              GIT_AUTHOR_NAME: "Mitch Autonomous Coding Worker",
              GIT_AUTHOR_EMAIL: "mitch-worker@goldline.internal",
              GIT_COMMITTER_NAME: "Mitch Autonomous Coding Worker",
              GIT_COMMITTER_EMAIL: "mitch-worker@goldline.internal",
            },
          });
          const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: worktreeDir });
          return stdout.trim();
        },
      };

      // 5. Execute worker (with timeout)
      const runner = this.customRunner ?? this.createGeminiRunner();
      const outcome = await this.runWithTimeout(runner(context), this.timeoutMs, order.id);

      if (outcome.status === "failed") {
        throw new Error(`Coding worker execution failed: ${outcome.error ?? "Unknown error"}`);
      }

      // 6. Inspect resulting commit SHA
      const { stdout: resultingShaRaw } = await execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: worktreeDir,
      });
      const resultingSha = resultingShaRaw.trim();

      // INVARIANT: Resulting commit SHA must differ from authorized baseSha
      if (resultingSha.toLowerCase() === actualHead.toLowerCase()) {
        throw new NoCommitProducedError(
          `Resulting commit SHA (${resultingSha}) is identical to base SHA (${actualHead}). Worker produced no immutable commit.`
        );
      }

      assertValidBuildIdentity(resultingSha);

      // 7. Inspect changed files & enforce scope boundary
      const { stdout: diffFilesRaw } = await execFileAsync(
        "git",
        ["diff", "--name-only", order.baseSha, "HEAD"],
        { cwd: worktreeDir }
      );
      const changedFiles = diffFilesRaw
        .split("\n")
        .map(f => f.trim())
        .filter(Boolean);

      if (changedFiles.length === 0) {
        throw new NoCommitProducedError("No changed files found between baseSha and resultingSha.");
      }

      for (const changed of changedFiles) {
        if (isPathProtected(changed)) {
          throw new ScopeViolationError(
            changed,
            "Autonomous coding worker modified a protected system file. Execution rejected."
          );
        }
      }

      // 8. Execute and verify all required targeted tests
      const testResults: Array<{ command: string; exitCode: number; stdout: string }> = [];
      for (const testTarget of order.requiredTests) {
        const testCmd = "pnpm";
        const testArgs = ["vitest", "run", testTarget];
        const fullCmd = `${testCmd} ${testArgs.join(" ")}`;
        let exitCode = 0;
        let stdout = "";
        let stderr = "";

        if (this.testCommandRunner) {
          const res = await this.testCommandRunner(testTarget, worktreeDir);
          exitCode = res.exitCode;
          stdout = res.stdout;
          stderr = res.stderr;
        } else {
          try {
            const res = await execFileAsync(testCmd, testArgs, {
              cwd: worktreeDir,
              timeout: 60_000,
              env: { ...process.env, CI: "true" },
            });
            stdout = res.stdout;
            stderr = res.stderr;
          } catch (testErr: unknown) {
            const anyErr = testErr as { code?: number; stdout?: string; stderr?: string };
            exitCode = typeof anyErr.code === "number" ? anyErr.code : 1;
            stdout = anyErr.stdout ?? "";
            stderr = anyErr.stderr ?? (testErr instanceof Error ? testErr.message : String(testErr));
          }
        }

        if (exitCode !== 0) {
          throw new TestExecutionFailedError(fullCmd, exitCode, stdout + "\n" + stderr);
        }

        testResults.push({
          command: fullCmd,
          exitCode: 0,
          stdout: stdout.slice(0, 1000),
        });
      }

      // 9. Return execution handback
      const handback: MitchExecutionHandback = {
        branch: branchName,
        commitSha: resultingSha,
        exactBuildId: resultingSha,
        whatChanged: outcome.whatChanged ?? `Implemented work order ${order.id}: ${order.title}`,
        testsActuallyRun: order.requiredTests,
        testsNotRun: [],
        previewLaunchInstructions: `git checkout ${branchName} && pnpm vitest run ${order.requiredTests.join(" ")}`,
        evidence: {
          startingBaseSha: order.baseSha,
          resultingCommitSha: resultingSha,
          branch: branchName,
          changedFiles,
          testResults,
          isolatedWorktreeUsed: true,
          attemptCount: order.attemptCount,
        },
        knownLimitations: "",
      };

      mitchExecutionHandbackSchema.parse(handback);
      return handback;
    } finally {
      // 10. Clean up worktree directory while preserving git branch and commit in repo history
      if (worktreeCreated) {
        this.cleanUpWorktreeQuietly(worktreeDir);
      }
    }
  }

  private cleanUpWorktreeQuietly(worktreeDir: string, branchNameToDelete?: string): void {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktreeDir], {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
    } catch {}
    try {
      execFileSync("git", ["worktree", "prune"], {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
    } catch {}
    if (branchNameToDelete) {
      try {
        execFileSync("git", ["branch", "-D", branchNameToDelete], {
          cwd: this.repoRoot,
          stdio: "ignore",
        });
      } catch {}
    }
  }

  private async runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, workOrderId: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ExecutionTimeoutError(workOrderId, timeoutMs)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Gemini autonomous worker runner using Google Generative Language API.
   * Multi-turn loop with action parsing, tool execution, and verification.
   */
  private createGeminiRunner(): AutonomousWorkerRunner {
    const apiKey = this.apiKey;
    const model = this.model;

    return async (ctx: WorkerExecutionContext): Promise<WorkerExecutionOutcome> => {
      if (!apiKey) {
        return { status: "failed", error: "Missing GOOGLE_API_KEY" };
      }

      const systemPrompt = `You are an autonomous software engineering worker executing a bounded Mitch game-production work order.
Your task is to modify the repository in your isolated workspace to satisfy the work order criteria, run the required tests, and create a git commit.

WORK ORDER DETAILS:
- Title: ${ctx.workOrder.title}
- Desired Result: ${ctx.workOrder.desiredPlayerVisibleResult}
- Acceptance Criteria:
${ctx.workOrder.acceptanceCriteria.map(c => `  * ${c}`).join("\n")}
- Canon Constraints:
${ctx.workOrder.canonConstraints.map(c => `  * ${c}`).join("\n")}
- Required Artifact: ${ctx.workOrder.requiredArtifact}
- Required Tests:
${ctx.workOrder.requiredTests.map(t => `  * ${t}`).join("\n")}

STRICT BOUNDARIES:
1. Do NOT modify any files in server/mitch/ or shared/mitchContracts.ts.
2. Only modify the bounded target files required by this work order.
3. You must execute commands to run the required tests.
4. When tests pass, create a git commit using the "commit" action.
5. After committing, conclude with the "finish" action.

You communicate exclusively by outputting a JSON object (optionally in a markdown \`\`\`json code block):
Available Actions:
- Read file: {"action": "read_file", "path": "relative/path"}
- Write file: {"action": "write_file", "path": "relative/path", "content": "file content"}
- Run command: {"action": "run_command", "command": "pnpm", "args": ["vitest", "run", "test/path"]}
- Git diff: {"action": "git_diff"}
- Git commit: {"action": "commit", "message": "commit message"}
- Finish: {"action": "finish", "summary": "summary of changes"}
`;

      const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [
        { role: "user", parts: [{ text: "Please begin executing the work order. Inspect files, modify code, run tests, commit, and finish. Respond with the first JSON action." }] },
      ];

      const maxTurns = 15;
      let committed = false;
      let commitMessage = "";

      for (let turn = 0; turn < maxTurns; turn++) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              responseMimeType: "application/json",
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return { status: "failed", error: `Gemini API returned status ${res.status}: ${errText.slice(0, 300)}` };
        }

        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };

        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        if (!responseText.trim()) {
          return { status: "failed", error: "Gemini returned empty response" };
        }

        contents.push({ role: "model", parts: [{ text: responseText }] });

        let actionObj: Record<string, unknown>;
        try {
          actionObj = JSON.parse(responseText);
        } catch {
          // Fallback if wrapped in markdown
          const actionMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
          const jsonStr = (actionMatch ? actionMatch[1] : responseText).trim();
          try {
            actionObj = JSON.parse(jsonStr);
          } catch {
            contents.push({
              role: "user",
              parts: [{ text: "Error: Please respond only with a valid JSON action. Respond with next JSON action." }],
            });
            continue;
          }
        }

        const action = String(actionObj.action ?? "");
        console.log(`[Worker Turn ${turn + 1}] Action: ${action} ${actionObj.path ?? actionObj.command ?? actionObj.message ?? ""}`);

        if (action === "read_file") {
          const filePath = String(actionObj.path ?? "");
          try {
            const content = await ctx.readFile(filePath);
            contents.push({ role: "user", parts: [{ text: `File content of ${filePath}:\n${content}\n\nRespond with next JSON action.` }] });
          } catch (e) {
            contents.push({ role: "user", parts: [{ text: `Error reading file ${filePath}: ${e instanceof Error ? e.message : String(e)}\n\nRespond with next JSON action.` }] });
          }
        } else if (action === "write_file") {
          const filePath = String(actionObj.path ?? "");
          const content = String(actionObj.content ?? "");
          try {
            await ctx.writeFile(filePath, content);
            contents.push({ role: "user", parts: [{ text: `File ${filePath} written successfully.\n\nRespond with next JSON action.` }] });
          } catch (e) {
            contents.push({ role: "user", parts: [{ text: `Error writing file ${filePath}: ${e instanceof Error ? e.message : String(e)}\n\nRespond with next JSON action.` }] });
          }
        } else if (action === "run_command") {
          const cmd = String(actionObj.command ?? "");
          const args = Array.isArray(actionObj.args) ? (actionObj.args as string[]).map(String) : [];
          const result = await ctx.runCommand(cmd, args);
          contents.push({
            role: "user",
            parts: [{ text: `Command exited with code ${result.exitCode}.\nSTDOUT:\n${result.stdout.slice(0, 2000)}\nSTDERR:\n${result.stderr.slice(0, 1000)}\n\nRespond with next JSON action.` }],
          });
        } else if (action === "git_diff") {
          const diff = await ctx.gitDiff();
          contents.push({ role: "user", parts: [{ text: `Current git diff:\n${diff || "(no changes)"}\n\nRespond with next JSON action.` }] });
        } else if (action === "commit") {
          const message = String(actionObj.message ?? `feat: implement ${ctx.workOrder.title}`);
          try {
            const sha = await ctx.commit(message);
            committed = true;
            commitMessage = message;
            contents.push({ role: "user", parts: [{ text: `Committed successfully. HEAD is now ${sha}. Respond with finish action.` }] });
          } catch (e) {
            contents.push({ role: "user", parts: [{ text: `Commit failed: ${e instanceof Error ? e.message : String(e)}\n\nRespond with next JSON action.` }] });
          }
        } else if (action === "finish") {
          if (!committed) {
            contents.push({
              role: "user",
              parts: [{ text: "Error: You cannot finish without committing your changes first using the commit action." }],
            });
            continue;
          }
          return {
            status: "succeeded",
            whatChanged: String(actionObj.summary ?? commitMessage),
          };
        } else {
          contents.push({
            role: "user",
            parts: [{ text: `Unknown action: "${action}". Valid actions are: read_file, write_file, run_command, git_diff, commit, finish.` }],
          });
        }
      }

      if (committed) {
        return {
          status: "succeeded",
          whatChanged: commitMessage || `Implemented work order ${ctx.workOrder.title}`,
        };
      }

      return {
        status: "failed",
        error: "Exceeded max turns without committing changes.",
      };
    };
  }
}
