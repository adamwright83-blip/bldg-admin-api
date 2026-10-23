import type { MitchWorkOrder } from "../../shared/mitchContracts";
import type { MitchProductionService } from "./mitchService";
import type { IMitchProductionStore } from "./mitchStore";

/**
 * A deliberately trivial, bounded work order used to prove the executor →
 * handback → independent-review loop end to end. Off unless the producer sets
 * MITCH_EXECUTOR_SMOKE_ORDER=true.
 *
 * It lives on its own milestone (sequence 0) so it never becomes a build of
 * k2_install_boreslay_duel_progression and can never touch the human-blocked
 * k2_author_real_business_binding milestone.
 */
export const KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE = {
  milestoneKey: "k2_executor_smoke_duel_scoring_test",
  sequence: 0,
  title: "Executor smoke: one deterministic Boreslay scoring test",
  desiredPlayerVisibleResult:
    "No player-visible change. A single extra deterministic unit test pins existing Boreslay Rally scoring behavior.",
  acceptanceCriteria: [
    "Exactly one new `it(...)` case is added to client/src/components/boreslay-rally/rallyScoring.test.ts",
    "The new test asserts scoring behavior the file does not already assert and is deterministic (no timers, randomness, or network)",
    "No file other than rallyScoring.test.ts is modified",
    "`pnpm exec vitest run client/src/components/boreslay-rally/rallyScoring.test.ts` passes",
  ],
} as const;

/**
 * Creates the smoke milestone and at most one work order for it, ever. A failed
 * or finished smoke order is never recreated: a failure here is evidence for a
 * human, not something to retry in a loop.
 */
export async function seedExecutorSmokeOrder(input: {
  tenantId: string;
  gameId: string;
  store: IMitchProductionStore;
  service: MitchProductionService;
  baseBranch?: string;
  baseSha?: string;
}): Promise<MitchWorkOrder | null> {
  const def = KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE;
  await input.service.registerMilestone({
    tenantId: input.tenantId,
    gameId: input.gameId,
    milestoneKey: def.milestoneKey,
    sequence: def.sequence,
    title: def.title,
    desiredPlayerVisibleResult: def.desiredPlayerVisibleResult,
    acceptanceCriteria: [...def.acceptanceCriteria],
  });

  const orders = await input.store.listWorkOrders(input.tenantId, input.gameId);
  if (orders.some(order => order.milestoneKey === def.milestoneKey)) return null;

  const baseSha = input.baseSha?.trim();
  if (!baseSha || !/^[a-f0-9]{40}$/i.test(baseSha))
    throw new Error(
      "MITCH_GAME_BASE_SHA must be an exact 40-character commit before the executor smoke order can dispatch"
    );

  return input.service.createWorkOrder({
    tenantId: input.tenantId,
    gameId: input.gameId,
    milestoneKey: def.milestoneKey,
    title: def.title,
    desiredPlayerVisibleResult: def.desiredPlayerVisibleResult,
    acceptanceCriteria: [...def.acceptanceCriteria],
    canonConstraints: [
      "Test-only change. Do not alter Boreslay Rally scoring, physics, or boss behavior.",
      "Do not touch kingdom binding, campaign, or real-business code.",
    ],
    relevantDependencies: [
      "client/src/components/boreslay-rally/rallyScoring.test.ts",
      "client/src/components/boreslay-rally/rallyEngine.ts",
    ],
    realBusinessEvidenceConstraints: [
      "Mitch must never fabricate business evidence. This order produces none.",
    ],
    baseBranch: input.baseBranch?.trim() || "main",
    baseSha,
    requiredArtifact: "client/src/components/boreslay-rally/rallyScoring.test.ts",
    requiredTests: [
      "pnpm exec vitest run client/src/components/boreslay-rally/rallyScoring.test.ts",
    ],
    requiredEvidence: [
      "Exact implementation branch and 40-character commit SHA",
      "Name of the single added test and the scoring behavior it pins",
      "Confirmation that only rallyScoring.test.ts changed",
    ],
  });
}
