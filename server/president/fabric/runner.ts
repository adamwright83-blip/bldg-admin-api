import type { PresidentCycle, PresidentCycleMission } from "../../../shared/presidentCycle";
import { MysqlPresidentCycleStore } from "../cycle/store";
import { PresidentEngineeringExecutor } from "./engineering";
import { PresidentIndependentReviewer } from "./review";
import {
  PresidentResearchExecutor,
  PresidentResearchReviewer,
} from "./research";

export type PresidentCycleRunResult =
  | { action: "EXECUTED"; mission: PresidentCycleMission; cycle: PresidentCycle }
  | { action: "WAITING"; reason: string; cycle: PresidentCycle };

export class PresidentCycleRunner {
  constructor(
    private readonly store: MysqlPresidentCycleStore,
    private readonly engineering = new PresidentEngineeringExecutor(),
    private readonly engineeringReviewer = new PresidentIndependentReviewer(),
    private readonly research = new PresidentResearchExecutor(),
    private readonly researchReviewer = new PresidentResearchReviewer()
  ) {}

  private async reconcileCycle(cycleId: string): Promise<PresidentCycle> {
    const cycle = await this.store.getCycle(cycleId);
    if (!cycle) throw new Error("President cycle not found");
    const missions = await this.store.listMissions(cycleId);
    if (!missions.length) return cycle;

    const active = missions.some(mission =>
      [
        "QUEUED",
        "PREPARING",
        "EXECUTING",
        "VALIDATING",
        "REVIEWING",
        "REPAIR_REQUIRED",
      ].includes(mission.state)
    );
    if (active) {
      if (cycle.state !== "EXECUTING")
        return this.store.updateCycle(cycleId, {
          state: "EXECUTING",
          blockReason: null,
        });
      return cycle;
    }

    const blocked = missions.filter(mission => mission.state === "BLOCKED");
    if (blocked.length)
      return this.store.updateCycle(cycleId, {
        state: "BLOCKED",
        blockReason: blocked
          .map(mission => `${mission.title}: ${mission.blocker ?? "blocked"}`)
          .join("\n"),
      });

    if (missions.some(mission => mission.state === "READY_FOR_HUMAN"))
      return this.store.updateCycle(cycleId, {
        state: "READY_FOR_HUMAN",
        blockReason: null,
      });

    if (missions.every(mission => mission.state === "COMPLETED"))
      return this.store.updateCycle(cycleId, {
        state: "COMPLETED",
        blockReason: null,
      });

    return cycle;
  }

  private async failMission(
    missionId: string,
    error: unknown
  ): Promise<PresidentCycleMission> {
    const current = await this.store.getMission(missionId);
    if (!current) throw new Error("President mission disappeared after execution failure");
    const exhausted = current.attemptCount >= current.maxAttempts;
    return this.store.updateMission(missionId, {
      state: exhausted ? "BLOCKED" : "REPAIR_REQUIRED",
      blocker:
        error instanceof Error ? error.message : "President mission execution failed",
    });
  }

  async runOne(cycleId: string): Promise<PresidentCycleRunResult> {
    await this.store.recoverExpiredLeases();
    let cycle = await this.store.getCycle(cycleId);
    if (!cycle) throw new Error("President cycle not found");
    if (!cycle.approval || !["ADAM_APPROVED", "EXECUTING"].includes(cycle.state))
      return {
        action: "WAITING",
        reason: "President cycle is not Adam-approved for execution",
        cycle,
      };

    if (cycle.state === "ADAM_APPROVED")
      cycle = await this.store.updateCycle(cycleId, {
        state: "EXECUTING",
        blockReason: null,
      });

    const approvedIds = new Set(cycle.approval.approvedCandidateIds);
    const missions = await this.store.listMissions(cycleId);
    if (
      missions.some(mission => !approvedIds.has(mission.candidateId)) ||
      missions.length !== approvedIds.size
    )
      throw new Error("President mission set does not exactly match Adam approval receipt");

    const mission = await this.store.claimNextMission(
      cycleId,
      "seat.president:cycle-runner"
    );
    if (!mission) {
      const reconciled = await this.reconcileCycle(cycleId);
      return {
        action: "WAITING",
        reason: "No eligible President mission",
        cycle: reconciled,
      };
    }

    try {
      if (mission.executionDomain === "ENGINEERING") {
        await this.store.updateMission(mission.id, {
          state: "EXECUTING",
          executorId: this.engineering.actorId,
          reviewerId: this.engineeringReviewer.actorId,
          blocker: null,
        });
        if (this.engineering.actorId === this.engineeringReviewer.actorId)
          throw new Error("President engineering executor cannot review its own work");

        const current = (await this.store.getMission(mission.id))!;
        const execution = await this.engineering.execute(current);
        await this.store.updateMission(mission.id, {
          state: "VALIDATING",
          executorId: execution.executorId,
          baseSha: execution.baseSha,
          branch: execution.branch,
          commitSha: execution.commitSha,
          pullRequestUrl: execution.pullRequestUrl,
          result: { ...execution },
          blocker: null,
        });

        const forReview = (await this.store.getMission(mission.id))!;
        await this.store.updateMission(mission.id, { state: "REVIEWING" });
        const review = await this.engineeringReviewer.review(
          forReview,
          execution
        );
        if (review.reviewerId === execution.executorId)
          throw new Error("President engineering result was self-reviewed");

        if (review.verdict === "PASS") {
          const updated = await this.store.updateMission(mission.id, {
            state: "READY_FOR_HUMAN",
            reviewerId: review.reviewerId,
            review: { ...review },
            blocker: null,
          });
          await this.store.releaseLease(mission.id);
          return {
            action: "EXECUTED",
            mission: updated,
            cycle: await this.reconcileCycle(cycleId),
          };
        }

        const updated = await this.store.updateMission(mission.id, {
          state:
            review.verdict === "FAIL" &&
            mission.attemptCount < mission.maxAttempts
              ? "REPAIR_REQUIRED"
              : "BLOCKED",
          reviewerId: review.reviewerId,
          review: { ...review },
          blocker:
            review.requiredRevision ??
            (review.verdict === "BLOCKED"
              ? "Independent reviewer blocked certification"
              : "Independent reviewer requested repair"),
        });
        await this.store.releaseLease(mission.id);
        return {
          action: "EXECUTED",
          mission: updated,
          cycle: await this.reconcileCycle(cycleId),
        };
      }

      if (
        ["RESEARCH", "ANALYSIS", "DOCUMENTATION"].includes(
          mission.executionDomain
        )
      ) {
        await this.store.updateMission(mission.id, {
          state: "EXECUTING",
          executorId: this.research.actorId,
          reviewerId: this.researchReviewer.actorId,
          blocker: null,
        });
        if (this.research.actorId === this.researchReviewer.actorId)
          throw new Error("President research executor cannot review its own work");

        const current = (await this.store.getMission(mission.id))!;
        const execution = await this.research.execute(current);
        await this.store.updateMission(mission.id, {
          state: "REVIEWING",
          result: { ...execution },
          executorId: execution.executorId,
        });
        const review = await this.researchReviewer.review(current, execution);
        if (review.reviewerId === execution.executorId)
          throw new Error("President research result was self-reviewed");

        const passed = review.verdict === "PASS";
        const updated = await this.store.updateMission(mission.id, {
          state: passed
            ? "COMPLETED"
            : review.verdict === "FAIL" &&
                mission.attemptCount < mission.maxAttempts
              ? "REPAIR_REQUIRED"
              : "BLOCKED",
          reviewerId: review.reviewerId,
          review: { ...review },
          blocker: passed
            ? null
            : review.requiredRevision ??
              (review.verdict === "BLOCKED"
                ? "Independent reviewer blocked certification"
                : "Independent reviewer requested repair"),
        });
        await this.store.releaseLease(mission.id);
        return {
          action: "EXECUTED",
          mission: updated,
          cycle: await this.reconcileCycle(cycleId),
        };
      }

      const unsupported = await this.store.updateMission(mission.id, {
        state: "BLOCKED",
        blocker: "BLOCKED_UNSUPPORTED_EXECUTION_DOMAIN",
      });
      await this.store.releaseLease(mission.id);
      return {
        action: "EXECUTED",
        mission: unsupported,
        cycle: await this.reconcileCycle(cycleId),
      };
    } catch (error) {
      const failed = await this.failMission(mission.id, error);
      await this.store.releaseLease(mission.id);
      return {
        action: "EXECUTED",
        mission: failed,
        cycle: await this.reconcileCycle(cycleId),
      };
    }
  }

  async runApprovedCycle(cycleId: string): Promise<PresidentCycle> {
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await this.runOne(cycleId);
      if (result.action === "WAITING") return result.cycle;
      if (
        ["READY_FOR_HUMAN", "COMPLETED", "BLOCKED"].includes(
          result.cycle.state
        )
      )
        return result.cycle;
    }
    throw new Error("President cycle exceeded bounded overnight execution loop");
  }
}
