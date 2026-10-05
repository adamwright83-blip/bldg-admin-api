import { runCommand } from "./exec";
import type { ModelRoster } from "../cycle/models";

export type Capability = { ready: boolean; detail: string };

export type PresidentReadiness = {
  APP_RUNNING: true;
  PRESIDENT_AUTONOMOUS_EXECUTION_READY: boolean;
  capabilities: Record<string, Capability>;
};

/**
 * Honest readiness. Booting the app never depends on this; the "overnight" claim does.
 * Every required actor must be present for PRESIDENT_AUTONOMOUS_EXECUTION_READY.
 */
export async function presidentReadiness(input: {
  roster: ModelRoster;
  repoRoot: string;
  notificationConfigured: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<PresidentReadiness> {
  const cli = async (cmd: string) => (await runCommand(cmd, input.repoRoot, { timeoutMs: 20_000 })).exitCode === 0;
  const claudeCli = await cli("claude --version");
  const gh = await cli("gh auth status");
  const git = await cli("git rev-parse --git-dir");
  const playwright = await cli("node -e \"require.resolve('@playwright/test')\"");
  const env = input.env ?? process.env;
  const cap = (ready: boolean, yes: string, no: string): Capability => ({ ready, detail: ready ? yes : no });
  const capabilities: Record<string, Capability> = {
    chatgptConnected: cap(!!input.roster.chatgpt, "OpenAI provider configured", "OPENAI_API_KEY missing"),
    claudeConnected: cap(!!input.roster.claude, `Anthropic provider (${input.roster.claude?.id})`, "ANTHROPIC_API_KEY missing and PRESIDENT_ALLOW_CLAUDE_CLI!=1"),
    deliberationReady: cap(!!input.roster.chatgpt && !!input.roster.claude, "ChatGPT→Claude→ChatGPT possible", "both providers required"),
    engineeringExecutorReady: cap(claudeCli && git, "claude CLI + git present", "claude CLI or git missing"),
    reviewerReady: cap(claudeCli, "read-only reviewer available", "claude CLI missing"),
    githubReady: cap(gh, "gh authenticated", "gh not authenticated"),
    browserValidationReady: cap(playwright, "playwright resolvable", "playwright missing"),
    notificationReady: cap(input.notificationConfigured, "owner notification configured", "owner notification not configured"),
    executionEnabled: cap(env.PRESIDENT_EXECUTION_ENABLED === "1", "PRESIDENT_EXECUTION_ENABLED=1", "PRESIDENT_EXECUTION_ENABLED is not 1"),
  };
  const required = ["deliberationReady", "engineeringExecutorReady", "reviewerReady", "githubReady", "notificationReady", "executionEnabled"];
  return {
    APP_RUNNING: true,
    PRESIDENT_AUTONOMOUS_EXECUTION_READY: required.every(k => capabilities[k].ready),
    capabilities,
  };
}
