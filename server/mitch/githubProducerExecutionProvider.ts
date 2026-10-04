
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

  async executeWorkOrder(order: MitchWorkOrder): Promise<MitchExecutionHandback> {
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
        "### Handback format",
        "Return a comment beginning with ## CLAUDE → MITCH and marker:",
        "<!-- " + handback + " -->",
        "followed by one fenced JSON object matching:",
        "",
        "~~~json",
        JSON.stringify(
          {
            branch: "your-branch",
            commitSha: "real git sha",
            exactBuildId: "real git sha or immutable preview URL",
            whatChanged: "player-visible summary",
            testsActuallyRun: ["test command"],
            testsNotRun: [],
            previewLaunchInstructions: "exact preview URL or exact local launch instructions",
            evidence: { captures: ["artifact-or-url"] },
            knownLimitations: "known limitations"
          },
          null,
          2
        ),
        "~~~"
      ].join("\n");
      await this.bus.postComment(body);
    }

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
