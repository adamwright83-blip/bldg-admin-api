import type { MitchGameProductionState, MitchWorkOrder } from "../../shared/mitchContracts";
import {
  KINGDOM_TWO_MILESTONE_INSTALL_DUEL,
  seedKingdomTwoProductionState,
} from "./kingdomTwoProduction";
import {
  SMALL_COMFORTS_GAME_ID,
  seedSmallComfortsProducerWork,
} from "./smallComfortsProduction";
import { seedExecutorSmokeOrder, withExecutorSmokeSeedLock } from "./executorSmokeOrder";
import type { MitchProductionService } from "./mitchService";
import type { IMitchProductionStore } from "./mitchStore";

export type MitchProducerPlan = {
  gameId: string;
  gameTitle: string;
  seed(): Promise<{
    state: MitchGameProductionState;
    workOrder: MitchWorkOrder | null;
  }>;
};

export function createMitchProducerPlan(input: {
  gameId: string;
  tenantId: string;
  store: IMitchProductionStore;
  service: MitchProductionService;
  baseBranch?: string;
  baseSha?: string;
  /** Opt-in (MITCH_EXECUTOR_SMOKE_ORDER=true): add one trivial order to prove the executor loop. */
  executorSmokeOrder?: boolean;
}): MitchProducerPlan {
  if (input.gameId === SMALL_COMFORTS_GAME_ID) {
    return {
      gameId: SMALL_COMFORTS_GAME_ID,
      gameTitle: "Small Comforts",
      seed: () =>
        seedSmallComfortsProducerWork({
          tenantId: input.tenantId,
          store: input.store,
          service: input.service,
          baseBranch: input.baseBranch,
          baseSha: input.baseSha,
        }),
    };
  }

  if (input.gameId !== "kingdom.boreslay")
    throw new Error(
      `Unsupported MITCH_GAME_ID "${input.gameId}". Mitch must attach to an explicit canonical game plan.`
    );

  return {
    gameId: "kingdom.boreslay",
    gameTitle: "Boreslay",
    seed: async () => withExecutorSmokeSeedLock({
      tenantId: input.tenantId,
      gameId: "kingdom.boreslay",
      enabled: input.executorSmokeOrder === true,
    }, async () => {
      const state = await seedKingdomTwoProductionState({
        tenantId: input.tenantId,
        store: input.store,
        service: input.service,
      });
      const milestone = await input.store.getMilestone(
        input.tenantId,
        "kingdom.boreslay",
        KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
      );
      if (!milestone)
        throw new Error("Kingdom Two producer milestone was not seeded");

      if (input.executorSmokeOrder) {
        const smoke = await seedExecutorSmokeOrder({
          tenantId: input.tenantId,
          gameId: "kingdom.boreslay",
          store: input.store,
          service: input.service,
          baseBranch: input.baseBranch,
          baseSha: input.baseSha,
        });
        // Smoke mode is isolated from the install-duel production lane.
        // On later ticks (or after smoke failure), do not fall through and mint
        // a different work order while this one-off probe is enabled.
        return { state, workOrder: smoke };
      }

      const orders = await input.store.listWorkOrders(
        input.tenantId,
        "kingdom.boreslay"
      );
      const existing =
        orders
          .filter(
            order =>
              order.milestoneKey ===
              KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
      if (existing) return { state, workOrder: existing };

      // The canonical Kingdom Two characterization deliberately starts blocked
      // until Adam authors the real-business binding. Never manufacture a
      // work order merely to make autonomous execution appear live.
      if (milestone.isHumanCreativeBlocker || milestone.status === "blocked")
        return { state, workOrder: null };

      const baseSha = input.baseSha?.trim();
      if (!baseSha || !/^[a-f0-9]{40}$/i.test(baseSha))
        throw new Error(
          "MITCH_GAME_BASE_SHA must be an exact 40-character commit before Kingdom Two can dispatch"
        );

      const workOrder = await input.service.createWorkOrder({
        tenantId: input.tenantId,
        gameId: "kingdom.boreslay",
        milestoneKey: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey,
        title: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.title,
        desiredPlayerVisibleResult:
          KINGDOM_TWO_MILESTONE_INSTALL_DUEL.desiredPlayerVisibleResult,
        acceptanceCriteria: [
          ...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.acceptanceCriteria,
        ],
        canonConstraints: [
          ...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.canonConstraints,
        ],
        relevantDependencies: [
          ...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.relevantDependencies,
        ],
        realBusinessEvidenceConstraints: [
          ...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.realBusinessEvidenceConstraints,
        ],
        baseBranch: input.baseBranch?.trim() || "main",
        baseSha,
        requiredArtifact:
          KINGDOM_TWO_MILESTONE_INSTALL_DUEL.requiredArtifact,
        requiredTests: [
          ...KINGDOM_TWO_MILESTONE_INSTALL_DUEL.requiredTests,
          "pnpm exec playwright test --config e2e/boreslay/playwright.config.ts",
          "pnpm check",
        ],
        requiredEvidence: [
          "Exact implementation branch and 40-character commit SHA",
          "Exact playable build or preview identity",
          "Independent Playwright gameplay exercise of the installed Kingdom Two path on the exact commit",
          "Evidence that match completion does not unlock Kingdom Three",
          "Known gameplay, UX, or integration limitations",
        ],
      });
      return { state, workOrder };
    }),
  };
}
