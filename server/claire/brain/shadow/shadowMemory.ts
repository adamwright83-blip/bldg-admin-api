/**
 * Brain V2's OWN working memory during shadow mode.
 *
 * V1 has its own conversation state and continues to own it. This is separate, and
 * deliberately so: without somewhere to keep what V2 resolved and what V2 presented,
 * a real shadow turn can never demonstrate continuation — "last five sales" then
 * "the other four" only works if V2 remembers its own previous answer.
 *
 * This store holds COGNITIVE state only. It may never:
 *   - alter V1 state
 *   - create Day Line work
 *   - alter business truth
 *   - consume personal entitlements
 *   - influence V1 speech or call control
 *
 * It is keyed by conversation identity and is discarded freely; losing it degrades
 * shadow fidelity and nothing else.
 */

import { createHash } from "node:crypto";
import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { FocusEntity, OrderedQueryMemory } from "../contracts/workingMemory";
import {
  claireConversationStateStore,
  type ClaireConversationStateStore,
  type ConversationStateOwner,
} from "../../turn/conversationStateStore";
import { openOrderedQuery, recordPresented, resetForNewQuery } from "../workingMemory/orderedQuery";

export type ShadowMemory = {
  focusEntities: FocusEntity[];
  orderedQuery: OrderedQueryMemory | null;
  unresolvedReferences: string[];
  /** Shape of recent V2 decisions, for tracing a disagreement back through the thread. */
  priorDecisionRefs: string[];
  updatedAtMs: number;
};

export function emptyShadowMemory(): ShadowMemory {
  return {
    focusEntities: [],
    orderedQuery: null,
    unresolvedReferences: [],
    priorDecisionRefs: [],
    updatedAtMs: 0,
  };
}

export interface ShadowMemoryStore {
  load(key: string): Promise<ShadowMemory | null>;
  save(key: string, memory: ShadowMemory, owner?: ConversationStateOwner): Promise<void>;
  clear(key?: string): Promise<void>;
}

const MAX_KEYS = 200;

/** Hermetic process-local implementation for tests and degraded fallback. */
export function createInMemoryShadowMemoryStore(): ShadowMemoryStore {
  const store = new Map<string, ShadowMemory>();
  return {
    async load(key) {
      return store.get(key) ?? null;
    },
    async save(key, memory) {
      if (!store.has(key) && store.size >= MAX_KEYS) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, memory);
    },
    async clear(key) {
      if (key === undefined) store.clear();
      else store.delete(key);
    },
  };
}

export const SHADOW_MEMORY_TTL_MS = 12 * 60 * 60 * 1000;

/** A bounded key in the existing conversation-state table, strictly separate from V1. */
export function shadowMemoryKey(input: {
  tenantId: string;
  operatorUserId: string;
  conversationKey: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.tenantId}\0${input.operatorUserId}\0${input.conversationKey}`)
    .digest("hex")
    .slice(0, 32);
  return `claire-brain-v2-shadow:${input.tenantId}:${input.operatorUserId}:${digest}`;
}

/**
 * Durable shadow memory reuses Claire's existing conversation-state infrastructure.
 * Only V2 cognitive state is stored; V1 state and transcript rows are never touched.
 */
export function createDurableShadowMemoryStore(
  store: ClaireConversationStateStore = claireConversationStateStore(),
  ttlMs: number = SHADOW_MEMORY_TTL_MS
): ShadowMemoryStore {
  return {
    async load(key) {
      const row = await store.load<ShadowMemory>(key);
      return row?.state ?? null;
    },
    async save(key, memory, owner) {
      if (!owner) throw new Error("Durable Brain V2 shadow memory requires an owner");
      await store.save(key, owner, memory, ttlMs);
    },
    async clear(key) {
      if (key) await store.remove(key);
    },
  };
}

export const shadowMemoryStore: ShadowMemoryStore = createDurableShadowMemoryStore();

/**
 * Fold one decision into shadow memory.
 *
 * A newly opened ordered result replaces the thread (which is what resets exclusions);
 * a continuation advances `presented` on the existing thread instead, so the remaining
 * members shrink turn over turn rather than resetting.
 */
export function updateShadowMemory(
  previous: ShadowMemory | null,
  decision: ExecutiveDecision,
  nowMs: number = Date.now()
): ShadowMemory {
  const base = previous ?? emptyShadowMemory();
  const update = decision.workingMemoryUpdate;
  let orderedQuery = base.orderedQuery;

  if (update?.orderedQuery) {
    const opened = openOrderedQuery({
      queryFingerprint: update.orderedQuery.queryFingerprint,
      parameters: update.orderedQuery.parameters,
      requestedCardinality: update.orderedQuery.requestedCardinality,
      ordering: update.orderedQuery.ordering,
      anchorEntity: update.orderedQuery.anchorEntity,
      resolved: update.orderedQuery.resolved,
      presented: update.orderedQuery.presented,
      sourceEvidence: update.orderedQuery.sourceEvidence,
    });
    // Same query again keeps what was already presented; a different one starts clean.
    orderedQuery = resetForNewQuery(base.orderedQuery, opened);
  } else if (update?.continuationPresented?.length && orderedQuery) {
    orderedQuery = recordPresented(orderedQuery, update.continuationPresented);
  }

  // Focus follows whatever the turn actually resolved, not what was merely mentioned.
  const resolvedFocus: FocusEntity[] = decision.evidence
    .filter(item => item.id.startsWith("contact_account_resolution:"))
    .map(item => {
      const payload = item.payload as {
        mention?: string;
        contactName?: string | null;
        accountId?: number | null;
        accountName?: string | null;
      };
      return {
        mentioned: payload.mention ?? "",
        contactName: payload.contactName ?? null,
        accountId: payload.accountId ?? null,
        accountName: payload.accountName ?? null,
      };
    })
    .filter(entry => entry.accountId != null || entry.contactName != null);

  return {
    focusEntities: resolvedFocus.length ? resolvedFocus : base.focusEntities,
    orderedQuery,
    unresolvedReferences: decision.perceivedTurn.ambiguities,
    priorDecisionRefs: [
      ...base.priorDecisionRefs,
      // Segment shape, never the operator's words — this store is not a transcript.
      decision.responsePlan.segments.map(segment => segment.type).join("+") || "none",
    ].slice(-10),
    updatedAtMs: nowMs,
  };
}
