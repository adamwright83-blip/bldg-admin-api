/**
 * Shadow observation of a real, COMPLETED operator turn.
 *
 * V1 answers normally. V2 then observes the same completed utterance and a frozen
 * working-memory snapshot, produces its own candidate decision, and records a safe
 * comparison. That is all it does.
 *
 * V2 may NOT, here or anywhere else in this phase:
 *   - speak to the operator
 *   - mutate anything
 *   - hang up
 *   - alter V1 state
 *   - change production behaviour in any observable way
 *
 * Three properties make that structural rather than aspirational:
 *
 *  1. DEFAULT OFF. `CLAIRE_BRAIN_V2_SHADOW` must be explicitly set to "1"/"true".
 *     An unset or malformed value disables observation.
 *  2. CANNOT THROW. Every path is wrapped. A V2 failure must never surface in an
 *     operator's call, so errors are swallowed and counted, never rethrown.
 *  3. CANNOT DELAY. `observeShadowTurnDetached` returns synchronously and never
 *     rejects, so a caller cannot accidentally await V2 on the live path.
 *
 * Telemetry carries evidence IDS AND TYPES ONLY — never secrets, phone numbers,
 * credentials, provider identifiers, or raw provider payloads.
 */

import { runClaireBrainTurn, type ClaireBrainTurnInput } from "./runClaireBrainTurn";
import type { ShadowComparisonRecord } from "../telemetry/comparison";
import { liveReadOnlyRetrieval, noRetrieval, type ExecutiveDeps } from "../executive/decide";
import {
  shadowMemoryStore,
  updateShadowMemory,
  type ShadowMemoryStore,
} from "./shadowMemory";

/** What V1 actually did, for comparison. Text is compared by shape, not stored raw. */
export type V1Outcome = {
  endedCall: boolean;
  mutated: boolean;
  spokeSomething: boolean;
};

export type ShadowDisagreement =
  | "call_control"
  | "mutation_authority"
  | "spoke_vs_silent";

export type ShadowObservation = {
  observed: true;
  comparison: ShadowComparisonRecord;
  disagreements: ShadowDisagreement[];
  candidateEndCall: boolean;
  candidateActionClasses: string[];
};

export type ShadowSkipped = { observed: false; reason: "disabled" | "error" };

export type ShadowResult = ShadowObservation | ShadowSkipped;

export type ShadowSink = (observation: ShadowObservation) => void;

/**
 * Read-only readers the observer may use when the flag is ON.
 *
 * Retrieval stays INJECTED rather than defaulted: a bare brain call still reaches
 * nothing, and the observer is the one explicit caller allowed to supply live readers.
 * When the flag is OFF none of this is constructed, so no reads happen at all.
 */
export type ShadowRetrievalContext = {
  tenantId: string;
  operatorUserId: string;
  conversationId: string;
  timeZone: string;
  today: string;
  surface: "voice" | "text";
  /** Terms the executive may recall from the conversation ledger. */
  episodicTerms?: string[];
};

function liveExecutiveDeps(ctx: ShadowRetrievalContext): ExecutiveDeps {
  const nowIso = new Date().toISOString();
  return {
    retrieve: liveReadOnlyRetrieval({
      business: { tenantId: ctx.tenantId, operatorUserId: ctx.operatorUserId, nowIso },
      episodic: {
        tenantId: ctx.tenantId,
        operatorUserId: ctx.operatorUserId,
        nowIso,
        terms: ctx.episodicTerms ?? [],
      },
      // Self and Goals stay unsupplied until their read-only entry points are wired;
      // an unsupplied compartment returns nothing rather than reading something else.
    }),
    ctx: { timeZone: ctx.timeZone, today: ctx.today, surface: ctx.surface },
  };
}

function enabled(env: NodeJS.ProcessEnv): boolean {
  const flag = env.CLAIRE_BRAIN_V2_SHADOW;
  return flag === "1" || flag?.toLowerCase() === "true";
}

/** In-memory by default. A real sink may be injected; it must not be a new secret log. */
const recent: ShadowObservation[] = [];
const MAX_RECENT = 50;

export function recordedObservations(): readonly ShadowObservation[] {
  return recent;
}

export function clearRecordedObservations(): void {
  recent.length = 0;
}

function defaultSink(observation: ShadowObservation): void {
  recent.push(observation);
  if (recent.length > MAX_RECENT) recent.shift();
}

/**
 * Where the two minds disagree. This is the point of shadow mode: a disagreement is
 * a question to investigate, never a signal to change V1.
 */
export function compareOutcomes(
  candidate: { endCall: boolean; actionClasses: string[]; spoke?: boolean },
  v1: V1Outcome | null
): ShadowDisagreement[] {
  if (!v1) return [];
  const out: ShadowDisagreement[] = [];
  if (candidate.endCall !== v1.endedCall) out.push("call_control");
  // V2 holds no live grants, so any V1 mutation is by definition a divergence in authority.
  if (v1.mutated && candidate.actionClasses.length === 0) out.push("mutation_authority");
  // One mind had something to say and the other did not.
  if (candidate.spoke !== undefined && candidate.spoke !== v1.spokeSomething) out.push("spoke_vs_silent");
  return out;
}

/**
 * Observe one completed turn. Never throws.
 *
 * Returns `{ observed: false }` when shadow mode is off or anything at all went wrong.
 * The caller must treat the result as advisory telemetry and must not branch production
 * behaviour on it.
 */
export async function observeShadowTurn(
  input: ClaireBrainTurnInput & { v1?: V1Outcome | null; live?: ShadowRetrievalContext },
  options: { env?: NodeJS.ProcessEnv; sink?: ShadowSink; memory?: ShadowMemoryStore } = {}
): Promise<ShadowResult> {
  const env = options.env ?? process.env;
  // Nothing below runs while disabled: no brain, no model, no database reads.
  if (!enabled(env)) return { observed: false, reason: "disabled" };

  const memoryStore = options.memory ?? shadowMemoryStore;

  try {
    const { v1, live, ...turn } = input;

    // V2's own memory of ITS previous answers — separate from V1's conversation state.
    const shadowKey = `${turn.tenantId}:${turn.operatorUserId}:${turn.conversationKey}`;
    const priorMemory = await memoryStore.load(shadowKey);

    const executive = turn.executive ?? (live ? liveExecutiveDeps(live) : undefined);
    const result = await runClaireBrainTurn({
      ...turn,
      executive: executive ?? { retrieve: noRetrieval, ctx: { timeZone: "UTC", today: new Date().toISOString().slice(0, 10), surface: turn.surface } },
      state: {
        ...(turn.state ?? {}),
        // V2 continues its OWN resolved/presented thread, not V1's.
        orderedQuery: priorMemory?.orderedQuery ?? null,
      },
    });

    // Defence in depth: the runner already guarantees these, and we re-check anyway.
    if (result.productionAuthority !== false || result.mutations.length !== 0) {
      return { observed: false, reason: "error" };
    }

    const candidateActionClasses = result.decision.actionGrants.map(grant => grant.actionClass);
    const observation: ShadowObservation = {
      observed: true,
      comparison: result.comparison,
      disagreements: compareOutcomes(
        {
          endCall: result.candidateEndCall,
          actionClasses: candidateActionClasses,
          spoke: result.candidateSpeak.trim().length > 0,
        },
        v1 ?? null
      ),
      candidateEndCall: result.candidateEndCall,
      candidateActionClasses,
    };
    // Persist V2's cognitive state so the next real turn can continue this result.
    await memoryStore.save(shadowKey, updateShadowMemory(priorMemory, result.decision));

    (options.sink ?? defaultSink)(observation);
    return observation;
  } catch {
    // A V2 failure must never reach an operator's call.
    return { observed: false, reason: "error" };
  }
}

/**
 * Fire-and-forget entrypoint for a live transport.
 *
 * Returns void synchronously and never rejects, so a production caller structurally
 * cannot await V2, cannot slow the live turn, and cannot observe a V2 failure.
 */
export function observeShadowTurnDetached(
  input: ClaireBrainTurnInput & { v1?: V1Outcome | null; live?: ShadowRetrievalContext },
  options: { env?: NodeJS.ProcessEnv; sink?: ShadowSink; memory?: ShadowMemoryStore } = {}
): void {
  try {
    void observeShadowTurn(input, options).catch(() => undefined);
  } catch {
    /* observation must never disturb the live path */
  }
}
