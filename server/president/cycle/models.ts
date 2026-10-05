import { spawn } from "node:child_process";

export type ProviderFamily = "openai" | "anthropic";

export interface ModelProvider {
  readonly family: ProviderFamily;
  /** Recorded in the audit trail, e.g. "openai-api" or "claude-cli". */
  readonly id: string;
  readonly model: string;
  complete(input: {
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<string>;
}

export class ProviderUnavailableError extends Error {}

export class OpenAiProvider implements ModelProvider {
  readonly family = "openai" as const;
  readonly id = "openai-api";
  constructor(
    private readonly apiKey: string,
    readonly model = process.env.PRESIDENT_OPENAI_MODEL || "gpt-4.1",
    private readonly baseUrl = "https://api.openai.com/v1"
  ) {}
  async complete(input: { system: string; prompt: string; signal?: AbortSignal }) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
      }),
      signal: input.signal,
    });
    if (!res.ok)
      throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as any;
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("OpenAI returned no content");
    return text;
  }
}

export class AnthropicApiProvider implements ModelProvider {
  readonly family = "anthropic" as const;
  readonly id = "anthropic-api";
  constructor(
    private readonly apiKey: string,
    readonly model = process.env.PRESIDENT_ANTHROPIC_MODEL || "claude-sonnet-4-5"
  ) {}
  async complete(input: { system: string; prompt: string; signal?: AbortSignal }) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 16000,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
      }),
      signal: input.signal,
    });
    if (!res.ok)
      throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as any;
    const text = body?.content?.find((c: any) => c.type === "text")?.text;
    if (typeof text !== "string") throw new Error("Anthropic returned no content");
    return text;
  }
}

/** Tool-free local Claude subscription. Family is anthropic; recorded as claude-cli. */
export class ClaudeCliProvider implements ModelProvider {
  readonly family = "anthropic" as const;
  readonly id = "claude-cli";
  constructor(
    readonly model = process.env.PRESIDENT_CLAUDE_CLI_MODEL || "sonnet",
    private readonly binary = "claude"
  ) {}
  complete(input: { system: string; prompt: string; signal?: AbortSignal }) {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        this.binary,
        [
          "--print",
          "--output-format",
          "json",
          "--model",
          this.model,
          "--tools",
          "",
          "--system-prompt",
          input.system,
        ],
        { stdio: ["pipe", "pipe", "pipe"], signal: input.signal, cwd: "/tmp" }
      );
      let out = "",
        err = "";
      child.stdout.on("data", d => (out += d));
      child.stderr.on("data", d => (err += d));
      child.on("error", reject);
      child.on("close", code => {
        if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
        try {
          const parsed = JSON.parse(out);
          if (parsed.is_error) return reject(new Error(String(parsed.result).slice(0, 300)));
          resolve(String(parsed.result));
        } catch {
          reject(new Error("claude CLI returned non-JSON envelope"));
        }
      });
      child.stdin.end(input.prompt);
    });
  }
}

export type ModelRoster = { chatgpt: ModelProvider | null; claude: ModelProvider | null };

/** Builds the roster from the environment. Never substitutes one family for the other. */
export function rosterFromEnv(env = process.env): ModelRoster {
  return {
    chatgpt: env.OPENAI_API_KEY ? new OpenAiProvider(env.OPENAI_API_KEY) : null,
    claude: env.ANTHROPIC_API_KEY
      ? new AnthropicApiProvider(env.ANTHROPIC_API_KEY)
      : env.PRESIDENT_ALLOW_CLAUDE_CLI === "1"
        ? new ClaudeCliProvider()
        : null,
  };
}

/** Strip anything that looks like a credential before persisting. */
export function redactSecrets(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?)[^\s"',]{8,}/gi,
      "$1[REDACTED]"
    );
}
