/**
 * Ordered query memory — the fix for the continuation flaw.
 *
 * The authoritative RESULT SET and the records Claire ACTUALLY PRESENTED are different
 * things, and conflating them is what broke continuation before.
 *
 * If a query resolved Thomas + four others and Claire spoke only Thomas:
 *
 *   resolved  = [Thomas, A, B, C, D]
 *   presented = [Thomas]
 *
 * "The other four" must return A, B, C, D — the remainder of THAT SAME resolved result.
 * It must never re-query for records 6–9, which is what "delivered = the whole query
 * window" produced. Do not port that behaviour from PR #192.
 *
 * Exclusions live on the current query thread only. A new, unrelated query resets them.
 */

import type { OrderedQueryMember, OrderedQueryMemory } from "../contracts/workingMemory";

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

/** Exclusions and anchors are spoken as names; match on identity or label, never position. */
export function memberMatches(member: OrderedQueryMember, token: string): boolean {
  const needle = normalizeLabel(token);
  if (!needle) return false;
  if (normalizeLabel(member.id) === needle) return true;
  if (!member.label) return false;
  const label = normalizeLabel(member.label);
  return label === needle || label.split(/\s+/).includes(needle);
}

function excluded(member: OrderedQueryMember, exclusions: string[]): boolean {
  return exclusions.some(token => memberMatches(member, token));
}

/** Open a fresh query thread. Exclusions start empty: a new query never inherits them. */
export function openOrderedQuery(input: {
  queryFingerprint: string;
  parameters: unknown;
  requestedCardinality: number | null;
  ordering: OrderedQueryMemory["ordering"];
  anchorEntity: string | null;
  resolved: OrderedQueryMember[];
  presented?: OrderedQueryMember[];
}): OrderedQueryMemory {
  return {
    queryFingerprint: input.queryFingerprint,
    parameters: input.parameters,
    requestedCardinality: input.requestedCardinality,
    ordering: input.ordering,
    anchorEntity: input.anchorEntity,
    exclusions: [],
    resolved: [...input.resolved],
    presented: [...(input.presented ?? [])],
  };
}

/**
 * Record what Claire actually said. Only these members count as presented —
 * resolving a record is not the same as having told the operator about it.
 */
export function recordPresented(memory: OrderedQueryMemory, members: OrderedQueryMember[]): OrderedQueryMemory {
  const seen = new Set(memory.presented.map(member => member.id));
  const added = members.filter(member => !seen.has(member.id));
  return { ...memory, presented: [...memory.presented, ...added] };
}

/** Resolved members that have not been presented and are not excluded on this thread. */
export function remainingMembers(memory: OrderedQueryMemory): OrderedQueryMember[] {
  const presented = new Set(memory.presented.map(member => member.id));
  return memory.resolved.filter(
    member => !presented.has(member.id) && !excluded(member, memory.exclusions)
  );
}

/**
 * Continue the SAME result. `count` is what the operator asked for ("the other four");
 * a null count returns every remaining member. Never issues a new query window.
 */
export function continueOrderedQuery(
  memory: OrderedQueryMemory,
  count: number | null
): { members: OrderedQueryMember[]; memory: OrderedQueryMemory } {
  const remaining = remainingMembers(memory);
  const members = count === null ? remaining : remaining.slice(0, Math.max(0, count));
  return { members, memory: recordPresented(memory, members) };
}

/**
 * "What happened before Thomas?" — members positioned before the anchor within the
 * same resolved ordering. Resolution is positional inside this result, not a new query.
 */
export function membersBeforeAnchor(memory: OrderedQueryMemory, anchor: string): OrderedQueryMember[] {
  const index = memory.resolved.findIndex(member => memberMatches(member, anchor));
  if (index < 0) return [];
  return memory.resolved.slice(0, index).filter(member => !excluded(member, memory.exclusions));
}

/** Members positioned after the anchor within the same resolved ordering. */
export function membersAfterAnchor(memory: OrderedQueryMemory, anchor: string): OrderedQueryMember[] {
  const index = memory.resolved.findIndex(member => memberMatches(member, anchor));
  if (index < 0) return [];
  return memory.resolved.slice(index + 1).filter(member => !excluded(member, memory.exclusions));
}

/** "Don't tell me about Thomas." Scoped to this query thread only. */
export function excludeFromThread(memory: OrderedQueryMemory, tokens: string[]): OrderedQueryMemory {
  const additions = tokens.map(token => token.trim()).filter(token => token.length > 0);
  const merged = new Set([...memory.exclusions, ...additions].map(token => token.trim()));
  return { ...memory, exclusions: Array.from(merged) };
}

/** A continuation only makes sense against the thread that produced the result. */
export function isSameQueryThread(memory: OrderedQueryMemory | null, queryFingerprint: string): boolean {
  return Boolean(memory && memory.queryFingerprint === queryFingerprint);
}

/**
 * Decide what an unrelated new query does to memory: it replaces the thread outright,
 * which is what resets exclusions. Continuation of the same thread keeps them.
 */
export function resetForNewQuery(
  memory: OrderedQueryMemory | null,
  next: OrderedQueryMemory
): OrderedQueryMemory {
  if (memory && memory.queryFingerprint === next.queryFingerprint) {
    return { ...next, exclusions: memory.exclusions, presented: memory.presented };
  }
  return next;
}
