/**
 * The one-way boundary between V1's live state and Brain V2's observation.
 *
 * V1 continues to own and mutate its `ClaireTurnState` after a turn completes.
 * Handing that object to V2 would give V2 a shared mutable reference into the live
 * conversation — which would make "V2 cannot affect V1" a matter of V2 behaving
 * well rather than a property of the system.
 *
 * So V2 never receives the live object. It receives a fresh, deeply-copied, frozen
 * snapshot containing only the fields Working Memory actually reads. Writing through
 * it throws in strict mode and is a no-op otherwise; either way the live state is
 * untouched.
 *
 *                      ┌──→ Brain V2 observer
 *                      │        ↓
 *   REAL TURN → V1 ────┤     telemetry only
 *               │      │
 *               ↓      X   NO RETURN PATH
 *          live response
 *          live mutations
 *          live call control
 */

import type { WorkingMemorySource } from "../workingMemory/snapshot";

/** Structural subset of `ClaireTurnState` that Working Memory reads. */
export type V1StateLike = {
  pendingFragment?: string | null;
  fragmentHolds?: number;
  pendingReminded?: boolean;
  focusAccount?: { id: number; name: string } | null;
  claimReceipts?: Array<{
    id: string;
    claireTurnOrdinal: number;
    claimType: string;
    recheck?: { kind: string };
  }> | null;
  pendingBriefing?: { parsed?: { items?: unknown[] } | null; createdAt?: number } | null;
  /** Shape varies by V1 version; only a createdAt stamp is read, defensively. */
  pendingAccountFollowUp?: { createdAt?: number | undefined } | object | null;
  proposal?: { title?: string } | null;
  pendingProposal?: { title?: string } | null;
};

function frozen<T>(value: T): T {
  return Object.freeze(value);
}

/**
 * Copy only what V2 needs, then freeze it. Nothing in the returned value shares an
 * object identity with the live state, so V2 cannot reach back through it.
 */
export function readOnlyWorkingMemorySource(state: V1StateLike | null | undefined): WorkingMemorySource {
  if (!state) return frozen({});

  const claimReceipts = (state.claimReceipts ?? []).map(receipt =>
    frozen({
      id: receipt.id,
      claireTurnOrdinal: receipt.claireTurnOrdinal,
      claimType: receipt.claimType,
      recheck: receipt.recheck ? frozen({ kind: receipt.recheck.kind }) : undefined,
    })
  );

  return frozen({
    pendingFragment: state.pendingFragment ?? null,
    fragmentHolds: state.fragmentHolds ?? 0,
    pendingReminded: Boolean(state.pendingReminded),
    focusAccount: state.focusAccount
      ? frozen({ id: state.focusAccount.id, name: state.focusAccount.name })
      : null,
    claimReceipts: frozen(claimReceipts),
    pendingBriefing: state.pendingBriefing
      ? frozen({
          parsed: state.pendingBriefing.parsed
            ? frozen({ items: frozen([...(state.pendingBriefing.parsed.items ?? [])]) })
            : null,
          createdAt: state.pendingBriefing.createdAt ?? 0,
        })
      : null,
    pendingAccountFollowUp: state.pendingAccountFollowUp
      ? frozen({
          createdAt:
            typeof (state.pendingAccountFollowUp as { createdAt?: unknown }).createdAt === "number"
              ? ((state.pendingAccountFollowUp as { createdAt: number }).createdAt)
              : 0,
        })
      : null,
    pendingProposal: state.pendingProposal
      ? frozen({ title: state.pendingProposal.title })
      : state.proposal
        ? frozen({ title: state.proposal.title })
        : null,
    // Ordered-query memory is not yet produced by V1; a continuation observed in
    // shadow therefore has nothing to walk, which is honest rather than invented.
    orderedQuery: null,
  }) as WorkingMemorySource;
}
