import { beforeEach, describe, expect, it } from "vitest";
import { projectCozyRecoverySurfaces } from "../../../../shared/cozyVillagerEvidence";
import { checkCommunicationPermission } from "../../../strategy/communicationPermissionService";
import {
  commitPersonalOutreachDraft,
  sendCozyOutreachNow,
} from "../cozyVillagerOutreachService";
import {
  classifyPersonalOutreachReply,
  listPersonalOutreachReplies,
  prepareNextStepFromPersonalReply,
  recordMessagingEvidenceEvent,
  recordPersonalOutreachReply,
  resetPersonalOutreachReplyMemoryForTest,
  setForceFailNextReplyPersistenceForTest,
} from "./personalOutreachReplyService";

const TENANT = "tenant_reply_test";
const OTHER_TENANT = "tenant_other_isolated";
const OPERATOR = "op_reply_test";
const OTHER_OPERATOR = "op_other_test";

describe("personalOutreachReplyService — transport-agnostic messaging evidence engine", () => {
  beforeEach(() => {
    resetPersonalOutreachReplyMemoryForTest();
  });

  it("classifies pickup interest, questions, complaints, deferrals, and opt-outs deterministically", () => {
    expect(classifyPersonalOutreachReply("Can you pick up 2 bags Thursday morning?")).toBe(
      "pickup_interest"
    );
    expect(classifyPersonalOutreachReply("How much do you charge per pound for wash and fold?")).toBe(
      "question"
    );
    expect(classifyPersonalOutreachReply("You shrunk my sweater last time and I'm upset")).toBe(
      "complaint"
    );
    expect(classifyPersonalOutreachReply("We're out of town for the next two weeks, not right now")).toBe(
      "not_now"
    );
    expect(classifyPersonalOutreachReply("STOP")).toBe("opt_out");
    expect(classifyPersonalOutreachReply("Please stop texting me", "pickup_interest")).toBe(
      "opt_out"
    );
  });

  it("prepares grounded follow-up drafts with zero unverified turnaround or pricing promises", () => {
    const questionStep = prepareNextStepFromPersonalReply({
      customerName: "Mei Lin",
      replyText: "How fast is your turnaround and how much per pound?",
      classification: "question",
      source: "device_observed",
    });
    expect(questionStep.preparedFollowUpDraft).toBeTruthy();
    expect(questionStep.preparedFollowUpDraft).not.toMatch(/next-day|24\s*hour|\$/i);

    const pickupStep = prepareNextStepFromPersonalReply({
      customerName: "Mei Lin",
      replyText: "Can you pick up Thursday?",
      classification: "pickup_interest",
      source: "provider_webhook",
    });
    expect(pickupStep.preparedFollowUpDraft).toBeTruthy();
    expect(pickupStep.preparedFollowUpDraft).not.toMatch(/next-day|24\s*hour|\$/i);
  });

  it("keeps provider_webhook, device_observed, and operator_reported evidence levels strictly separate and supports unmatched raw numbers", async () => {
    const webhookIn = await recordMessagingEvidenceEvent({
      tenantId: TENANT,
      operatorId: OPERATOR,
      source: "provider_webhook",
      direction: "inbound",
      customerId: "cust_1",
      customerName: "Mei Lin",
      rawPhone: "+12135550141",
      providerMessageId: "SM_webhook_1",
      body: "Can you pick up tomorrow morning?",
      observedAt: "2026-10-17T18:00:00.000Z",
    });
    const deviceOut = await recordMessagingEvidenceEvent({
      tenantId: TENANT,
      operatorId: OPERATOR,
      source: "device_observed",
      direction: "outbound",
      customerId: null,
      rawPhone: "(213) 555-0199",
      providerMessageId: "gmsg_out_1",
      body: "Hey! Just checking in.",
      observedAt: "2026-10-17T18:01:00.000Z",
    });
    const operatorFallback = await recordMessagingEvidenceEvent({
      tenantId: TENANT,
      operatorId: OPERATOR,
      source: "operator_reported",
      direction: "inbound",
      customerId: "cust_2",
      customerName: "Barnaby Hayes",
      body: "Not right now, out of town",
      observedAt: "2026-10-17T18:02:00.000Z",
    });

    expect(webhookIn.source).toBe("provider_webhook");
    expect(webhookIn.provenance).toBe("provider_webhook");
    expect(webhookIn.direction).toBe("inbound");

    expect(deviceOut.source).toBe("device_observed");
    expect(deviceOut.provenance).toBe("device_observed");
    expect(deviceOut.direction).toBe("outbound");
    expect(deviceOut.customerId).toBeNull();
    expect(deviceOut.rawPhone).toBe("+12135550199");

    expect(operatorFallback.source).toBe("operator_reported");
    expect(operatorFallback.provenance).toBe("operator_reported");

    const webhookOnly = await listPersonalOutreachReplies({
      tenantId: TENANT,
      operatorId: OPERATOR,
      source: "provider_webhook",
    });
    expect(webhookOnly).toHaveLength(1);
    expect(webhookOnly[0]?.id).toBe(webhookIn.id);

    const outboundOnly = await listPersonalOutreachReplies({
      tenantId: TENANT,
      operatorId: OPERATOR,
      direction: "outbound",
    });
    expect(outboundOnly).toHaveLength(1);
    expect(outboundOnly[0]?.id).toBe(deviceOut.id);
  });

  it("prepares a draft only on a pickup reply without sending, ordering, or completing the objective", async () => {
    const saved = await recordMessagingEvidenceEvent({
      tenantId: TENANT,
      operatorId: OPERATOR,
      source: "device_observed",
      direction: "inbound",
      customerId: "cust_mei_1",
      customerName: "Mei Lin",
      rawPhone: "+12135550141",
      providerMessageId: "gmsg_in_42",
      body: "Yes please! Can we do a pickup tomorrow morning?",
      messageId: "som_1",
      territoryId: "silver-lake",
      observedAt: new Date("2026-10-17T18:00:00.000Z"),
    });

    expect(saved.provenance).toBe("device_observed");
    expect(saved.classification).toBe("pickup_interest");
    expect(saved.nextStepKind).toBe("prepare_pickup_follow_up");
    expect(saved.permissionEffect).toBe("none");
    expect(saved.preparedFollowUpDraft).toContain("Thanks Mei!");

    const projected = projectCozyRecoverySurfaces({
      tenantId: TENANT,
      operatorId: OPERATOR,
      mission: {
        missionId: "mission_winback_silver-lake",
        title: "Claire's Recovery Mission: Silver Lake",
        objective: "Recover dormant laundry customers in Silver Lake",
        territoryId: "silver-lake",
        territoryName: "Silver Lake",
        totalLapsedInTerritory: 1,
        activeTargetCount: 1,
        targets: [
          {
            slotId: "slot_01",
            customerId: "cust_mei_1",
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
          },
        ],
      },
      messages: [],
      replies: [saved],
      objective: {
        id: "goal_silver_lake_recovery",
        statement: "Recover dormant laundry customers in Silver Lake",
        areaLabel: "Silver Lake",
      },
      now: new Date("2026-10-17T18:01:00.000Z"),
    });

    const villager = projected.mission.targets[0]!;
    expect(villager.communicationState).toBe("draft_prepared");
    expect(villager.preparedMessage).toBe(saved.preparedFollowUpDraft);
    expect(villager.outreachActionComplete).toBe(false);
    expect(villager.objectiveComplete).toBe(false);
    expect(villager.paidOrder.status).toBe("unavailable");
    expect(projected.dayLineCard?.objectiveComplete).toBe(false);
    expect(projected.dayLineCard?.outreachActionComplete).toBe(false);
    expect(projected.dayLineCard?.paidOrder.status).toBe("unavailable");
  });

  it("fails closed when persistence fails and never leaves a phantom row in memory", async () => {
    setForceFailNextReplyPersistenceForTest(true);
    await expect(
      recordMessagingEvidenceEvent({
        tenantId: TENANT,
        operatorId: OPERATOR,
        source: "device_observed",
        direction: "inbound",
        customerId: "cust_fail_closed",
        customerName: "Mei Lin",
        body: "STOP",
        observedAt: new Date("2026-10-17T18:00:00.000Z"),
      })
    ).rejects.toThrow(/persistence failure/i);

    const listAfterFailure = await listPersonalOutreachReplies({
      tenantId: TENANT,
      operatorId: OPERATOR,
    });
    expect(listAfterFailure).toHaveLength(0);
  });

  it("enforces strict tenant and operator isolation so another tenant cannot read or project replies", async () => {
    const saved = await recordPersonalOutreachReply({
      tenantId: TENANT,
      operatorId: OPERATOR,
      customerId: "cust_mei_1",
      customerName: "Mei Lin",
      replyText: "Can you swing by Friday?",
      now: new Date("2026-10-17T18:02:00.000Z"),
    });

    const otherTenantList = await listPersonalOutreachReplies({
      tenantId: OTHER_TENANT,
      operatorId: OPERATOR,
    });
    expect(otherTenantList).toHaveLength(0);

    const otherOperatorList = await listPersonalOutreachReplies({
      tenantId: TENANT,
      operatorId: OTHER_OPERATOR,
    });
    expect(otherOperatorList).toHaveLength(0);

    await recordPersonalOutreachReply({
      tenantId: OTHER_TENANT,
      operatorId: OPERATOR,
      customerId: "cust_mei_1",
      customerName: "Mei Lin",
      replyText: "STOP",
      now: new Date("2026-10-17T18:03:00.000Z"),
    });

    const tenantList = await listPersonalOutreachReplies({
      tenantId: TENANT,
      operatorId: OPERATOR,
    });
    expect(tenantList).toHaveLength(1);
    expect(tenantList[0]?.id).toBe(saved.id);
    expect(tenantList[0]?.classification).toBe("pickup_interest");

    const tenantPerm = await checkCommunicationPermission({
      tenantId: TENANT,
      subjectType: "customer",
      subjectId: "cust_mei_1",
      channel: "sms",
    });
    expect(tenantPerm.allowed).toBe(true);
  });

  it("never treats a complaint as a positive buying signal", async () => {
    const saved = await recordPersonalOutreachReply({
      tenantId: TENANT,
      operatorId: OPERATOR,
      customerId: "cust_barnaby_2",
      customerName: "Barnaby Hayes",
      replyText: "My dress shirts came back stained last order.",
      now: new Date("2026-10-17T18:05:00.000Z"),
    });

    expect(saved.classification).toBe("complaint");
    expect(saved.nextStepKind).toBe("operator_service_recovery");
    expect(saved.nextAction).toContain("Do not pitch a win-back offer");
    expect(saved.preparedFollowUpDraft).toContain("sorry about that experience");
  });

  it("immediately blocks future SMS and any-channel drafts when an opt-out reply is recorded", async () => {
    const customerId = "cust_opt_out_99";
    const before = await checkCommunicationPermission({
      tenantId: TENANT,
      subjectType: "customer",
      subjectId: customerId,
      channel: "sms",
    });
    expect(before.allowed).toBe(true);

    const saved = await recordPersonalOutreachReply({
      tenantId: TENANT,
      operatorId: OPERATOR,
      customerId,
      customerName: "Alex Rivera",
      replyText: "STOP",
      now: new Date("2026-10-17T18:10:00.000Z"),
    });

    expect(saved.classification).toBe("opt_out");
    expect(saved.permissionEffect).toBe("opted_out");
    expect(saved.preparedFollowUpDraft).toBeNull();

    const afterSms = await checkCommunicationPermission({
      tenantId: TENANT,
      subjectType: "customer",
      subjectId: customerId,
      channel: "sms",
    });
    expect(afterSms.allowed).toBe(false);
    expect(afterSms.permissionStatus).toBe("opted_out");

    const afterAny = await checkCommunicationPermission({
      tenantId: TENANT,
      subjectType: "customer",
      subjectId: customerId,
      channel: "any",
    });
    expect(afterAny.allowed).toBe(false);
    expect(afterAny.permissionStatus).toBe("opted_out");

    await expect(
      commitPersonalOutreachDraft({
        tenantId: TENANT,
        operatorId: OPERATOR,
        customerId,
        messageBody: "Trying to schedule another draft after STOP",
        scheduledFor: "2026-10-18T17:00:00.000Z",
        now: new Date("2026-10-17T18:11:00.000Z"),
      })
    ).rejects.toThrow(/opted out/i);

    await expect(
      sendCozyOutreachNow({
        tenantId: TENANT,
        operatorId: OPERATOR,
        customerId,
        messageBody: "Trying to send now after STOP",
        now: new Date("2026-10-17T18:11:00.000Z"),
      })
    ).rejects.toThrow(/opted out/i);
  });
});
