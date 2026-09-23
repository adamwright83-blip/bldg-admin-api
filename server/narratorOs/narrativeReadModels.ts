import type {
  KnowledgeState,
  NarrativeBeatId,
  NarrativeDisclosureRule,
  NarrativeKnowledgeMutation,
  NarrativeState,
  NarrativeStateMutation,
  QuietBehavior,
  RookContactInterventionResidue,
} from "../../shared/narratorOs/contracts";
import { getBeat } from "./registry";
import { cloneKnowledge, type NarratorSnapshot } from "./store";

/**
 * Read layer over authored beats, the fired-beat ledger, knowledge planes,
 * and narrative state. Nothing here writes. playerVisible is authored
 * metadata stored on the ledger row. It is not presentation or delivery.
 */

export type AuthoredReactionPlan = {
  readonly beatId: NarrativeBeatId;
  readonly characters: readonly string[];
  readonly knowledgeMutations: readonly NarrativeKnowledgeMutation[];
  readonly stateMutations: readonly NarrativeStateMutation[];
  readonly playerVisibility: boolean;
  readonly disclosureRules: readonly NarrativeDisclosureRule[];
  readonly quietBehavior: QuietBehavior | null;
  readonly authoredSourceRef: string;
};

export type KnowledgeMutationRef = {
  readonly plane: NarrativeKnowledgeMutation["plane"];
  readonly factId: string;
  readonly op: NarrativeKnowledgeMutation["op"];
};

export type StateMutationRef = {
  readonly key: string;
  readonly value: NarrativeStateMutation["value"];
};

export type AuthoredReactionReceipt = {
  readonly beatId: NarrativeBeatId;
  readonly ledgerEntryId: string;
  readonly occurredAt: string;
  readonly knowledgeMutationRefs: readonly KnowledgeMutationRef[];
  readonly stateMutationRefs: readonly StateMutationRef[];
  readonly characters: readonly string[];
  readonly playerVisible: boolean;
};

export type FiredAuthoredBeatMemory = {
  readonly ledgerEntryId: string;
  readonly beatId: NarrativeBeatId;
  readonly occurredAt: string;
  readonly offscreen: boolean;
  readonly playerVisible: boolean;
};

export type VerifiedGoldlineMemory = {
  readonly ledgerEntryId: string;
  readonly occurredAt: string;
  readonly goldlineOutcomeId: string | null;
  readonly relatedBeatId: NarrativeBeatId | null;
};

export type SocialResidueMemory = {
  readonly ledgerEntryId: string;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly operatorUserId: string;
  readonly residue: RookContactInterventionResidue;
};

export type NarrativeMemoryView = {
  readonly firedAuthoredBeats: readonly FiredAuthoredBeatMemory[];
  readonly verifiedGoldlineOutcomes: readonly VerifiedGoldlineMemory[];
  readonly socialResidues: readonly SocialResidueMemory[];
  readonly knowledge: KnowledgeState;
  readonly narrativeStateValues: NarrativeState["values"];
  readonly closedForwardPaths: readonly string[];
  readonly holdOpenedAtMs: Readonly<Record<string, number>>;
};

/** What the registered beat is authored to change if a legal commit runs. */
export function authoredReactionPlan(beatId: string): AuthoredReactionPlan {
  const beat = getBeat(beatId);
  return Object.freeze({
    beatId: beat.id,
    characters: Object.freeze([...beat.characters]),
    knowledgeMutations: Object.freeze(
      beat.knowledgeMutations.map(mutation => Object.freeze({ ...mutation }))
    ),
    stateMutations: Object.freeze(
      beat.stateMutations.map(mutation => Object.freeze({ ...mutation }))
    ),
    playerVisibility: beat.playerVisibility,
    disclosureRules: Object.freeze(
      beat.disclosureRules.map(rule => Object.freeze({ ...rule }))
    ),
    quietBehavior: beat.quietBehavior
      ? Object.freeze({
          ...beat.quietBehavior,
          holdWindow: beat.quietBehavior.holdWindow
            ? Object.freeze({ ...beat.quietBehavior.holdWindow })
            : null,
        })
      : null,
    authoredSourceRef: beat.authoredSourceRef,
  });
}

/**
 * Receipt for one successful FIRED_AUTHORED_BEAT row. Mutation refs are the
 * registered beat's mutations, and only because that ledger commit exists.
 * A missing row, or any other ledger kind, has no receipt.
 */
export function authoredReactionReceipt(
  snapshot: NarratorSnapshot,
  ledgerEntryId: string
): AuthoredReactionReceipt | null {
  const entry = snapshot.ledger.find(row => row.id === ledgerEntryId);
  if (!entry || entry.kind !== "FIRED_AUTHORED_BEAT" || !entry.beatId) {
    return null;
  }
  let beat;
  try {
    beat = getBeat(entry.beatId);
  } catch {
    return null;
  }
  return Object.freeze({
    beatId: beat.id,
    ledgerEntryId: entry.id,
    occurredAt: entry.occurredAt,
    knowledgeMutationRefs: Object.freeze(
      beat.knowledgeMutations.map(mutation =>
        Object.freeze({
          plane: mutation.plane,
          factId: mutation.factId,
          op: mutation.op,
        })
      )
    ),
    stateMutationRefs: Object.freeze(
      beat.stateMutations.map(mutation =>
        Object.freeze({
          key: mutation.key,
          value: mutation.value,
        })
      )
    ),
    characters: Object.freeze([...beat.characters]),
    playerVisible: entry.playerVisible,
  });
}

/** Deterministic projection of the current snapshot. Does not write. */
export function narrativeMemoryView(
  snapshot: NarratorSnapshot
): NarrativeMemoryView {
  const firedAuthoredBeats: FiredAuthoredBeatMemory[] = [];
  const verifiedGoldlineOutcomes: VerifiedGoldlineMemory[] = [];
  const socialResidues: SocialResidueMemory[] = [];
  for (const entry of snapshot.ledger) {
    if (entry.kind === "SOCIAL_RESIDUE" && entry.socialResidue?.event === "rook.contact_intervention") {
      socialResidues.push(
        Object.freeze({
          ledgerEntryId: entry.id,
          occurredAt: entry.occurredAt,
          tenantId: entry.tenantId,
          operatorUserId: entry.operatorUserId,
          residue: Object.freeze({
            ...entry.socialResidue,
            evidenceRefs: Object.freeze([...entry.socialResidue.evidenceRefs]),
          }),
        })
      );
      continue;
    }
    if (entry.kind === "FIRED_AUTHORED_BEAT" && entry.beatId) {
      firedAuthoredBeats.push(
        Object.freeze({
          ledgerEntryId: entry.id,
          beatId: entry.beatId,
          occurredAt: entry.occurredAt,
          offscreen: entry.offscreen,
          playerVisible: entry.playerVisible,
        })
      );
      continue;
    }
    if (entry.kind === "VERIFIED_GOLDLINE_OUTCOME") {
      verifiedGoldlineOutcomes.push(
        Object.freeze({
          ledgerEntryId: entry.id,
          occurredAt: entry.occurredAt,
          goldlineOutcomeId: entry.goldlineOutcomeId,
          relatedBeatId: entry.beatId,
        })
      );
    }
  }
  return Object.freeze({
    firedAuthoredBeats: Object.freeze(firedAuthoredBeats),
    verifiedGoldlineOutcomes: Object.freeze(verifiedGoldlineOutcomes),
    socialResidues: Object.freeze(socialResidues),
    knowledge: cloneKnowledge(snapshot.knowledge),
    narrativeStateValues: Object.freeze({ ...snapshot.narrativeState.values }),
    closedForwardPaths: Object.freeze([
      ...snapshot.narrativeState.closedForwardPaths,
    ]),
    holdOpenedAtMs: Object.freeze({
      ...snapshot.narrativeState.holdOpenedAtMs,
    }),
  });
}
