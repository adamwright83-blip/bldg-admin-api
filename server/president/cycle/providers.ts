import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

export type PresidentCycleModelResult = {
  text: string;
  provider: "openai" | "anthropic";
  model: string;
  providerRunId: string | null;
};

export interface PresidentCycleModelProvider {
  readonly id: "openai" | "anthropic";
  available(): Promise<boolean>;
  generate(input: {
    system: string;
    prompt: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<PresidentCycleModelResult>;
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "")
    .trim();
}

export function parseModelJson(text: string): unknown {
  return JSON.parse(stripCodeFence(text));
}

export class OpenAIPresidentCycleProvider implements PresidentCycleModelProvider {
  readonly id = "openai" as const;

  async available(): Promise<boolean> {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  }

  async generate(input: {
    system: string;
    prompt: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<PresidentCycleModelResult> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model =
      process.env.PRESIDENT_OPENAI_MODEL?.trim() || "chat-latest";
    if (!apiKey)
      throw new Error("President ChatGPT stage requires OPENAI_API_KEY");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
        max_completion_tokens: input.maxTokens ?? 12000,
      }),
      signal: input.signal ?? AbortSignal.timeout(180_000),
    });
    const body = (await response.json()) as {
      id?: string;
      model?: string;
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    if (!response.ok)
      throw new Error(
        "President OpenAI provider failed: " +
          (body.error?.message ?? `HTTP ${response.status}`)
      );
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("President OpenAI provider returned no JSON");
    return {
      text,
      provider: "openai",
      model: body.model ?? model,
      providerRunId: body.id ?? randomUUID(),
    };
  }
}

async function claudeCliAvailable(binary: string): Promise<boolean> {
  return new Promise(resolve => {
    const child = spawn(binary, ["--version"], {
      stdio: "ignore",
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        LOGNAME: process.env.LOGNAME,
        TMPDIR: process.env.TMPDIR,
      },
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, 5_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

export class ClaudePresidentCycleProvider implements PresidentCycleModelProvider {
  readonly id = "anthropic" as const;
  private readonly binary = process.env.PRESIDENT_CLAUDE_BINARY?.trim() || "claude";

  async available(): Promise<boolean> {
    if (
      process.env.ANTHROPIC_API_KEY?.trim() &&
      process.env.PRESIDENT_ANTHROPIC_MODEL?.trim()
    )
      return true;
    return claudeCliAvailable(this.binary);
  }

  async generate(input: {
    system: string;
    prompt: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<PresidentCycleModelResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    const configuredModel = process.env.PRESIDENT_ANTHROPIC_MODEL?.trim();
    if (apiKey && configuredModel) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: configuredModel,
          max_tokens: input.maxTokens ?? 12000,
          temperature: 0,
          system: input.system,
          messages: [{ role: "user", content: input.prompt }],
        }),
        signal: input.signal ?? AbortSignal.timeout(180_000),
      });
      const body = (await response.json()) as {
        id?: string;
        model?: string;
        error?: { message?: string };
        content?: Array<{ type?: string; text?: string }>;
      };
      if (!response.ok)
        throw new Error(
          "President Anthropic provider failed: " +
            (body.error?.message ?? `HTTP ${response.status}`)
        );
      const text = body.content
        ?.filter(block => block.type === "text")
        .map(block => block.text ?? "")
        .join("\n")
        .trim();
      if (!text) throw new Error("President Anthropic provider returned no JSON");
      return {
        text,
        provider: "anthropic",
        model: body.model ?? configuredModel,
        providerRunId: body.id ?? randomUUID(),
      };
    }

    return this.generateWithCli(input);
  }

  private async generateWithCli(input: {
    system: string;
    prompt: string;
    signal?: AbortSignal;
  }): Promise<PresidentCycleModelResult> {
    const model = process.env.PRESIDENT_CLAUDE_MODEL?.trim() || "sonnet";
    const text = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        this.binary,
        [
          "--print",
          "--output-format",
          "json",
          "--model",
          model,
          "--max-budget-usd",
          process.env.PRESIDENT_CLAUDE_MAX_USD?.trim() || "1",
          "--tools",
          "",
          "--allowedTools",
          "",
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
          input.system,
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
          signal: input.signal,
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
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("President Claude CLI deliberation timed out"));
      }, 180_000);
      child.stdout.on("data", chunk => {
        stdout += String(chunk);
        if (stdout.length > 512_000) {
          child.kill("SIGTERM");
          reject(new Error("President Claude CLI output exceeded bound"));
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
          ? resolve(stdout)
          : reject(new Error(`President Claude CLI exited ${code}`));
      });
      child.stdin.end(input.prompt);
    });
    const envelope = JSON.parse(text) as {
      session_id?: string;
      result?: string;
      structured_output?: unknown;
      modelUsage?: Record<string, unknown>;
      is_error?: boolean;
    };
    if (envelope.is_error)
      throw new Error("President Claude CLI returned an error");
    const result =
      envelope.structured_output !== undefined
        ? JSON.stringify(envelope.structured_output)
        : envelope.result;
    if (!result?.trim())
      throw new Error("President Claude CLI returned no critique");
    return {
      text: result,
      provider: "anthropic",
      model: Object.keys(envelope.modelUsage ?? {}).join(",") || model,
      providerRunId: envelope.session_id ?? randomUUID(),
    };
  }
}
