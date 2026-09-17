import Anthropic, {
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { ENV } from "./env";
import {
  assertAiSpendAvailable,
  trackModelUsage,
} from "../agents/costTracking";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?:
      | "audio/mpeg"
      | "audio/wav"
      | "application/pdf"
      | "audio/mp4"
      | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tenantId?: string;
  model?: string;
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  temperature?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type InvokeTextParams = Pick<
  InvokeParams,
  "messages" | "tenantId" | "model" | "maxTokens" | "max_tokens" | "temperature"
> & {
  /**
   * PR1 Claire Intelligence Repair -- corrective pass: durable stop-reason
   * visibility, not a one-off for a single exam. Anthropic's own
   * `stop_reason` ("end_turn", "max_tokens", "stop_sequence", ...) is
   * captured and handed back here before the text is returned, so a
   * caller can positively detect "the model hit its token ceiling" instead
   * of inferring truncation from trailing punctuation. Optional and
   * additive -- existing callers that don't pass it are unaffected.
   */
  onStopReason?: (stopReason: string | null) => void;
};

export class TextLLMInvocationError extends Error {
  readonly code: "invalid_request" | "provider_failure";

  constructor(
    code: "invalid_request" | "provider_failure",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "TextLLMInvocationError";
    this.code = code;
  }
}

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }
  if (part.type === "text") return part;
  if (part.type === "image_url") return part;
  if (part.type === "file_url") return part;
  throw new Error("Unsupported message content part");
};

function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const m = url.match(/^data:([^;,]+);base64,([\s\S]*)$/);
  if (!m) return null;
  return { mime: m[1].trim(), base64: m[2].trim() };
}

export function messageContentToAnthropicBlocks(
  content: MessageContent | MessageContent[]
): Anthropic.ContentBlockParam[] {
  const parts = ensureArray(content).map(normalizeContentPart);
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "image_url") {
      const parsed = parseDataUrl(part.image_url.url);
      if (!parsed) {
        throw new Error(
          "Anthropic vision requires a data URL (data:<mime>;base64,...). Check menu upload encoding."
        );
      }
      const mt = parsed.mime.toLowerCase();
      const allowed = [
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp",
      ] as const;
      const mediaType = (
        allowed.includes(mt as (typeof allowed)[number]) ? mt : "image/jpeg"
      ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: mediaType, data: parsed.base64 },
      });
      continue;
    }
    if (
      part.type === "file_url" &&
      part.file_url.mime_type === "application/pdf"
    ) {
      const parsed = parseDataUrl(part.file_url.url);
      if (!parsed) {
        throw new Error(
          "Anthropic PDF requires a data URL (data:application/pdf;base64,...). Check menu upload encoding."
        );
      }
      blocks.push({
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: parsed.base64,
        },
      });
      continue;
    }
    throw new Error(
      `Unsupported file type for Anthropic: ${(part as FileContent).file_url?.mime_type ?? "unknown"}`
    );
  }
  return blocks;
}

const assertAnthropicApiKey = () => {
  if (!ENV.anthropicApiKey?.trim()) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;
  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }
  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

function inputSchemaForAnthropic(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  delete clone.strict;
  return clone;
}

export function toAnthropicCallerError(err: unknown): Error {
  if (err instanceof AuthenticationError) {
    return new Error(
      `Anthropic authentication failed (${err.status}). Check ANTHROPIC_API_KEY is valid and not revoked.`
    );
  }
  if (err instanceof RateLimitError) {
    return new Error(
      `Anthropic rate limit (${err.status}). Wait and retry, or check usage limits on your Anthropic account.`
    );
  }
  if (err instanceof APIError) {
    const status = err.status ?? "?";
    const msg = err.message || "request failed";
    if (status === 400 || status === 422) {
      return new Error(`Anthropic rejected the request (${status}): ${msg}`);
    }
    if (status === 529) {
      return new Error(`Anthropic is overloaded (${status}). Retry later.`);
    }
    return new Error(`Anthropic API error (${status}): ${msg}`);
  }
  if (err instanceof Error) {
    return err;
  }
  return new Error(String(err));
}

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertAnthropicApiKey();
  const tenantId = params.tenantId ?? "default";
  await assertAiSpendAvailable(tenantId);

  if (params.tools?.length) {
    throw new Error(
      "invokeLLM with Anthropic does not support custom tools; use outputSchema only."
    );
  }

  const normalizedFormat = normalizeResponseFormat({
    responseFormat: params.responseFormat,
    response_format: params.response_format,
    outputSchema: params.outputSchema,
    output_schema: params.output_schema,
  });

  if (!normalizedFormat || normalizedFormat.type !== "json_schema") {
    throw new Error(
      "Anthropic invoke requires outputSchema (JSON schema) for structured catalog/menu output."
    );
  }

  const toolName = normalizedFormat.json_schema.name;
  const inputSchema = inputSchemaForAnthropic(
    normalizedFormat.json_schema.schema as Record<string, unknown>
  );

  const systemParts: string[] = [];
  const anthropicMessages: Anthropic.MessageParam[] = [];

  for (const m of params.messages) {
    if (m.role === "system") {
      const arr = ensureArray(m.content).map(normalizeContentPart);
      for (const p of arr) {
        if (p.type !== "text") {
          throw new Error("Anthropic system message must be text-only.");
        }
        systemParts.push(p.text);
      }
      continue;
    }
    if (m.role === "user") {
      anthropicMessages.push({
        role: "user",
        content: messageContentToAnthropicBlocks(m.content),
      });
      continue;
    }
    throw new Error(`Unsupported message role for Anthropic invoke: ${m.role}`);
  }

  if (anthropicMessages.length === 0) {
    throw new Error(
      "At least one user message is required for Anthropic invoke."
    );
  }

  const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
  const model = params.model ?? ENV.anthropicModel;
  const maxTokens = Math.min(
    params.maxTokens ?? params.max_tokens ?? 8192,
    8192
  );

  try {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: params.temperature ?? 0,
      ...(systemParts.length ? { system: systemParts.join("\n\n") } : {}),
      messages: anthropicMessages,
      tools: [
        {
          name: toolName,
          description:
            "Emit structured data exactly matching the schema. Fill fields per the user instructions.",
          input_schema: inputSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: {
        type: "tool",
        name: toolName,
        disable_parallel_tool_use: true,
      },
    });

    const toolBlock = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (!toolBlock) {
      const summary = response.content
        .map(b => (b.type === "text" ? b.text : `[${b.type}]`))
        .join(" ")
        .slice(0, 500);
      throw new Error(
        `Anthropic returned no tool_use block for structured output. Content preview: ${summary || "(empty)"}`
      );
    }
    if (toolBlock.name !== toolName) {
      throw new Error(
        `Anthropic tool mismatch: expected ${toolName}, got ${toolBlock.name}`
      );
    }

    const jsonStr = JSON.stringify(toolBlock.input ?? {});
    if (!jsonStr || jsonStr === "{}") {
      throw new Error("Anthropic tool returned empty input object.");
    }

    const result: InvokeResult = {
      id: response.id,
      created: Date.now(),
      model: response.model,
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content: jsonStr },
          finish_reason: response.stop_reason,
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.input_tokens,
            completion_tokens: response.usage.output_tokens,
            total_tokens:
              response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
    };
    if (result.usage) {
      await trackModelUsage({
        tenantId,
        modelUsed: result.model,
        inputTokens: result.usage.prompt_tokens,
        outputTokens: result.usage.completion_tokens,
      });
    }
    return result;
  } catch (e) {
    throw toAnthropicCallerError(e);
  }
}

/** Plain-text Anthropic generation. Structured callers must continue to use invokeLLM. */
export async function invokeTextLLM(params: InvokeTextParams): Promise<string> {
  try {
    assertAnthropicApiKey();
    const tenantId = params.tenantId ?? "default";
    await assertAiSpendAvailable(tenantId);

    const systemParts: string[] = [];
    const anthropicMessages: Anthropic.MessageParam[] = [];
    for (const message of params.messages) {
      if (
        message.role !== "system" &&
        message.role !== "user" &&
        message.role !== "assistant"
      ) {
        throw new TextLLMInvocationError(
          "invalid_request",
          `Unsupported message role for Anthropic text invoke: ${message.role}`
        );
      }
      const parts = ensureArray(message.content).map(normalizeContentPart);
      if (parts.some(part => part.type !== "text")) {
        throw new TextLLMInvocationError(
          "invalid_request",
          "Anthropic text invoke supports text message content only."
        );
      }
      const text = parts.map(part => (part as TextContent).text).join("\n");
      if (message.role === "system") systemParts.push(text);
      // Real alternating history: user/assistant messages are pushed in the
      // order given, preserving role. Callers are responsible for bounding
      // history length and for treating verified business context (not
      // prior assistant text) as the source of truth for facts.
      else anthropicMessages.push({ role: message.role, content: text });
    }
    if (anthropicMessages.length === 0) {
      throw new TextLLMInvocationError(
        "invalid_request",
        "At least one user message is required for Anthropic text invoke."
      );
    }

    const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
    const response = await client.messages.create({
      model: params.model ?? ENV.anthropicModel,
      max_tokens: Math.min(params.maxTokens ?? params.max_tokens ?? 8192, 8192),
      temperature: params.temperature ?? 0,
      ...(systemParts.length ? { system: systemParts.join("\n\n") } : {}),
      messages: anthropicMessages,
    });
    params.onStopReason?.(response.stop_reason ?? null);
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();
    if (!text) {
      throw new TextLLMInvocationError(
        "provider_failure",
        "Anthropic returned no assistant text."
      );
    }
    if (response.usage) {
      await trackModelUsage({
        tenantId,
        modelUsed: response.model,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      });
    }
    return text;
  } catch (error) {
    if (error instanceof TextLLMInvocationError) throw error;
    const callerError = toAnthropicCallerError(error);
    throw new TextLLMInvocationError(
      "provider_failure",
      `Anthropic text generation failed: ${callerError.message}`,
      { cause: callerError }
    );
  }
}
