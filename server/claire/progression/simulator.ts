import { executePersonalTurn, type PersonalGenerator, type PersonalTurnResult } from "./personalReveal";
import { recordProgressionEvidence, refreshProgression } from "./service";
import { createInMemoryProgressionStore, type OperatorScope, type ProgressionStore } from "./store";
import { PROGRESSION_POLICY } from "./policy";

/**
 * NON-PRODUCTION disclosure simulator. Lets every rung be auditioned immediately
 * WITHOUT weakening production thresholds: it feeds synthetic evidence through the
 * SAME pure evaluator and personal-turn controller that production uses.
 *
 * Hard guards (all must hold; any failure throws, i.e. fails closed):
 *  1. NODE_ENV must not be "production" and no Railway production environment.
 *  2. CLAIRE_PROGRESSION_SIMULATOR must be exactly "1".
 *  3. The store must be an ephemeral in-memory store created here; a store whose
 *     kind is anything else (i.e. the production database) is refused.
 * This module deliberately imports NOTHING that touches the production
 * relationship store, the relationship emitters, or the Drizzle progression store
 * (a test proves that by reading this file's source).
 */

export const SIMULATION_MARK = "[SIMULATION]";
export const SIMULATION_SCOPE: OperatorScope = { tenantId: "SIMULATION", operatorUserId: "SIMULATION" };

export class SimulationNotAllowedError extends Error {
  constructor(reason: string) {
    super(`Progression simulator refused: ${reason}`);
    this.name = "SimulationNotAllowedError";
  }
}

export function assertSimulationAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production") throw new SimulationNotAllowedError("NODE_ENV is production");
  if ((env.RAILWAY_ENVIRONMENT_NAME ?? "").toLowerCase() === "production") {
    throw new SimulationNotAllowedError("running in the Railway production environment");
  }
  if (env.CLAIRE_PROGRESSION_SIMULATOR !== "1") {
    throw new SimulationNotAllowedError("CLAIRE_PROGRESSION_SIMULATOR=1 is required");
  }
}

function assertEphemeralStore(store: ProgressionStore): void {
  if (store.kind !== "in_memory") throw new SimulationNotAllowedError("store is not an ephemeral in-memory store");
}

export type SimulationState =
  | "rapport0_access0"
  | "high_rapport_access0"
  | "rung1"
  | "rung2"
  | "rung3";

const STATE_SPEC: Record<SimulationState, { actions: number; progress: Array<"strong" | "intermediate"> }> = {
  rapport0_access0: { actions: 0, progress: [] },
  high_rapport_access0: { actions: PROGRESSION_POLICY.rapport[2].minActions + 2, progress: [] },
  rung1: { actions: PROGRESSION_POLICY.rungs[0].minActions, progress: ["strong"] },
  rung2: { actions: PROGRESSION_POLICY.rungs[1].minActions, progress: ["strong", "intermediate"] },
  rung3: { actions: PROGRESSION_POLICY.rungs[2].minActions, progress: ["strong", "strong", "intermediate", "intermediate"] },
};

export type SimulationSession = {
  readonly mark: typeof SIMULATION_MARK;
  readonly store: ProgressionStore;
  readonly scope: OperatorScope;
  applyState(state: SimulationState): Promise<{ rapportBand: number; personalRung: number; entitlementsMinted: number }>;
  /** Simulates a NEW qualifying business-progress event (mints one entitlement if the rung allows). */
  addProgressEvent(kind?: string): Promise<void>;
  ask(input: { topic: string; conversationId: string; generate: PersonalGenerator; businessOpen?: boolean }): Promise<PersonalTurnResult & { marked: string }>;
};

export function createSimulationSession(options: { env?: Record<string, string | undefined>; store?: ProgressionStore } = {}): SimulationSession {
  assertSimulationAllowed(options.env ?? process.env);
  const store = options.store ?? createInMemoryProgressionStore();
  assertEphemeralStore(store);
  const scope = SIMULATION_SCOPE;
  const base = new Date(Date.UTC(2026, 0, 1, 15)).getTime();
  const at = (i: number) => new Date(base + i * 86_400_000);
  let seq = 0;
  // A simulated clock that only moves forward: later progress events are recognized AFTER earlier grants.
  let clock = base + 400 * 86_400_000;
  const now = () => new Date(clock);

  const addEvidence = async (category: "growth_action" | "business_progress", kind: string, i: number) => {
    await recordProgressionEvidence(store, {
      ...scope, category, kind, sourceType: "simulation", sourceId: `sim-${(seq += 1)}`,
      provenance: `${SIMULATION_MARK} synthetic`, occurredAt: at(i), recognizedAt: at(i),
    }, now);
  };

  return {
    mark: SIMULATION_MARK,
    store,
    scope,
    async applyState(state) {
      const spec = STATE_SPEC[state];
      for (let i = 0; i < spec.actions; i += 1) await addEvidence("growth_action", "confirmed_field_visit", i);
      // Business progress must occur on/after the progress epoch to qualify, like the real thing.
      const epochDay = Math.ceil((Date.parse(PROGRESSION_POLICY.progressEpoch) - base) / 86_400_000);
      for (const [i, strength] of spec.progress.entries()) {
        await addEvidence("business_progress", strength === "strong" ? "new_paying_customer" : "next_meeting_scheduled", epochDay + 1 + i);
      }
      const snap = await refreshProgression(store, scope, { disclosureSafetyOk: true, now });
      return { rapportBand: snap.grant.rapportBand, personalRung: snap.grant.personalRung, entitlementsMinted: snap.mintedEntitlementIds.length };
    },
    async addProgressEvent(kind = "new_paying_customer") {
      clock += 86_400_000; // a new day passes; the event is recognized on it
      await recordProgressionEvidence(store, {
        ...scope, category: "business_progress", kind, sourceType: "simulation", sourceId: `sim-${(seq += 1)}`,
        provenance: `${SIMULATION_MARK} synthetic`, occurredAt: now(), recognizedAt: now(),
      }, now);
      await refreshProgression(store, scope, { disclosureSafetyOk: true, now });
    },
    async ask(input) {
      const result = await executePersonalTurn({
        store, scope, conversationId: input.conversationId, topic: input.topic, generate: input.generate,
        businessOpen: input.businessOpen ?? true, now, autoCommit: true,
      });
      return { ...result, marked: `${SIMULATION_MARK} ${result.text}` };
    },
  };
}
