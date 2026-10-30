/**
 * The native-tool Claire on the phone.
 *
 * Production seam between the Twilio call (claireTwilio.ts: identity, token,
 * transcription, speech, ledger) and the prototype tool loop. The engine is
 * chosen once, when an inbound call is opened, and written into the call's
 * persisted state; every later turn of that call runs on the same engine. A
 * scheduled call (morning, evening wrap) is chosen the same way before it is
 * dialed, and its opening is written by the model from live reads. There
 * is no fallback to Brain V2 mid-conversation: a failure is spoken as a failure
 * and the call stays on this engine. Flipping the switch changes the NEXT call.
 *
 *   CLAIRE_NATIVE_TOOL_OPERATOR_IDS  comma list; who gets the new Claire, on inbound calls and on
 *                                    scheduled morning and evening calls.
 *                                    "owner" means OWNER_OPEN_ID; "tenant:operator" scopes
 *                                    to one tenant; a bare id matches that operator in any tenant.
 *                                    Unset or empty: nobody (everyone stays on Brain V2).
 *   CLAIRE_NATIVE_TOOL_KILL_SWITCH   "1" puts every NEW call back on Brain V2 whatever the list says.
 *
 * Runtime log marker: [ClaireNativeTool]. Transcript text itself goes through the
 * existing scoped transcript mirror ([ClaireTranscript]), never through this marker.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../../_core/env";
import { loadPersistedOperatorIdentity } from "../../identity/operatorIdentityReadService";
import { loadTenantBusinessIdentity } from "../../saas/tenantIdentityService";
import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import {
  anthropicClient,
  buildSystemPromptWithRules,
  CLAIRE_PROTOTYPE_MODEL,
  ClaireToolTurnError,
  runClaireToolTurn,
  scheduledCallKickoff,
  type ClaireCallKind,
  type ClaireTurnResult,
} from "./claireToolLoop";
import type { HeldTopic } from "./speechGuard";
import type { ToolContext, ToolEvent } from "./tools";

export const NATIVE_TOOL_ENGINE = "native_tool" as const;
export const NATIVE_TOOL_LOG = "[ClaireNativeTool]";

/** Spoken when a model call fails mid-turn. Honest about what may or may not have landed. */
export const NATIVE_TOOL_FAILURE_LINE =
  "Something failed on my side before I could answer. Nothing from that was written. Say it again?";
export const NATIVE_TOOL_FAILURE_AFTER_WRITE_LINE =
  "Something failed on my side partway through that. Some of it may have been written. Ask me to read the day back before trusting it.";

/**
 * The engine's working memory, persisted inside the call state. Plain JSON:
 * the model thread (tool_use and tool_result blocks included, which is how a
 * receipt from turn 3 is still in front of the model on turn 20), the server's
 * own record of operator words and Claire's last line, and the rows this call
 * added (anything else on the Day Line predates the call).
 */
export type NativeToolCallState = {
  engine: typeof NATIVE_TOOL_ENGINE;
  model: string;
  /** Built on the first turn, not at pickup, so the greeting is never delayed by database reads. */
  prepared: null | {
    systemPrompt: string;
    heldTopics: HeldTopic[];
    canonicalOperatorId: string;
    operatorName: string;
    businessName: string;
  };
  messages: Anthropic.MessageParam[];
  operatorTurns: string[];
  lastClaireText: string | null;
  callRowIds: string[];
  toolCallCounter: number;
  turnsFailed: number;
};

export function nativeToolClaireEnabledFor(
  scope: { tenantId: string; operatorUserId: string },
  env: NodeJS.ProcessEnv = process.env,
  ownerOpenId: string = ENV.ownerOpenId
): boolean {
  const kill = env.CLAIRE_NATIVE_TOOL_KILL_SWITCH?.trim().toLowerCase();
  if (kill === "1" || kill === "true" || kill === "on") return false;
  const raw = env.CLAIRE_NATIVE_TOOL_OPERATOR_IDS ?? "";
  const operator = scope.operatorUserId.trim();
  const tenant = scope.tenantId.trim();
  if (!operator || !tenant) return false;
  return raw
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean)
    .some(entry => {
      if (entry.toLowerCase() === "owner") return Boolean(ownerOpenId.trim()) && ownerOpenId.trim() === operator;
      const separator = entry.indexOf(":");
      if (separator > 0) return entry.slice(0, separator).trim() === tenant && entry.slice(separator + 1).trim() === operator;
      return entry === operator;
    });
}

export function newNativeToolCallState(model: string = CLAIRE_PROTOTYPE_MODEL): NativeToolCallState {
  return {
    engine: NATIVE_TOOL_ENGINE,
    model,
    prepared: null,
    messages: [],
    operatorTurns: [],
    lastClaireText: null,
    callRowIds: [],
    toolCallCounter: 0,
    turnsFailed: 0,
  };
}

export type NativeToolVoiceTurnInput = {
  conversationId: string;
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  timeZone: string;
  state: NativeToolCallState;
  utterance: string;
  now?: () => Date;
  client?: Anthropic;
};

export type NativeToolVoiceTurnResult = ClaireTurnResult & {
  state: NativeToolCallState;
  /** Day Line row ids this turn wrote (applied receipts), for the call ledger's related-action links. */
  actionIds: string[];
};

function firstName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed.split(/\s+/)[0]! : "there";
}

async function prepare(input: NativeToolVoiceTurnInput, callKind: ClaireCallKind = "inbound"): Promise<NonNullable<NativeToolCallState["prepared"]>> {
  const resolved = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: { type: "open_id", value: input.operatorUserId },
    subsystem: "claire_native_tool_voice",
  });
  if (!resolved.ok) throw new Error(`native-tool Claire: operator identity unresolved (${resolved.reason})`);
  const [persisted, business] = await Promise.all([
    loadPersistedOperatorIdentity(input.operatorUserId).catch(() => null),
    loadTenantBusinessIdentity(input.tenantId).catch(() => null),
  ]);
  const operatorName = firstName(persisted?.name);
  const businessName = business?.businessName?.trim() || business?.brandName?.trim() || "the business";
  const ctx = toolContext(input, resolved.identity.canonicalOperatorId);
  const { prompt, heldTopics } = await buildSystemPromptWithRules(ctx, { operatorName, businessName, callKind });
  return { systemPrompt: prompt, heldTopics, canonicalOperatorId: resolved.identity.canonicalOperatorId, operatorName, businessName };
}

function toolContext(input: NativeToolVoiceTurnInput, canonicalOperatorId: string): ToolContext {
  const { state } = input;
  return {
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    dayDirectorActorId: input.dayDirectorActorId,
    canonicalOperatorId,
    timeZone: input.timeZone,
    now: input.now ?? (() => new Date()),
    conversationId: input.conversationId,
    nextTurnId: () => `t${++state.toolCallCounter}`,
    operatorTurns: () => state.operatorTurns,
    lastClaireText: () => state.lastClaireText,
    callRowIds: new Set(state.callRowIds),
  };
}

export function appliedRowIds(toolEvents: readonly ToolEvent[]): string[] {
  const ids: string[] = [];
  for (const event of toolEvents) {
    if (event.name !== "apply_day_line_changes") continue;
    const receipts = (event.output as { receipts?: Array<{ status?: string; id?: string | null }> } | null)?.receipts;
    for (const receipt of receipts ?? []) if (receipt.status === "applied" && receipt.id) ids.push(receipt.id);
  }
  return [...new Set(ids)];
}

/** What the runtime log says about a turn's tools: names, statuses and row ids, never operator words. */
export function toolEventSummary(toolEvents: readonly ToolEvent[]): Array<Record<string, unknown>> {
  return toolEvents.map(event => {
    const output = (event.output ?? {}) as { status?: string; receipts?: Array<{ op?: string; status?: string; id?: string | null }>; candidates?: unknown[] };
    return {
      name: event.name,
      wrote: event.wrote,
      latencyMs: event.latencyMs,
      ...(output.status ? { status: output.status } : {}),
      ...(Array.isArray(output.receipts) ? { receipts: output.receipts.map(r => ({ op: r.op, status: r.status, id: r.id ?? null })) } : {}),
      ...(Array.isArray(output.candidates) ? { candidates: output.candidates.length } : {}),
    };
  });
}

/**
 * One operator turn on the phone. The returned `state` replaces the persisted
 * one. Throws ClaireToolTurnError (or an identity/preparation error) when the
 * turn could not complete; the caller speaks the failure and keeps the call on
 * this engine.
 */
export async function runNativeToolVoiceTurn(input: NativeToolVoiceTurnInput): Promise<NativeToolVoiceTurnResult> {
  const state = input.state;
  if (!state.prepared) state.prepared = await prepare(input);
  const ctx = toolContext(input, state.prepared.canonicalOperatorId);
  const lastClaireText = { value: state.lastClaireText };
  const result = await runClaireToolTurn(
    {
      client: input.client ?? anthropicClient(),
      model: state.model,
      systemPrompt: state.prepared.systemPrompt,
      heldTopics: state.prepared.heldTopics,
      ctx,
      messages: state.messages,
      operatorTurns: state.operatorTurns,
      lastClaireText,
    },
    input.utterance
  );
  state.lastClaireText = lastClaireText.value;
  state.callRowIds = [...ctx.callRowIds];
  return { ...result, state, actionIds: appliedRowIds(result.toolEvents) };
}

export type ScheduledNativeToolCall = "morning_readiness" | "evening_debrief";

/**
 * Claire's opening for a scheduled call, written by the model before the phone
 * dials (so pickup is never kept waiting). It reads what it needs with the same
 * tools as any turn, and the opening stays in the model thread, so the
 * operator's first answer continues that conversation. The call-start notice is
 * not recorded as operator words, so nothing can be authorized by it.
 * Throws when no opening could be written; the caller does not place the call.
 */
export async function openNativeToolScheduledCall(input: Omit<NativeToolVoiceTurnInput, "utterance"> & { purpose: ScheduledNativeToolCall }): Promise<NativeToolVoiceTurnResult> {
  const state = input.state;
  const turnInput = { ...input, utterance: "" };
  if (!state.prepared) state.prepared = await prepare(turnInput, input.purpose);
  const ctx = toolContext(turnInput, state.prepared.canonicalOperatorId);
  const lastClaireText = { value: state.lastClaireText };
  const result = await runClaireToolTurn(
    {
      client: input.client ?? anthropicClient(),
      model: state.model,
      systemPrompt: state.prepared.systemPrompt,
      heldTopics: state.prepared.heldTopics,
      ctx,
      messages: state.messages,
      operatorTurns: state.operatorTurns,
      lastClaireText,
    },
    scheduledCallKickoff(input.purpose, state.prepared.operatorName),
    { operatorSpoke: false }
  );
  if (!result.speak.trim()) throw new Error("native-tool Claire: the model wrote no opening");
  state.lastClaireText = lastClaireText.value;
  state.callRowIds = [...ctx.callRowIds];
  return { ...result, state, actionIds: appliedRowIds(result.toolEvents) };
}

export { ClaireToolTurnError };
