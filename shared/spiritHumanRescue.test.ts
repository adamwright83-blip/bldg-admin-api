import { describe, expect, it } from "vitest";
import {
  applyLaterConsequence,
  CONSEQUENCE_KINDS,
  canCompleteRescue,
  composeReactivationDraft,
  emptySendRecord,
  isDuplicateSendBlocked,
  canRetrySend,
  canClaimOutboundSend,
  isSendClaimLocked,
  missionLifecycleFromSend,
  publicMissionHasNoPhone,
  selectVillagerIndependentOfCustomer,
  SPIRIT_HUMAN_VILLAGERS,
  type RescueSendRecord,
  type SpiritHumanRescueMission,
} from "./spiritHumanRescue";

function mission(overrides: Partial<SpiritHumanRescueMission> = {}): SpiritHumanRescueMission {
  const send = emptySendRecord("mission-1");
  return {
    missionId: "mission-1",
    tenantId: "tenant-a",
    operatorUserId: "op-a",
    kind: "spirit_human_rescue",
    lifecycle: "available",
    villager: SPIRIT_HUMAN_VILLAGERS[0]!,
    spiritHuman: {
      snapshotCustomerId: "cust_abc123",
      firstName: "Maya",
      lastOrderAt: "2026-07-01T12:00:00.000Z",
      daysSinceLastOrder: 78,
    },
    draft: null,
    send,
    consequences: [],
    opsTaskId: 41,
    deferredAt: null,
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    ...overrides,
  };
}

function sentRecord(): RescueSendRecord {
  return {
    ...emptySendRecord("mission-1"),
    status: "sent",
    approvedByUserId: "op-a",
    attemptedAt: "2026-09-17T01:00:00.000Z",
    acceptedAt: "2026-09-17T01:00:01.000Z",
    providerMessageId: "SM123",
    providerStatus: "queued",
    evidenceName: "provider_accepted",
    failureReason: null,
  };
}

describe("Spirit Human rescue contract", () => {
  it("does not complete from draft, preview, approval, or local CTA", () => {
    expect(canCompleteRescue(emptySendRecord("m"))).toBe(false);
    expect(canCompleteRescue({ ...emptySendRecord("m"), status: "draft_ready" })).toBe(false);
    expect(
      canCompleteRescue({
        ...emptySendRecord("m"),
        status: "awaiting_approval",
        approvedByUserId: "op-a",
      })
    ).toBe(false);
    expect(canCompleteRescue({ ...emptySendRecord("m"), status: "sending" })).toBe(false);
    expect(canCompleteRescue({ ...emptySendRecord("m"), status: "send_failed" })).toBe(false);
  });

  it("completes only after provider-accepted send with a message id", () => {
    expect(canCompleteRescue(sentRecord())).toBe(true);
    expect(
      canCompleteRescue({
        ...sentRecord(),
        providerMessageId: null,
      })
    ).toBe(false);
  });

  it("maps send success to completed and failure to problem", () => {
    expect(
      missionLifecycleFromSend({ entered: true, sendStatus: "sent", deferred: false, superseded: false })
    ).toBe("completed");
    expect(
      missionLifecycleFromSend({
        entered: true,
        sendStatus: "send_failed",
        deferred: false,
        superseded: false,
      })
    ).toBe("problem");
  });

  it("blocks duplicate send after sent or in-flight", () => {
    expect(isDuplicateSendBlocked(sentRecord())).toBe(true);
    expect(isDuplicateSendBlocked({ ...emptySendRecord("m"), status: "sending" })).toBe(true);
    expect(isDuplicateSendBlocked(emptySendRecord("m"))).toBe(false);
  });

  it("keeps later reply/order from rewriting the send", () => {
    const completed = mission({ send: sentRecord(), lifecycle: "completed" });
    const withReply = applyLaterConsequence(completed, {
      kind: "customer_replied",
      observedAt: "2026-09-18T00:00:00.000Z",
      evidenceId: "sms-in-1",
    });
    expect(withReply.send).toEqual(completed.send);
    expect(withReply.lifecycle).toBe("completed");
    const withOrder = applyLaterConsequence(withReply, {
      kind: "customer_ordered",
      observedAt: "2026-09-19T00:00:00.000Z",
      evidenceId: "order-99",
    });
    expect(withOrder.send.providerMessageId).toBe("SM123");
    expect(withOrder.consequences.map(item => item.kind)).toEqual([
      "customer_replied",
      "customer_ordered",
    ]);
    const duplicate = applyLaterConsequence(withReply, {
      kind: "customer_replied",
      observedAt: "2026-09-18T00:00:01.000Z",
      evidenceId: "sms-in-1",
    });
    expect(duplicate.consequences).toHaveLength(1);
  });

  it("does not treat absence of a reply as verified truth", () => {
    expect(CONSEQUENCE_KINDS).toEqual(["customer_replied", "customer_ordered"]);
    expect(CONSEQUENCE_KINDS).not.toContain("no_response");
  });

  it("selects villagers independently of customer identity", () => {
    const a = selectVillagerIndependentOfCustomer("mission-aaa");
    const b = selectVillagerIndependentOfCustomer("mission-aaa");
    expect(a).toEqual(b);
    const names = new Set(
      ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"].map(
        id => selectVillagerIndependentOfCustomer(id).id
      )
    );
    expect(names.size).toBeGreaterThan(1);
  });

  it("keeps phones out of the public mission payload", () => {
    const row = mission({
      spiritHuman: {
        snapshotCustomerId: "cust_no_phone",
        firstName: "Alex",
        lastOrderAt: "2026-07-01T12:00:00.000Z",
        daysSinceLastOrder: 40,
      },
    });
    expect(publicMissionHasNoPhone(row)).toBe(true);
    expect(publicMissionHasNoPhone({
      ...row,
      draft: "Call me at 310-555-0199",
    })).toBe(false);
  });

  it("composes a truthful draft without invented offers or shame", () => {
    const draft = composeReactivationDraft({
      snapshotCustomerId: "cust_x",
      firstName: "Alex",
      buildingName: "Opus LA",
      lastOrderAt: "2026-07-04T12:00:00.000Z",
      daysSinceLastOrder: 75,
    });
    expect(draft).toContain("Alex");
    expect(draft.toLowerCase()).not.toMatch(/free|discount|sorry|disappointed/);
    expect(draft).not.toMatch(/Reply YES/i);
    expect(draft.toLowerCase()).not.toContain("claire");
  });

  it("keeps NOT NOW (deferred) distinct from CANCEL (skipped)", () => {
    expect(
      missionLifecycleFromSend({
        entered: false,
        sendStatus: "draft_ready",
        deferred: true,
        superseded: false,
      })
    ).toBe("available");
    expect(
      missionLifecycleFromSend({
        entered: false,
        sendStatus: "cancelled",
        deferred: false,
        superseded: false,
      })
    ).toBe("skipped");
    expect(isDuplicateSendBlocked({ ...emptySendRecord("m"), status: "send_outcome_unknown" })).toBe(
      true
    );
    expect(canRetrySend({ status: "send_failed" })).toBe(true);
    expect(canRetrySend({ status: "send_outcome_unknown" })).toBe(false);
    expect(canRetrySend({ status: "sending" })).toBe(false);
    expect(isSendClaimLocked({ status: "sending" })).toBe(true);
    expect(isSendClaimLocked({ status: "send_outcome_unknown" })).toBe(true);
    expect(isSendClaimLocked({ status: "sent" })).toBe(true);
    expect(isSendClaimLocked({ status: "draft_ready" })).toBe(false);
    expect(
      canClaimOutboundSend({
        lifecycle: "superseded",
        send: emptySendRecord("m"),
      })
    ).toBe(false);
    expect(
      canClaimOutboundSend({
        lifecycle: "active",
        send: emptySendRecord("m"),
      })
    ).toBe(true);
    expect(
      missionLifecycleFromSend({
        entered: true,
        sendStatus: "send_outcome_unknown",
        deferred: false,
        superseded: false,
      })
    ).toBe("problem");
  });
});
