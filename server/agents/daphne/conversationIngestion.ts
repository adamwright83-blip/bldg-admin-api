import { createHash } from "node:crypto";
import { resolveCanonicalOperatorIdentity } from "../persistentOperator/identity";
import { isDaphneV2ClaireEnabled } from "./claireAdapter";
import { isDaphneConversationIngestionEnabled } from "./releaseSafety";
import {
  loadDaphneMetaPreferences,
  daphneAdaptationAllowed,
} from "./goalsPreferences";
import { recordDaphneObservation } from "./observationStore";
import { DAPHNE_PERSON_DIMENSIONS, isDaphnePersonDimension, type DaphnePersonDimension } from "./personModel";
import { invokeLLM } from "../../_core/llm";
import { ENV } from "../../_core/env";
import { CURRENT_HAIKU_MODEL, normalizeAnthropicModel } from "../../_core/modelCapabilities";

/**
 * Instruction kinds match the standing-instruction ledger's kinds (repair plan W5),
 * so its importer can take these observations without translation.
 */
export type DaphneInstructionKind = "standing_rule" | "scheduling_rule" | "credit_rule";

export type DaphneConversationItem =
  | { kind: "fact"; key: string; statement: string; correction: boolean }
  | { kind: "goal"; key: string; statement: string }
  | { kind: "state"; taskFamily: string; statement: string }
  | { kind: "preference"; key: "question_batch_size"; value: number }
  | { kind: "relationship"; eventKind: "rupture" | "repair"; value: string }
  | { kind: "instruction"; instructionKind: DaphneInstructionKind; statement: string };

/** Quoted, reported, hypothetical or joking speech is never the operator's own standing statement. */
const NOT_OWN_STATEMENT =
  /["“”]|\b(if|hypothetical|pretend|imagine|joking|sarcastic|sarcasm|maybe|said|apparently)\b/i;
/** Daphne never records health or diagnosis talk, from any classifier. */
const MENTAL_HEALTH = /\b(depression|depressed|adhd|bipolar|diagnos|anxiety disorder)\b/i;

/** The hard exclusions both classifiers sit behind. */
export function daphneIngestionExcluded(utterance: string): boolean {
  const text = utterance.trim();
  return !text || text.length > 600 || NOT_OWN_STATEMENT.test(text) || MENTAL_HEALTH.test(text);
}

/** Bounded explicit syntax, not an autobiographical or psychological inference engine. */
export function classifyDaphneConversation(
  utterance: string
): DaphneConversationItem[] {
  const text = utterance.trim();
  if (daphneIngestionExcluded(text)) return [];
  const normalized = text.replace(/[.!]$/, " ").trim();
  const fact = normalized.match(
    /^(Actually,?\s+)?I (own|run|operate) (?:a |an |the )?([\w ,'-]{2,180})$/i
  );
  if (fact)
    return [
      {
        kind: "fact",
        key: "business_ownership",
        statement: `I ${fact[2].toLowerCase()} ${fact[3]}`,
        correction: Boolean(fact[1]),
      },
    ];
  if (/^(?:That|It) (?:isn't|is not) my business anymore$/i.test(normalized))
    return [
      {
        kind: "fact",
        key: "business_ownership",
        statement: "That is not my business anymore",
        correction: true,
      },
    ];
  const goal = normalized.match(
    /^(?:My (?:new )?goal is (?:to )?|I want to )([\w ,'-]{3,240})$/i
  );
  if (goal)
    return [
      { kind: "goal", key: "operator_declared_goal", statement: goal[1] },
    ];
  const state = normalized.match(
    /^I(?:'m| am) working on ([\w ,'-]{2,120}) today$/i
  );
  if (state)
    return [{ kind: "state", taskFamily: state[1], statement: normalized }];
  if (
    /^(?:I prefer Claire to ask one question at a time|Please ask (?:me )?one question at a time)$/i.test(
      normalized
    )
  )
    return [{ kind: "preference", key: "question_batch_size", value: 1 }];
  if (/^You misunderstood (?:me|my instruction)$/i.test(normalized))
    return [
      {
        kind: "relationship",
        eventKind: "rupture",
        value: "instruction_misunderstanding",
      },
    ];
  if (
    /^(?:That's|That is) what I meant,? (?:thanks|thank you)$/i.test(normalized)
  )
    return [
      {
        kind: "relationship",
        eventKind: "repair",
        value: "instruction_misunderstanding",
      },
    ];
  // Real standing statements from production calls (2026-10-15/18/19). Narrow on purpose:
  // the model classifier below handles phrasing these do not.
  if (
    /\b(?:on|in|for) the record as (?:an? )?[\w -]{0,30}\b(?:challenge|mission)\b/i.test(normalized) ||
    /\b(?:so|so that) I (?:get|can get) (?:the )?credit\b/i.test(normalized)
  )
    return [{ kind: "instruction", instructionKind: "credit_rule", statement: text.slice(0, 600) }];
  if (
    /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekends?|mornings?|evenings?)\b/i.test(normalized) &&
    /\b\d{1,2}(?::\d{2})?\s*(?:to|-|and)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?|\b\d{1,2}\s*(?:am|pm)\b/i.test(normalized) &&
    /\b(?:good|best|right) time to (?:ask|call|talk|bring|go over)\b|\b(?:ask|call) me (?:on|then|at)\b/i.test(normalized)
  )
    return [{ kind: "instruction", instructionKind: "scheduling_rule", statement: text.slice(0, 600) }];
  if (/\bI want (?:that|this|it|you to do that)\b.*\b(?:on |in )?every (?:call|time|morning|evening|day)\b/i.test(normalized))
    return [{ kind: "instruction", instructionKind: "standing_rule", statement: text.slice(0, 600) }];
  return [];
}

// ── Bounded model classifier ─────────────────────────────────────────────────

export const DAPHNE_INGESTION_KINDS = [
  "declared_goal",
  "standing_instruction",
  "scheduling_rule",
  "credit_request",
  "motivational_preference",
  "rupture",
  "repair",
  "none",
] as const;
export type DaphneIngestionKind = (typeof DAPHNE_INGESTION_KINDS)[number];

export type DaphneIngestionReading = {
  kinds: Exclude<DaphneIngestionKind, "none">[];
  dimension: DaphnePersonDimension | null;
};

export type DaphneIngestionInterpreter = (input: {
  tenantId: string;
  utterance: string;
  recentTurns: Array<{ speaker: "operator" | "claire"; text: string }>;
}) => Promise<DaphneIngestionReading | null>;

export function daphneIngestionModelId(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeAnthropicModel(env.ANTHROPIC_MODEL_DAPHNE_INGESTION?.trim() ?? "") || CURRENT_HAIKU_MODEL;
}

const SYSTEM = [
  "You read one utterance a small-business operator said to Claire, their chief of staff, and decide whether it is a durable statement Claire should remember.",
  "Return every kind that applies, or ['none']. Kinds:",
  "declared_goal: the operator states a business goal or objective they are pursuing.",
  "standing_instruction: the operator tells Claire how she should behave from now on or on every call (tone, what to include, encouragement, what not to do).",
  "scheduling_rule: the operator names a day or time window when Claire should raise something, call, or ask them.",
  "credit_request: the operator asks that work be recorded or credited a certain way (e.g. as a marketing challenge, a mission, on the record).",
  "motivational_preference: the operator explicitly says what kind of experience they enjoy or want (then set dimension).",
  "rupture: the operator says Claire misunderstood, ignored, or failed them. repair: the operator says that was right or the misunderstanding is resolved.",
  "Return ['none'] when the operator is quoting someone, dictating an example of what Claire could say, describing a hypothetical, joking, asking a question, or reporting what happened.",
  "Never classify talk about health, mood disorders or diagnoses; return ['none'].",
  `dimension is one of ${DAPHNE_PERSON_DIMENSIONS.join(", ")} only when the operator states it for motivational_preference; otherwise 'none'.`,
].join(" ");

/** Production interpreter: newest Haiku, closed schema. Any failure returns null. */
export const interpretDaphneIngestion: DaphneIngestionInterpreter = async input => {
  if (!ENV.anthropicApiKey?.trim()) return null;
  const result = await invokeLLM({
    tenantId: input.tenantId,
    model: daphneIngestionModelId(),
    maxTokens: 120,
    timeoutMs: 8_000,
    feature: "daphne_conversation_ingestion",
    messages: [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          recentTurns: input.recentTurns.slice(-4).map(t => ({ speaker: t.speaker, text: t.text.slice(0, 300) })),
          utterance: input.utterance.slice(0, 600),
        }),
      },
    ],
    outputSchema: {
      name: "daphne_conversation_ingestion",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["kinds", "dimension"],
        properties: {
          kinds: { type: "array", items: { type: "string", enum: [...DAPHNE_INGESTION_KINDS] } },
          dimension: { type: "string", enum: [...DAPHNE_PERSON_DIMENSIONS, "none"] },
        },
      },
    },
  });
  const raw = result.choices[0]?.message.content;
  return parseDaphneIngestionReading(JSON.parse(typeof raw === "string" ? raw : "{}"));
};

/** Closed-enum validation of model output; anything outside the enums is dropped. */
export function parseDaphneIngestionReading(value: unknown): DaphneIngestionReading | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { kinds?: unknown; dimension?: unknown };
  if (!Array.isArray(v.kinds)) return null;
  const kinds = [...new Set(v.kinds)]
    .filter((k): k is Exclude<DaphneIngestionKind, "none"> => typeof k === "string" && k !== "none" && (DAPHNE_INGESTION_KINDS as readonly string[]).includes(k))
    .slice(0, 3);
  return { kinds, dimension: isDaphnePersonDimension(v.dimension) ? v.dimension : null };
}

/** Maps a model reading to items. Statements are the operator's own words, never model text. */
export function daphneItemsFromReading(utterance: string, reading: DaphneIngestionReading): DaphneConversationItem[] {
  const statement = utterance.trim().slice(0, 600);
  const items: DaphneConversationItem[] = [];
  for (const kind of reading.kinds) {
    if (kind === "declared_goal") items.push({ kind: "goal", key: "operator_declared_goal", statement: statement.slice(0, 240) });
    else if (kind === "standing_instruction") items.push({ kind: "instruction", instructionKind: "standing_rule", statement });
    else if (kind === "scheduling_rule") items.push({ kind: "instruction", instructionKind: "scheduling_rule", statement });
    else if (kind === "credit_request") items.push({ kind: "instruction", instructionKind: "credit_rule", statement });
    else if (kind === "motivational_preference" && reading.dimension)
      // Explicit only, stored as an operator-stated fact with its source utterance.
      items.push({ kind: "fact", key: `motivational_dimension:${reading.dimension}`, statement, correction: false });
    else if (kind === "rupture") items.push({ kind: "relationship", eventKind: "rupture", value: "operator_reported_misunderstanding" });
    else if (kind === "repair") items.push({ kind: "relationship", eventKind: "repair", value: "operator_reported_misunderstanding" });
  }
  return items;
}

function itemKey(item: DaphneConversationItem): string {
  switch (item.kind) {
    case "fact":
    case "goal":
      return `${item.kind}:${item.key}`;
    case "instruction":
      return `instruction:${item.instructionKind}`;
    case "relationship":
      return `relationship:${item.eventKind}`;
    default:
      return item.kind;
  }
}

/** Items the model found that the deterministic pass did not already record. */
export function daphneModelOnlyItems(deterministic: DaphneConversationItem[], model: DaphneConversationItem[]): DaphneConversationItem[] {
  const seen = new Set(deterministic.map(itemKey));
  // A deterministic relationship event already covers both rupture and repair for this turn.
  const hasRelationship = deterministic.some(i => i.kind === "relationship");
  return model.filter(i => !seen.has(itemKey(i)) && !(hasRelationship && i.kind === "relationship"));
}

export type DaphneIngestionDeps = {
  interpret?: DaphneIngestionInterpreter;
  /** Tests await the model pass; production never waits for it on Claire's answer path. */
  awaitModel?: boolean;
  recentTurns?: Array<{ speaker: "operator" | "claire"; text: string }>;
  resolveIdentity?: typeof resolveCanonicalOperatorIdentity;
  loadPreferences?: typeof loadDaphneMetaPreferences;
  recordObservation?: typeof recordDaphneObservation;
  enabled?: (tenantId: string) => boolean;
};

type IngestInput = {
  tenantId: string;
  operatorUserId: string;
  conversationId: string;
  turnId: string;
  utterance: string;
  completed: boolean;
  occurredAt?: Date;
};

type PersistResult =
  | { status: "ineligible" | "identity_unresolved" | "disabled" }
  | { status: "persisted"; observationId: string; tenantId: string; canonicalOperatorId: string };

async function persistItems(
  input: IngestInput,
  items: DaphneConversationItem[],
  source: "deterministic" | "model",
  deps: DaphneIngestionDeps
): Promise<PersistResult> {
  if (!items.length) return { status: "ineligible" };
  const raw = input.operatorUserId.trim();
  if (!raw) return { status: "identity_unresolved" };
  const resolution = await (deps.resolveIdentity ?? resolveCanonicalOperatorIdentity)({
    tenantId: input.tenantId,
    source: /^\d+$/.test(raw)
      ? { type: "user_id", value: Number(raw) }
      : { type: "open_id", value: raw },
    subsystem: "daphne_conversation_ingestion",
  });
  if (!resolution.ok) return { status: "identity_unresolved" };
  const scope = {
    tenantId: input.tenantId,
    canonicalOperatorId: resolution.identity.canonicalOperatorId,
  };
  const preferences = await (deps.loadPreferences ?? loadDaphneMetaPreferences)(scope);
  if (
    !daphneAdaptationAllowed(preferences) ||
    preferences.memory_recall?.value === false ||
    preferences.memory_recall?.status === "revoked"
  )
    return { status: "disabled" };
  const key = createHash("sha256")
    .update(JSON.stringify([input.conversationId, input.turnId]))
    .digest("hex");
  const state = items.find(
    (item): item is Extract<DaphneConversationItem, { kind: "state" }> =>
      item.kind === "state"
  );
  const relationship = items.find(
    (item): item is Extract<DaphneConversationItem, { kind: "relationship" }> =>
      item.kind === "relationship"
  );
  const observation = await (deps.recordObservation ?? recordDaphneObservation)({
    ...scope,
    operatorUserId: raw,
    sessionId: input.conversationId,
    actorType: "user",
    actorId: raw,
    agentId: "claire",
    observationKind: relationship ? "relationship_event" : "user_statement",
    evidenceChannel: "stated",
    verificationStatus: "attested",
    sourceType: "claire_conversation_ingestion",
    sourceReference: `turn:${input.turnId}`.slice(0, 191),
    occurredAt: input.occurredAt ?? new Date(),
    context: state
      ? {
          taskFamily: state.taskFamily,
          taskMode: "execution",
          currentGoal: state.statement,
        }
      : null,
    payload: {
      schemaVersion: 1,
      items,
      classifier:
        source === "model"
          ? { source, model: daphneIngestionModelId(), kinds: items.map(itemKey) }
          : { source },
      utterance: input.utterance.trim().slice(0, 600),
      ...(relationship
        ? { eventKind: relationship.eventKind, value: relationship.value }
        : {}),
    },
    idempotencyKey: source === "model" ? `conversation-model:${key}` : `conversation:${key}`,
  });
  return {
    status: "persisted" as const,
    observationId: observation.id,
    ...scope,
  };
}

/**
 * Deterministic rules first (synchronous with the turn, and the fallback when the
 * model is unavailable), then the bounded model classifier in the background for
 * phrasing the rules miss. Both sit behind the same hard exclusions and consent.
 */
export async function ingestDaphneConversation(input: IngestInput, deps: DaphneIngestionDeps = {}) {
  const enabled =
    deps.enabled ??
    ((tenantId: string) => isDaphneConversationIngestionEnabled(tenantId) && isDaphneV2ClaireEnabled(tenantId));
  if (!input.completed || !enabled(input.tenantId) || daphneIngestionExcluded(input.utterance))
    return { status: "ineligible" as const };
  const deterministic = classifyDaphneConversation(input.utterance).filter(
    item => item.kind !== "preference"
  );
  const result = await persistItems(input, deterministic, "deterministic", deps);

  const words = input.utterance.trim().split(/\s+/).length;
  const modelPass = async () => {
    if (words < 4) return null;
    const reading = await (deps.interpret ?? interpretDaphneIngestion)({
      tenantId: input.tenantId,
      utterance: input.utterance,
      recentTurns: deps.recentTurns ?? [],
    }).catch(() => null);
    if (!reading) return null;
    const extra = daphneModelOnlyItems(deterministic, daphneItemsFromReading(input.utterance, reading));
    return extra.length ? persistItems(input, extra, "model", deps) : null;
  };
  if (deps.awaitModel) {
    const model = await modelPass();
    if (result.status !== "persisted" && model) return model;
    return result;
  }
  void modelPass().catch(error =>
    console.warn("[DaphneIngestion]", JSON.stringify({ event: "model_pass_failed", message: String(error).slice(0, 200) }))
  );
  return result;
}
