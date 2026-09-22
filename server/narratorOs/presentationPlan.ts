import type { AuthoredBeat } from "../../shared/narratorOs/contracts";
import {
  authoredReactionReceipt,
  type AuthoredReactionReceipt,
} from "./narrativeReadModels";
import { isAuthoritativeNarratorSnapshot } from "./narratorSnapshotAttestation";
import { getBeat } from "./registry";
import { planeKnows, type NarratorSnapshot } from "./store";

/**
 * Read-only presentation contract.
 *
 * A plan is not eligibility, dramaturgy, or execution authorization.
 * It cannot create facts. It is derived only from a FIRED_AUTHORED_BEAT
 * row, the registered beat, the current knowledge planes, the beat's
 * authored disclosure rules, and the Slice G reaction receipt.
 *
 * Axes stay independent:
 * beat occurred ≠ player may see it ≠ Claire knows it ≠ Claire may
 * disclose it ≠ Claire spoke it ≠ the player heard it.
 */

export type NarrativePresentationPlan = {
  readonly occurrenceLedgerEntryId: string;
  readonly beatId: string;
  readonly occurredAt: string;
  readonly presentationId: string;
  readonly player: {
    readonly maySurface: boolean;
    readonly title: string | null;
  };
  readonly claire: {
    readonly knows: boolean;
    readonly mayDisclose: boolean;
    readonly maySpeak: boolean;
  };
  readonly authoredReaction: AuthoredReactionReceipt;
  readonly authoredSourceRef: string;
};

export function presentationIdForOccurrence(
  occurrenceLedgerEntryId: string
): string {
  return `presentation:${occurrenceLedgerEntryId}`;
}

const trustedNarrativePresentationPlans = new WeakSet<object>();

function assertPresentationPlanTestIssuanceAllowed(): void {
  const nodeEnv = process.env.NODE_ENV;
  const inVitest = Boolean(process.env.VITEST);
  if (nodeEnv === "test" || inVitest) return;
  throw new Error(
    "NarrativePresentationPlan test issuance is not available outside tests"
  );
}

/**
 * Membership is the authority. A structurally identical object, including a
 * spread or JSON clone, is not a member. Production derive is the only
 * issuer outside tests. This remember is env-gated and is not exported from
 * the Narrator index.
 */
export function rememberNarrativePresentationPlanForTests(
  plan: NarrativePresentationPlan
): NarrativePresentationPlan {
  assertPresentationPlanTestIssuanceAllowed();
  const frozen = Object.freeze({
    ...plan,
    player: Object.freeze({ ...plan.player }),
    claire: Object.freeze({ ...plan.claire }),
    authoredReaction: plan.authoredReaction,
  });
  trustedNarrativePresentationPlans.add(frozen);
  return frozen;
}

export function isTrustedNarrativePresentationPlan(
  value: unknown
): value is NarrativePresentationPlan {
  return (
    typeof value === "object" &&
    value !== null &&
    trustedNarrativePresentationPlans.has(value)
  );
}

/**
 * OPEN and INCOMPLETE beats are not a valid fired presentation, even if a
 * ledger row names them. Omission of a disclosure rule is not permission.
 */
export function authoredBeatMayPresent(
  beat: Pick<AuthoredBeat, "canonStatus" | "eligibilityDefinition">
): boolean {
  return (
    beat.canonStatus !== "OPEN" && beat.eligibilityDefinition === "COMPLETE"
  );
}

function claireKnowsAuthoredFacts(
  snapshot: NarratorSnapshot,
  beat: AuthoredBeat
): boolean {
  const mutations = beat.knowledgeMutations.filter(
    mutation => mutation.plane === "CLAIRE"
  );
  if (mutations.length === 0) return false;
  return mutations.every(mutation => {
    if (mutation.op === "set_interpretation") {
      return (
        typeof snapshot.knowledge.planes.CLAIRE.interpretations[
          mutation.factId
        ] === "string"
      );
    }
    return planeKnows(snapshot.knowledge, "CLAIRE", mutation.factId);
  });
}

/**
 * Authored Claire disclosure only. Knowledge is not permission. A rule for
 * another plane, a missing rule, or a rule without an authored source
 * fails closed. Claire being a character, a player-visible flag, or a
 * title does not disclose.
 */
function claireDisclosurePermitted(beat: AuthoredBeat): boolean {
  return beat.disclosureRules.some(
    rule =>
      rule.plane === "CLAIRE" &&
      rule.mayDisclose === true &&
      typeof rule.authoredSourceRef === "string" &&
      rule.authoredSourceRef.trim().length > 0
  );
}

export function deriveNarrativePresentationPlan(
  snapshot: NarratorSnapshot,
  occurrenceLedgerEntryId: string
): NarrativePresentationPlan | null {
  if (!isAuthoritativeNarratorSnapshot(snapshot)) return null;
  const receipt = authoredReactionReceipt(snapshot, occurrenceLedgerEntryId);
  if (!receipt) return null;
  let beat: AuthoredBeat;
  try {
    beat = getBeat(receipt.beatId);
  } catch {
    return null;
  }
  if (!authoredBeatMayPresent(beat)) return null;
  if (beat.id !== receipt.beatId) return null;
  const entry = snapshot.ledger.find(row => row.id === occurrenceLedgerEntryId);
  if (!entry || entry.kind !== "FIRED_AUTHORED_BEAT" || !entry.beatId) {
    return null;
  }
  const knows = claireKnowsAuthoredFacts(snapshot, beat);
  const mayDisclose = claireDisclosurePermitted(beat);
  const maySurface =
    entry.playerVisible === true && beat.playerVisibility === true;
  const plan = Object.freeze({
    occurrenceLedgerEntryId: entry.id,
    beatId: beat.id,
    occurredAt: entry.occurredAt,
    presentationId: presentationIdForOccurrence(entry.id),
    player: Object.freeze({
      maySurface,
      title: beat.title,
    }),
    claire: Object.freeze({
      knows,
      mayDisclose,
      maySpeak: knows && mayDisclose,
    }),
    authoredReaction: receipt,
    authoredSourceRef: beat.authoredSourceRef,
  });
  trustedNarrativePresentationPlans.add(plan);
  return plan;
}
