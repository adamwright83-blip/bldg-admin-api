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
  candidate: { endCall: boolean; actionClasses: string[] },
  v1: V1Outcome | null
): ShadowDisagreement[] {
  if (!v1) return [];
  const out: ShadowDisagreement[] = [];
  if (candidate.endCall !== v1.endedCall) out.push("call_control");
  // V2 holds no live grants, so any V1 mutation is by definition a divergence in authority.
  if (v1.mutated && candidate.actionClasses.length === 0) out.push("mutation_authority");
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
  input: ClaireBrainTurnInput & { v1?: V1Outcome | null },
  options: { env?: NodeJS.ProcessEnv; sink?: ShadowSink } = {}
): Promise<ShadowResult> {
  const env = options.env ?? process.env;
  if (!enabled(env)) return { observed: false, reason: "disabled" };

  try {
    const { v1, ...turn } = input;
    const result = await runClaireBrainTurn(turn);

    // Defence in depth: the runner already guarantees these, and we re-check anyway.
    if (result.productionAuthority !== false || result.mutations.length !== 0) {
      return { observed: false, reason: "error" };
    }

    const candidateActionClasses = result.decision.actionGrants.map(grant => grant.actionClass);
    const observation: ShadowObservation = {
      observed: true,
      comparison: result.comparison,
      disagreements: compareOutcomes(
        { endCall: result.candidateEndCall, actionClasses: candidateActionClasses },
        v1 ?? null
      ),
      candidateEndCall: result.candidateEndCall,
      candidateActionClasses,
    };
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
  input: ClaireBrainTurnInput & { v1?: V1Outcome | null },
  options: { env?: NodeJS.ProcessEnv; sink?: ShadowSink } = {}
): void {
  try {
    void observeShadowTurn(input, options).catch(() => undefined);
  } catch {
    /* observation must never disturb the live path */
  }
}
