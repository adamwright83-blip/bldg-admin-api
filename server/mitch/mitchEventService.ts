import { mitchEventSchema, type MitchEvent } from "../../shared/mitchEvents";
import type { IMitchEventInbox } from "./mitchEventInbox";
import type { IMitchProductionStore } from "./mitchStore";
import type { MitchGameDispatcher } from "./mitchDispatcher";
import type { MitchProducerCoordinator } from "./mitchProducerCoordinator";
import type { MitchProductionService } from "./mitchService";

export class MitchEventService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly deps: {
      tenantId: string;
      gameId: string;
      humanActorId: string;
      inbox: IMitchEventInbox;
      store: IMitchProductionStore;
      dispatcher: MitchGameDispatcher;
      verifyImplementation?: (
        branch: string,
        commitSha: string
      ) => Promise<void>;
      coordinator: MitchProducerCoordinator;
      service: MitchProductionService;
    }
  ) {}
  async receive(
    value: unknown,
    deliveryId?: string
  ): Promise<{ duplicate: boolean }> {
    const event = mitchEventSchema.parse(value);
    if (
      event.tenantId !== this.deps.tenantId ||
      event.gameId !== this.deps.gameId
    )
      throw new Error("Wrong tenant/game identity");
    if (deliveryId)
      await this.deps.inbox.bindDelivery(deliveryId, event.eventId);
    const added = await this.deps.inbox.put(event);
    await this.drain();
    return { duplicate: !added };
  }
  /** Serializes local intake; the durable inbox additionally serializes replicas. */
  async drain(): Promise<void> {
    const next = this.tail
      .catch(() => {})
      .then(async () => {
        for (const id of await this.deps.inbox.pending())
          await this.deps.inbox.process(id, event => this.apply(event));
      });
    this.tail = next;
    await next;
  }
  private async apply(event: MitchEvent) {
    const { store, dispatcher, coordinator, service } = this.deps;
    const order = await store.getWorkOrder(event.tenantId, event.workOrderId);
    if (
      !order ||
      order.gameId !== event.gameId ||
      order.milestoneId !== event.milestoneId
    )
      throw new Error("Wrong work-order/milestone identity");
    const milestone = await store.getMilestone(
      event.tenantId,
      event.gameId,
      order.milestoneKey
    );
    if (!milestone || milestone.id !== event.milestoneId)
      throw new Error("Wrong milestone identity");
    if (
      event.type === "implementation_handback" ||
      event.type === "agent_failed"
    ) {
      if (
        order.claimedBy !== event.actorId ||
        !["claimed", "executing"].includes(order.status) ||
        !order.leaseExpiresAt ||
        Date.parse(order.leaseExpiresAt) <= Date.now()
      )
        throw new Error("Invalid or expired executor lease");
      if (event.type === "implementation_handback") {
        if (
          !/^[a-f0-9]{40}$/i.test(event.handback.exactBuildId) &&
          event.handback.evidence.buildCommitSha !== event.handback.commitSha
        ) {
          throw new Error(
            "Preview/artifact evidence must bind to the exact commit SHA"
          );
        }
        await this.deps.verifyImplementation?.(
          event.handback.branch,
          event.handback.commitSha
        );
        await dispatcher.submitHandback({
          tenantId: event.tenantId,
          workOrderId: order.id,
          executorId: event.actorId,
          handback: event.handback,
        });
      } else {
        await store.failWorkOrder({
          tenantId: event.tenantId,
          workOrderId: order.id,
          error: event.error,
        });
      }
    } else {
      const build = await store.getBuild(event.tenantId, event.buildId);
      if (
        !build ||
        build.gameId !== event.gameId ||
        build.workOrderId !== order.id ||
        build.branch !== event.branch ||
        build.commitSha !== event.commitSha ||
        milestone.currentAvailableBuildId !== build.id
      ) {
        throw new Error("Wrong or stale build/branch/SHA identity");
      }
      if (event.type === "human_decision") {
        if (event.actorId !== this.deps.humanActorId)
          throw new Error(
            "Only the configured human may decide creative acceptance"
          );
        if (event.decision === "resolve_blocker") {
          if (!milestone.isHumanCreativeBlocker)
            throw new Error("No human blocker to resolve");
          await service.resolveMilestoneBlocker({
            tenantId: event.tenantId,
            gameId: event.gameId,
            milestoneKey: order.milestoneKey,
            resolvedBy: event.actorId,
            resolutionNote: event.note,
          });
          await store.saveMilestone({
            ...milestone,
            status: "implemented",
            isHumanCreativeBlocker: false,
            blockedReason: null,
          });
          await store.recordAuditEvent({
            tenantId: event.tenantId,
            gameId: event.gameId,
            actorId: event.actorId,
            eventType: "mitch_review_reopened",
            details: { eventId: event.eventId, buildId: build.id },
          });
        } else {
          if (!build.isVerified || milestone.lastVerifiedBuildId !== build.id)
            throw new Error(
              "Creative acceptance requires exact verified build"
            );
          const state = await store.getProductionState(
            event.tenantId,
            event.gameId
          );
          if (!state) throw new Error("Missing production state");
          await store.saveProductionState({
            ...state,
            creativeAcceptanceState:
              event.decision === "accept" ? "accepted" : "rejected",
            creativeAcceptanceNote: event.note,
            creativeAcceptanceDecidedAt: new Date().toISOString(),
            lifecycleState:
              event.decision === "accept"
                ? "creatively_accepted"
                : state.lifecycleState,
          });
          await store.saveMilestone({
            ...milestone,
            status:
              event.decision === "accept" ? "creatively_accepted" : "blocked",
            isHumanCreativeBlocker: event.decision === "reject",
            blockedReason: event.decision === "reject" ? event.note : null,
          });
        }
      } else {
        if (milestone.isHumanCreativeBlocker)
          throw new Error("HUMAN CREATIVE DECISION REQUIRED");
        if (event.actorId === order.claimedBy)
          throw new Error("Review must be independent of executor");
        const audits = await store.listAuditEvents(
          event.tenantId,
          event.gameId
        );
        if (
          !audits.some(
            a =>
              a.eventType === "mitch_review_requested" &&
              a.actorId === event.actorId &&
              a.details.workOrderId === order.id &&
              a.details.buildId === build.id &&
              a.details.commitSha === build.commitSha
          )
        ) {
          throw new Error("Reviewer was not assigned to this exact build");
        }
        // A different event ID cannot apply the same review twice.
        const lastRequest = audits.findLastIndex(
          a =>
            a.eventType === "mitch_review_requested" &&
            a.details.buildId === build.id
        );
        const lastConsumed = audits.findLastIndex(
          a =>
            a.eventType === "mitch_review_consumed" &&
            a.details.buildId === build.id
        );
        if (lastConsumed > lastRequest)
          throw new Error("Review already consumed for this build");
        await coordinator.acceptReview(milestone, build.id, event.review);
        await store.recordAuditEvent({
          tenantId: event.tenantId,
          gameId: event.gameId,
          actorId: event.actorId,
          eventType: "mitch_review_consumed",
          details: { eventId: event.eventId, buildId: build.id },
        });
      }
    }
    await store.recordAuditEvent({
      tenantId: event.tenantId,
      gameId: event.gameId,
      actorId: event.actorId,
      eventType: "mitch_producer_event_applied",
      details: {
        eventId: event.eventId,
        type: event.type,
        workOrderId: order.id,
      },
    });
    await coordinator.advance();
  }
}
