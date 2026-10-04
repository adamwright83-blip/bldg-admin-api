import { eventContract } from "../../shared/mitchEvents";

import type { MitchExecutionHandback, MitchWorkOrder } from "../../shared/mitchContracts";
import { workOrderDispatchMarker, handbackMarker } from "../../shared/mitchProducerBus";
import type { IMitchExecutionProvider } from "./mitchDispatcher";
import { GitHubProducerBus } from "./githubProducerBus";

export type GitHubProducerExecutionProviderOptions = {
  id?: string;
  name?: string;
  pollMs?: number;
  timeoutMs?: number;
  leaseMs?: number;
};

export class GitHubProducerExecutionProvider implements IMitchExecutionProvider {
  readonly id: string;
  readonly name: string;
  readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly bus: GitHubProducerBus,
    options: GitHubProducerExecutionProviderOptions = {}
  ) {
    this.id = options.id ?? "github-producer-bus:claude";
    this.name = options.name ?? "Claude via Mitch GitHub Producer Bus";
    this.pollMs = options.pollMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? 45 * 60 * 1000;
    this.leaseMs = options.leaseMs ?? Math.max(this.timeoutMs + 10 * 60 * 1000, 60 * 60 * 1000);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.bus.listComments();
      return true;
    } catch {
      return false;
    }
  }

  async dispatchWorkOrder(order: MitchWorkOrder): Promise<void> {
    const marker = workOrderDispatchMarker(order.id);
    if (!(await this.bus.hasMarker(marker))) {
      const handback = handbackMarker(order.id);
      const body = [
        "## MITCH → CLAUDE",
        "<!-- " + marker + " -->",
        "",
        "**Work order:** " + order.id,
        "**Game:** " + order.gameId,
        "**Milestone:** " + order.milestoneKey,
        "**Exact base:** " + order.baseBranch + "@" + order.baseSha,
        "",
        "### Player-visible result",
        order.desiredPlayerVisibleResult,
        "",
        "### Acceptance criteria",
        ...order.acceptanceCriteria.map(item => "- " + item),
        "",
        "### Canon constraints",
        ...(order.canonConstraints.length ? order.canonConstraints.map(item => "- " + item) : ["- None beyond the work-order contract."]),
        "",
        "### Relevant dependencies",
        ...(order.relevantDependencies.length ? order.relevantDependencies.map(item => "- " + item) : ["- None listed."]),
        "",
        "### Required tests",
        ...order.requiredTests.map(item => "- " + item),
        "",
        "### Required evidence",
        ...(order.requiredEvidence.length ? order.requiredEvidence.map(item => "- " + item) : ["- Exact branch/SHA plus playable evidence when applicable."]),
        "",
        "### Guardrails",
        "- Do not merge to main.",
        "- Do not invent creative acceptance.",
        "- Keep IMPLEMENTED ≠ VERIFIED ≠ CREATIVE-ACCEPTED ≠ RELEASED.",
        "",
        "### Event-driven handback (mandatory)",
        eventContract(order, this.id, "implementation_handback", { handback: {
          branch: "your-branch", commitSha: "FULL_40_CHARACTER_SHA", exactBuildId: "FULL_40_CHARACTER_SHA",
          whatChanged: "player-visible summary", testsActuallyRun: ["command and result"], testsNotRun: [],
          previewLaunchInstructions: "exact launch instructions", evidence: { captures: [], sourceCompiled: false, unitTestsPassed: false, buildCommitSha: "FULL_40_CHARACTER_SHA" }, knownLimitations: ""
        } }),
      ].join("\n");
      await this.bus.postComment(body);
    }

  }

  /** Legacy recovery interface; normal runtime uses dispatchWorkOrder plus event ingress. */
  async executeWorkOrder(order: MitchWorkOrder): Promise<MitchExecutionHandback> {
    await this.dispatchWorkOrder(order);
    const result = await this.bus.waitForHandback({
      workOrderId: order.id,
      after: order.claimedAt,
      pollMs: this.pollMs,
      timeoutMs: this.timeoutMs
    });

    return {
      branch: result.payload.branch,
      commitSha: result.payload.commitSha,
      exactBuildId: result.payload.exactBuildId ?? result.payload.commitSha,
      whatChanged: result.payload.whatChanged,
      testsActuallyRun: result.payload.testsActuallyRun,
      testsNotRun: result.payload.testsNotRun,
      previewLaunchInstructions: result.payload.previewLaunchInstructions,
      evidence: {
        ...result.payload.evidence,
        producerBusCommentUrl: result.comment.html_url,
        producerBusCommentId: result.comment.id
      },
      knownLimitations: result.payload.knownLimitations
    };
  }
}
