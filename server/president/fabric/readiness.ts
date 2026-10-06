import { runCommand } from "./exec";
import type { ModelRoster } from "../cycle/models";
import type { PresidentExecutionMode } from "../cycle/runtime";

export type Capability = { ready: boolean; detail: string };

export type PresidentReadiness = {
  APP_RUNNING: true;
  PRESIDENT_AUTONOMOUS_EXECUTION_READY: boolean;
  capabilities: Record<string, Capability>;
};

/**
 * Honest readiness. Booting the app never depends on this; the "overnight" claim does.
 * Local CLI execution and GitHub Actions execution have different requirements.
 */
export async function presidentReadiness(input: {
  roster: ModelRoster;
  repoRoot: string;
  notificationConfigured: boolean;
  executionMode?: PresidentExecutionMode;
  env?: NodeJS.ProcessEnv;
}): Promise<PresidentReadiness> {
  const env = input.env ?? process.env;
  const mode =
    input.executionMode ??
    (env.NODE_ENV === "production" ? "github_actions" : "local_cli");
  const cap = (ready: boolean, yes: string, no: string): Capability => ({
    ready,
    detail: ready ? yes : no,
  });

  let engineeringExecutorReady = false;
  let reviewerReady = false;
  let githubReady = false;
  let browserValidationReady = false;

  if (mode === "github_actions") {
    // The default-branch workflow owns repo checkout, GITHUB_TOKEN publication,
    // OIDC authentication, Claude execution and independent review. Railway must
    // not pretend it needs a local git checkout/gh/Claude installation.
    engineeringExecutorReady = true;
    reviewerReady = true;
    githubReady = true;
    browserValidationReady = true;
  } else {
    const cli = async (cmd: string) =>
      (
        await runCommand(cmd, input.repoRoot, {
          timeoutMs: 20_000,
        })
      ).exitCode === 0;
    const [claudeCli, gh, git, playwright] = await Promise.all([
      cli("claude --version"),
      cli("gh auth status"),
      cli("git rev-parse --git-dir"),
      cli("node -e \"require.resolve('@playwright/test')\""),
    ]);
    engineeringExecutorReady = claudeCli && git;
    reviewerReady = claudeCli;
    githubReady = gh;
    browserValidationReady = playwright;
  }

  const capabilities: Record<string, Capability> = {
    chatgptConnected: cap(
      !!input.roster.chatgpt,
      "OpenAI provider configured",
      "OPENAI_API_KEY missing"
    ),
    claudeConnected: cap(
      !!input.roster.claude,
      `Anthropic provider (${input.roster.claude?.id})`,
      "ANTHROPIC_API_KEY missing and PRESIDENT_ALLOW_CLAUDE_CLI!=1"
    ),
    deliberationReady: cap(
      !!input.roster.chatgpt && !!input.roster.claude,
      "ChatGPT→Claude→ChatGPT possible",
      "both providers required"
    ),
    executionMode: cap(
      mode === "github_actions" || mode === "local_cli",
      `execution mode: ${mode}`,
      "execution mode invalid"
    ),
    engineeringExecutorReady: cap(
      engineeringExecutorReady,
      mode === "github_actions"
        ? "GitHub Actions engineering executor configured by code"
        : "claude CLI + git present",
      mode === "github_actions"
        ? "GitHub Actions engineering executor unavailable"
        : "claude CLI or git missing"
    ),
    reviewerReady: cap(
      reviewerReady,
      mode === "github_actions"
        ? "independent GitHub Actions reviewer configured by code"
        : "read-only reviewer available",
      "reviewer unavailable"
    ),
    githubReady: cap(
      githubReady,
      mode === "github_actions"
        ? "GitHub Actions supplies scoped GITHUB_TOKEN + OIDC"
        : "gh authenticated",
      "GitHub execution unavailable"
    ),
    browserValidationReady: cap(
      browserValidationReady,
      mode === "github_actions"
        ? "GitHub Actions can install Playwright on demand"
        : "playwright resolvable",
      "browser validation unavailable"
    ),
    notificationReady: cap(
      input.notificationConfigured,
      "owner notification configured",
      "owner notification not configured"
    ),
    executionEnabled: cap(
      env.PRESIDENT_EXECUTION_ENABLED === "1",
      "PRESIDENT_EXECUTION_ENABLED=1",
      "PRESIDENT_EXECUTION_ENABLED is not 1"
    ),
  };

  const required = [
    "deliberationReady",
    "engineeringExecutorReady",
    "reviewerReady",
    "githubReady",
    "notificationReady",
    "executionEnabled",
  ];
  return {
    APP_RUNNING: true,
    PRESIDENT_AUTONOMOUS_EXECUTION_READY: required.every(
      key => capabilities[key].ready
    ),
    capabilities,
  };
}
