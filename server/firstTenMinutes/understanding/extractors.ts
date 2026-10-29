import { z } from "zod";
import { invokeLLM } from "../../_core/llm";
import exampleExtraction from "../../../shared/firstTenMinutesExampleExtraction.json";
import { conversationExtractionSchema, workExtractionSchema, type Extractor } from "./extract";

/**
 * Claude reads (server/_core/llm.ts, structured output); extract.ts decides what may be shown. Each reading is
 * attributed to its own journey for AI spend (the person has no workspace yet), never to another tenant.
 */
export function claudeExtractor(journeyId: string): Extractor {
  const attribution = `first_ten:${journeyId}`;
  async function call<T>(name: string, schema: z.ZodType<T>, system: string, corpus: string): Promise<T> {
    const result = await invokeLLM({
      tenantId: attribution,
      feature: name,
      maxTokens: 8192,
      messages: [
        { role: "system", content: system },
        { role: "user", content: corpus },
      ],
      responseFormat: { type: "json_schema", json_schema: { name, strict: true, schema: z.toJSONSchema(schema) as Record<string, unknown> } },
    });
    const content = result.choices[0]?.message.content;
    if (typeof content !== "string") throw new Error("The reading returned nothing structured");
    return schema.parse(JSON.parse(content));
  }
  return {
    conversations: ({ system, corpus }) => call("first_ten_conversations", conversationExtractionSchema, system, corpus),
    work: ({ system, corpus }) => call("first_ten_work", workExtractionSchema, system, corpus),
  };
}

/** Nina's example: the readings as written for her invented corpus, verified like any other. No model is called. */
export function exampleExtractor(): Extractor {
  return {
    async conversations() {
      return conversationExtractionSchema.parse(exampleExtraction.conversations);
    },
    async work() {
      return workExtractionSchema.parse(exampleExtraction.work);
    },
  };
}
