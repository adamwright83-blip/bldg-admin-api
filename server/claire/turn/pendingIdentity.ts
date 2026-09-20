/**
 * Reminder state is tied to the pending item's identity, not the conversation.
 * A reminder about proposal A must not suppress a later mention of proposal B.
 */

export type PendingIdentityState = {
  pendingBriefing?: { createdAt: number; parsed?: { items?: Array<{ title?: string }> } } | null;
  pendingProposal?: { title?: string; sourceText?: string } | null;
  pendingReminded?: boolean;
  pendingReminderKey?: string | null;
};

export function pendingItemIdentity(state: PendingIdentityState): string | null {
  if (state.pendingBriefing) {
    const titles = (state.pendingBriefing.parsed?.items ?? []).map(item => item.title ?? "").join("|");
    return `briefing:${state.pendingBriefing.createdAt}:${titles}`;
  }
  if (state.pendingProposal?.title) {
    return `proposal:${state.pendingProposal.title}:${state.pendingProposal.sourceText ?? ""}`;
  }
  return null;
}

/** Reset the reminder marker whenever the live pending item changes (created, cleared, replaced). */
export function syncPendingReminderIdentity(state: PendingIdentityState): string | null {
  const key = pendingItemIdentity(state);
  if (key !== (state.pendingReminderKey ?? null)) {
    state.pendingReminded = false;
    state.pendingReminderKey = key;
  }
  return key;
}

export function markPendingReminded(state: PendingIdentityState): void {
  const key = syncPendingReminderIdentity(state);
  if (key) {
    state.pendingReminded = true;
    state.pendingReminderKey = key;
  }
}
