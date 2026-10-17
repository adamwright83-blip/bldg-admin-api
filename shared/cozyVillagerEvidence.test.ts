import { describe, expect, it } from "vitest";
import type { CozyCustomerTarget, CozyEncounterMission } from "./cozyVillagerOutreach";
import {
  COZY_VILLAGER_EVIDENCE_CONTRACT,
  chooseOutreachEvidence,
  communicationStateForRow,
  poseForCommunicationState,
  projectCozyRecoverySurfaces,
  villagerSprite,
  type CozyOutreachEvidenceRow,
} from "./cozyVillagerEvidence";

const TENANT = "tenant_test";
const OPERATOR = "op_test";
const OTHER = "op_other";
const NOW = new Date("2026-10-15T18:00:00.000Z");

function target(overrides: Partial<CozyCustomerTarget> = {}): CozyCustomerTarget {
  return {
    slotId: "slot_01",
    customerId: "cust_stable_1",
    displayName: "Mei Lin",
    phone: "+12135550141",
    address: "Silver Lake, Los Angeles",
    territoryId: "silver-lake",
    territoryName: "Silver Lake",
    daysSinceLastOrder: 34,
    paidOrders: 14,
    lifetimeCents: 62400,
    lastOrderDate: "2026-09-10",
    lastOrderSummary: "Wash & Fold 32 lbs",
    hasConsent: true,
    consentStatus: "existing_customer_relationship",
    consentBasis: "transactional_dormant_recovery",
    villagerVariant: "fox",
    suggestedMessage: "Hey Mei! It's Adam from Laundry Farm.",
    status: "eligible",
    ...overrides,
  };
}

function mission(targets: CozyCustomerTarget[]): CozyEncounterMission {
  return {
    missionId: "mission_winback_silver-lake",
    title: "Claire's Recovery Mission: Silver Lake",
    objective: "Reconnect with dormant customers in Silver Lake",
    territoryId: "silver-lake",
    territoryName: "Silver Lake",
    totalLapsedInTerritory: targets.length,
    activeTargetCount: targets.length,
    targets,
  };
}

function row(overrides: Partial<CozyOutreachEvidenceRow> = {}): CozyOutreachEvidenceRow {
  return {
    id: "msg_1",
    tenantId: TENANT,
    operatorId: OPERATOR,
    customerId: "cust_stable_1",
    currentMessageBody: "Hey Mei, checking in.",
    originalSuggestedDraft: "Hey Mei! It's Adam from Laundry Farm.",
    status: "pending",
    deliveryIntent: "scheduled",
    scheduledFor: "2026-10-16T17:00:00.000Z",
    timezone: "America/Los_Angeles",
    slotId: "slot_03",
    territoryId: "silver-lake",
    dispatchedAt: null,
    externalMessageId: null,
    failureReason: null,
    ...overrides,
  };
}

const objective = {
  id: "goal_silver_lake_recovery",
  statement: "Recover dormant laundry customers in Silver Lake",
  areaLabel: "Silver Lake",
};

describe("cozy villager evidence contract", () => {
  it("reads a personal handoff draft as scheduled or awaiting, never sent", () => {
    expect(
      communicationStateForRow(
        row({ status: "awaiting_sender_setup", deliveryIntent: "scheduled", dispatchedAt: null, externalMessageId: null }),
        false
      )
    ).toBe("scheduled");
    expect(
      communicationStateForRow(
        row({ status: "awaiting_sender_setup", deliveryIntent: "immediate", dispatchedAt: null, externalMessageId: null }),
        false
      )
    ).toBe("awaiting_sender");
    expect(poseForCommunicationState("scheduled")).not.toBe("acknowledged");
    expect(poseForCommunicationState("awaiting_sender")).not.toBe("acknowledged");
    expect(poseForCommunicationState("send_observed")).toBe("acknowledged");
  });

  it("keeps reply and paid-order unavailable unless admitted evidence is supplied", () => {
    expect(COZY_VILLAGER_EVIDENCE_CONTRACT.reply).toMatch(/Unavailable/);
    expect(COZY_VILLAGER_EVIDENCE_CONTRACT.paidOrder).toMatch(/not a paid order/i);
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [],
      objective,
      now: NOW,
    });
    const villager = surfaces.mission.targets[0]!;
    expect(villager.customerId).toBe("cust_stable_1");
    expect(villager.communicationState).toBe("draft_prepared");
    expect(villager.pose).toBe("idle");
    expect(villager.reply.status).toBe("unavailable");
    expect(villager.paidOrder.status).toBe("unavailable");
    expect(villager.verifiedAddress).toBeNull();
    expect(villager.objectiveComplete).toBe(false);
    expect(surfaces.mission.world.recoveryState).toBe("none");
    expect(surfaces.mission.world.worldEventAppended).toBe(false);
    expect(surfaces.dayLineCard?.objectiveId).toBe(objective.id);
    expect(surfaces.dayLineCard?.objectiveComplete).toBe(false);
    expect(surfaces.dayLineCard?.missionType).toBe("customer_recovery");
  });

  it("binds a durable slot and does not treat scheduled as sent", () => {
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target({ slotId: "slot_01", villagerVariant: "fox" })]),
      messages: [row({ slotId: "slot_03", status: "pending", deliveryIntent: "scheduled" })],
      objective,
      now: NOW,
    });
    const villager = surfaces.mission.targets[0]!;
    expect(villager.slotId).toBe("slot_03");
    expect(villager.villagerVariant).toBe("otter");
    expect(villager.communicationState).toBe("scheduled");
    expect(villager.pose).toBe("wave");
    expect(poseForCommunicationState("scheduled")).not.toBe("acknowledged");
    expect(villager.outreachActionComplete).toBe(false);
    expect(villager.preparedMessage).toBe("Hey Mei, checking in.");
    expect(surfaces.dayLineCard?.customerId).toBe("cust_stable_1");
    expect(surfaces.dayLineCard?.messageId).toBe("msg_1");
    expect(surfaces.dayLineCard?.messageBody).toBe("Hey Mei, checking in.");
    expect(surfaces.dayLineCard?.outreachActionComplete).toBe(false);
  });

  it("uses the acknowledged pose only after a verified send, including a simulated reference", () => {
    const scheduled = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [row()],
      objective,
      now: NOW,
    });
    expect(scheduled.mission.targets[0]!.pose).toBe("wave");

    const missingReference = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [row({ status: "dispatched", dispatchedAt: "2026-10-15T17:00:00.000Z", externalMessageId: null, deliveryIntent: "immediate" })],
      objective,
      now: NOW,
    });
    expect(missingReference.mission.targets[0]!.communicationState).toBe("send_not_observed");
    expect(missingReference.mission.targets[0]!.pose).toBe("idle");

    const simulated = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [
        row({
          status: "dispatched",
          deliveryIntent: "immediate",
          dispatchedAt: "2026-10-15T17:05:00.000Z",
          externalMessageId: "simulated:android_msg_1",
          slotId: "slot_01",
        }),
      ],
      objective,
      now: NOW,
    });
    const sent = simulated.mission.targets[0]!;
    expect(sent.communicationState).toBe("send_observed");
    expect(sent.pose).toBe("acknowledged");
    expect(sent.transport).toBe("simulated");
    expect(sent.paidOrder.status).toBe("unavailable");
    expect(sent.outreachActionComplete).toBe(true);
    expect(simulated.dayLineCard?.objectiveComplete).toBe(false);
    expect(simulated.dayLineCard?.customerId).toBeNull();
    expect(simulated.mission.world.recoveryState).toBe("none");
    const sprite = villagerSprite({ variant: "fox", communicationState: "send_observed" });
    expect(sprite.pose).toBe("acknowledged");
    expect(sprite.src).toContain("fox-acknowledged");
  });

  it("does not let a failed row or another operator produce a sent pose", () => {
    const failed = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [
        row({ status: "failed", failureReason: "adapter down", deliveryIntent: "immediate", scheduledFor: "2026-10-15T17:00:00.000Z" }),
        row({
          id: "msg_other_operator",
          operatorId: OTHER,
          status: "dispatched",
          dispatchedAt: "2026-10-15T17:10:00.000Z",
          externalMessageId: "simulated:other",
        }),
      ],
      objective,
      now: NOW,
    });
    expect(failed.mission.targets[0]!.communicationState).toBe("failed");
    expect(failed.mission.targets[0]!.pose).toBe("idle");
    expect(failed.mission.targets[0]!.outreachActionComplete).toBe(false);
    expect(failed.dayLineCard?.objectiveComplete).toBe(false);

    const observed = chooseOutreachEvidence([
      row({ id: "fail_later", status: "failed", scheduledFor: "2026-10-15T19:00:00.000Z" }),
      row({
        id: "sent_earlier",
        status: "dispatched",
        dispatchedAt: "2026-10-15T17:00:00.000Z",
        externalMessageId: "simulated:kept",
        scheduledFor: "2026-10-15T17:00:00.000Z",
      }),
    ]);
    expect(observed?.id).toBe("sent_earlier");
  });

  it("keeps one card for the existing objective and leaves a past window open", () => {
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([
        target({ customerId: "cust_stable_1", displayName: "Mei Lin", slotId: "slot_01" }),
        target({
          customerId: "cust_stable_2",
          displayName: "Barnaby Hayes",
          slotId: "slot_02",
          villagerVariant: "bear",
          suggestedMessage: "Hey Barnaby! It's Adam from Laundry Farm.",
        }),
      ]),
      messages: [
        row({
          customerId: "cust_stable_1",
          status: "dispatched",
          dispatchedAt: "2026-10-15T17:00:00.000Z",
          externalMessageId: "simulated:mei",
          deliveryIntent: "immediate",
        }),
        row({
          id: "msg_barnaby",
          customerId: "cust_stable_2",
          status: "pending",
          deliveryIntent: "scheduled",
          scheduledFor: "2026-10-14T17:00:00.000Z",
          currentMessageBody: "Hello Barnaby.",
          slotId: "slot_02",
        }),
      ],
      objective,
      presentation: {
        adjustment: { kind: "presentation_style", style: "plain" },
        note: "Shown plainly, without story framing.",
      },
      now: NOW,
    });
    expect(surfaces.dayLineCard?.objectiveId).toBe("goal_silver_lake_recovery");
    expect(surfaces.dayLineCard?.missionTitle).toBe(objective.statement);
    expect(surfaces.dayLineCard?.customerId).toBe("cust_stable_2");
    expect(surfaces.dayLineCard?.presentationNote).toMatch(/plainly/);
    expect(surfaces.dayLineCard?.timeWindow).toMatch(/window passed — still open/);
    expect(surfaces.dayLineCard?.outreachActionComplete).toBe(false);
    expect(surfaces.dayLineCard?.objectiveComplete).toBe(false);
    expect(surfaces.mission.targets.find(item => item.customerId === "cust_stable_1")?.pose).toBe("acknowledged");
    expect(surfaces.mission.targets.find(item => item.customerId === "cust_stable_2")?.pose).toBe("wave");
    const again = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([
        target(),
        target({ customerId: "cust_stable_2", displayName: "Barnaby Hayes", slotId: "slot_02" }),
      ]),
      messages: [
        row({
          status: "dispatched",
          dispatchedAt: "2026-10-15T17:00:00.000Z",
          externalMessageId: "simulated:mei",
          deliveryIntent: "immediate",
        }),
        row({
          id: "msg_barnaby",
          customerId: "cust_stable_2",
          status: "pending",
          deliveryIntent: "scheduled",
          scheduledFor: "2026-10-14T17:00:00.000Z",
          slotId: "slot_02",
        }),
      ],
      objective,
      now: NOW,
    });
    expect(again.dayLineCard?.objectiveId).toBe(surfaces.dayLineCard?.objectiveId);
    expect(again.dayLineCard?.customerId).toBe("cust_stable_2");
  });

  it("accepts a paid order only from supplied admission and does not change the send pose", () => {
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [],
      objective,
      paidOrderEvidence: [{ customerId: "cust_stable_1", orderId: "order_99", paidAt: "2026-10-15T19:00:00.000Z" }],
      now: NOW,
    });
    expect(surfaces.mission.targets[0]!.paidOrder).toEqual({
      status: "verified",
      orderId: "order_99",
      paidAt: "2026-10-15T19:00:00.000Z",
    });
    expect(surfaces.mission.targets[0]!.communicationState).toBe("draft_prepared");
    expect(surfaces.mission.targets[0]!.pose).toBe("idle");
    expect(surfaces.dayLineCard?.objectiveComplete).toBe(false);
  });

  it("leaves an empty house slot when fewer customers are eligible", () => {
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [],
      objective: null,
      now: NOW,
    });
    expect(surfaces.mission.targets).toHaveLength(1);
    expect(surfaces.mission.targets[0]!.slotId).toBe("slot_01");
    expect(surfaces.dayLineCard).toBeNull();
  });

  it("does not invent an acknowledged frame for a variant that has no pose asset", () => {
    const sprite = villagerSprite({ variant: "bear", communicationState: "send_observed" });
    expect(sprite.pose).toBe("acknowledged");
    expect(sprite.poseFrameAvailable).toBe(false);
    expect(sprite.src).toContain("villager-02");
  });

  it("projects an observed reply across sources (device_observed, provider_webhook, operator_reported) without marking a paid order", () => {
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [
        row({
          status: "dispatched",
          deliveryIntent: "immediate",
          dispatchedAt: "2026-10-15T17:05:00.000Z",
          externalMessageId: "simulated:android_msg_1",
          slotId: "slot_01",
        }),
      ],
      replies: [
        {
          id: "por_reply_1",
          tenantId: TENANT,
          operatorId: OPERATOR,
          customerId: "cust_stable_1",
          customerName: "Mei Lin",
          rawPhone: "+12135550141",
          direction: "inbound",
          source: "device_observed",
          providerMessageId: "gmsg_in_1",
          messageId: "msg_1",
          territoryId: "silver-lake",
          replyText: "Can you pick up 2 bags Thursday morning?",
          classification: "pickup_interest",
          nextStepKind: "prepare_pickup_follow_up",
          nextAction:
            "Mei Lin replied with pickup interest (device observed). Review and approve the follow-up draft before sending.",
          preparedFollowUpDraft:
            "Thanks Mei! I'd be glad to coordinate a pickup—what day and time window works best for you, and are there any gate or pickup notes I should have ready?",
          permissionEffect: "none",
          provenance: "device_observed",
          surface: "device_connector",
          reportedAt: "2026-10-15T17:30:00.000Z",
          observedAt: "2026-10-15T17:30:00.000Z",
        },
      ],
      objective,
      now: NOW,
    });

    const villager = surfaces.mission.targets[0]!;
    expect(villager.reply.status).toBe("device_observed");
    if (villager.reply.status !== "unavailable") {
      expect(villager.reply.source).toBe("device_observed");
      expect(villager.reply.classification).toBe("pickup_interest");
      expect(villager.reply.provenance).toBe("device_observed");
      expect(villager.reply.replyText).toContain("Thursday morning");
    }
    expect(villager.preparedMessage).toContain("Thanks Mei!");
    expect(villager.paidOrder.status).toBe("unavailable");
    expect(villager.outreachActionComplete).toBe(false);
    expect(villager.objectiveComplete).toBe(false);
    expect(surfaces.dayLineCard?.customerId).toBe("cust_stable_1");
    expect(surfaces.dayLineCard?.reply.status).toBe("device_observed");
    expect(surfaces.dayLineCard?.nextAction).toContain("pickup interest (device observed)");
    expect(surfaces.dayLineCard?.messageBody).toContain("Thanks Mei!");
    expect(surfaces.dayLineCard?.openHref).toContain("customer=cust_stable_1");
    expect(surfaces.dayLineCard?.objectiveComplete).toBe(false);
  });

  it("marks an outbound draft as send_observed only when a matching outbound event is observed, not from compose handoff alone", () => {
    const composeOnly = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [
        row({
          status: "awaiting_sender_setup",
          deliveryIntent: "immediate",
          dispatchedAt: null,
          externalMessageId: null,
          slotId: "slot_01",
        }),
      ],
      replies: [],
      objective,
      now: NOW,
    });
    expect(composeOnly.mission.targets[0]!.communicationState).toBe("awaiting_sender");
    expect(composeOnly.mission.targets[0]!.outreachActionComplete).toBe(false);

    const afterOutboundEvent = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [
        row({
          status: "awaiting_sender_setup",
          deliveryIntent: "immediate",
          dispatchedAt: null,
          externalMessageId: null,
          slotId: "slot_01",
        }),
      ],
      messageEvents: [
        {
          id: "por_out_1",
          tenantId: TENANT,
          operatorId: OPERATOR,
          customerId: "cust_stable_1",
          customerName: "Mei Lin",
          rawPhone: "+12135550141",
          direction: "outbound",
          source: "device_observed",
          providerMessageId: "gmsg_out_99",
          messageId: "msg_1",
          territoryId: "silver-lake",
          replyText: "Hey Mei, checking in.",
          body: "Hey Mei, checking in.",
          classification: "outbound_sent",
          nextStepKind: "outbound_send_observed",
          nextAction:
            "Outbound send observed (device observed). The recovery objective stays open until a paid order is admitted.",
          preparedFollowUpDraft: null,
          permissionEffect: "none",
          provenance: "device_observed",
          surface: "device_connector",
          reportedAt: "2026-10-15T17:15:00.000Z",
          observedAt: "2026-10-15T17:15:00.000Z",
        },
      ],
      objective,
      now: NOW,
    });
    const villager = afterOutboundEvent.mission.targets[0]!;
    expect(villager.communicationState).toBe("send_observed");
    expect(villager.pose).toBe("acknowledged");
    expect(villager.outreachActionComplete).toBe(true);
    expect(villager.objectiveComplete).toBe(false);
    expect(villager.paidOrder.status).toBe("unavailable");
  });

  it("blocks consent when an observed reply is an opt-out", () => {
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: mission([target()]),
      messages: [],
      replies: [
        {
          id: "por_reply_stop",
          tenantId: TENANT,
          operatorId: OPERATOR,
          customerId: "cust_stable_1",
          customerName: "Mei Lin",
          messageId: null,
          territoryId: "silver-lake",
          replyText: "STOP",
          classification: "opt_out",
          nextStepKind: "opt_out_recorded",
          nextAction:
            "Mei Lin opted out (provider webhook). Communication permission is now blocked; do not send further outreach.",
          preparedFollowUpDraft: null,
          permissionEffect: "opted_out",
          provenance: "provider_webhook",
          source: "provider_webhook",
          direction: "inbound",
          surface: "provider_webhook",
          reportedAt: "2026-10-15T17:45:00.000Z",
        },
      ],
      objective,
      now: NOW,
    });

    const villager = surfaces.mission.targets[0]!;
    expect(villager.communicationState).toBe("consent_blocked");
    expect(villager.hasConsent).toBe(false);
    expect(villager.consentStatus).toBe("blocked_opt_out");
    expect(villager.reply.status).toBe("provider_webhook");
    expect(villager.paidOrder.status).toBe("unavailable");
    expect(villager.objectiveComplete).toBe(false);
  });
});
