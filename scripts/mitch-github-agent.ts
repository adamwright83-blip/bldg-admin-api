import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = resolve(__dirname, "..");
const API = (process.env.MITCH_PRODUCER_BASE_URL || "").replace(/\/$/, "");
const ROLE = process.env.MITCH_AGENT_ROLE;
const REPO = process.env.MITCH_GITHUB_REPO || "adamwright83-blip/bldg-admin-api";
const ISSUE = Number(process.env.MITCH_GITHUB_ISSUE_NUMBER || "370");
const MODEL = process.env.MITCH_CLAUDE_MODEL || "claude-sonnet-4-6";
const EXECUTOR_ACTOR = "github-producer-bus:claude";
const REVIEWER_ACTOR = "claude_independent_review";

type Wake = {
  wakeId: string;
  actorId: string;
  kind: "implementation_request" | "design_review_request" | "retest_request";
  tenantId: string;
  gameId: string;
  milestoneId: string;
  workOrderId: string;
  buildId?: string | null;
  issueCommentUrl?: string | null;
};

type Check = { command: string; exitCode: number; ok: boolean };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function runCommand(
  command: string,
  cwd = ROOT,
  options: { timeoutMs?: number; maxBytes?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const maxBytes = options.maxBytes ?? 250_000;
    let stdout = "";
    let stderr = "";
    const append = (current: string, next: Buffer) =>
      (current + next.toString("utf8")).slice(-maxBytes);
    child.stdout.on("data", data => (stdout = append(stdout, data)));
    child.stderr.on("data", data => (stderr = append(stderr, data)));
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      options.timeoutMs ?? 15 * 60_000
    );
    child.once("error", reject);
    child.once("close", code => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

function parseWake(): Wake {
  const wake = JSON.parse(required("MITCH_WAKE")) as Wake;
  if (!wake?.workOrderId || !wake?.milestoneId || !wake?.tenantId || !wake?.gameId)
    throw new Error("MITCH_WAKE is missing required identity");
  if (ROLE === "executor" && wake.actorId !== EXECUTOR_ACTOR)
    throw new Error("Executor workflow received the wrong actor identity");
  if (ROLE === "reviewer" && wake.actorId !== REVIEWER_ACTOR)
    throw new Error("Reviewer workflow received the wrong actor identity");
  if (!["executor", "reviewer"].includes(String(ROLE)))
    throw new Error("MITCH_AGENT_ROLE must be executor or reviewer");
  return wake;
}

async function githubOidc(): Promise<string> {
  const rawUrl = required("ACTIONS_ID_TOKEN_REQUEST_URL");
  const requestToken = required("ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const url = new URL(rawUrl);
  url.searchParams.set("audience", "joystick-mitch-agent");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`OIDC token request failed (${response.status})`);
  const body = (await response.json()) as { value?: string };
  if (!body.value) throw new Error("OIDC response contained no token");
  return body.value;
}

async function postEvent(event: unknown): Promise<void> {
  const token = await githubOidc();
  const response = await fetch(API + "/api/mitch/autonomous/event", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `Mitch event callback failed (${response.status}): ${text.slice(0, 800)}`
    );
}

async function startRefreshingModelProxy() {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 2_000_000) throw new Error("Claude gateway request too large");
        chunks.push(buffer);
      }
      const token = await githubOidc();
      const upstream = await fetch(
        API + "/api/mitch/autonomous/model" + (req.url || "/v1/messages"),
        {
          method: req.method || "POST",
          headers: {
            "content-type": String(req.headers["content-type"] || "application/json"),
            "x-api-key": token,
            "anthropic-version": String(
              req.headers["anthropic-version"] || "2023-06-01"
            ),
            ...(req.headers["anthropic-beta"]
              ? { "anthropic-beta": String(req.headers["anthropic-beta"]) }
              : {}),
          },
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(20 * 60_000),
        }
      );
      res.statusCode = upstream.status;
      const type = upstream.headers.get("content-type");
      if (type) res.setHeader("content-type", type);
      res.setHeader("cache-control", "no-store");
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      res.statusCode = 502;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not bind Mitch model proxy");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolvePromise => server.close(() => resolvePromise())),
  };
}

async function claude(prompt: string, readonly: boolean): Promise<string> {
  const claudeDir = join(homedir(), readonly ? ".claude-mitch-review" : ".claude-mitch-exec");
  mkdirSync(claudeDir, { recursive: true });
  const onboarding = join(homedir(), ".claude.json");
  if (!existsSync(onboarding))
    writeFileSync(onboarding, JSON.stringify({ hasCompletedOnboarding: true }));

  const args = [
    "-y",
    "@anthropic-ai/claude-code@2.1.114",
    "--print",
    "--output-format",
    "json",
    "--model",
    MODEL,
    "--allowedTools",
    readonly ? "Read,Glob,Grep" : "Read,Edit,Write,Glob,Grep",
  ];
  if (readonly) args.push("--disallowedTools", "Edit,Write,Bash,NotebookEdit");
  else args.push("--disallowedTools", "Bash,NotebookEdit", "--permission-mode", "acceptEdits");

  const proxy = await startRefreshingModelProxy();
  const promptFile = join(
    process.env.RUNNER_TEMP || "/tmp",
    `mitch-${ROLE}-prompt-${Date.now()}.txt`
  );
  writeFileSync(promptFile, prompt);
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: proxy.baseUrl,
    ANTHROPIC_API_KEY: "mitch-github-oidc-proxy",
    CLAUDE_CONFIG_DIR: claudeDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  try {
    const result = await runCommand(
      `cat ${shellQuote(promptFile)} | npx ${args.map(shellQuote).join(" ")}`,
      ROOT,
      { timeoutMs: 30 * 60_000, maxBytes: 300_000, env }
    );
    if (result.exitCode !== 0)
      throw new Error(
        `Claude Code exited ${result.exitCode}: ${result.stderr.slice(-1500)}`
      );
    const parsed = JSON.parse(result.stdout) as { is_error?: boolean; result?: unknown };
    if (parsed.is_error) throw new Error(String(parsed.result).slice(0, 1500));
    return String(parsed.result ?? "");
  } finally {
    await proxy.close();
  }
}

async function listProducerComments(): Promise<Array<{ body: string; html_url: string }>> {
  const token = required("GITHUB_TOKEN");
  const [owner, repo] = REPO.split("/");
  const out: Array<{ body: string; html_url: string }> = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${ISSUE}/comments?per_page=100&page=${page}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
      }
    );
    if (!response.ok)
      throw new Error(`Could not read Mitch producer issue (${response.status})`);
    const batch = (await response.json()) as Array<{ body: string; html_url: string }>;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function findWorkOrderBrief(workOrderId: string): Promise<string> {
  const marker = `<!-- mitch-work-order:${workOrderId} -->`;
  const comments = await listProducerComments();
  const comment = comments.find(item => item.body.includes(marker));
  if (!comment) throw new Error("Mitch work-order brief was not found on producer issue");
  return comment.body;
}

async function findReviewBrief(wake: Wake): Promise<string> {
  if (!wake.buildId) throw new Error("Reviewer wake has no exact build id");
  const prefix = `<!-- mitch-design-review-request:${wake.milestoneId}:${wake.buildId}`;
  const comments = await listProducerComments();
  const matches = comments.filter(item => item.body.includes(prefix));
  if (!matches.length) throw new Error("Mitch review brief was not found on producer issue");
  return matches[matches.length - 1].body;
}

function parseBase(brief: string): { branch: string; sha: string } {
  const match = brief.match(/\*\*Exact base:\*\*\s+(.+?)@([a-f0-9]{40})\s*$/im);
  if (!match) throw new Error("Work order has no exact 40-character base SHA");
  return { branch: match[1].trim(), sha: match[2].toLowerCase() };
}

function requiredTestItems(brief: string): string[] {
  const section = brief.split("### Required tests")[1]?.split(/\n### /)[0] ?? "";
  return section
    .split("\n")
    .map(line => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function validationCommand(item: string): string {
  if (item === "pnpm check") return item;
  if (/^pnpm exec vitest run [A-Za-z0-9_./*:-]+$/.test(item)) return item;
  if (/^npx vitest run [A-Za-z0-9_./*:-]+$/.test(item)) return item;
  if (
    /^pnpm exec playwright test --config e2e\/[A-Za-z0-9_./-]+\.ts(?: [A-Za-z0-9_./*:-]+)?$/.test(
      item
    )
  )
    return item;
  if (/^[A-Za-z0-9_./-]+\.test\.[cm]?[jt]sx?$/.test(item))
    return `pnpm exec vitest run ${item}`;
  throw new Error(`Unsupported Mitch validation instruction: ${item}`);
}

async function runValidation(brief: string): Promise<Check[]> {
  const commands = requiredTestItems(brief).map(validationCommand);
  if (!commands.includes("pnpm check")) commands.push("pnpm check");
  const uniqueCommands = [...new Set(commands)];
  const checks: Check[] = [];

  if (uniqueCommands.some(command => /\bplaywright\b/.test(command))) {
    const install = await runCommand(
      "pnpm exec playwright install --with-deps chromium",
      ROOT,
      { timeoutMs: 15 * 60_000 }
    );
    checks.push({
      command: "pnpm exec playwright install --with-deps chromium",
      exitCode: install.exitCode,
      ok: install.exitCode === 0,
    });
    if (install.exitCode !== 0) return checks;
  }

  for (const command of uniqueCommands) {
    const result = await runCommand(command, ROOT, { timeoutMs: 15 * 60_000 });
    checks.push({ command, exitCode: result.exitCode, ok: result.exitCode === 0 });
    if (result.exitCode !== 0) break;
  }
  return checks;
}

function protectedFiles(files: string[]): string[] {
  return files.filter(path => {
    if (path.startsWith("client/src/")) return false;
    if (path.startsWith("client/public/assets/")) return false;
    if (path.startsWith("e2e/")) return false;
    return true;
  });
}

async function checkoutExact(baseSha: string, branch: string): Promise<void> {
  let result = await runCommand("git fetch --prune origin main", ROOT, { timeoutMs: 120_000 });
  if (result.exitCode !== 0) throw new Error("git fetch main failed: " + result.stderr.slice(-800));
  result = await runCommand(`git cat-file -e ${shellQuote(baseSha + "^{commit}")}`, ROOT);
  if (result.exitCode !== 0) {
    result = await runCommand(`git fetch origin ${shellQuote(baseSha)}`, ROOT, { timeoutMs: 120_000 });
    if (result.exitCode !== 0) throw new Error("Pinned Mitch base SHA is not fetchable");
  }
  result = await runCommand(
    `git checkout -B ${shellQuote(branch)} ${shellQuote(baseSha)}`,
    ROOT
  );
  if (result.exitCode !== 0) throw new Error("Mitch checkout failed: " + result.stderr.slice(-800));
}

function executionPrompt(brief: string): string {
  return [
    "You are Mitch's Claude game-production executor.",
    "Implement exactly the bounded work order below in the current repository checkout.",
    "The repository checkout is pinned by the harness to the work order's exact base SHA.",
    "",
    "Hard rules:",
    "- Do not merge, deploy, commit, push, or change branches. The harness owns git publication.",
    "- Do not touch server/claire/**, server/president/**, server/mitch/**, shared/**, drizzle/**, scripts/**, .github/**, package.json, or lockfiles.",
    "- Game implementation may change only client/src/**, client/public/assets/**, and focused e2e/** evidence/tests.",
    "- Do not alter business truth, customer data, revenue, orders, tenancy, identity, payment, or architecture.",
    "- Do not broaden the creative scope beyond the work order.",
    "- Do not claim tests or gameplay evidence you did not actually produce.",
    "",
    "WORK ORDER:",
    brief,
  ].join("\n");
}

async function execute(wake: Wake): Promise<void> {
  const brief = await findWorkOrderBrief(wake.workOrderId);
  const base = parseBase(brief);
  const branch = `mitch/${wake.workOrderId}`;
  await checkoutExact(base.sha, branch);
  await claude(executionPrompt(brief), false);

  const diff = await runCommand(
    `git diff --name-only ${shellQuote(base.sha)}; git ls-files --others --exclude-standard`,
    ROOT
  );
  const files = [...new Set(diff.stdout.split("\n").map(x => x.trim()).filter(Boolean))]
    .filter(path => !path.startsWith("node_modules/"));
  if (!files.length) throw new Error("Claude executor produced no file changes");
  const violations = protectedFiles(files);
  if (violations.length)
    throw new Error("Claude executor changed protected files: " + violations.join(", "));

  const checks = await runValidation(brief);
  if (checks.some(check => !check.ok))
    throw new Error(
      "Required validation failed: " +
        checks.filter(check => !check.ok).map(check => check.command).join(", ")
    );

  await runCommand("git config user.name 'Mitch Claude Executor'", ROOT);
  await runCommand(
    "git config user.email 'mitch-claude-executor@users.noreply.github.com'",
    ROOT
  );
  let result = await runCommand("git add -A", ROOT);
  if (result.exitCode !== 0) throw new Error(result.stderr);
  result = await runCommand(
    `git commit --no-verify -m ${shellQuote("Mitch work order " + wake.workOrderId)}`,
    ROOT
  );
  if (result.exitCode !== 0)
    throw new Error("Mitch commit failed: " + result.stderr.slice(-1000));
  const commitSha = (await runCommand("git rev-parse HEAD", ROOT)).stdout.trim();
  if (!/^[a-f0-9]{40}$/i.test(commitSha))
    throw new Error("Executor produced invalid commit SHA");
  result = await runCommand(
    `git push --force-with-lease origin HEAD:refs/heads/${shellQuote(branch)}`,
    ROOT,
    { timeoutMs: 180_000 }
  );
  if (result.exitCode !== 0)
    throw new Error("Mitch push failed: " + result.stderr.slice(-1200));

  await postEvent({
    eventId: randomUUID(),
    type: "implementation_handback",
    tenantId: wake.tenantId,
    gameId: wake.gameId,
    milestoneId: wake.milestoneId,
    workOrderId: wake.workOrderId,
    actorId: EXECUTOR_ACTOR,
    handback: {
      branch,
      commitSha,
      exactBuildId: commitSha,
      whatChanged: `Claude executor changed ${files.length} file(s): ${files.join(", ")}`,
      testsActuallyRun: checks.map(
        check => `${check.command} => exit ${check.exitCode}`
      ),
      testsNotRun: [],
      previewLaunchInstructions:
        `git checkout ${commitSha} && pnpm install --frozen-lockfile && pnpm dev`,
      evidence: {
        captures: [],
        sourceCompiled: checks.some(check => check.command === "pnpm check" && check.ok),
        unitTestsPassed: checks.every(check => check.ok),
        buildCommitSha: commitSha,
        githubActionsRunId: process.env.GITHUB_RUN_ID ?? null,
        changedFiles: files,
      },
      knownLimitations:
        "GitHub Actions executor does not claim hands-on gameplay unless a browser test is explicitly part of the work order.",
    },
  });
}

type ReviewerDecision = {
  verdict: "fix_needed" | "no_blocking_issue" | "human_play_required";
  observedBehavior: string;
  recommendedNextProof: string;
};

function parseReviewerModel(text: string): ReviewerDecision {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match)
    return {
      verdict: "human_play_required",
      observedBehavior: "Reviewer returned no structured verdict.",
      recommendedNextProof: "Human play the exact build.",
    };
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = ["fix_needed", "no_blocking_issue", "human_play_required"].includes(String(parsed.verdict))
      ? (String(parsed.verdict) as "fix_needed" | "no_blocking_issue" | "human_play_required")
      : "human_play_required";
    return {
      verdict,
      observedBehavior: String(parsed.observedBehavior ?? "No observation supplied"),
      recommendedNextProof: String(parsed.recommendedNextProof ?? "Exercise the exact build"),
    };
  } catch {
    return {
      verdict: "human_play_required",
      observedBehavior: "Reviewer returned invalid JSON.",
      recommendedNextProof: "Human play the exact build.",
    };
  }
}

async function review(wake: Wake): Promise<void> {
  if (!wake.buildId || !/^[a-f0-9]{40}$/i.test(wake.buildId))
    throw new Error("Reviewer requires an exact commit-backed build");
  const workBrief = await findWorkOrderBrief(wake.workOrderId);
  const reviewBrief = await findReviewBrief(wake);
  const base = parseBase(workBrief);
  await checkoutExact(wake.buildId, `mitch-review-${wake.buildId.slice(0, 12)}`);

  const checks = await runValidation(workBrief);
  const diffResult = await runCommand(
    `git diff ${shellQuote(base.sha)} ${shellQuote(wake.buildId)}`,
    ROOT,
    { maxBytes: 120_000 }
  );
  const filesResult = await runCommand(
    `git diff --name-only ${shellQuote(base.sha)} ${shellQuote(wake.buildId)}`,
    ROOT
  );
  const files = filesResult.stdout.split("\n").map(x => x.trim()).filter(Boolean);
  const violations = protectedFiles(files);
  const browserCheck = checks.find(check => /playwright|browser|e2e/i.test(check.command));
  const gameActuallyExercised = Boolean(browserCheck?.ok);

  let model: ReviewerDecision = {
    verdict: "human_play_required",
    observedBehavior: "Independent harness checks passed, but the exact game build was not exercised in a browser.",
    recommendedNextProof: "Play the exact commit-backed build and verify the player-visible mechanic.",
  };

  if (checks.some(check => !check.ok) || violations.length) {
    model = {
      verdict: "fix_needed",
      observedBehavior:
        violations.length
          ? "The implementation changed protected/out-of-scope files: " + violations.join(", ")
          : "One or more required validation commands failed.",
      recommendedNextProof: "Repair the bounded defect and rerun independent validation.",
    };
  } else {
    const response = await claude(
      [
        "You are Mitch's independent game-code reviewer.",
        "You did not write this implementation. You are read-only and must not fix it.",
        "Review correctness, scope, regressions, evidence honesty, and whether the acceptance criteria are actually supported.",
        "Do not claim you played the game unless the harness explicitly reports a passing browser/e2e command.",
        "",
        "REVIEW REQUEST:",
        reviewBrief,
        "",
        "HARNESS CHECKS:",
        JSON.stringify(checks),
        "",
        "CHANGED FILES:",
        files.join("\n"),
        "",
        "DIFF:",
        diffResult.stdout,
        "",
        'Return ONLY JSON: {"verdict":"fix_needed"|"no_blocking_issue"|"human_play_required","observedBehavior":"...","recommendedNextProof":"..."}.',
      ].join("\n"),
      true
    );
    model = parseReviewerModel(response);
  }

  if (model.verdict === "no_blocking_issue" && !gameActuallyExercised) {
    model = {
      verdict: "human_play_required",
      observedBehavior:
        model.observedBehavior +
        " The exact build was not exercised by an independent browser/gameplay check.",
      recommendedNextProof: "Play the exact build before creative acceptance.",
    };
  }

  const acceptancePassed =
    model.verdict === "no_blocking_issue" &&
    gameActuallyExercised &&
    checks.every(check => check.ok) &&
    violations.length === 0;

  await postEvent({
    eventId: randomUUID(),
    type: wake.kind === "retest_request" ? "qa_handback" : "design_review_handback",
    tenantId: wake.tenantId,
    gameId: wake.gameId,
    milestoneId: wake.milestoneId,
    workOrderId: wake.workOrderId,
    actorId: REVIEWER_ACTOR,
    buildId: wake.buildId,
    branch: (
      reviewBrief.match(/\*\*Branch:\*\*\s+([^\n]+)/i)?.[1] ?? ""
    ).trim(),
    commitSha: wake.buildId,
    review: {
      verdict: model.verdict,
      observedBehavior: model.observedBehavior,
      evidenceArtifact: `https://github.com/${REPO}/commit/${wake.buildId}`,
      recommendedNextProof: model.recommendedNextProof,
      gameActuallyExercised,
      acceptancePassed,
    },
  });
}

async function main() {
  if (!process.env.GITHUB_ACTIONS)
    throw new Error("Mitch GitHub agent must run inside GitHub Actions");
  if (!API) throw new Error("MITCH_PRODUCER_BASE_URL is required");
  const wake = parseWake();
  try {
    if (ROLE === "executor") await execute(wake);
    else await review(wake);
  } catch (error) {
    if (ROLE === "executor") {
      await postEvent({
        eventId: randomUUID(),
        type: "agent_failed",
        tenantId: wake.tenantId,
        gameId: wake.gameId,
        milestoneId: wake.milestoneId,
        workOrderId: wake.workOrderId,
        actorId: EXECUTOR_ACTOR,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    }
    throw error;
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
