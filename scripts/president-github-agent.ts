import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Mission, ReviewVerdict } from "../shared/presidentCycle";
import {
  assertSafeValidationCommand,
  runCommand,
} from "../server/president/fabric/exec";
import {
  protectedViolations,
  runBrowserCheck,
} from "../server/president/fabric/engineering";
import { validateResearchArtifact } from "../server/president/fabric/review";

const API =
  (process.env.PRESIDENT_AGENT_BASE_URL || "https://admin.bldg.chat").replace(
    /\/$/,
    ""
  );
const ROOT = resolve(__dirname, "..");
const MAX_MISSIONS = 3;

type ExecutionClaim = {
  cycleId: string;
  mission: Mission;
  leaseToken: string;
  route: "ENGINEERING" | "RESEARCH";
  feedback: string | null;
};

type ReviewClaim = {
  cycleId: string;
  mission: Mission;
  leaseToken: string;
};

function shellQuote(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

async function githubOidc(): Promise<string> {
  const rawUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!rawUrl || !requestToken)
    throw new Error("GitHub Actions OIDC environment is unavailable");
  const url = new URL(rawUrl);
  url.searchParams.set("audience", "joystick-president-agent");
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${requestToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new Error(`OIDC token request failed (${response.status})`);
  const body = (await response.json()) as { value?: string };
  if (!body.value) throw new Error("OIDC token response contained no value");
  return body.value;
}

async function post<T>(
  path: string,
  token: string,
  body: unknown = {}
): Promise<T | null> {
  const response = await fetch(API + path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${path} failed (${response.status}): ${text.slice(0, 800)}`
    );
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function claude(
  prompt: string,
  token: string,
  opts: { readonly?: boolean } = {}
): Promise<string> {
  const claudeDir = join(homedir(), ".claude");
  mkdirSync(claudeDir, { recursive: true });
  const onboarding = join(homedir(), ".claude.json");
  if (!existsSync(onboarding))
    writeFileSync(onboarding, JSON.stringify({ hasCompletedOnboarding: true }));

  const allowed = opts.readonly
    ? "Read,Glob,Grep"
    : "Read,Edit,Write,Glob,Grep,Bash(npx vitest:*),Bash(pnpm check:*),Bash(pnpm test:*),Bash(pnpm run:*),Bash(ls:*),Bash(cat:*)";
  const args = [
    "-y",
    "@anthropic-ai/claude-code@2.1.114",
    "--print",
    "--output-format",
    "json",
    "--model",
    process.env.PRESIDENT_AGENT_MODEL || "claude-opus-5-5",
    "--allowedTools",
    allowed,
  ];
  if (opts.readonly)
    args.push("--disallowedTools", "Edit,Write,Bash,NotebookEdit");
  else args.push("--permission-mode", "acceptEdits");

  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: `${API}/api/president/autonomous/model`,
    ANTHROPIC_API_KEY: token,
    CLAUDE_CONFIG_DIR: claudeDir,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
  const inputFile = join(process.env.RUNNER_TEMP || "/tmp", `president-prompt-${Date.now()}.txt`);
  writeFileSync(inputFile, prompt);
  const cmd =
    `cat ${shellQuote(inputFile)} | npx ${args.map(shellQuote).join(" ")}`;
  const result = await runCommand(cmd, ROOT, {
    timeoutMs: 30 * 60_000,
    maxBytes: 300_000,
    env,
  });
  if (result.exitCode !== 0)
    throw new Error(
      `Claude Code exited ${result.exitCode}: ${result.stderr.slice(-1200)}`
    );
  let parsed: any;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error("Claude Code returned a non-JSON envelope");
  }
  if (parsed?.is_error) throw new Error(String(parsed.result).slice(0, 1200));
  return String(parsed?.result ?? "");
}

async function validation(mission: Mission, cwd: string) {
  const checks: Array<{ command: string; exitCode: number; ok: boolean }> = [];
  for (const command of mission.requiredValidation.commands) {
    assertSafeValidationCommand(command);
    const result = await runCommand(command, cwd, { timeoutMs: 15 * 60_000 });
    checks.push({
      command,
      exitCode: result.exitCode,
      ok: result.exitCode === 0,
    });
  }
  return checks;
}

async function checkoutMissionBranch(
  mission: Mission
): Promise<{ branch: string; baseSha: string }> {
  const branchName = `president/${mission.missionId}`;
  let r = await runCommand("git fetch --prune origin main", ROOT, {
    timeoutMs: 120_000,
  });
  if (r.exitCode !== 0) throw new Error(`git fetch main failed: ${r.stderr}`);
  const currentMain = (
    await runCommand("git rev-parse origin/main", ROOT)
  ).stdout.trim();

  const remote = await runCommand(
    `git ls-remote --exit-code --heads origin ${shellQuote(branchName)}`,
    ROOT,
    { timeoutMs: 60_000 }
  );
  let baseSha = currentMain;
  if (remote.exitCode === 0) {
    await runCommand(`git fetch origin ${shellQuote(branchName)}`, ROOT, {
      timeoutMs: 120_000,
    });
    r = await runCommand(
      `git checkout -B ${shellQuote(branchName)} FETCH_HEAD`,
      ROOT
    );
    if (r.exitCode === 0) {
      const mergeBase = await runCommand(
        "git merge-base HEAD origin/main",
        ROOT
      );
      if (
        mergeBase.exitCode === 0 &&
        /^[a-f0-9]{40}$/i.test(mergeBase.stdout.trim())
      )
        baseSha = mergeBase.stdout.trim();
    }
  } else {
    r = await runCommand(
      `git checkout -B ${shellQuote(branchName)} ${shellQuote(baseSha)}`,
      ROOT
    );
  }
  if (r.exitCode !== 0)
    throw new Error(`mission checkout failed: ${r.stderr.slice(0, 800)}`);
  return { branch: branchName, baseSha };
}

function engineeringPrompt(m: Mission, feedback: string | null) {
  return [
    "You are President's engineering executor.",
    "This mission was explicitly approved by Adam. Implement exactly the approved scope in the current repository checkout.",
    `Mission: ${m.missionId}`,
    `Title: ${m.title}`,
    `Objective: ${m.objective}`,
    `Business reason: ${m.businessReason}`,
    `Scope: ${m.scope}`,
    "Acceptance criteria:",
    ...m.acceptanceCriteria.map(x => "- " + x),
    "Hard rules:",
    "- Do not merge or deploy.",
    "- Do not touch server/mitch/**.",
    "- Do not touch server/commercialPipeline/**, server/commercialCampaigns/**, server/authority/**, server/geography/**, server/goldlineWorld/**, server/lanternCity/**, drizzle/schema.ts, server/routers.ts, package.json, scripts/migrate.mjs, or .github/workflows/**.",
    "- Do not commit or push; the harness owns git publication.",
    "- Do not broaden scope or perform unrelated refactors.",
    "- Add/update focused tests when needed.",
    feedback ? `Previous attempt feedback: ${feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function researchPrompt(m: Mission, feedback: string | null) {
  return [
    "You are President's read-only research executor.",
    `Mission: ${m.missionId}`,
    `Objective: ${m.objective}`,
    `Scope: ${m.scope}`,
    "Acceptance criteria:",
    ...m.acceptanceCriteria.map(x => "- " + x),
    "Read the repository only. Do not edit files or run shell commands.",
    "Return markdown with exactly these H2 sections in order:",
    "## Findings (evidence)",
    "## Inferences (judgment)",
    "## Sources",
    "## State changes",
    "Sources must be repo-relative paths in backticks, optionally with :line.",
    'State changes must be exactly "None".',
    feedback ? `Previous attempt feedback: ${feedback}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function executeEngineering(claim: ExecutionClaim, token: string) {
  const { mission } = claim;
  try {
    const { branch, baseSha } = await checkoutMissionBranch(mission);
    await claude(engineeringPrompt(mission, claim.feedback), token);

    const changed = (
      await runCommand(`git diff --name-only ${baseSha}; git ls-files --others --exclude-standard`, ROOT)
    ).stdout
      .split("\n")
      .filter(Boolean)
      .filter(x => !x.startsWith("node_modules/"));
    const files = [...new Set(changed)];
    const protectedHits = protectedViolations(files);
    if (!files.length)
      throw new Error("Executor produced no file changes");
    if (protectedHits.length)
      throw new Error(`Protected files changed: ${protectedHits.join(", ")}`);

    const checks = await validation(mission, ROOT);
    let browserEvidence:
      | {
          ok: boolean;
          consoleErrors: string[];
          screenshotPath?: string;
          detail: string;
          workflowRunId?: string;
        }
      | undefined;
    if (mission.requiredValidation.browser) {
      const install = await runCommand(
        "pnpm exec playwright install --with-deps chromium",
        ROOT,
        { timeoutMs: 15 * 60_000 }
      );
      if (install.exitCode !== 0) {
        checks.push({
          command: "playwright-install-chromium",
          exitCode: install.exitCode,
          ok: false,
        });
      } else {
        const shotDir = join(
          process.env.RUNNER_TEMP || "/tmp",
          "president-browser"
        );
        mkdirSync(shotDir, { recursive: true });
        browserEvidence = {
          ...(await runBrowserCheck(
            mission.requiredValidation.browser,
            ROOT,
            join(shotDir, `${mission.missionId}-executor.png`)
          )),
          workflowRunId: process.env.GITHUB_RUN_ID,
        };
        checks.push({
          command: "browser-validation",
          exitCode: browserEvidence.ok ? 0 : 1,
          ok: browserEvidence.ok,
        });
      }
    }
    if (checks.some(x => !x.ok)) {
      await post(
        "/api/president/autonomous/agent/report-execution",
        token,
        {
          cycleId: claim.cycleId,
          missionId: mission.missionId,
          leaseToken: claim.leaseToken,
          result: {
            ok: false,
            validationFailure: true,
            reason: `Required validation failed: ${checks
              .filter(x => !x.ok)
              .map(x => x.command)
              .join(", ")}`,
          },
        }
      );
      return;
    }

    await runCommand("git config user.name 'President Executor'", ROOT);
    await runCommand(
      "git config user.email 'president-executor@users.noreply.github.com'",
      ROOT
    );
    let r = await runCommand("git add -A", ROOT);
    if (r.exitCode !== 0) throw new Error(r.stderr);
    r = await runCommand(
      `git commit --no-verify -m ${shellQuote(
        `President mission ${mission.missionId}: ${mission.title}`
      )}`,
      ROOT
    );
    if (r.exitCode !== 0 && !/nothing to commit/i.test(r.stdout + r.stderr))
      throw new Error(`commit failed: ${r.stderr}`);
    const commitSha = (await runCommand("git rev-parse HEAD", ROOT)).stdout.trim();
    r = await runCommand(
      `git push --force-with-lease origin HEAD:refs/heads/${branch}`,
      ROOT,
      { timeoutMs: 180_000 }
    );
    if (r.exitCode !== 0) throw new Error(`push failed: ${r.stderr}`);

    let prUrl = (
      await runCommand(
        `gh pr list --head ${shellQuote(branch)} --state open --json url --jq '.[0].url // empty'`,
        ROOT,
        { env: { GH_TOKEN: process.env.GITHUB_TOKEN || "" } }
      )
    ).stdout.trim();
    if (!prUrl) {
      const body = [
        `President mission: ${mission.missionId}`,
        `Cycle: ${mission.cycleId}`,
        `Approval receipt: ${mission.approvalReceiptId}`,
        "",
        "Human merge required. This PR was created by President's approved execution fabric.",
      ].join("\n");
      const pr = await runCommand(
        `gh pr create --base main --head ${shellQuote(branch)} --title ${shellQuote(
          `[President] ${mission.title}`
        )} --body ${shellQuote(body)}`,
        ROOT,
        {
          timeoutMs: 90_000,
          env: { GH_TOKEN: process.env.GITHUB_TOKEN || "" },
        }
      );
      if (pr.exitCode !== 0)
        throw new Error(`PR creation failed: ${pr.stderr}`);
      prUrl = pr.stdout.trim().split("\n").pop() || "";
    }

    await post(
      "/api/president/autonomous/agent/report-execution",
      token,
      {
        cycleId: claim.cycleId,
        missionId: mission.missionId,
        leaseToken: claim.leaseToken,
        result: {
          ok: true,
          route: "ENGINEERING",
          baseSha,
          branch,
          commitSha,
          prUrl,
          changedFiles: files,
          checks,
          browserEvidence,
          summary: `Implemented and published ${files.length} changed file(s)`,
        },
      }
    );
  } catch (error) {
    await post(
      "/api/president/autonomous/agent/report-execution",
      token,
      {
        cycleId: claim.cycleId,
        missionId: claim.mission.missionId,
        leaseToken: claim.leaseToken,
        result: {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        },
      }
    ).catch(() => undefined);
    throw error;
  }
}

async function executeResearch(claim: ExecutionClaim, token: string) {
  try {
    await runCommand("git fetch --prune origin main", ROOT, {
      timeoutMs: 120_000,
    });
    const baseSha = (await runCommand("git rev-parse origin/main", ROOT)).stdout.trim();
    await runCommand(`git checkout --detach ${shellQuote(baseSha)}`, ROOT);
    const artifact = await claude(
      researchPrompt(claim.mission, claim.feedback),
      token,
      { readonly: true }
    );
    const problems = validateResearchArtifact(artifact, ROOT);
    if (problems.length) {
      await post(
        "/api/president/autonomous/agent/report-execution",
        token,
        {
          cycleId: claim.cycleId,
          missionId: claim.mission.missionId,
          leaseToken: claim.leaseToken,
          result: {
            ok: false,
            validationFailure: true,
            reason: problems.join("; "),
          },
        }
      );
      return;
    }
    await post(
      "/api/president/autonomous/agent/report-execution",
      token,
      {
        cycleId: claim.cycleId,
        missionId: claim.mission.missionId,
        leaseToken: claim.leaseToken,
        result: {
          ok: true,
          route: "RESEARCH",
          artifactText: artifact,
          artifactSha256: createHash("sha256").update(artifact).digest("hex"),
          summary: "Research artifact produced with repository citations",
        },
      }
    );
  } catch (error) {
    await post(
      "/api/president/autonomous/agent/report-execution",
      token,
      {
        cycleId: claim.cycleId,
        missionId: claim.mission.missionId,
        leaseToken: claim.leaseToken,
        result: {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        },
      }
    ).catch(() => undefined);
    throw error;
  }
}

function parseReviewer(text: string): { verdict: ReviewVerdict; reasons: string[] } {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { verdict: "BLOCKED", reasons: ["Reviewer returned no JSON verdict"] };
  try {
    const value = JSON.parse(match[0]);
    if (!["PASS", "FAIL", "BLOCKED"].includes(value.verdict))
      throw new Error("bad verdict");
    return {
      verdict: value.verdict,
      reasons: Array.isArray(value.reasons)
        ? value.reasons.map(String).slice(0, 20)
        : [],
    };
  } catch {
    return { verdict: "BLOCKED", reasons: ["Reviewer returned invalid JSON verdict"] };
  }
}

async function reviewMission(claim: ReviewClaim, token: string) {
  const m = claim.mission;
  let checks: Array<{ command: string; exitCode: number; ok: boolean }> = [];
  let verdict: ReviewVerdict = "BLOCKED";
  let reasons: string[] = [];

  try {
    if (m.domain === "ENGINEERING") {
      const handback = m.handback as any;
      const commitSha = String(handback?.commitSha || "");
      const baseSha = String(handback?.baseSha || "");
      if (!/^[a-f0-9]{40}$/i.test(commitSha) || !/^[a-f0-9]{40}$/i.test(baseSha))
        throw new Error("Review handback is missing commit/base SHA");

      await runCommand(`git fetch origin ${shellQuote(commitSha)}`, ROOT, {
        timeoutMs: 120_000,
      });
      await runCommand(`git checkout --detach ${shellQuote(commitSha)}`, ROOT);
      checks = await validation(m, ROOT);
      if (m.requiredValidation.browser) {
        const install = await runCommand(
          "pnpm exec playwright install --with-deps chromium",
          ROOT,
          { timeoutMs: 15 * 60_000 }
        );
        if (install.exitCode !== 0) {
          checks.push({
            command: "reviewer-playwright-install-chromium",
            exitCode: install.exitCode,
            ok: false,
          });
        } else {
          const shotDir = join(
            process.env.RUNNER_TEMP || "/tmp",
            "president-browser"
          );
          mkdirSync(shotDir, { recursive: true });
          const browser = await runBrowserCheck(
            m.requiredValidation.browser,
            ROOT,
            join(shotDir, `${m.missionId}-reviewer.png`)
          );
          checks.push({
            command: "reviewer-browser-validation",
            exitCode: browser.ok ? 0 : 1,
            ok: browser.ok,
          });
          if (!browser.ok)
            reasons.push(
              `Browser validation failed: ${browser.detail}; ${browser.consoleErrors.join(" | ")}`
            );
        }
      }

      const files = (
        await runCommand(
          `git diff --name-only ${shellQuote(baseSha)} ${shellQuote(commitSha)}`,
          ROOT
        )
      ).stdout.split("\n").filter(Boolean);
      const protectedHits = protectedViolations(files);
      const diff = (
        await runCommand(
          `git diff ${shellQuote(baseSha)} ${shellQuote(commitSha)}`,
          ROOT,
          { maxBytes: 100_000 }
        )
      ).stdout;

      if (checks.some(x => !x.ok) || protectedHits.length) {
        verdict = "FAIL";
        reasons = [
          ...checks.filter(x => !x.ok).map(x => `Required check failed: ${x.command}`),
          ...(protectedHits.length
            ? [`Protected files changed: ${protectedHits.join(", ")}`]
            : []),
        ];
      } else {
        const review = await claude(
          [
            "You are President's independent code reviewer.",
            "You did not write this change. You may read files but you may not edit or run shell commands.",
            `Mission: ${m.title}`,
            `Objective: ${m.objective}`,
            `Scope: ${m.scope}`,
            "Acceptance criteria:",
            ...m.acceptanceCriteria.map(x => "- " + x),
            `Harness checks: ${JSON.stringify(checks)}`,
            "Review for correctness, security, scope creep, fake evidence, and whether tests really prove the criteria.",
            "DIFF:",
            diff,
            'Return ONLY JSON: {"verdict":"PASS"|"FAIL"|"BLOCKED","reasons":["..."]}.',
          ].join("\n"),
          token,
          { readonly: true }
        );
        ({ verdict, reasons } = parseReviewer(review));
      }
    } else {
      const artifact = m.handback?.artifactText || "";
      const problems = validateResearchArtifact(artifact, ROOT);
      if (problems.length) {
        verdict = "FAIL";
        reasons = problems;
      } else {
        const review = await claude(
          [
            "You are President's independent research reviewer.",
            "You did not create this artifact. Use Read/Glob/Grep only to verify cited repository sources.",
            `Objective: ${m.objective}`,
            "Acceptance criteria:",
            ...m.acceptanceCriteria.map(x => "- " + x),
            "ARTIFACT:",
            artifact,
            'Return ONLY JSON: {"verdict":"PASS"|"FAIL"|"BLOCKED","reasons":["..."]}.',
          ].join("\n"),
          token,
          { readonly: true }
        );
        ({ verdict, reasons } = parseReviewer(review));
      }
    }

    await post(
      "/api/president/autonomous/agent/report-review",
      token,
      {
        cycleId: claim.cycleId,
        missionId: m.missionId,
        leaseToken: claim.leaseToken,
        verdict,
        reasons,
        checks,
      }
    );
  } catch (error) {
    await post(
      "/api/president/autonomous/agent/report-review",
      token,
      {
        cycleId: claim.cycleId,
        missionId: m.missionId,
        leaseToken: claim.leaseToken,
        verdict: "BLOCKED",
        reasons: [error instanceof Error ? error.message : String(error)],
        checks,
      }
    ).catch(() => undefined);
    throw error;
  }
}

async function main() {
  if (!process.env.GITHUB_ACTIONS)
    throw new Error("President GitHub agent must run inside GitHub Actions");
  if (!process.env.GITHUB_TOKEN)
    throw new Error("GITHUB_TOKEN is required");

  const token = await githubOidc();
  let didWork = false;

  for (let i = 0; i < MAX_MISSIONS; i++) {
    const execution = await post<ExecutionClaim>(
      "/api/president/autonomous/agent/claim-execution",
      token
    );
    if (execution) {
      didWork = true;
      if (execution.route === "ENGINEERING")
        await executeEngineering(execution, token);
      else await executeResearch(execution, token);
    }

    const review = await post<ReviewClaim>(
      "/api/president/autonomous/agent/claim-review",
      token
    );
    if (review) {
      didWork = true;
      await reviewMission(review, token);
    }

    if (!execution && !review) break;
  }

  console.log(
    didWork
      ? "President autonomous agent processed available work."
      : "President autonomous agent found no claimable work."
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
