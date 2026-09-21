import { randomUUID } from "node:crypto";
import {
  InvalidNarrativeBeatIdError,
  type AuthoredBeat,
  type NarrativeBeatId,
  type NarrativeKnowledgeMutation,
  type NarrativeState,
} from "../../shared/narratorOs/contracts";
import { evaluateEligibility, type EligibilityInput } from "./eligibility";
import { getBeat, isKnownBeatId } from "./registry";
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

export async function commitFiredBeat(input: {
  store: NarratorStore;
  scope: OperatorScope;
  beatId: string;
  registryLookup?: (id: string) => AuthoredBeat | undefined;
  offscreen?: boolean;
  nowIso?: string;
}): Promise<NarratorSnapshot> {
  if (!isKnownBeatId(input.beatId) && !input.registryLookup) {
    throw new UnknownBeatLedgerError(input.beatId);
  }
  const beat = input.registryLookup
    ? input.registryLookup(input.beatId)
    : getBeat(input.beatId);
  if (!beat) throw new UnknownBeatLedgerError(input.beatId);
  if (beat.canonStatus === "OPEN") {
    throw new InvalidNarrativeBeatIdError(input.beatId);
  }
  assertMutationsLegal(beat);
  const snapshot = await input.store.load(input.scope);
  if (!snapshot) throw new Error("Narrator operator is not initialized");
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
  await input.store.replaceKnowledge(input.scope, knowledge);
  await input.store.replaceNarrativeState(input.scope, narrativeState);
  await input.store.appendLedger(input.scope, {
    kind: "FIRED_AUTHORED_BEAT",
    beatId: beat.id,
    goldlineOutcomeId: null,
    offscreen: input.offscreen === true,
    playerVisible: beat.playerVisibility,
    evidenceRef: null,
    occurredAt: input.nowIso ?? new Date().toISOString(),
    idempotencyKey: `beat:${beat.id}:${already ? randomUUID() : "once"}`,
  });
  const next = await input.store.load(input.scope);
  if (!next) throw new Error("Narrator operator disappeared after commit");
  return next;
}

export async function recordVerifiedGoldlineOutcome(input: {
  store: NarratorStore;
  scope: OperatorScope;
  outcomeId: string;
  evidenceRef: {
    sourceType: string;
    sourceReference: string;
    classification: "authoritative_external" | "operator_attested";
  };
  relatedBeatId?: NarrativeBeatId | null;
  nowIso?: string;
}): Promise<void> {
  if (input.relatedBeatId && !isKnownBeatId(input.relatedBeatId)) {
    throw new UnknownBeatLedgerError(input.relatedBeatId);
  }
  await input.store.appendLedger(input.scope, {
    kind: "VERIFIED_GOLDLINE_OUTCOME",
    beatId: input.relatedBeatId ?? null,
    goldlineOutcomeId: input.outcomeId,
    offscreen: false,
    playerVisible: false,
    evidenceRef: input.evidenceRef,
    occurredAt: input.nowIso ?? new Date().toISOString(),
    idempotencyKey: `goldline:${input.outcomeId}`,
  });
}

export async function fireOffscreenIfLegal(input: {
  store: NarratorStore;
  scope: OperatorScope;
  eligibility: EligibilityInput;
}): Promise<{ fired: readonly string[] }> {
  const offscreenInput: EligibilityInput = {
    ...input.eligibility,
    mode: "offscreen",
  };
  const result = evaluateEligibility(offscreenInput);
  const fired: string[] = [];
  if (result.outcome === "NO_ELIGIBLE") return { fired };
  const ids = [...result.eligibleBeatIds, ...result.withheldBeatIds];
  for (const beatId of ids) {
    const beat = offscreenInput.registry.find(entry => entry.id === beatId);
    if (!beat || beat.mayFireOffscreen !== true) continue;
    await commitFiredBeat({
      store: input.store,
      scope: input.scope,
      beatId,
      registryLookup: id =>
        offscreenInput.registry.find(entry => entry.id === id)!,
      offscreen: true,
    });
    fired.push(beatId);
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
