import {
  type AuthoredBeat,
  type NarrativeBeatId,
  type NarrativeEventLedgerEntry,
  type NarrativeKnowledgeMutation,
  type NarrativeState,
} from "../../shared/narratorOs/contracts";
import { decideDramaturgy } from "./dramaturgy";
import {
  evaluateProductionEligibility,
  isEligibilityAuthorization,
  issueEligibilityAuthorizations,
  type EligibilityAuthorization,
  type EligibilityInput,
} from "./eligibility";
import { M03_BEAT_ID, nextM03OccurrenceIdempotencyKey } from "./m03Readiness";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  getBeat,
  isKnownBeatId,
} from "./registry";
import { goldlineLedgerIdempotencyKey } from "./goldlineReceiptIdentity";
import { ConflictingGoldlineLedgerReplayError } from "./goldlineLedgerReplay";
import {
  persistableVerifiedGoldlineReceipt,
  productionVerifiedGoldlineEvidence,
} from "./verifiedGoldlinePersistence";
import {
  isUpstreamIssuedVerifiedGoldlineReceipt,
  type VerifiedGoldlineReceipt,
} from "./verifiedGoldlineReceipt";
import {
  NonRepeatableReplayError,
  UnknownBeatLedgerError,
  applyKnowledgeWrite,
  planeKnows,
  type KnowledgeWrite,
  type NarratorSnapshot,
  type NarratorStore,
  type OperatorScope,
} from "./store";

export class ProhibitedKnowledgeMutationError extends Error {
  constructor(factId: string, beatId: string) {
    super(`Beat ${beatId} cannot establish prohibited knowledge ${factId}`);
    this.name = "ProhibitedKnowledgeMutationError";
  }
}

export class IneligibleBeatCommitError extends Error {
  constructor(beatId: string, reason: string) {
    super(`Cannot commit beat ${beatId}: ${reason}`);
    this.name = "IneligibleBeatCommitError";
  }
}

/**
 * Interactive commit reloaded a snapshot whose production dramaturgy does
 * not SELECT this authorized beat. No knowledge, state, or ledger write.
 */
export class LiveDramaturgyMismatchError extends IneligibleBeatCommitError {
  constructor(beatId: string) {
    super(beatId, "live dramaturgy does not select this beat");
    this.name = "LiveDramaturgyMismatchError";
  }
}

function mutationsFromBeat(beat: AuthoredBeat): KnowledgeWrite[] {
  return beat.knowledgeMutations.map((mutation: NarrativeKnowledgeMutation) => {
    if (mutation.op === "set_interpretation") {
      return {
        plane: mutation.plane,
        factId: mutation.factId,
        op: "set_interpretation" as const,
        interpretation: mutation.interpretation ?? "",
      };
    }
    return {
      plane: mutation.plane,
      factId: mutation.factId,
      op: "learn" as const,
      kind: mutation.kind,
    };
  });
}

export function assertMutationsLegal(beat: AuthoredBeat): void {
  for (const mutation of beat.knowledgeMutations) {
    if (beat.prohibitedKnowledgeFactIds.includes(mutation.factId)) {
      throw new ProhibitedKnowledgeMutationError(mutation.factId, beat.id);
    }
  }
}

/**
 * Production mutation. Raw beat ids are not authority. Re-evaluates
 * eligibility against the reloaded snapshot. Interactive commits also
 * rerun production dramaturgy on that same snapshot and write only when
 * it SELECTs this authorized beat. Offscreen commits do not consult
 * dramaturgy. Then writes knowledge + state + ledger atomically.
 */
export async function commitAuthorizedBeat(input: {
  store: NarratorStore;
  scope: OperatorScope;
  authorization: EligibilityAuthorization;
  eligibility: EligibilityInput;
  nowIso?: string;
  /**
   * Receives the ledger row this commit wrote or resolved. Existing callers
   * omit it. The return value stays the reloaded snapshot.
   */
  onCommittedLedgerEntry?: (entry: NarrativeEventLedgerEntry) => void;
}): Promise<NarratorSnapshot> {
  if (!isEligibilityAuthorization(input.authorization)) {
    throw new IneligibleBeatCommitError(
      String((input.authorization as { beatId?: string })?.beatId ?? "unknown"),
      "missing eligibility authorization"
    );
  }
  const authorization = input.authorization;
  if (
    authorization.tenantId !== input.scope.tenantId ||
    authorization.operatorUserId !== input.scope.operatorUserId
  ) {
    throw new IneligibleBeatCommitError(
      authorization.beatId,
      "authorization scope mismatch"
    );
  }
  if (authorization.mode !== input.eligibility.mode) {
    throw new IneligibleBeatCommitError(
      authorization.beatId,
      "authorization mode mismatch"
    );
  }

  const snapshot = await input.store.load(input.scope);
  if (!snapshot) throw new Error("Narrator operator is not initialized");

  if (!isKnownBeatId(authorization.beatId)) {
    throw new UnknownBeatLedgerError(authorization.beatId);
  }

  const liveInput: EligibilityInput = {
    snapshot,
    verifiedGoldline: productionVerifiedGoldlineEvidence(
      snapshot,
      input.eligibility.verifiedGoldline
    ),
    nowMs: input.eligibility.nowMs,
    mode: input.eligibility.mode,
    registry: AUTHORED_BEATS,
    graph: AUTHORED_GRAPH,
  };
  const result = evaluateProductionEligibility(liveInput);
  if (!result.eligibleBeatIds.includes(authorization.beatId)) {
    const audit = result.audit.find(
      entry => entry.beatId === authorization.beatId
    );
    throw new IneligibleBeatCommitError(
      authorization.beatId,
      `not eligible (${audit?.failedGates.join(",") || result.outcome})`
    );
  }

  if (liveInput.mode === "interactive") {
    const liveDecision = decideDramaturgy({ eligibility: result });
    if (
      liveDecision.outcome !== "SELECT" ||
      liveDecision.selectedBeatId !== authorization.beatId
    ) {
      throw new LiveDramaturgyMismatchError(authorization.beatId);
    }
  }

  const beat = getBeat(authorization.beatId);
  if (beat.canonStatus === "OPEN") {
    throw new IneligibleBeatCommitError(beat.id, "OPEN beats cannot fire");
  }
  if (beat.eligibilityDefinition !== "COMPLETE") {
    throw new IneligibleBeatCommitError(
      beat.id,
      "incomplete eligibility definition"
    );
  }
  if (liveInput.mode === "offscreen" && beat.mayFireOffscreen !== true) {
    throw new IneligibleBeatCommitError(
      beat.id,
      "offscreen is not permitted for this beat"
    );
  }
  assertMutationsLegal(beat);

  const already = snapshot.ledger.some(
    entry => entry.kind === "FIRED_AUTHORED_BEAT" && entry.beatId === beat.id
  );
  if (already && beat.repeatability === "non_repeatable") {
    throw new NonRepeatableReplayError(beat.id);
  }

  let knowledge = snapshot.knowledge;
  for (const write of mutationsFromBeat(beat)) {
    knowledge = applyKnowledgeWrite(knowledge, write);
  }
  const values = { ...snapshot.narrativeState.values };
  for (const mutation of beat.stateMutations) {
    values[mutation.key] = mutation.value;
  }
  const narrativeState: NarrativeState = {
    ...snapshot.narrativeState,
    values,
  };

  let idempotencyKey = `beat:${beat.id}:once`;
  if (beat.id === M03_BEAT_ID) {
    const occurrence = nextM03OccurrenceIdempotencyKey(
      liveInput.verifiedGoldline,
      snapshot
    );
    if (!occurrence) {
      throw new IneligibleBeatCommitError(
        beat.id,
        "no unconsumed same-target M03 RETURN"
      );
    }
    idempotencyKey = occurrence;
  }

  const committedEntry = await input.store.commitAtomic(input.scope, {
    knowledge,
    narrativeState,
    ledgerEntry: {
      kind: "FIRED_AUTHORED_BEAT",
      beatId: beat.id,
      goldlineOutcomeId: null,
      offscreen: liveInput.mode === "offscreen",
      playerVisible: beat.playerVisibility,
      evidenceRef: null,
      occurredAt: input.nowIso ?? new Date().toISOString(),
      idempotencyKey,
    },
  });
  input.onCommittedLedgerEntry?.(committedEntry);
  const next = await input.store.load(input.scope);
  if (!next) throw new Error("Narrator operator disappeared after commit");
  return next;
}

/** @deprecated Raw beat ids are not authority. Use commitAuthorizedBeat. */
export async function commitFiredBeat(input: {
  store: NarratorStore;
  scope: OperatorScope;
  beatId: string;
  registryLookup?: (id: string) => AuthoredBeat | undefined;
  offscreen?: boolean;
  nowIso?: string;
}): Promise<NarratorSnapshot> {
  throw new IneligibleBeatCommitError(
    input.beatId,
    "raw beat id is not authority; evaluate eligibility and commitAuthorizedBeat"
  );
}

export { ConflictingGoldlineLedgerReplayError };

export class UntrustedGoldlineReceiptError extends Error {
  constructor(detail: string) {
    super(`Narrator cannot persist untrusted Goldline evidence: ${detail}`);
    this.name = "UntrustedGoldlineReceiptError";
  }
}

/**
 * Persist an already-authorized upstream receipt into Narrator's ledger.
 * Does not mint, upgrade, or reinterpret verification authority.
 * Uses ledger append only: knowledge, narrative state, WORLD_TRUTH, and
 * Claire lived biography are not rewritten. Does not fire a beat.
 */
export async function recordVerifiedGoldlineOutcome(input: {
  store: NarratorStore;
  scope: OperatorScope;
  receipt: VerifiedGoldlineReceipt;
  relatedBeatId?: NarrativeBeatId | null;
  nowIso?: string;
}): Promise<void> {
  if (!isUpstreamIssuedVerifiedGoldlineReceipt(input.receipt)) {
    throw new UntrustedGoldlineReceiptError("missing authorized receipt");
  }
  const receipt = input.receipt;
  if (
    receipt.tenantId !== input.scope.tenantId ||
    receipt.operatorUserId !== input.scope.operatorUserId
  ) {
    throw new UntrustedGoldlineReceiptError("receipt scope mismatch");
  }
  if (input.relatedBeatId && !isKnownBeatId(input.relatedBeatId)) {
    throw new UnknownBeatLedgerError(input.relatedBeatId);
  }
  const snapshot = await input.store.load(input.scope);
  if (!snapshot) throw new Error("Narrator operator is not initialized");
  await input.store.appendLedger(input.scope, {
    kind: "VERIFIED_GOLDLINE_OUTCOME",
    beatId: input.relatedBeatId ?? null,
    goldlineOutcomeId: receipt.outcomeId,
    offscreen: false,
    playerVisible: false,
    evidenceRef: {
      sourceType: receipt.evidenceRef.sourceType,
      sourceReference: receipt.evidenceRef.sourceReference,
      classification: receipt.evidenceRef.classification,
    },
    occurredAt: input.nowIso ?? new Date(receipt.occurredAtMs).toISOString(),
    idempotencyKey: goldlineLedgerIdempotencyKey(receipt.receiptId),
    persistedVerifiedGoldline: persistableVerifiedGoldlineReceipt(receipt),
  });
}

export async function fireOffscreenIfLegal(input: {
  store: NarratorStore;
  scope: OperatorScope;
  eligibility: EligibilityInput;
}): Promise<{ fired: readonly string[] }> {
  const offscreenInput: EligibilityInput = {
    snapshot: input.eligibility.snapshot,
    verifiedGoldline: productionVerifiedGoldlineEvidence(
      input.eligibility.snapshot,
      input.eligibility.verifiedGoldline
    ),
    nowMs: input.eligibility.nowMs,
    mode: "offscreen",
    registry: AUTHORED_BEATS,
    graph: AUTHORED_GRAPH,
  };
  const result = evaluateProductionEligibility(offscreenInput);
  if (result.outcome !== "ELIGIBLE") return { fired: [] };
  const authorizations = issueEligibilityAuthorizations(result, offscreenInput);
  const fired: string[] = [];
  for (const authorization of authorizations) {
    if (!isKnownBeatId(authorization.beatId)) continue;
    const beat = getBeat(authorization.beatId);
    if (beat.mayFireOffscreen !== true) continue;
    await commitAuthorizedBeat({
      store: input.store,
      scope: input.scope,
      authorization,
      eligibility: offscreenInput,
    });
    fired.push(authorization.beatId);
  }
  return { fired };
}

export function applyQuietClose(
  state: NarrativeState,
  pathId: string,
  authoredCloses: boolean
): NarrativeState {
  if (!authoredCloses) return state;
  if (state.closedForwardPaths.includes(pathId)) return state;
  return {
    ...state,
    closedForwardPaths: [...state.closedForwardPaths, pathId],
  };
}

export function applyElapsedTime(
  state: NarrativeState,
  nowMs: number,
  windows: readonly {
    key: string;
    durationMs: number | null;
    pathId: string;
    canonStatus: "LOCKED" | "WORKING" | "OPEN";
  }[]
): { state: NarrativeState; createdEvents: false } {
  let next = state;
  for (const window of windows) {
    if (window.durationMs === null || window.canonStatus === "OPEN") continue;
    const opened = state.holdOpenedAtMs[window.key];
    if (opened === undefined) continue;
    if (nowMs - opened >= window.durationMs) {
      next = applyQuietClose(next, window.pathId, true);
    }
  }
  return { state: next, createdEvents: false };
}

export function disclosureDoesNotTeachClaire(
  snapshot: NarratorSnapshot,
  factId: string
): boolean {
  return !planeKnows(snapshot.knowledge, "CLAIRE", factId);
}
