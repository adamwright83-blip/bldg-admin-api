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
  repository: string;
  environment: string;
  leaseMs?: number;
};

export type PresidentAgentTargets = Record<string, PresidentAgentTarget>;

export type PresidentWakeEnvelope =
  | {
      kind: "PRESIDENT_EXECUTE";
      authority: {
        repository: string;
        environment: string;
        policyVersion: string;
        founderApproved: boolean;
        internalMergeAllowed: boolean;
        internalDeployAllowed: boolean;
        maxUsd: number;
      };
      programId: string;
      step: PresidentProgramStep;
      callbackUrl: string;
    }
  | {
      kind: "PRESIDENT_REVIEW";
      authority: {
        repository: string;
        environment: string;
        policyVersion: string;
        readOnly: true;
        maxUsd: number;
      };
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
  if (!Object.hasOwn(tokens, actorId)) return false;
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
        throw new Error(
          "Every President agent target needs capability, actorId, url and wakeToken"
        );
      new URL(target.url);
    }
  }

  target(capability: string): PresidentAgentTarget | null {
    return Object.hasOwn(this.targets, capability)
      ? this.targets[capability]
      : null;
  }

  async wake(
    target: PresidentAgentTarget,
    payload: PresidentWakeEnvelope
  ): Promise<void> {
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
      signal: AbortSignal.timeout(20_000),
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
    return (
      decision?.status === "ANSWERED" &&
      decision.answer === "Approve bounded program"
    );
  }

  async dispatchNext(): Promise<
    | { action: "DISPATCHED"; stepId: string; actorId: string }
    | { action: "WAITING"; reason: string }
  > {
    const step = await this.programs.nextPendingStep();
    if (!step)
      return { action: "WAITING", reason: "No eligible President step" };
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
          reason:
            "President cannot fabricate or autonomously perform human-world evidence.",
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

    if (
      !policy.allowedRepositories.includes(target.repository) ||
      !policy.allowedEnvironments.includes(target.environment) ||
      (step.authorityClass === "AUTO_SANDBOX" &&
        !["test", "sandbox", "preview", "development"].includes(
          target.environment
        ))
    ) {
      await this.programs.updateProgram(program.id, {
        state: "BLOCKED_CAPABILITY",
        blockReason:
          "Configured execution target is outside repository/environment authority",
      });
      return {
        action: "WAITING",
        reason: "Execution target is outside authority scope",
      };
    }
    const claimed = await this.programs.claimSpecificStep({
      stepId: step.id,
      executorId: capability.actorId,
      leaseMs: target.leaseMs ?? 60 * 60 * 1000,
    });
    if (!claimed)
      return { action: "WAITING", reason: "Step was claimed elsewhere" };

    try {
      await this.wake.wake(target, {
        kind: "PRESIDENT_EXECUTE",
        authority: {
          repository: target.repository,
          environment: target.environment,
          policyVersion: policy.policyVersion,
          founderApproved: approved,
          internalMergeAllowed: policy.internalMergeAllowed,
          internalDeployAllowed: policy.internalDeployAllowed,
          maxUsd: claimed.maxUsd,
        },
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
      return {
        action: "DISPATCHED",
        stepId: step.id,
        actorId: capability.actorId,
      };
    } catch (error) {
      await this.programs.failStep(
        {
          ...claimed,
          leaseOwner: claimed.leaseOwner!,
          leaseExpiresAt: claimed.leaseExpiresAt!,
        },
        error,
        60_000
      );
      throw error;
    }
  }

  async receiveExecution(input: PresidentExecutionHandback) {
    const handback = presidentExecutionHandbackSchema.parse(input);
    const priorStep = await this.programs.getStep(handback.stepId);
    if (!priorStep) throw new Error("President callback step not found");
    const executionCapability = await this.programs.getAgentCapability(
      priorStep.executorCapability
    );
    const executionTarget = executionCapability
      ? this.wake.target(executionCapability.targetCapability)
      : null;
    if (
      !executionTarget ||
      executionCapability?.status !== "ACTIVE" ||
      executionTarget.actorId !== handback.executorId ||
      handback.evidence.repository !== executionTarget.repository ||
      handback.evidence.environment !== executionTarget.environment
    )
      throw new Error(
        "Execution callback scope does not match its governed transport"
      );
    const result = await this.programs.transaction(
      priorStep.programId,
      async store => {
        const reused = await store.callbackReplay(handback);
        const step = reused
          ? (await store.getStep(handback.stepId))!
          : await store.submitExternalHandback(handback);
        return { reused, step };
      }
    );
    const { step } = result;
    if (step.state !== "REVIEW_PENDING") return result;
    await this.requestReview(step);
    return result;
  }

  async requestReview(step: PresidentProgramStep) {
    if (step.state !== "REVIEW_PENDING")
      throw new Error(
        "President cannot request review before a durable handback"
      );
    const program = await this.programs.getProgram(step.programId);
    if (!program) throw new Error("President program disappeared");
    const handback = await this.programs.getHandback(step.id);
    if (!handback)
      throw new Error("President review requires exact execution handback");
    const reviewerCapability = await this.programs.getAgentCapability(
      step.reviewerCapability
    );
    if (
      !reviewerCapability ||
      reviewerCapability.status !== "ACTIVE" ||
      (reviewerCapability.programId &&
        reviewerCapability.programId !== program.id) ||
      !reviewerCapability.authorityClasses.includes("AUTO_READ_ONLY") ||
      !reviewerCapability.consequentialDomains.includes("NONE")
    ) {
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
    const policy = await this.programs.getAuthorityPolicy(
      program.authorityPolicyVersion
    );
    if (
      !policy ||
      !policy.allowedRepositories.includes(target.repository) ||
      !policy.allowedEnvironments.includes(target.environment)
    )
      throw new Error(
        "Independent reviewer transport is outside repository/environment authority"
      );
    if (reviewerCapability.actorId === handback.executorId)
      throw new Error(
        "President executor and independent reviewer resolve to the same actor"
      );
    const assigned = await this.programs.transaction(
      program.id,
      async store => {
        const current = await store.getStep(step.id);
        if (current?.state !== "REVIEW_PENDING") return null;
        if (
          current.leaseExpiresAt &&
          new Date(current.leaseExpiresAt).getTime() > Date.now()
        )
          return null;
        const attempts = (await store.listEvents(program.id)).filter(
          event =>
            event.stepId === step.id &&
            event.eventType === "REVIEW_WAKE_ATTEMPT" &&
            event.details.exactArtifactId === handback.exactArtifactId
        ).length;
        if (attempts >= current.maxAttempts) {
          await store.updateStep(step.id, {
            state: "DEAD_LETTER",
            error: "Independent review exhausted bounded wake retries",
          });
          await store.updateProgram(program.id, {
            state: "BLOCKED_CAPABILITY",
            blockReason: "Independent review exhausted bounded wake retries",
          });
          return null;
        }
        await store.recordEvent({
          programId: program.id,
          stepId: step.id,
          eventType: "REVIEW_WAKE_ATTEMPT",
          actorId: reviewerCapability.actorId,
          details: { exactArtifactId: handback.exactArtifactId },
        });
        return store.updateStep(step.id, {
          reviewerId: reviewerCapability.actorId,
          leaseOwner: "review:" + reviewerCapability.actorId,
          leaseExpiresAt: new Date(
            Date.now() + (target.leaseMs ?? 60_000)
          ).toISOString(),
        });
      }
    );
    if (!assigned) return { action: "WAITING_REVIEWER" as const };
    await this.wake.wake(target, {
      kind: "PRESIDENT_REVIEW",
      authority: {
        repository: target.repository,
        environment: target.environment,
        policyVersion: policy.policyVersion,
        readOnly: true,
        maxUsd: reviewerCapability.maxUsdPerRun,
      },
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
    const step = await this.programs.getStep(review.stepId);
    if (!step) throw new Error("President review callback step not found");
    const result = await this.programs.transaction(
      step.programId,
      async store => {
        const reused = await store.callbackReplay(review);
        if (reused)
          return { reused, program: (await store.getProgram(step.programId))! };
        const currentProgram = await store.getProgram(step.programId);
        if (
          !currentProgram ||
          ["STOPPED", "COMPLETED"].includes(currentProgram.state)
        )
          throw new Error("Review callback program is no longer active");
        const current = await store.getStep(step.id);
        if (
          current?.state !== "REVIEW_PENDING" ||
          current.reviewerId !== review.reviewerId
        )
          throw new Error("President review is not assigned to this actor/run");
        const service = this.service.withProgramStore(store);
        return {
          reused: false,
          program: await service.acceptIndependentReview(review),
        };
      }
    );
    const { program } = result;
    if (result.reused) return result;
    await this.programs.recordEvent({
      programId: program.id,
      stepId: step.id,
      eventType: `INDEPENDENT_REVIEW_${review.verdict}`,
      actorId: review.reviewerId,
      details: { exactArtifactId: review.exactArtifactId },
    });

    if (["READY", "REVISION_REQUIRED"].includes(program.state))
      await this.dispatchNext();
    return result;
  }

  async recover(): Promise<void> {
    await this.programs.deadLetterExpiredSteps();
    for (const program of await this.programs.listPrograms(50)) {
      if (["STOPPED", "COMPLETED"].includes(program.state)) continue;
      for (const step of await this.programs.listSteps(program.id)) {
        if (step.state === "REVIEW_PENDING") await this.requestReview(step);
      }
    }
    await this.dispatchNext();
  }
}
