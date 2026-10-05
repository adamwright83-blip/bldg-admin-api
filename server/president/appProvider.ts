import { randomUUID } from "node:crypto";
import { invokeLLM } from "../_core/llm";
import type { PresidentJudgmentProvider } from "./reasoning";

function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema as Record<string, unknown> & {
    $schema?: unknown;
  };
  return rest;
}

export class AppPresidentJudgmentProvider implements PresidentJudgmentProvider {
  readonly id = "anthropic:structured-president";

  async judge(input: Parameters<PresidentJudgmentProvider["judge"]>[0]) {
    if (!input.outputSchema)
      throw new Error("Structured President provider requires an explicit output schema");
    if (!Number.isFinite(input.maxUsd) || input.maxUsd <= 0 || input.maxUsd > 2)
      throw new Error("President reasoning requires a bounded <=$2 request budget");

    const result = await invokeLLM({
      tenantId: "default",
      model: process.env.PRESIDENT_MODEL?.trim() || undefined,
      maxTokens: 8192,
      temperature: 0,
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            evidence: input.evidence,
            context: input.context,
          }),
        },
      ],
      outputSchema: {
        name: "president_structured_result",
        strict: true,
        schema: cleanSchema(input.outputSchema),
      },
    });
    const content = result.choices[0]?.message.content;
    if (typeof content !== "string" || !content.trim())
      throw new Error("President structured provider returned no JSON result");
    return {
      text: content,
      model: result.model,
      costUsd: null,
      providerRunId: result.id || randomUUID(),
    };
  }
}
