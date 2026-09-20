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

import type { ExecutiveDecision } from "../contracts/executiveDecision";
import type { FocusEntity, OrderedQueryMemory } from "../contracts/workingMemory";
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
  save(key: string, memory: ShadowMemory): Promise<void>;
  clear(key?: string): Promise<void>;
}

const MAX_KEYS = 200;

/**
 * Process-local by default. Shadow memory is observational, so it does not need to
 * survive a restart and must not acquire a durable write path into production storage.
 */
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

export const shadowMemoryStore: ShadowMemoryStore = createInMemoryShadowMemoryStore();

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
