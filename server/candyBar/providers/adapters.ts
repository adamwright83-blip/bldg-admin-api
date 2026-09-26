import { unavailableResult, type ArchitectAdapter, type CreativeAdapter, type EngineerAdapter, type ReviewerAdapter } from "./types";
import {
  capabilityEngineeringConfig,
  continueCapabilityBuilderSession,
  createCapabilityBuilderSession,
  extractTerminalFromAgentEvents,
} from "../../goldline/engineering/agentsClient";
import type { ProviderDispatchResult } from "../../../shared/candyBar";

/**
 * Grok / xAI reviewer seat.
 * Claire's XAI_API_KEY is TTS-oriented in this repo; there is no committed
 * Grok text-review client. V0 returns typed PROVIDER_UNAVAILABLE and never
 * browser-automates chatgpt.com / x.com / grok.x.ai.
 */
export function createGrokReviewerAdapter(env: NodeJS.ProcessEnv = process.env): ReviewerAdapter {
  return {
    providerId: "xai_grok",
    async review() {
      void env;
      return unavailableResult(
        "xai_grok",
        "No legitimate Grok text reviewer adapter is wired in V0. Claire xAI TTS config is not the reviewer. Browser automation is forbidden."
      );
    },
  };
}

/**
 * Cursor engineer seat — no documented programmatic background-agent API is
 * wired in this repo. Never GUI-automate Cursor. Return PROVIDER_UNAVAILABLE.
 */
export function createCursorEngineerAdapter(): EngineerAdapter {
  return {
    providerId: "cursor",
    async implement() {
      return unavailableResult(
        "cursor",
        "No legitimate Cursor programmatic/background-agent API is configured. GUI automation is forbidden."
      );
    },
  };
}

/** Creative lane seam — contract only, never executes Claude/Blender/video. */
export function createCreativeAdapter(): CreativeAdapter {
  return {
    providerId: "anthropic",
    async treat() {
      return unavailableResult(
        "anthropic",
        "CreativeAdapter is a V0 seam only. Claude creative execution, Blender, and A/B video are out of scope."
      );
    },
  };
}

/**
 * OpenAI-backed Architect via structured JSON response.
 * Only used when preferred anthropic seat is empty AND workflow fallback allows it,
 * or when preferredArchitect is openai.
 */
export function createOpenAiArchitectAdapter(opts?: {
  invoke?: (prompt: string) => Promise<Record<string, unknown>>;
}): ArchitectAdapter {
  return {
    providerId: "openai",
    async plan(input) {
      if (!opts?.invoke) {
        return unavailableResult(
          "openai",
          "OpenAI Architect invoke not injected. Configure workflow fallback + inject for dogfood."
        );
      }
      try {
        const content = await opts.invoke(input.prompt);
        return {
          ok: true,
          provider: "openai",
          sessionId: null,
          content,
          inputTokens: null,
          outputTokens: null,
          estimatedCostCents: null,
          costKnown: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const auth = /401|403|auth/i.test(message);
        return {
          ok: false,
          provider: "openai",
          code: auth ? "AUTH_FAILURE" : "TRANSIENT",
          message: message.slice(0, 500),
          retryable: !auth,
          browserAutomationUsed: false,
        };
      }
    },
  };
}

export function createOpenAiReviewerAdapter(opts?: {
  invoke?: (prompt: string) => Promise<Record<string, unknown>>;
}): ReviewerAdapter {
  return {
    providerId: "openai",
    async review(input) {
      if (!opts?.invoke) {
        return unavailableResult(
          "openai",
          "OpenAI Reviewer invoke not injected. Configure workflow fallback + inject for dogfood."
        );
      }
      try {
        const content = await opts.invoke(input.prompt);
        return {
          ok: true,
          provider: "openai",
          sessionId: null,
          content,
          inputTokens: null,
          outputTokens: null,
          estimatedCostCents: null,
          costKnown: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const auth = /401|403|auth/i.test(message);
        return {
          ok: false,
          provider: "openai",
          code: auth ? "AUTH_FAILURE" : "TRANSIENT",
          message: message.slice(0, 500),
          retryable: !auth,
          browserAutomationUsed: false,
        };
      }
    },
  };
}

/**
 * Engineer via existing OpenAI hosted capability-builder sessions.
 * Identity is always recorded as `openai`, never as Cursor.
 */
export function createOpenAiEngineerAdapter(): EngineerAdapter {
  return {
    providerId: "openai",
    async implement(input): Promise<ProviderDispatchResult> {
      const config = capabilityEngineeringConfig();
      if ("missing" in config) {
        return unavailableResult(
          "openai",
          `Missing server env: ${config.missing.join(", ")}`
        );
      }
      try {
        if (input.sessionId) {
          const continued = await continueCapabilityBuilderSession({
            config,
            sessionId: input.sessionId,
            prompt: input.prompt,
          });
          const terminal = extractTerminalFromAgentEvents(continued.events);
          if (!terminal) {
            return {
              ok: false,
              provider: "openai",
              code: "MALFORMED",
              message: "No structured engineering terminal result in continuation",
              retryable: true,
              browserAutomationUsed: false,
            };
          }
          return {
            ok: true,
            provider: "openai",
            sessionId: input.sessionId,
            content: terminal as unknown as Record<string, unknown>,
            inputTokens: null,
            outputTokens: null,
            estimatedCostCents: null,
            costKnown: false,
          };
        }
        const started = await createCapabilityBuilderSession({
          config,
          prompt: input.prompt,
        });
        const terminal = extractTerminalFromAgentEvents(started.events);
        if (!terminal) {
          return {
            ok: false,
            provider: "openai",
            code: "MALFORMED",
            message: "No structured engineering terminal result",
            retryable: true,
            browserAutomationUsed: false,
          };
        }
        return {
          ok: true,
          provider: "openai",
          sessionId: started.sessionId || null,
          content: terminal as unknown as Record<string, unknown>,
          inputTokens: null,
          outputTokens: null,
          estimatedCostCents: null,
          costKnown: false,
        };
      } catch (error) {
        const authFailure = Boolean((error as { authFailure?: boolean }).authFailure);
        return {
          ok: false,
          provider: "openai",
          code: authFailure ? "AUTH_FAILURE" : "TRANSIENT",
          message: error instanceof Error ? error.message.slice(0, 500) : "engineer_failed",
          retryable: !authFailure,
          browserAutomationUsed: false,
        };
      }
    },
  };
}

/**
 * Anthropic Architect seat — uses injected invoke (typically invokeLLM structured).
 * Preferred Architect when configured.
 */
export function createAnthropicArchitectAdapter(opts?: {
  invoke?: (prompt: string) => Promise<Record<string, unknown>>;
}): ArchitectAdapter {
  return {
    providerId: "anthropic",
    async plan(input) {
      if (!opts?.invoke) {
        return unavailableResult(
          "anthropic",
          "Anthropic Architect invoke not injected for this runtime."
        );
      }
      try {
        const content = await opts.invoke(input.prompt);
        return {
          ok: true,
          provider: "anthropic",
          sessionId: null,
          content,
          inputTokens: null,
          outputTokens: null,
          estimatedCostCents: null,
          costKnown: false,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const auth = /401|403|auth|ANTHROPIC_API_KEY/i.test(message);
        return {
          ok: false,
          provider: "anthropic",
          code: auth ? "AUTH_FAILURE" : "TRANSIENT",
          message: message.slice(0, 500),
          retryable: !auth,
          browserAutomationUsed: false,
        };
      }
    },
  };
}
