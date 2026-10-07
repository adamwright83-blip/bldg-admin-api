
import { describe, expect, it } from "vitest";
import type { MitchExecutionHandback, MitchWorkOrder } from "../../shared/mitchContracts";
import { MitchGameDispatcher, type IMitchExecutionProvider } from "./mitchDispatcher";
import { MitchProducerCoordinator } from "./mitchProducerCoordinator";
import { createMitchProducerPlan } from "./mitchProducerPlans";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import { MitchQaService } from "./mitchQaService";
import { MitchProductionService } from "./mitchService";
import { MitchProductionStore } from "./mitchStore";
import type { GitHubProducerBus } from "./githubProducerBus";

class ImmediateExecutor implements IMitchExecutionProvider {
  readonly id = "test-claude";
  readonly name = "Test Claude";
  readonly leaseMs = 60_000;

  async isAvailable() {
    return true;
  }

  async executeWorkOrder(order: MitchWorkOrder): Promise<MitchExecutionHandback> {
    return {
      branch: "feat/small-comforts-proprietor-spike",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
      exactBuildId: "abcdef1234567890abcdef1234567890abcdef12",
      whatChanged: "The proprietor walks the shelf, hauls one object home, and changes a resident routine.",
      testsActuallyRun: ["pnpm vitest run server/mitch/mitchNativeProducer.test.ts"],
      testsNotRun: ["manual phone pass"],
      previewLaunchInstructions: "Open the proprietor preview.",
      evidence: { capture: "artifact-proprietor-proof-12345678" },
      knownLimitations: "Human fun judgment still required.",
    };
  }
}

class FakeBus {
  comments: string[] = [];
  async hasMarker(marker: string) {
    return this.comments.some(body => body.includes("<!-- " + marker + " -->"));
  }
  async postComment(body: string) {
    this.comments.push(body);
    return {
      id: this.comments.length,
      html_url: "https://example.test/comment/" + this.comments.length,
      body,
      created_at: new Date().toISOString(),
    };
  }
  async readDesignReview() {
    return null;
  }
}

describe("Mitch native Small Comforts producer coordination", () => {
  it("dispatches a durable work order then routes the exact build to design review without creative auto-acceptance", async () => {
    const store = new MitchProductionStore(true);
    const service = new MitchProductionService(store);
    const dispatcher = new MitchGameDispatcher(store);
    dispatcher.registerExecutionProvider(new ImmediateExecutor());
    const reasoning = new MitchProductionReasoningService(store);
    const qa = new MitchQaService(store);
    const bus = new FakeBus();

    const plan = createMitchProducerPlan({
      gameId: "game.small_comforts",
      tenantId: "tenant-small-comforts-test",
      store,
      service,
      baseBranch: "feat/small-comforts-proprietor-spike",
      baseSha: "f4d2f81036fdc1b348bd679fb58eb63059efde42",
    });
    const coordinator = new MitchProducerCoordinator({
      tenantId: "tenant-small-comforts-test",
      store,
      service,
      dispatcher,
      reasoning,
      qa,
      bus: bus as unknown as GitHubProducerBus,
      gameId: plan.gameId,
      gameTitle: plan.gameTitle,
      seedProductionWork: plan.seed,
    });

    const first = await coordinator.runOnce();
    expect(first.action).toBe("dispatched");

    const inspectionAfterImplementation = await reasoning.inspectProductionState(
      "tenant-small-comforts-test",
      "game.small_comforts"
    );
    expect(inspectionAfterImplementation.currentAvailableBuildId).toBe(
      "abcdef1234567890abcdef1234567890abcdef12"
    );
    expect(inspectionAfterImplementation.lastVerifiedBuildId).toBeNull();
    expect(inspectionAfterImplementation.nextBoundedOutcome.recommendedAction).toBe(
      "perform_gameplay_qa"
    );

    const second = await coordinator.runOnce();
    expect(second.action).toBe("design_review_requested");
    expect(bus.comments.some(body => body.includes("MITCH → CHATGPT"))).toBe(true);

    const state = await store.getProductionState(
      "tenant-small-comforts-test",
      "game.small_comforts"
    );
    expect(state?.creativeAcceptanceState).toBe("pending");
    expect(state?.releaseState).toBe("unreleased");
  });
});
