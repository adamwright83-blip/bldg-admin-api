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
import { anthropicMessagesClient, createAnthropicMessage } from "../../_core/anthropicMessages";
import { modelRequestShape } from "../../_core/modelCapabilities";
import { buildStandingInstructionsView, drizzleStandingInstructionStore } from "../../agents/daphne/standingInstructions";
import { CLAIRE_PROTOTYPE_TOOLS, executeTool, readDayLineRows, type ToolContext, type ToolEvent } from "./tools";
import { checkSpeech, heldTopicsFrom, restateInstruction, withoutOffendingSentences, type HeldTopic } from "./speechGuard";
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
  /** Scheduled calls only: Claire's opening, spoken before the operator says anything. Null on an inbound call. */
  open: (() => Promise<ClaireTurnResult>) | null;
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

/** Which call this is. Inbound: the operator rang Claire. The rest: Claire placed a scheduled call. */
export type ClaireCallKind = "inbound" | "morning_readiness" | "evening_debrief";

export type ClairePromptInput = { operatorName: string; businessName: string; callKind?: ClaireCallKind };

/** Why Claire placed a scheduled call, and how she opens it. Inbound calls have none: the operator leads. */
function scheduledCallSection(kind: ClaireCallKind, operatorName: string): string | null {
  if (kind === "evening_debrief") {
    return `This call: you placed ${operatorName}'s scheduled evening wrap and they just picked up, so you speak first. The point of the call is to hear what got done today and agree on the first move for tomorrow. Open with their goal and where they stand on it (read_goal_progress), in one sentence, then one question about today. Then listen. Do not walk through the Day Line in the opening; read it when the conversation needs it.`;
  }
  if (kind === "morning_readiness") {
    return `This call: you placed ${operatorName}'s scheduled morning call and they just picked up, so you speak first. The point of the call is to make sure they know their first move today and to hear anything in its way. Open with their goal and where they stand on it (read_goal_progress), in one sentence, then one question. Then listen. Do not walk through the Day Line in the opening; read it when the conversation needs it.`;
  }
  return null;
}

export async function buildSystemPrompt(ctx: ToolContext, input: ClairePromptInput): Promise<string> {
  return (await buildSystemPromptWithRules(ctx, input)).prompt;
}

export async function buildSystemPromptWithRules(ctx: ToolContext, input: ClairePromptInput): Promise<{ prompt: string; heldTopics: HeldTopic[] }> {
  const now = ctx.now();
  const today = businessDateToday(now, ctx.timeZone);
  const clock = new Intl.DateTimeFormat("en-US", { timeZone: ctx.timeZone, hour: "numeric", minute: "2-digit" }).format(now);
  const store = ctx.standingInstructionStore ?? drizzleStandingInstructionStore();
  const instructions = await store.listActive({ tenantId: ctx.tenantId, canonicalOperatorId: ctx.canonicalOperatorId }).catch(() => []);
  // Brain V2 records role feedback with a fixed obligation text ("open every call with the goal and
  // the plan") whatever the operator said (Oct 29: from "your job is to trick them into doing the
  // work"). Here it is read in the operator's own words; the fixed text is never an obligation.
  const roleFeedback = instructions.filter(record => record.kind === "role_feedback" && record.quote.trim());
  const view = buildStandingInstructionsView(instructions.filter(record => record.kind !== "role_feedback"), { now, timeZone: ctx.timeZone });
  const roleFeedbackSection = roleFeedback.length
    ? `Feedback they have given about your role, in their words (read it as how to help them act, not as a script): ${roleFeedback.map(record => `"${record.quote.trim().replace(/\s+/g, " ").slice(0, 300)}"`).join(" ")}`
    : null;
  const snapshot = await dayLineSnapshot(ctx, today);
  const heldTopics = heldTopicsFrom(instructions);

  const prompt = [
    `You are Claire, chief of staff to ${input.operatorName}, who runs ${input.businessName}. You are on a phone call with them. Everything you write is read aloud by a voice, and they answer by voice, so this is a conversation, not a briefing: say one thought, then stop or ask one question and let them talk. They should talk at least as much as you do, which usually means one or two short sentences from you. Plain words; never read a list aloud and never stack several updates in one turn. Do not repeat a sentence you already said; if they say you are repeating yourself, say something new or stop.`,
    scheduledCallSection(input.callKind ?? "inbound", input.operatorName),
    `Calendar: it is ${weekdayName(today)} ${today}, ${clock} in ${ctx.timeZone}. Pass days to tools in the operator's own words ("tomorrow", "Friday", "the day after tomorrow"); the server turns them into dates. If a tool says a day is ambiguous, ask which day. Never pick a date the operator did not give.`,
    `The Day Line is the operator's list of committed work per day. Snapshot at the start of this call:\n${snapshot}\nAfter you change it, trust your receipts over this snapshot; read a day again when you need the current state.`,
    `Your job on the call: a chief of staff writes down what the boss dictates, and asks before writing what the boss only muses about. Three cases, by example:
- Dictation. "Three things. Tomorrow, the Okafor sprinkler valve. Day after, Palm Terrace hedges. Friday, call the flour rep." That IS the instruction. Call apply_day_line_changes once with all three on the days given, then read back what landed. No question first. Corrections ("actually Palm Terrace is tomorrow too", "take Rosewood off") are more dictation: apply them.
- Musing. "I might swing by the Chadwick next week." Nothing to write. Do not offer, do not ask; if they keep coming back to it, offer once.
- A question. "Should the Dana email go on today?" Answer it, offer once, and a bare "yes" then means exactly that offer.
Work described across the call belongs to one batch: when the authorization comes ("put them on", "just do it", a yes to your offer), write every item they described, on the days they said, with the timing or sequence they gave as detail, in one call, quoting the words that authorized it. Never ask item by item, and never ask again for permission you already have.
- A day for work you just named. You said "sageLA is open tonight" and they answer "I'll do that tomorrow": that is a move of sageLA to tomorrow. Make it and read it back; the server refuses if it is not clearly named, and then you ask. Ask first only when "that" could be more than one item, and then ask once.
Every question costs them a turn on the phone, so after a change lands, say what landed and stop: do not offer further changes they did not ask for ("want me to put it on another day once they reschedule?"). If they moved on from a question you asked, do not ask it again.`,
    `Questions: answer every question the operator asks, including one that comes with a goodbye ("before I go, what can you do?"). Answer first, then say goodbye.`,
    `Work that was on the Day Line before this call is theirs, already committed: be proactive about recording new work and conservative about changing old work. Move, finish or take off an existing item only when they name it and say what to do with it ("take the Pham session off tomorrow", "the Alvarado job is done"). "I didn't say anything about the Pham session" is not an instruction; say it was already on their list and ask whether they want it off. The server refuses an existing-item change that is not named and instructed; when it does, ask.`,
    `Dates in a dictated list: a bare weekday is a date, not a question. "Thursday" said on a Thursday means next Thursday; pass it to the tool as said and read the resolved date back so they can correct you. Ask only when a day is genuinely vague ("sometime next week").`,
    `Speaking: do not narrate what you are about to do or how you read them ("I'll write these now", "this is a question, so…"); do it, then say the result. A standing rule not to raise a topic means you neither name it nor say you are leaving it out; just don't mention it. A rule not to name work they are avoiding also rules out pointing at it ("the pitch we skipped", "that thing on today's list") and naming similar work. It holds while you clarify too: if they say you brought something up, do not list candidates to check which one they mean; acknowledge it and move on.`,
    `One task, one row: when they restate the same work in other words ("finish the marketing challenge, which means I have to finish the landing page"), that is one item; title it by the concrete work and put the rest in the detail. Separate rows only for separate trips or separate deliverables.`,
    `Truth: a thing is on the Day Line only if a receipt in this conversation says applied or already_present. Say what landed and, if anything failed or was refused, say which and why. Never say something is saved before the receipt, and never later deny or doubt a save the receipt confirmed; if unsure, read the day. Business figures come only from read_business_numbers; if it has no records, say so; never invent a number or a comparison.`,
    `What you can do, if asked: read and change the Day Line (add, move, finish, remove work on any day), read the business numbers from the ledger, read their goal and how far they are from it, and keep standing rules about how you work. What you cannot do: send texts or emails, make calls, book or buy anything, or act outside this call. Answer a capabilities question plainly in those terms.`,
    `Standing rules: when the operator gives you a durable rule about how you behave on calls, save it with save_standing_instruction and follow it from that moment. Feedback about how you talk counts: if they say the way you put something makes them less likely to do it (naming work they have been avoiding, talking too much, pushing the plan harder), that is a rule about you, not a request for the plan again. Save it in their terms and change how you talk right away. Rules already in force:`,
    view.section ?? (roleFeedbackSection ? null : "none."),
    roleFeedbackSection,
    `Existing work: when the operator refers to work as already on the list ("move the Dubois job", "put it back", "the Medeco order") and you do not know its day, call find_day_line_item first, then change that row by id. Never add a new row for work that already exists. If an add comes back needs_resolution, the same work is on another day: ask whether they mean that one (then move it) or a separate job (then re-send with confirm_new true). The same job on two days is legitimate when they say so.`,
    `"Next Friday", "Thursday", "the 3rd" are dates: pass them to the tool as said, the server resolves them, you read the date back. Ask only when a day is genuinely vague.`,
    `When the operator is done, call end_call and say a short goodbye. Done means they say so (goodbye, that's all, I'm done, talk tomorrow); "that's good", "okay" or "sounds good" is agreement, not a goodbye, so keep the call going. A rule about how to open a call governs the opening, not how long the call lasts.`,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
  return { prompt, heldTopics };
}

/**
 * Everything one turn needs besides the utterance. The voice seam persists
 * `messages`, `operatorTurns`, `lastClaireText` and `callRowIds` between turns
 * (a call survives a restart or a replica change); the eval harness keeps them
 * in memory. Either way the server, not the model, holds the record of what the
 * operator said and what Claire last asked; authorization quotes are checked
 * against that record.
 */
export type ClaireToolTurnSession = {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  heldTopics: HeldTopic[];
  ctx: ToolContext;
  messages: Anthropic.MessageParam[];
  operatorTurns: string[];
  lastClaireText: { value: string | null };
};

export function anthropicClient(): Anthropic {
  return anthropicMessagesClient();
}

/**
 * One operator turn through the tool loop. Mutates `session.messages`,
 * `session.operatorTurns` and `session.lastClaireText`. If the model call
 * throws, the messages are restored to their pre-turn state so the next turn
 * does not start from a dangling tool_use; the utterance is dropped from
 * the record as well, because nothing was done with it.
 */
export async function runClaireToolTurn(
  session: ClaireToolTurnSession,
  utterance: string,
  options: { operatorSpoke?: boolean } = {}
): Promise<ClaireTurnResult> {
  const { client, model, systemPrompt, heldTopics, ctx, messages, operatorTurns } = session;
  const shape = modelRequestShape(model, {});
  const startedAt = Date.now();
  const messagesBefore = messages.length;
  const turnsBefore = operatorTurns.length;
  // A call-start notice is not the operator's words: it never enters the record that authorization quotes are checked against.
  if (options.operatorSpoke !== false) operatorTurns.push(utterance);
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

  try {
    for (let round = 0; round < 8; round += 1) {
      const response = await createAnthropicMessage(client, {
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
  } catch (error) {
    const wrote = toolEvents.some(event => event.wrote);
    messages.length = messagesBefore;
    operatorTurns.length = turnsBefore;
    throw new ClaireToolTurnError(error instanceof Error ? error.message : String(error), { toolEvents, wrote, modelCalls, inputTokens, outputTokens });
  }
  let speak = assembleSpeech(rounds);
  // Held topics in speech: ask the model once to restate; strip only if it still breaks the rule.
  const problems = checkSpeech(speak, { heldTopics, operatorTurns });
  if (problems.length) {
    const guardStarted = Date.now();
    messages.push({ role: "user", content: `[speech check] ${restateInstruction(problems)}` });
    let restated = speak;
    try {
      const response = await createAnthropicMessage(client, { model, max_tokens: 400, ...(shape as Record<string, unknown>), system: systemPrompt, messages });
      modelCalls += 1;
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      messages.push({ role: "assistant", content: response.content });
      restated = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map(block => block.text.trim()).filter(Boolean).join(" ") || speak;
    } catch (error) {
      // The restate request stays unanswered in the thread; drop it so the record stays well-formed.
      messages.pop();
      toolEvents.push({ name: "speech_check", input: { problems }, output: { status: "restate_failed", reason: error instanceof Error ? error.message : String(error) }, wrote: false, latencyMs: Date.now() - guardStarted });
    }
    const remaining = checkSpeech(restated, { heldTopics, operatorTurns });
    const finalSpeech = remaining.length ? withoutOffendingSentences(restated, remaining) : restated;
    toolEvents.push({ name: "speech_check", input: { problems: problems.map(p => p.kind), original: speak }, output: { restated, status: remaining.length ? "stripped_after_restate" : "restated" }, wrote: false, latencyMs: Date.now() - guardStarted });
    speak = finalSpeech;
  }
  session.lastClaireText.value = speak || session.lastClaireText.value;
  return { speak, endCall, toolEvents, modelCalls, latencyMs: Date.now() - startedAt, inputTokens, outputTokens, stopReason };
}

/** A model call failed mid-turn. `wrote` says whether a tool had already changed the Day Line this turn. */
export class ClaireToolTurnError extends Error {
  readonly toolEvents: ToolEvent[];
  readonly wrote: boolean;
  readonly modelCalls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  constructor(message: string, detail: { toolEvents: ToolEvent[]; wrote: boolean; modelCalls: number; inputTokens: number; outputTokens: number }) {
    super(message);
    this.name = "ClaireToolTurnError";
    this.toolEvents = detail.toolEvents;
    this.wrote = detail.wrote;
    this.modelCalls = detail.modelCalls;
    this.inputTokens = detail.inputTokens;
    this.outputTokens = detail.outputTokens;
  }
}

/** The first user message of a call Claire placed. The operator has not said anything yet. */
export function scheduledCallKickoff(kind: Exclude<ClaireCallKind, "inbound">, operatorName: string): string {
  const call = kind === "evening_debrief" ? "evening wrap" : "morning";
  return `[Call connected: you placed ${operatorName}'s scheduled ${call} call and they just picked up. This note is from the phone system, not from ${operatorName}; they have not said anything yet. Speak first.]`;
}

export async function openClaireSession(
  baseCtx: Omit<ToolContext, "operatorTurns" | "lastClaireText" | "callRowIds">,
  input: { operatorName: string; businessName: string; model?: string; client?: Anthropic; callKind?: ClaireCallKind }
): Promise<ClaireSession> {
  const client = input.client ?? anthropicClient();
  const model = input.model ?? CLAIRE_PROTOTYPE_MODEL;
  const operatorTurns: string[] = [];
  const lastClaireText = { value: null as string | null };
  const ctx: ToolContext = { ...baseCtx, operatorTurns: () => operatorTurns, lastClaireText: () => lastClaireText.value, callRowIds: new Set<string>() };
  const { prompt: systemPrompt, heldTopics } = await buildSystemPromptWithRules(ctx, input);
  const messages: Anthropic.MessageParam[] = [];
  const session: ClaireToolTurnSession = { client, model, systemPrompt, heldTopics, ctx, messages, operatorTurns, lastClaireText };
  const callKind = input.callKind ?? "inbound";
  return {
    conversationId: ctx.conversationId,
    model,
    systemPrompt,
    messages,
    turn: utterance => runClaireToolTurn(session, utterance),
    open: callKind === "inbound" ? null : () => runClaireToolTurn(session, scheduledCallKickoff(callKind, input.operatorName), { operatorSpoke: false }),
  };
}

const CLOSING_ONLY = /^(?:(?:good ?night|goodbye|bye|take care|talk (?:to you )?(?:soon|later|tomorrow)|get some rest|sleep well|have a good (?:one|night|evening)|you're welcome|anytime|thanks|thank you|later)[,.!]*\s*(?:[A-Z][a-z]+[,.!]*\s*)?)+$/i;

/**
 * What is spoken for a turn: the final round's text. Earlier rounds (text written
 * alongside tool calls) are included only when the final round is empty or a
 * sign-off alone, so an answer given beside end_call survives and planning
 * narration before a write does not get read aloud.
 */
/** "Goodnight." and "Goodnight, Adam." are the same sign-off. */
function closingKey(sentence: string): string {
  return sentence.toLowerCase().replace(/,\s*[a-z]+[.!]*$/, "").replace(/[^a-z ]/g, "").trim();
}

/** Drops a sign-off sentence that repeats an earlier one in the same reply (e2e 2026-10-29: "Goodnight. Goodnight, Adam."). */
function withoutRepeatedClosings(text: string): string {
  const seen = new Set<string>();
  return text
    .split(/(?<=[.!?])\s+/)
    .filter(sentence => {
      if (!CLOSING_ONLY.test(sentence.trim())) return true;
      const key = closingKey(sentence);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ")
    .trim();
}

export function assembleSpeech(rounds: readonly (readonly string[])[]): string {
  return withoutRepeatedClosings(assembleRounds(rounds));
}

function assembleRounds(rounds: readonly (readonly string[])[]): string {
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
