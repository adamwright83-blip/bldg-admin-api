import { timingSafeEqual } from "node:crypto";
import {
  assertPresidentStepAuthority,
  presidentExecutionHandbackSchema,
  presidentIndependentReviewSchema,
  type PresidentExecutionHandback,
  type PresidentIndependentReview,
  type PresidentProgramStep,
} from "../../shared/presidentOperatingSystem";
import { MysqlPresidentProgramStore } from "./programStore";
import { PresidentProgramService } from "./programService";

export type PresidentAgentTarget = {
  actorId: string;
  url: string;
  wakeToken: string;
  leaseMs?: number;
};

export type PresidentAgentTargets = Record<string, PresidentAgentTarget>;

export type PresidentWakeEnvelope =
  | {
      kind: "PRESIDENT_EXECUTE";
      programId: string;
      step: PresidentProgramStep;
      callbackUrl: string;
    }
  | {
      kind: "PRESIDENT_REVIEW";
      programId: string;
      step: PresidentProgramStep;
      handback: PresidentExecutionHandback;
      callbackUrl: string;
    };

function secureEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authorizePresidentCallback(
  actorId: string,
  authorization: string | undefined,
  tokens: Record<string, string>
): boolean {
  const expected = tokens[actorId];
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  return secureEqual(authorization, "Bearer " + expected);
}

export class PresidentAgentWakeClient {
  constructor(
    private readonly targets: PresidentAgentTargets,
    readonly callbackBaseUrl: string
  ) {
    new URL(callbackBaseUrl);
    for (const [capability, target] of Object.entries(targets)) {
      if (!capability || !target.actorId || !target.url || !target.wakeToken)
        throw new Error("Every President agent target needs capability, actorId, url and wakeToken");
      new URL(target.url);
    }
  }

  target(capability: string): PresidentAgentTarget | null {
    return this.targets[capability] ?? null;
  }

  async wake(target: PresidentAgentTarget, payload: PresidentWakeEnvelope): Promise<void> {
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${target.wakeToken}`,
        "x-president-work-id":
          payload.kind === "PRESIDENT_EXECUTE"
            ? payload.step.id
            : `review:${payload.step.id}:${payload.handback.exactArtifactId}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `President could not wake ${target.actorId} (${response.status}): ${body.slice(0, 400)}`
      );
    }
  }
}

export class PresidentAgentRuntimeCoordinator {
  constructor(
    private readonly programs: MysqlPresidentProgramStore,
    private readonly service: PresidentProgramService,
    private readonly wake: PresidentAgentWakeClient
  ) {}

  private async founderApproved(programId: string): Promise<boolean> {
    const preflight = await this.programs.getPreflight(programId);
    if (!preflight || preflight.result !== "FOUNDER_REQUIRED") return true;
    const decision = await this.programs.findDecisionByKey(
      `program:${programId}:preflight`
    );
    return decision?.status === "ANSWERED" && decision.answer === "Approve bounded program";
  }

  async dispatchNext(): Promise<
    | { action: "DISPATCHED"; stepId: string; actorId: string }
    | { action: "WAITING"; reason: string }
  > {
    const step = await this.programs.nextPendingStep();
    if (!step) return { action: "WAITING", reason: "No eligible President step" };
    const program = await this.programs.getProgram(step.programId);
    if (!program) throw new Error("President program disappeared");
    const policy = await this.programs.getAuthorityPolicy(
      program.authorityPolicyVersion
    );
    if (!policy) throw new Error("President authority policy unavailable");
    const approved = await this.founderApproved(program.id);

    if (["HUMAN_PHYSICAL", "HUMAN_REMOTE"].includes(step.authorityClass)) {
      await this.programs.updateProgram(program.id, {
        state: "BLOCKED_FOUNDER",
        currentStepId: step.id,
        blockReason: `Human action required: ${step.title}`,
      });
      const existing = await this.programs.findOpenDecision(
        `program:${program.id}:human-step:${step.id}`
      );
      if (!existing) {
        await this.programs.createFounderDecision({
          id: crypto.randomUUID(),
          programId: program.id,
          stepId: step.id,
          questionKey: `program:${program.id}:human-step:${step.id}`,
          question: `This program needs a human action: ${step.title}. What should President do?`,
          options: ["I completed it", "Not now", "Stop program"],
          recommendedOption: null,
          reason: "President cannot fabricate or autonomously perform human-world evidence.",
          status: "OPEN",
          answer: null,
          askedAt: new Date().toISOString(),
          answeredAt: null,
        });
      }
      return { action: "WAITING", reason: "Human action required" };
    }

    assertPresidentStepAuthority(step, policy, approved);

    const capability = await this.programs.getAgentCapability(
      step.executorCapability
    );
    if (
      !capability ||
      capability.status !== "ACTIVE" ||
      (capability.programId && capability.programId !== program.id) ||
      !capability.authorityClasses.includes(step.authorityClass) ||
      !capability.consequentialDomains.includes(step.consequentialDomain) ||
      step.maxUsd > capability.maxUsdPerRun
    ) {
      await this.programs.updateProgram(program.id, {
        state: "BLOCKED_CAPABILITY",
        currentStepId: step.id,
        blockReason: `No active governed President executor is authorized for capability "${step.executorCapability}"`,
      });
      return {
        action: "WAITING",
        reason: `Missing or insufficient executor capability ${step.executorCapability}`,
      };
    }
    const target = this.wake.target(capability.targetCapability);
    if (!target || target.actorId !== capability.actorId) {
      await this.programs.updateProgram(program.id, {
        state: "BLOCKED_CAPABILITY",
        currentStepId: step.id,
        blockReason: `Governed capability "${step.executorCapability}" has no matching configured transport`,
      });
      return {
        action: "WAITING",
        reason: `Capability transport unavailable ${step.executorCapability}`,
      };
    }

    const claimed = await this.programs.claimSpecificStep({
      stepId: step.id,
      executorId: capability.actorId,
      leaseMs: target.leaseMs ?? 60 * 60 * 1000,
    });
    if (!claimed) return { action: "WAITING", reason: "Step was claimed elsewhere" };

    try {
      await this.wake.wake(target, {
        kind: "PRESIDENT_EXECUTE",
        programId: program.id,
        step: claimed,
        callbackUrl: new URL(
          "/api/president/agent/execution",
          this.wake.callbackBaseUrl
        ).toString(),
      });
      await this.programs.recordEvent({
        programId: program.id,
        stepId: step.id,
        eventType: "EXECUTOR_WOKEN",
        actorId: capability.actorId,
        details: {
          capability: step.executorCapability,
          targetCapability: capability.targetCapability,
        },
      });
      return { action: "DISPATCHED", stepId: step.id, actorId: capability.actorId };
    } catch (error) {
      await this.programs.updateStep(step.id, {
        state: "PENDING",
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
        error: String(error).slice(0, 4000),
      });
      await this.programs.updateProgram(program.id, {
        state: "BLOCKED_CAPABILITY",
        blockReason: `Executor wake failed for ${step.executorCapability}`,
      });
      throw error;
    }
  }

  async receiveExecution(input: PresidentExecutionHandback) {
    const handback = presidentExecutionHandbackSchema.parse(input);
    if (await this.programs.hasExecutionEvent(handback.eventId)) {
      const step = await this.programs.getStep(handback.stepId);
      return { reused: true, step };
    }
    const step = await this.programs.submitExternalHandback(handback);
    await this.requestReview(step);
    return { reused: false, step };
  }

  async requestReview(step: PresidentProgramStep) {
    if (step.state !== "REVIEW_PENDING")
      throw new Error("President cannot request review before a durable handback");
    const program = await this.programs.getProgram(step.programId);
    if (!program) throw new Error("President program disappeared");
    const handback = await this.programs.getHandback(step.id);
    if (!handback) throw new Error("President review requires exact execution handback");
    const reviewerCapability = await this.programs.getAgentCapability(
      step.reviewerCapability
    );
    if (!reviewerCapability || reviewerCapability.status !== "ACTIVE") {
      await this.programs.updateProgram(program.id, {
        state: "BLOCKED_CAPABILITY",
        currentStepId: step.id,
        blockReason: `No active governed independent reviewer exists for capability "${step.reviewerCapability}"`,
      });
      return { action: "WAITING_REVIEWER" as const };
    }
    const target = this.wake.target(reviewerCapability.targetCapability);
    if (!target || target.actorId !== reviewerCapability.actorId) {
      await this.programs.updateProgram(program.id, {
        state: "BLOCKED_CAPABILITY",
        currentStepId: step.id,
        blockReason: `Reviewer capability "${step.reviewerCapability}" has no matching configured transport`,
      });
      return { action: "WAITING_REVIEWER" as const };
    }
    if (reviewerCapability.actorId === handback.executorId)
      throw new Error("President executor and independent reviewer resolve to the same actor");
    const assigned = await this.programs.assignReviewer(
      step.id,
      reviewerCapability.actorId
    );
    await this.wake.wake(target, {
      kind: "PRESIDENT_REVIEW",
      programId: program.id,
      step: assigned,
      handback,
      callbackUrl: new URL(
        "/api/president/agent/review",
        this.wake.callbackBaseUrl
      ).toString(),
    });
    await this.programs.recordEvent({
      programId: program.id,
      stepId: step.id,
      eventType: "INDEPENDENT_REVIEWER_WOKEN",
      actorId: reviewerCapability.actorId,
      details: {
        capability: step.reviewerCapability,
        targetCapability: reviewerCapability.targetCapability,
        exactArtifactId: handback.exactArtifactId,
      },
    });
    return {
      action: "REVIEW_DISPATCHED" as const,
      reviewerId: reviewerCapability.actorId,
    };
  }

  async receiveReview(input: PresidentIndependentReview) {
    const review = presidentIndependentReviewSchema.parse(input);
    if (await this.programs.hasReviewEvent(review.eventId)) {
      const step = await this.programs.getStep(review.stepId);
      const program = step ? await this.programs.getProgram(step.programId) : null;
      return { reused: true, program };
    }
    const step = await this.programs.getStep(review.stepId);
    if (!step) throw new Error("President review callback step not found");
    if (!step.reviewerId || step.reviewerId !== review.reviewerId)
      throw new Error("President review callback actor is not the assigned reviewer");

    const program = await this.service.acceptIndependentReview(review);
    await this.programs.recordEvent({
      programId: program.id,
      stepId: step.id,
      eventType: `INDEPENDENT_REVIEW_${review.verdict}`,
      actorId: review.reviewerId,
      details: { exactArtifactId: review.exactArtifactId },
    });

    if (["READY", "REVISION_REQUIRED"].includes(program.state))
      await this.dispatchNext();
    return { reused: false, program };
  }

  async recover(): Promise<void> {
    await this.programs.deadLetterExpiredSteps();
    await this.dispatchNext();
  }
}
