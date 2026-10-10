import { createHash } from "node:crypto";
import { resolveCanonicalOperatorIdentity } from "../persistentOperator/identity";
import { isDaphneV2ClaireEnabled } from "./claireAdapter";
import {
  loadDaphneMetaPreferences,
  daphneAdaptationAllowed,
} from "./goalsPreferences";
import { recordDaphneObservation } from "./observationStore";

export type DaphneConversationItem =
  | { kind: "fact"; key: string; statement: string; correction: boolean }
  | { kind: "goal"; key: string; statement: string }
  | { kind: "state"; taskFamily: string; statement: string }
  | { kind: "preference"; key: "question_batch_size"; value: number }
  | { kind: "relationship"; eventKind: "rupture" | "repair"; value: string };

/** Bounded explicit syntax, not an autobiographical or psychological inference engine. */
export function classifyDaphneConversation(
  utterance: string
): DaphneConversationItem[] {
  const text = utterance.trim();
  if (
    !text ||
    text.length > 600 ||
    /["“”]|\b(if|hypothetical|pretend|imagine|joking|sarcastic|sarcasm|maybe|said|apparently)\b/i.test(
      text
    )
  )
    return [];
  if (
    /\b(depression|depressed|adhd|bipolar|diagnos|anxiety disorder)\b/i.test(
      text
    )
  )
    return [];
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
  return [];
}

export async function ingestDaphneConversation(input: {
  tenantId: string;
  operatorUserId: string;
  conversationId: string;
  turnId: string;
  utterance: string;
  completed: boolean;
  occurredAt?: Date;
}) {
  const items = input.completed
    ? classifyDaphneConversation(input.utterance).filter(
        item => item.kind !== "preference"
      )
    : [];
  if (!items.length || !isDaphneV2ClaireEnabled(input.tenantId))
    return { status: "ineligible" as const };
  const raw = input.operatorUserId.trim();
  if (!raw) return { status: "identity_unresolved" as const };
  const resolution = await resolveCanonicalOperatorIdentity({
    tenantId: input.tenantId,
    source: /^\d+$/.test(raw)
      ? { type: "user_id", value: Number(raw) }
      : { type: "open_id", value: raw },
    subsystem: "daphne_conversation_ingestion",
  });
  if (!resolution.ok) return { status: "identity_unresolved" as const };
  const scope = {
    tenantId: input.tenantId,
    canonicalOperatorId: resolution.identity.canonicalOperatorId,
  };
  const preferences = await loadDaphneMetaPreferences(scope);
  if (
    !daphneAdaptationAllowed(preferences) ||
    preferences.memory_recall?.value === false ||
    preferences.memory_recall?.status === "revoked"
  )
    return { status: "disabled" as const };
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
  const observation = await recordDaphneObservation({
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
      ...(relationship
        ? { eventKind: relationship.eventKind, value: relationship.value }
        : {}),
    },
    idempotencyKey: `conversation:${key}`,
  });
  return {
    status: "persisted" as const,
    observationId: observation.id,
    ...scope,
  };
}
