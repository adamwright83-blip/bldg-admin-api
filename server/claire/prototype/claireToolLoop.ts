/**
 * Claire prototype — one Claude model, a handful of tools, the Messages API
 * tool loop as Anthropic documents it. Isolated from `server/_core/llm.ts`
 * (whose contract is structured output only) and from production Claire.
 *
 * Per operator turn: append the utterance, call the model with the tools,
 * run every tool_use block it returns, append the tool_result blocks, repeat
 * until the model stops with text. Tool results stay in the conversation, so
 * a receipt from turn 3 is still in front of the model on turn 20. That is
 * the whole mechanism by which a save cannot be "forgotten" or denied.
 */
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../../_core/env";
import { modelRequestShape } from "../../_core/modelCapabilities";
import { buildStandingInstructionsView, drizzleStandingInstructionStore } from "../../agents/daphne/standingInstructions";
import { CLAIRE_PROTOTYPE_TOOLS, executeTool, readDayLineRows, type ToolContext, type ToolEvent } from "./tools";
import { addDaysYmd, businessDateToday } from "./spokenDate";

export const CLAIRE_PROTOTYPE_MODEL = process.env.ANTHROPIC_MODEL_CLAIRE_PROTOTYPE?.trim() || "claude-sonnet-5-5";

export type ClaireTurnResult = {
  speak: string;
  endCall: boolean;
  toolEvents: ToolEvent[];
  modelCalls: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
};

export type ClaireSession = {
  conversationId: string;
  model: string;
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  turn: (utterance: string) => Promise<ClaireTurnResult>;
};

function weekdayName(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(`${ymd}T00:00:00Z`));
}

async function dayLineSnapshot(ctx: ToolContext, today: string): Promise<string> {
  const lines: string[] = [];
  for (const [label, date] of [["Today", today], ["Tomorrow", addDaysYmd(today, 1)]] as const) {
    const rows = await readDayLineRows(ctx, date).catch(() => []);
    const open = rows.filter(row => row.status === "open");
    const done = rows.filter(row => row.status === "completed");
    lines.push(
      `${label} (${weekdayName(date)} ${date}): ${open.length ? open.map(row => `${row.title}${row.detail ? ` — ${row.detail}` : ""} [${row.id}]`).join("; ") : "nothing open"}${done.length ? `. Completed: ${done.map(row => row.title).join("; ")}` : ""}`
    );
  }
  return lines.join("\n");
}

export async function buildSystemPrompt(ctx: ToolContext, input: { operatorName: string; businessName: string }): Promise<string> {
  const now = ctx.now();
  const today = businessDateToday(now, ctx.timeZone);
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: ctx.timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  const store = ctx.standingInstructionStore ?? drizzleStandingInstructionStore();
  const instructions = await store.listActive({ tenantId: ctx.tenantId, canonicalOperatorId: ctx.canonicalOperatorId }).catch(() => []);
  const view = buildStandingInstructionsView(instructions, { now, timeZone: ctx.timeZone });
  const snapshot = await dayLineSnapshot(ctx, today);

  return [
    `You are Claire, chief of staff to ${input.operatorName}, who runs ${input.businessName}. You are on a phone call with them. Everything you write is spoken aloud, so keep it short: one to three sentences, plain words, at most one question, and never a list read out loud. Do not repeat a sentence you already said; if they say you are repeating yourself, say something new or stop.`,
    `Calendar: it is ${weekdayName(today)} ${today}, ${clock} in ${ctx.timeZone}. Pass days to tools in the operator's own words ("tomorrow", "Friday", "the day after tomorrow"); the server turns them into dates. If a tool says a day is ambiguous, ask which day. Never pick a date the operator did not give.`,
    `The Day Line is the operator's list of committed work per day. Snapshot at the start of this call:\n${snapshot}\nAfter you change it, trust your receipts over this snapshot; read a day again when you need the current state.`,
    `Working the call: the operator will tell you things they have to do, often one at a time, mixed with other talk. Keep all of it in mind. When they instruct you ("add it", "put that on tomorrow", "just do it", a yes to something you offered), call apply_day_line_changes once with every item they have described and authorized, on the days they said, with the timing or sequence they gave as detail. When they merely describe work without asking, you may offer once to put it on, naming the items and the day; a bare "yes" then means exactly that offer. Do not ask again for permission you already have, and do not ask one item at a time when they gave you several.`,
    `Truth: a thing is on the Day Line only if a receipt in this conversation says applied or already_present. Say what landed and, if anything failed or was refused, say which and why. Never say something is saved before the receipt, and never later deny or doubt a save the receipt confirmed; if unsure, read the day. Business figures come only from read_business_numbers; if it has no records, say so; never invent a number or a comparison.`,
    `What you can do, if asked: read and change the Day Line (add, move, finish, remove work on any day), read the business numbers from the ledger, and keep standing rules about how you work. What you cannot do: send texts or emails, make calls, book or buy anything, or act outside this call. Answer a capabilities question plainly in those terms.`,
    `Standing rules: when the operator gives you a durable rule about how you behave on calls, save it with save_standing_instruction and follow it from that moment. Rules already in force:`,
    view.section ?? "none.",
    `When the operator is done, call end_call and say a short goodbye.`,
  ].join("\n\n");
}

export async function openClaireSession(ctx: ToolContext, input: { operatorName: string; businessName: string; model?: string; client?: Anthropic }): Promise<ClaireSession> {
  const client = input.client ?? new Anthropic({ apiKey: ENV.anthropicApiKey });
  const model = input.model ?? CLAIRE_PROTOTYPE_MODEL;
  const systemPrompt = await buildSystemPrompt(ctx, input);
  const messages: Anthropic.MessageParam[] = [];
  const shape = modelRequestShape(model, {});

  async function turn(utterance: string): Promise<ClaireTurnResult> {
    const startedAt = Date.now();
    messages.push({ role: "user", content: utterance });
    const toolEvents: ToolEvent[] = [];
    let endCall = false;
    let modelCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    let spoken: string[] = [];

    for (let round = 0; round < 8; round += 1) {
      const response = await client.messages.create({
        model,
        max_tokens: 600,
        ...(shape as Record<string, unknown>),
        system: systemPrompt,
        tools: CLAIRE_PROTOTYPE_TOOLS,
        tool_choice: { type: "auto" },
        messages,
      });
      modelCalls += 1;
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      stopReason = response.stop_reason;
      messages.push({ role: "assistant", content: response.content });
      const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map(block => block.text.trim()).filter(Boolean);
      const uses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      if (!uses.length) {
        spoken = text.length ? text : spoken;
        break;
      }
      // Text alongside tool calls is narration ("one moment"); only the final text is spoken.
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const toolStarted = Date.now();
        let output: unknown;
        let wrote = false;
        try {
          const executed = await executeTool(ctx, use.name, (use.input ?? {}) as Record<string, unknown>);
          output = executed.output;
          wrote = executed.wrote;
          if (executed.endCall) endCall = true;
        } catch (error) {
          output = { status: "failed", reason: error instanceof Error ? error.message : String(error) };
        }
        toolEvents.push({ name: use.name, input: use.input, output, wrote, latencyMs: Date.now() - toolStarted });
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) });
      }
      messages.push({ role: "user", content: results });
    }
    return { speak: spoken.join(" "), endCall, toolEvents, modelCalls, latencyMs: Date.now() - startedAt, inputTokens, outputTokens, stopReason };
  }

  return { conversationId: ctx.conversationId, model, systemPrompt, messages, turn };
}

export function newConversationId(): string {
  return `proto-${randomUUID()}`;
}
