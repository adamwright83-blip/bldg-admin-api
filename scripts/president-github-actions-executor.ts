import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname, join, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  runCommand,
  assertSafeValidationCommand,
} from "../server/president/fabric/exec";
import {
  protectedViolations,
  runBrowserCheck,
} from "../server/president/fabric/engineering";

const API =
  process.env.PRESIDENT_EXECUTION_API?.trim() ||
  "https://admin.bldg.chat/api/president/autonomous/github";
const AUDIENCE = "joystick-president-executor";
const root = process.cwd();

function safeWorkspacePath(input: string) {
  if (!input || input.includes("\0")) throw new Error("Invalid path");
  const absolute = resolve(root, input);
  if (absolute !== root && !absolute.startsWith(root + sep))
    throw new Error("Path escapes repository");
  const rel = relative(root, absolute).replace(/\\/g, "/") || ".";
  if (/^(server\/mitch(?:\/|$)|shared\/mitch)/i.test(rel))
    throw new Error("Peer-seat source is outside President execution");
  return { absolute, relative: rel };
}

function assertWritable(path: string) {
  const { relative: rel } = safeWorkspacePath(path);
  const blocked = [
    /^server\/mitch(?:\/|$)/i,
    /^shared\/mitch/i,
    /^server\/commercialPipeline(?:\/|$)/,
    /^server\/commercialCampaigns(?:\/|$)/,
    /^server\/authority(?:\/|$)/,
    /^drizzle\/schema\.ts$/,
    /^package\.json$/,
    /^pnpm-lock\.yaml$/,
    /^\.github(?:\/|$)/,
  ];
  if (blocked.some(pattern => pattern.test(rel)))
    throw new Error("Protected path: " + rel);
  return safeWorkspacePath(path);
}

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !requestToken)
    throw new Error("GitHub Actions OIDC environment unavailable");
  const joiner = url.includes("?") ? "&" : "?";
  const response = await fetch(
    `${url}${joiner}audience=${encodeURIComponent(AUDIENCE)}`,
    {
      headers: { Authorization: `Bearer ${requestToken}` },
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!response.ok)
    throw new Error(`OIDC token request failed (${response.status})`);
  const body = (await response.json()) as { value?: string };
  if (!body.value) throw new Error("OIDC response missing token");
  return body.value;
}

let token = "";

async function api<T = any>(path: string, body: unknown): Promise<T> {
  if (!token) token = await oidcToken();
  const response = await fetch(API + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5 * 60_000),
  });
  const parsed = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `${path} failed (${response.status}): ${String(parsed?.error ?? "").slice(0, 500)}`
    );
  return parsed as T;
}

type Claim = {
  claimed: boolean;
  leaseToken?: string;
  reviewOnly?: boolean;
  baseSha?: string;
  branch?: string;
  feedback?: string | null;
  mission?: {
    missionId: string;
    cycleId: string;
    candidateId: string;
    title: string;
    objective: string;
    businessReason: string;
    acceptanceCriteria: string[];
    domain: string;
    scope: string;
    constraints: string[];
    approvalReceiptId: string;
    approvedAt: string;
    attempt: number;
    maxAttempts: number;
    requiredValidation: {
      commands: string[];
      browser: {
        url: string;
        expectText?: string;
        startCommand?: string;
      } | null;
    };
  };
};

function listDirectory(path: string) {
  const { absolute, relative: rel } = safeWorkspacePath(path || ".");
  return JSON.stringify(
    readdirSync(absolute, { withFileTypes: true })
      .filter(entry => {
        const child = join(rel === "." ? "" : rel, entry.name).replace(/\\/g, "/");
        return !/^(server\/mitch(?:\/|$)|shared\/mitch)/i.test(child);
      })
      .slice(0, 400)
      .map(entry => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : "file",
      }))
  );
}

function readFileTool(path: string, startLine = 1, endLine = startLine + 400) {
  const { absolute } = safeWorkspacePath(path);
  const content = readFileSync(absolute, "utf8");
  const start = Math.max(1, Number(startLine) || 1);
  const end = Math.min(start + 800, Math.max(start, Number(endLine) || start + 400));
  return content.split("\n").slice(start - 1, end).join("\n").slice(0, 180_000);
}

async function searchText(query: string, path = ".") {
  if (!query.trim()) throw new Error("search_text requires query");
  const { relative: rel } = safeWorkspacePath(path || ".");
  const args = ["grep", "-n", "-I", "-F", "-e", query, "--"];
  if (rel !== ".") args.push(rel);
  const result = await runCommand("git " + args.map(a => JSON.stringify(a)).join(" "), root, {
    timeoutMs: 20_000,
  });
  if (result.exitCode !== 0 && result.exitCode !== 1)
    throw new Error("search_text failed");
  return result.stdout
    .split("\n")
    .filter(line => !/^(server\/mitch(?:\/|$)|shared\/mitch)/i.test(line.split(":")[0] ?? ""))
    .slice(0, 400)
    .join("\n");
}

function writeFileTool(path: string, content: string) {
  const { absolute, relative: rel } = assertWritable(path);
  if (content.length > 900_000) throw new Error("write_file content too large");
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
  return "wrote " + rel;
}

function replaceTextTool(path: string, oldText: string, newText: string) {
  if (!oldText) throw new Error("replace_text old_text required");
  const { absolute, relative: rel } = assertWritable(path);
  const source = readFileSync(absolute, "utf8");
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error("replace_text old_text not found");
  if (source.indexOf(oldText, first + oldText.length) >= 0)
    throw new Error("replace_text old_text is not unique");
  writeFileSync(
    absolute,
    source.slice(0, first) + newText + source.slice(first + oldText.length),
    "utf8"
  );
  return "replaced text in " + rel;
}

async function handleTool(use: any, readOnly: boolean) {
  const name = String(use.name);
  const input = (use.input ?? {}) as Record<string, any>;
  if (name === "list_directory") return listDirectory(String(input.path ?? "."));
  if (name === "read_file")
    return readFileTool(
      String(input.path ?? ""),
      Number(input.start_line ?? 1),
      Number(input.end_line ?? Number(input.start_line ?? 1) + 400)
    );
  if (name === "search_text")
    return searchText(String(input.query ?? ""), String(input.path ?? "."));
  if (readOnly) throw new Error("Reviewer/research executor is read-only");
  if (name === "write_file")
    return writeFileTool(String(input.path ?? ""), String(input.content ?? ""));
  if (name === "replace_text")
    return replaceTextTool(
      String(input.path ?? ""),
      String(input.old_text ?? ""),
      String(input.new_text ?? "")
    );
  throw new Error("Unknown tool " + name);
}

async function modelLoop(
  claim: Claim,
  role: "EXECUTOR" | "REVIEWER",
  initial: string,
  readOnly: boolean
) {
  const mission = claim.mission!;
  const messages: any[] = [{ role: "user", content: initial }];
  const summaries: string[] = [];

  for (let turn = 0; turn < 20; turn++) {
    const response = await api<any>("/model", {
      cycleId: mission.cycleId,
      missionId: mission.missionId,
      leaseToken: claim.leaseToken,
      role,
      messages,
    });
    const content = Array.isArray(response.content) ? response.content : [];
    const text = content
      .filter((b: any) => b.type === "text")
      .map((b: any) => String(b.text ?? ""))
      .join("\n")
      .trim();
    if (text) summaries.push(text);
    const uses = content.filter((b: any) => b.type === "tool_use");
    messages.push({ role: "assistant", content });
    if (!uses.length) return summaries.join("\n\n").trim();

    const results = [];
    for (const use of uses) {
      try {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: await handleTool(use, readOnly),
        });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          is_error: true,
          content: error instanceof Error ? error.message : String(error),
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("President model tool loop exceeded 20 turns");
}

async function checkoutMissionBranch(claim: Claim) {
  const branch = claim.branch!;
  const baseSha = claim.baseSha!;
  execFileSync("git", ["fetch", "origin", "--prune"], { stdio: "inherit" });
  let remoteExists = true;
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`]);
  } catch {
    remoteExists = false;
  }
  if (remoteExists)
    execFileSync("git", ["checkout", "-B", branch, `origin/${branch}`], { stdio: "inherit" });
  else
    execFileSync("git", ["checkout", "-B", branch, baseSha], { stdio: "inherit" });
}

async function runChecks(commands: string[]) {
  const checks: Array<{ command: string; exitCode: number; ok: boolean }> = [];
  for (const command of commands) {
    assertSafeValidationCommand(command);
    const result = await runCommand(command, root, { timeoutMs: 15 * 60_000 });
    checks.push({ command, exitCode: result.exitCode, ok: result.exitCode === 0 });
    if (result.exitCode !== 0)
      throw Object.assign(
        new Error(
          `Validation failed: ${command}\n${(result.stdout + result.stderr).slice(-5000)}`
        ),
        { checks }
      );
  }
  return checks;
}

async function ensureBrowserIfNeeded(claim: Claim) {
  if (!claim.mission?.requiredValidation.browser) return null;
  const install = await runCommand("pnpm exec playwright install --with-deps chromium", root, {
    timeoutMs: 15 * 60_000,
  });
  if (install.exitCode !== 0)
    throw new Error("Playwright Chromium installation failed");
  const shot = join(
    root,
    "artifacts",
    "president-cycle",
    `${claim.mission.missionId}-browser.png`
  );
  return runBrowserCheck(claim.mission.requiredValidation.browser, root, shot);
}

function parseReviewerFinal(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Reviewer did not return JSON verdict");
  const parsed = JSON.parse(match[0]) as {
    verdict?: string;
    reasons?: unknown[];
  };
  if (!["PASS", "FAIL", "BLOCKED"].includes(String(parsed.verdict)))
    throw new Error("Reviewer returned invalid verdict");
  return {
    verdict: parsed.verdict as "PASS" | "FAIL" | "BLOCKED",
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.map(String).slice(0, 20)
      : [],
  };
}

async function publishEngineering(
  claim: Claim,
  summary: string,
  checks: Array<{ command: string; exitCode: number; ok: boolean }>,
  browserEvidence: any
) {
  const branch = claim.branch!;
  const baseSha = claim.baseSha!;
  const files = execFileSync("git", ["diff", "--name-only", baseSha], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!files.length) throw new Error("Engineering executor produced no file changes");
  const violations = protectedViolations(files);
  if (violations.length)
    throw new Error("Protected/out-of-scope files changed: " + violations.join(", "));

  execFileSync("git", ["config", "user.name", "JOYSTICK President"]);
  execFileSync("git", ["config", "user.email", "president@users.noreply.github.com"]);
  execFileSync("git", ["add", "-A"]);
  try {
    execFileSync("git", ["commit", "-m", `President mission ${claim.mission!.missionId}: ${claim.mission!.title}`], {
      stdio: "inherit",
    });
  } catch {
    // A repair pass can legitimately validate an already-committed branch.
  }
  execFileSync("git", ["push", "-u", "origin", branch], { stdio: "inherit" });
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  let prUrl = "";
  try {
    prUrl = execFileSync(
      "gh",
      ["pr", "view", branch, "--json", "url", "-q", ".url"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    const body = [
      `President mission: ${claim.mission!.title}`,
      "",
      `Cycle: ${claim.mission!.cycleId}`,
      `Mission: ${claim.mission!.missionId}`,
      `Adam approval receipt: ${claim.mission!.approvalReceiptId}`,
      "",
      "Objective:",
      claim.mission!.objective,
      "",
      "Acceptance criteria:",
      ...claim.mission!.acceptanceCriteria.map(x => "- " + x),
      "",
      "Executor summary:",
      summary.slice(0, 4000),
      "",
      "Required checks:",
      ...checks.map(x => `- ${x.ok ? "PASS" : "FAIL"}: ${x.command}`),
      "",
      "Human merge required. President cannot merge this PR.",
    ].join("\n");
    prUrl = execFileSync(
      "gh",
      [
        "pr",
        "create",
        "--base",
        "main",
        "--head",
        branch,
        "--title",
        `[President] ${claim.mission!.title}`,
        "--body",
        body,
      ],
      { encoding: "utf8" }
    ).trim();
  }

  await api("/published", {
    cycleId: claim.mission!.cycleId,
    missionId: claim.mission!.missionId,
    leaseToken: claim.leaseToken,
    baseSha,
    branch,
    commitSha,
    prUrl,
    changedFiles: files,
    checks,
    browserEvidence,
  });
  return { prUrl, commitSha, files };
}

async function review(claim: Claim, context: string) {
  const final = await modelLoop(
    claim,
    "REVIEWER",
    [
      "Independently review this President mission. You did not execute it.",
      JSON.stringify(claim.mission, null, 2),
      "",
      "Execution evidence:",
      context.slice(0, 60_000),
      "",
      "Use read-only repository tools if needed. Return only the required JSON verdict when finished.",
    ].join("\n"),
    true
  );
  const verdict = parseReviewerFinal(final);
  await api("/review", {
    cycleId: claim.mission!.cycleId,
    missionId: claim.mission!.missionId,
    leaseToken: claim.leaseToken,
    verdict: verdict.verdict,
    reasons: verdict.reasons,
  });
  return verdict;
}

async function execute(claim: Claim) {
  const mission = claim.mission!;
  if (claim.reviewOnly) {
    const context = JSON.stringify(
      {
        previousHandback:
          "Review-only recovery. Inspect the mission branch/repository and durable evidence.",
      },
      null,
      2
    );
    return review(claim, context);
  }

  await checkoutMissionBranch(claim);

  if (mission.domain === "ENGINEERING") {
    const summary = await modelLoop(
      claim,
      "EXECUTOR",
      [
        "Execute this Adam-approved engineering mission.",
        JSON.stringify(mission, null, 2),
        claim.feedback ? "\nRepair feedback:\n" + claim.feedback : "",
      ].join("\n"),
      false
    );

    const checks = await runChecks(mission.requiredValidation.commands);
    const browserEvidence = await ensureBrowserIfNeeded(claim);
    if (mission.requiredValidation.browser && browserEvidence?.ok !== true)
      throw Object.assign(
        new Error("Required browser validation failed"),
        { checks, browserEvidence }
      );

    const publication = await publishEngineering(
      claim,
      summary,
      checks,
      browserEvidence
    );
    const diff = execFileSync("git", ["diff", `${claim.baseSha}...${publication.commitSha}`], {
      encoding: "utf8",
      maxBuffer: 2_000_000,
    });
    return review(
      claim,
      JSON.stringify(
        {
          prUrl: publication.prUrl,
          commitSha: publication.commitSha,
          changedFiles: publication.files,
          checks,
          browserEvidence,
          diff: diff.slice(0, 80_000),
        },
        null,
        2
      )
    );
  }

  const artifact = await modelLoop(
    claim,
    "EXECUTOR",
    [
      "Execute this Adam-approved read-only research/analysis/documentation mission.",
      JSON.stringify(mission, null, 2),
      claim.feedback ? "\nRepair feedback:\n" + claim.feedback : "",
    ].join("\n"),
    true
  );
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  await api("/published", {
    cycleId: mission.cycleId,
    missionId: mission.missionId,
    leaseToken: claim.leaseToken,
    baseSha: claim.baseSha,
    artifactText: artifact,
    artifactSha256,
    checks: [],
  });
  return review(
    claim,
    JSON.stringify({ artifactSha256, artifact: artifact.slice(0, 60_000) }, null, 2)
  );
}

async function main() {
  const claim = await api<Claim>("/claim", {});
  if (!claim.claimed) {
    console.log("President: no approved mission ready");
    return;
  }
  if (!claim.mission || !claim.leaseToken || !claim.baseSha || !claim.branch)
    throw new Error("President claim response incomplete");

  console.log(
    `President: claimed ${claim.mission.missionId} (${claim.mission.domain}) attempt ${claim.mission.attempt}`
  );
  try {
    const result = await execute(claim);
    console.log("President result:", result);
  } catch (error) {
    const checks = (error as any)?.checks ?? [];
    const reason = error instanceof Error ? error.message : String(error);
    console.error("President execution failed:", reason);
    await api("/failure", {
      cycleId: claim.mission.cycleId,
      missionId: claim.mission.missionId,
      leaseToken: claim.leaseToken,
      reason,
      checks,
    }).catch(callbackError => {
      console.error("President failure callback also failed:", callbackError);
    });
    process.exitCode = 1;
  }
}

await main();
