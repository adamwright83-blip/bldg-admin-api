/**
 * Map a V1-shaped state bag into WorkingMemorySnapshot without importing the orchestrator.
 * Ordered query memory carries the resolved result the thread is still walking, so a
 * continuation answers from that result rather than re-querying.
 */

import type {
  OrderedQueryMemory,
  PendingProposalSnapshot,
  PriorClaimRef,
  WorkingMemorySnapshot,
} from "../contracts/workingMemory";

export type WorkingMemorySource = {
  pendingFragment?: string | null;
  fragmentHolds?: number;
  pendingReminded?: boolean;
  focusAccount?: { id: number; name: string } | null;
  claimReceipts?: Array<{
    id: string;
    claireTurnOrdinal: number;
    claimType: string;
    recheck?: { kind: string };
  }>;
  pendingBriefing?: { parsed?: { items?: unknown[] } | null; createdAt?: number } | null;
  pendingAccountFollowUp?: { createdAt?: number } | null;
  proposal?: { title?: string } | null;
  pendingProposal?: { title?: string } | null;
  /** The ordered result this thread is still walking, if any. */
  orderedQuery?: OrderedQueryMemory | null;
};

export type WorkingMemoryContext = {
  conversationKey: string;
  tenantId: string;
  operatorUserId: string;
  surface: "voice" | "text";
};

function pending(identity: string, kind: PendingProposalSnapshot["kind"], createdAtMs: number, reminded: boolean, hints: string[]): PendingProposalSnapshot {
  return { identity, kind, createdAtMs, reminded, hints };
}

export function snapshotWorkingMemory(source: WorkingMemorySource, ctx: WorkingMemoryContext): WorkingMemorySnapshot {
  const reminded = Boolean(source.pendingReminded);
  const briefing = source.pendingBriefing
    ? pending("pending-briefing", "briefing", source.pendingBriefing.createdAt ?? 0, reminded, [])
    : null;
  const followUp = source.pendingAccountFollowUp
    ? pending("pending-follow-up", "account_follow_up", source.pendingAccountFollowUp.createdAt ?? 0, reminded, [])
    : null;
  const proposalSource = source.pendingProposal ?? source.proposal;
  const proposal = proposalSource
    ? pending("pending-proposal", "day_line", 0, reminded, proposalSource.title ? [proposalSource.title] : [])
    : null;

  const priorClaims: PriorClaimRef[] = (source.claimReceipts ?? []).map(receipt => ({
    receiptId: receipt.id,
    claireTurnOrdinal: receipt.claireTurnOrdinal,
    claimType: receipt.claimType,
    recheckable: receipt.recheck?.kind === "business_query",
  }));

  return {
    threadId: ctx.conversationKey,
    focusEntities: source.focusAccount
      ? [{ mentioned: source.focusAccount.name, contactName: null, accountId: source.focusAccount.id, accountName: source.focusAccount.name }]
      : [],
    pendingProposal: proposal,
    pendingBriefing: briefing,
    pendingAccountFollowUp: followUp,
    orderedQuery: source.orderedQuery ?? null,
    priorClaims,
    unresolvedReferences: [],
    pendingFragment: source.pendingFragment ?? null,
    fragmentHolds: source.fragmentHolds ?? 0,
    currentCallContext: {
      surface: ctx.surface,
      conversationKey: ctx.conversationKey,
      tenantId: ctx.tenantId,
      operatorUserId: ctx.operatorUserId,
    },
  };
}
