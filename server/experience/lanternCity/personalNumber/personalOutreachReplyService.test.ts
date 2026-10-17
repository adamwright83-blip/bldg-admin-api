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
  recordPersonalOutreachReply,
  resetPersonalOutreachReplyMemoryForTest,
} from "./personalOutreachReplyService";

const TENANT = "tenant_reply_test";
const OTHER_TENANT = "tenant_other_isolated";
const OPERATOR = "op_reply_test";
const OTHER_OPERATOR = "op_other_test";

describe("personalOutreachReplyService", () => {
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
    // Explicit STOP overrides an accidental positive classification selection
    expect(classifyPersonalOutreachReply("Please stop texting me", "pickup_interest")).toBe(
      "opt_out"
    );
  });

  it("prepares a draft only on a pickup reply without sending, ordering, or completing the objective", async () => {
    const saved = await recordPersonalOutreachReply({
      tenantId: TENANT,
      operatorId: OPERATOR,
      customerId: "cust_mei_1",
      customerName: "Mei Lin",
      replyText: "Yes please! Can we do a pickup tomorrow morning?",
      messageId: "som_1",
      territoryId: "silver-lake",
      now: new Date("2026-10-17T18:00:00.000Z"),
    });

    expect(saved.provenance).toBe("operator_reported");
    expect(saved.classification).toBe("pickup_interest");
    expect(saved.nextStepKind).toBe("prepare_pickup_follow_up");
    expect(saved.permissionEffect).toBe("none");
    expect(saved.preparedFollowUpDraft).toContain("Awesome Mei!");
    expect(saved.nextAction).toContain("before opening Google Messages");

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
    // Prepares draft only; nothing is sent or ordered, and objectiveComplete / paidOrder stay false/unavailable
    expect(villager.communicationState).toBe("draft_prepared");
    expect(villager.preparedMessage).toBe(saved.preparedFollowUpDraft);
    expect(villager.outreachActionComplete).toBe(false);
    expect(villager.objectiveComplete).toBe(false);
    expect(villager.paidOrder.status).toBe("unavailable");
    expect(projected.dayLineCard?.objectiveComplete).toBe(false);
    expect(projected.dayLineCard?.outreachActionComplete).toBe(false);
    expect(projected.dayLineCard?.paidOrder.status).toBe("unavailable");
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

    // Another tenant with the same operatorId cannot read the reply
    const otherTenantList = await listPersonalOutreachReplies({
      tenantId: OTHER_TENANT,
      operatorId: OPERATOR,
    });
    expect(otherTenantList).toHaveLength(0);

    // Another operator in the same tenant cannot read the reply
    const otherOperatorList = await listPersonalOutreachReplies({
      tenantId: TENANT,
      operatorId: OTHER_OPERATOR,
    });
    expect(otherOperatorList).toHaveLength(0);

    // Writing a reply in OTHER_TENANT does not leak into TENANT
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

    // Communication permission in TENANT remains allowed even though OTHER_TENANT recorded STOP for the same customerId
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
    expect(saved.preparedFollowUpDraft).toContain("make it right");
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
