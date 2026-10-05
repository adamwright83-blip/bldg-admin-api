import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { PresidentDeliberationProvider } from "./deliberation";

function parseJson(text:string): unknown {
  const trimmed = text.trim().replace(/^\`\`\`json\s*/i,"").replace(/\`\`\`$/,"").trim();
  return JSON.parse(trimmed);
}

export class OpenAiPresidentDeliberationProvider implements PresidentDeliberationProvider {
  readonly actorId = "openai:chatgpt";
  constructor(
    private readonly apiKey = process.env.OPENAI_API_KEY?.trim(),
    private readonly model = process.env.PRESIDENT_OPENAI_MODEL?.trim() || "chat-latest"
  ) {}
  async generate(input:{system:string;prompt:string;schema:z.ZodTypeAny}) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{"content-type":"application/json",authorization:`Bearer ${this.apiKey}`},
      body:JSON.stringify({model:this.model,instructions:input.system,input:input.prompt}),
      signal:AbortSignal.timeout(120000),
    });
    if (!response.ok) throw new Error(`OpenAI President deliberation failed (${response.status}): ${(await response.text()).slice(0,500)}`);
    const body = await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    const text = body.output?.flatMap(x=>x.content??[]).find(x=>x.type==="output_text")?.text;
    if (!text) throw new Error("OpenAI President deliberation returned no output text");
    return input.schema.parse(parseJson(text));
  }
}

export class ClaudePresidentDeliberationProvider implements PresidentDeliberationProvider {
  readonly actorId = "anthropic:claude";
  constructor(
    private readonly apiKey = process.env.ANTHROPIC_API_KEY?.trim(),
    private readonly model = process.env.PRESIDENT_CLAUDE_MODEL?.trim() || "claude-sonnet-4-5"
  ) {}
  async generate(input:{system:string;prompt:string;schema:z.ZodTypeAny}) {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
    const client = new Anthropic({apiKey:this.apiKey});
    const response = await client.messages.create({
      model:this.model,max_tokens:8192,temperature:0,system:input.system,
      messages:[{role:"user",content:input.prompt+"\n\nReturn JSON only."}],
    });
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type==="text").map(b=>b.text).join("\n").trim();
    if (!text) throw new Error("Claude President critique returned no text");
    return input.schema.parse(parseJson(text));
  }
}
