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
    `Your job on the call: a chief of staff writes down what the boss dictates, and asks before writing what the boss only muses about. Three cases, by example:
- Dictation. "Three things. Tomorrow, the Okafor sprinkler valve. Day after, Palm Terrace hedges. Friday, call the flour rep." That IS the instruction. Call apply_day_line_changes once with all three on the days given, then read back what landed. No question first. Corrections ("actually Palm Terrace is tomorrow too", "take Rosewood off") are more dictation: apply them.
- Musing. "I might swing by the Chadwick next week." Nothing to write. Do not offer, do not ask; if they keep coming back to it, offer once.
- A question. "Should the Dana email go on today?" Answer it, offer once, and a bare "yes" then means exactly that offer.
Work described across the call belongs to one batch: when the authorization comes ("put them on", "just do it", a yes to your offer), write every item they described, on the days they said, with the timing or sequence they gave as detail, in one call, quoting the words that authorized it. Never ask item by item, and never ask again for permission you already have.`,
    `Questions: answer every question the operator asks, including one that comes with a goodbye ("before I go, what can you do?"). Answer first, then say goodbye.`,
    `Work that was on the Day Line before this call is theirs, already committed: be proactive about recording new work and conservative about changing old work. Move, finish or take off an existing item only when they name it and say what to do with it ("take the Pham session off tomorrow", "the Alvarado job is done"). "I didn't say anything about the Pham session" is not an instruction; say it was already on their list and ask whether they want it off. The server refuses an existing-item change that is not named and instructed; when it does, ask.`,
    `Dates in a dictated list: a bare weekday is a date, not a question. "Thursday" said on a Thursday means next Thursday; pass it to the tool as said and read the resolved date back so they can correct you. Ask only when a day is genuinely vague ("sometime next week").`,
    `Speaking: do not narrate what you are about to do or how you read them ("I'll write these now", "this is a question, so…"); do it, then say the result. A standing rule not to raise a topic means you neither name it nor say you are leaving it out; just don't mention it.`,
    `One task, one row: when they restate the same work in other words ("finish the marketing challenge, which means I have to finish the landing page"), that is one item; title it by the concrete work and put the rest in the detail. Separate rows only for separate trips or separate deliverables.`,
    `Truth: a thing is on the Day Line only if a receipt in this conversation says applied or already_present. Say what landed and, if anything failed or was refused, say which and why. Never say something is saved before the receipt, and never later deny or doubt a save the receipt confirmed; if unsure, read the day. Business figures come only from read_business_numbers; if it has no records, say so; never invent a number or a comparison.`,
    `What you can do, if asked: read and change the Day Line (add, move, finish, remove work on any day), read the business numbers from the ledger, and keep standing rules about how you work. What you cannot do: send texts or emails, make calls, book or buy anything, or act outside this call. Answer a capabilities question plainly in those terms.`,
    `Standing rules: when the operator gives you a durable rule about how you behave on calls, save it with save_standing_instruction and follow it from that moment. Rules already in force:`,
    view.section ?? "none.",
    `When the operator is done, call end_call and say a short goodbye.`,
  ].join("\n\n");
}

export async function openClaireSession(
  baseCtx: Omit<ToolContext, "operatorTurns" | "lastClaireText" | "callRowIds">,
  input: { operatorName: string; businessName: string; model?: string; client?: Anthropic }
): Promise<ClaireSession> {
  const client = input.client ?? new Anthropic({ apiKey: ENV.anthropicApiKey });
  const model = input.model ?? CLAIRE_PROTOTYPE_MODEL;
  // The server, not the model, keeps the record of what the operator said and what
  // Claire last asked; authorization quotes are checked against that record.
  const operatorTurns: string[] = [];
  let lastClaireText: string | null = null;
  const ctx: ToolContext = { ...baseCtx, operatorTurns: () => operatorTurns, lastClaireText: () => lastClaireText, callRowIds: new Set<string>() };
  const systemPrompt = await buildSystemPrompt(ctx, input);
  const messages: Anthropic.MessageParam[] = [];
  const shape = modelRequestShape(model, {});

  async function turn(utterance: string): Promise<ClaireTurnResult> {
    const startedAt = Date.now();
    operatorTurns.push(utterance);
    messages.push({ role: "user", content: utterance });
    const toolEvents: ToolEvent[] = [];
    let endCall = false;
    let modelCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    // Text per model round. The last round is what Claire says; earlier rounds are usually
    // planning narration before a tool call and are spoken only when the last round said
    // nothing of substance (run 8 lost a capabilities answer that way; run 11 then spoke
    // "This is dictation, so I'll write all three now").
    const rounds: string[][] = [];

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
      rounds.push(text);
      if (!uses.length) break;
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
    const speak = assembleSpeech(rounds);
    lastClaireText = speak || lastClaireText;
    return { speak, endCall, toolEvents, modelCalls, latencyMs: Date.now() - startedAt, inputTokens, outputTokens, stopReason };
  }

  return { conversationId: ctx.conversationId, model, systemPrompt, messages, turn };
}

const CLOSING_ONLY = /^(?:(?:good ?night|goodbye|bye|take care|talk (?:to you )?(?:soon|later|tomorrow)|get some rest|sleep well|have a good (?:one|night|evening)|you're welcome|anytime|thanks|thank you|later)[,.!]*\s*(?:[A-Z][a-z]+[,.!]*\s*)?)+$/i;

/**
 * What is spoken for a turn: the final round's text. Earlier rounds (text written
 * alongside tool calls) are included only when the final round is empty or a
 * sign-off alone, so an answer given beside end_call survives and planning
 * narration before a write does not get read aloud.
 */
export function assembleSpeech(rounds: readonly (readonly string[])[]): string {
  const final = rounds.length ? rounds[rounds.length - 1]! : [];
  const finalText = final.join(" ").trim();
  if (finalText && !CLOSING_ONLY.test(finalText)) return finalText;
  const earlier = rounds.slice(0, -1).flat().filter(Boolean);
  const unique = earlier.filter((line, index) => earlier.indexOf(line) === index);
  // A sign-off already present in the earlier text is not repeated ("Bye, Adam. … Bye, Adam.").
  const said = new Set(unique.flatMap(line => line.split(/(?<=[.!?])\s+/)).map(sentence => sentence.trim().toLowerCase()));
  const closing = final.flatMap(line => line.split(/(?<=[.!?])\s+/)).map(sentence => sentence.trim()).filter(sentence => sentence && !said.has(sentence.toLowerCase()));
  return [...unique, ...closing].join(" ").trim();
}

export function newConversationId(): string {
  return `proto-${randomUUID()}`;
}
