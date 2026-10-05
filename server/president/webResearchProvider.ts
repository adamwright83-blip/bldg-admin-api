import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { ENV } from "../_core/env";
import type { PresidentJudgmentProvider } from "./reasoning";

type ResearchContext = {
  research?: {
    allowedDomains?: string[];
    maxUses?: number;
  };
};

export class AnthropicWebSearchPresidentProvider
  implements PresidentJudgmentProvider
{
  readonly id = "anthropic:web-search";

  async judge(input: Parameters<PresidentJudgmentProvider["judge"]>[0]) {
    if (!Number.isFinite(input.maxUsd) || input.maxUsd <= 0 || input.maxUsd > 2)
      throw new Error("President research requires a bounded <=$2 request budget");
    const policy = (input.context ?? {}) as ResearchContext;
    const allowedDomains = policy.research?.allowedDomains ?? [];
    if (!allowedDomains.length)
      throw new Error("President web research requires an explicit domain allowlist");
    const maxUses = Math.max(1, Math.min(10, policy.research?.maxUses ?? 5));
    const client = new Anthropic({ apiKey: ENV.anthropicApiKey });
    const model =
      process.env.PRESIDENT_RESEARCH_MODEL?.trim() ||
      process.env.PRESIDENT_MODEL?.trim() ||
      ENV.anthropicModel;
    const tools = [
      {
        type: "web_search_20260318",
        name: "web_search",
        max_uses: maxUses,
        allowed_domains: allowedDomains,
        allowed_callers: ["direct"],
      },
    ] as any;

    const messages: any[] = [
      {
        role: "user",
        content: JSON.stringify({
          question: input.question,
          context: input.context,
        }),
      },
    ];

    let response: any;
    for (let continuation = 0; continuation < 4; continuation++) {
      response = await client.messages.create({
        model,
        max_tokens: 8192,
        system: input.system,
        messages,
        tools,
      } as any);
      if (response.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: response.content });
      if (continuation === 3)
        throw new Error("President web research exceeded continuation bound");
    }

    const text = (response?.content ?? [])
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n")
      .trim();
    if (!text) throw new Error("President web research returned no final text");
    return {
      text,
      model: String(response.model ?? model),
      costUsd: null,
      providerRunId: String(response.id ?? randomUUID()),
    };
  }
}
