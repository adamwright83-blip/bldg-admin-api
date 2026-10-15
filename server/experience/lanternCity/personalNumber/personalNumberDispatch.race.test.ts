import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach } from "vitest";
import { recordCommunicationPermission } from "../../../strategy/communicationPermissionService";
import {
  _resetScheduledOutreachMemoryStore,
  cancelScheduledOutreachDraft,
  claimDueOutreachLeases,
  createScheduledOutreachDraft,
  listScheduledOutreachMessages,
  rescheduleOutreachDraft,
  sendEarlyOutreachDraft,
} from "../scheduledOutreachService";
import {
  _resetPersonalSenderIdentityStore,
  getPersonalSenderStatus,
  recordPersonalSenderObservation,
} from "./personalSenderIdentityStore";
import {
  createSimulatedPersonalTransport,
  type PersonalNumberTransport,
  type SimulatedScript,
} from "./androidDeviceSender";

const tenantId = "tenant_android_sender";
const operatorId = "op_android_sender";
const senderPhone = "+12135550100";
const recipientPhone = "+12135550141";
const now = new Date("2026-10-15T18:00:00.000Z");

function transport(script: SimulatedScript, overrides: Record<string, unknown> = {}) {
  return createSimulatedPersonalTransport({
    script,
    observedSenderPhone: senderPhone,
    authorizedSenderPhone: senderPhone,
    observedDeviceId: "pixel-operator",
    authorizedDeviceId: "pixel-operator",
    authorizedRecipientPhone: recipientPhone,
    humanGateBypassForTest: true,
    ...overrides,
  });
}

async function pendingDraft(overrides: Record<string, unknown> = {}) {
  return createScheduledOutreachDraft({
    tenantId,
    operatorId,
    customerId: `cust_${Math.random().toString(16).slice(2)}`,
    customerName: "Mei",
    recipientPhone,
    originalSuggestedDraft: "Hi Mei",
    messageBody: "Hi Mei",
    scheduledFor: new Date(now.getTime() + 60 * 60_000),
    now,
    ...overrides,
  });
}

async function row(messageId: string) {
  const rows = await listScheduledOutreachMessages({ tenantId, operatorId, limit: 100 });
  const found = rows.find((item) => item.id === messageId);
  if (!found) throw new Error(`missing draft ${messageId}`);
  return found;
}

describe("personal-number dispatch races", () => {
  beforeEach(() => {
    _resetScheduledOutreachMemoryStore();
    _resetPersonalSenderIdentityStore();
  });

  it("does not transmit when no handset transport is injected", async () => {
    const draft = await pendingDraft();
    const result = await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      leaseHolder: "operator_early",
      now,
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe("awaiting_sender_setup");
    expect(result.carrierDeliveryObserved).toBe(false);
    expect(result.blockReason).toMatch(/BLOCKED/);
    expect(result.blockReason).toMatch(/DOM click is not proof of send/);
    const stored = await row(draft.id);
    expect(stored.status).toBe("pending");
    expect(stored.dispatchAttemptedAt).toBeNull();
  });

  it("refuses a simulated send when the human gate was not bypassed", async () => {
    const draft = await pendingDraft();
    const simulated = transport("verified", { humanGateBypassForTest: false });
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "operator_early",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/Silence is not approval/);
    expect(simulated.executeCount).toBe(0);
    expect((await row(draft.id)).status).toBe("pending");
    expect((await row(draft.id)).dispatchAttemptedAt).toBeNull();
  });

  it.each([
    ["wrong_sender", { observedSenderPhone: "+12135550999" }, /originating number does not match/],
    ["wrong_device", { observedDeviceId: "someone-elses-phone" }, /does not match the authorized personal device/],
    ["wrong_recipient", { authorizedRecipientPhone: "+12135550199" }, /destination does not match/],
    ["malformed_sender", { observedSenderPhone: "555" }, /originating personal number is missing or malformed/],
    ["malformed_recipient", {}, /destination number is missing or malformed/],
    ["lost_pairing", {}, /pairing was lost/],
    ["offline", {}, /offline/],
  ] as const)("fails closed before transmission for %s", async (script, overrides, pattern) => {
    const draft = await pendingDraft();
    const simulated = transport(script, overrides);
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "operator_early",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(pattern);
    expect(simulated.executeCount).toBe(0);
    const stored = await row(draft.id);
    expect(stored.status).toBe("pending");
    expect(stored.dispatchAttemptedAt).toBeNull();
  });

  it("fails closed on a malformed stored destination before any transport call", async () => {
    const draft = await pendingDraft({ recipientPhone: "123456789012345" });
    const simulated = transport("verified");
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "operator_early",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/destination or message body could not be verified/);
    expect(simulated.preflightCount).toBe(0);
    expect(simulated.executeCount).toBe(0);
  });

  it("reverts a crash that happened before transmission started", async () => {
    const draft = await pendingDraft({
      scheduledFor: new Date(now.getTime() - 60_000),
      allowImmediate: true,
    });
    const simulated = transport("before_send_crash");
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_before",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/Crash before send/);
    expect(simulated.executeCount).toBe(1);
    const stored = await row(draft.id);
    expect(stored.status).toBe("pending");
    expect(stored.dispatchAttemptedAt).toBeNull();
    expect(stored.dispatchedAt).toBeNull();
  });

  it("does not retry after a crash that may already have sent", async () => {
    const draft = await pendingDraft({
      scheduledFor: new Date(now.getTime() - 60_000),
      allowImmediate: true,
    });
    const simulated = transport("ambiguous_after_possible_send");
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_ambiguous",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/Automatic retry is refused/);
    const stored = await row(draft.id);
    expect(stored.status).toBe("failed");
    expect(stored.dispatchAttemptedAt).not.toBeNull();
    expect(stored.dispatchedAt).toBeNull();
    expect(stored.externalMessageId).toBeNull();
    const claimed = await claimDueOutreachLeases({
      leaseHolder: "worker_retry",
      now: new Date(now.getTime() + 120_000),
    });
    expect(claimed.find((item) => item.id === draft.id)).toBeUndefined();
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_second",
        personalTransport: transport("verified"),
        now,
      })
    ).rejects.toThrow(/Only pending/);
  });

  it("does not invent a delivery receipt after an observed send", async () => {
    const draft = await pendingDraft();
    const simulated = transport("observed_without_receipt");
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_receipt",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/not carrier delivery/);
    const stored = await row(draft.id);
    expect(stored.status).toBe("failed");
    expect(stored.externalMessageId).toBeNull();
    expect(stored.failureReason).toMatch(/not a carrier delivery receipt|not carrier delivery/);
    expect(stored.dispatchAttemptedAt).not.toBeNull();
  });

  it("labels a simulated local observation and does not call it carrier delivery", async () => {
    const draft = await pendingDraft();
    const simulated = transport("verified");
    const result = await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      leaseHolder: "worker_sim",
      personalTransport: simulated,
      now,
    });
    expect(result.evidenceName).toBe("simulated_personal_send");
    expect(result.carrierDeliveryObserved).toBe(false);
    expect(result.message.externalMessageId).toMatch(/^simulated:local_/);
    expect(simulated.executeCount).toBe(1);
  });

  it("ignores a duplicate send after a simulated observation", async () => {
    const draft = await pendingDraft();
    const simulated = transport("verified");
    await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      leaseHolder: "worker_sim",
      personalTransport: simulated,
      now,
    });
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_sim_2",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/Only pending/);
    expect(simulated.executeCount).toBe(1);
  });

  it("lets only one of two dispatch workers transmit", async () => {
    const draft = await pendingDraft();
    const simulated = transport("verified", {
      beforeExecute: () => new Promise((resolve) => setTimeout(resolve, 20)),
    });
    const results = await Promise.allSettled([
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_a",
        personalTransport: simulated,
        now,
      }),
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_b",
        personalTransport: simulated,
        now,
      }),
    ]);
    const fulfilled = results.filter((item) => item.status === "fulfilled");
    const rejected = results.filter((item) => item.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(simulated.executeCount).toBe(1);
  });

  it("rejects an idempotency key reused for a different recipient", async () => {
    await pendingDraft({
      customerId: "cust_same",
      idempotencyKey: "outreach_key_1",
    });
    await expect(
      pendingDraft({
        customerId: "cust_other",
        recipientPhone: "+12135550199",
        idempotencyKey: "outreach_key_1",
      })
    ).rejects.toThrow(/different customer/);
  });

  it("returns the original draft when the same idempotency key is repeated", async () => {
    const first = await pendingDraft({
      customerId: "cust_same",
      idempotencyKey: "outreach_key_same",
    });
    const second = await pendingDraft({
      customerId: "cust_same",
      idempotencyKey: "outreach_key_same",
    });
    expect(second.id).toBe(first.id);
  });

  it("does not transmit when cancel wins before dispatch", async () => {
    const draft = await pendingDraft();
    await cancelScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      reason: "operator stopped it",
      now,
    });
    const simulated = transport("verified");
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_late",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/Only pending/);
    expect(simulated.executeCount).toBe(0);
    expect((await row(draft.id)).status).toBe("cancelled");
  });

  it("does not transmit when cancel is attempted during the held lease", async () => {
    const draft = await pendingDraft();
    const simulated = transport("verified", {
      beforeExecute: () =>
        cancelScheduledOutreachDraft({
          tenantId,
          operatorId,
          messageId: draft.id,
          reason: "stop during send",
          now,
        }),
    });
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_inflight",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/Automatic retry is refused/);
    expect(simulated.executeCount).toBe(0);
    const stored = await row(draft.id);
    expect(stored.status).toBe("failed");
    expect(stored.dispatchAttemptedAt).not.toBeNull();
    expect(stored.dispatchedAt).toBeNull();
  });

  it("does not transmit when reschedule is attempted during the held lease", async () => {
    const draft = await pendingDraft();
    const simulated = transport("verified", {
      beforeExecute: () =>
        rescheduleOutreachDraft({
          tenantId,
          operatorId,
          messageId: draft.id,
          newScheduledFor: "2026-10-16 09:00:00",
          now,
        }),
    });
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_reschedule",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/Automatic retry is refused/);
    expect(simulated.executeCount).toBe(0);
    expect((await row(draft.id)).dispatchedAt).toBeNull();
  });

  it("cancels instead of sending when permission is revoked before dispatch", async () => {
    const draft = await pendingDraft({ customerId: "cust_revoke_before" });
    await recordCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: "cust_revoke_before",
      channel: "sms",
      status: "opted_out",
      reason: "stop",
    });
    const simulated = transport("verified");
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_permission",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/no longer eligible/);
    expect(simulated.executeCount).toBe(0);
    expect((await row(draft.id)).status).toBe("cancelled");
  });

  it("cancels instead of sending when opt-out lands after the lease is held", async () => {
    const draft = await pendingDraft({ customerId: "cust_opt_out_mid" });
    const simulated = transport("verified", {
      beforeExecute: () =>
        recordCommunicationPermission({
          tenantId,
          subjectType: "customer",
          subjectId: "cust_opt_out_mid",
          channel: "sms",
          status: "opted_out",
          reason: "stop",
        }),
    });
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_opt_out",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/no longer eligible/);
    expect(simulated.executeCount).toBe(0);
    const stored = await row(draft.id);
    expect(stored.status).toBe("cancelled");
    expect(stored.dispatchAttemptedAt).toBeNull();
    expect(stored.dispatchedAt).toBeNull();
  });

  it("rejects a tenant or operator mismatch without transmitting", async () => {
    const draft = await pendingDraft();
    const simulated = transport("verified");
    await expect(
      sendEarlyOutreachDraft({
        tenantId: "other_tenant",
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_tenant",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/unauthorized/);
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId: "other_operator",
        messageId: draft.id,
        leaseHolder: "worker_operator",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/unauthorized/);
    expect(simulated.executeCount).toBe(0);
    expect((await row(draft.id)).status).toBe("pending");
  });

  it("does not let an old immediate draft transmit when the sender later looks connected", async () => {
    const draft = await pendingDraft({
      customerId: "cust_old_immediate",
      status: "awaiting_sender_setup",
      deliveryIntent: "immediate",
      allowImmediate: true,
      scheduledFor: new Date(now.getTime() - 24 * 60 * 60_000),
    });
    await recordPersonalSenderObservation({
      tenantId,
      operatorId,
      pairingPresent: true,
      displacesExistingWebSession: false,
      pageLoaded: true,
      deviceOnline: true,
      sessionObservedAt: now,
      originatingPhone: senderPhone,
      originatingPhoneVerified: true,
      observationSource: "android_telephony_line",
      deviceId: "pixel-operator",
      expectedDeviceId: "pixel-operator",
      transportProbeOk: true,
      now,
    });
    const status = await getPersonalSenderStatus({ tenantId, operatorId, now });
    expect(status.stateLabel).toBe("Connected");
    expect(status.authorizedToTransmit).toBe(false);
    const claimed = await claimDueOutreachLeases({
      leaseHolder: "worker_reconnect",
      now: new Date(now.getTime() + 60_000),
    });
    expect(claimed.find((item) => item.id === draft.id)).toBeUndefined();
    const simulated = transport("verified");
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "operator_reconnect",
        personalTransport: simulated,
        now,
      })
    ).rejects.toThrow(/awaiting_sender_setup/);
    expect(simulated.executeCount).toBe(0);
    expect((await row(draft.id)).status).toBe("awaiting_sender_setup");
    expect((await row(draft.id)).dispatchAttemptedAt).toBeNull();
  });

  it("marks a thrown transport as ambiguous and does not retry it", async () => {
    const draft = await pendingDraft({
      scheduledFor: new Date(now.getTime() - 60_000),
      allowImmediate: true,
    });
    const throwing: PersonalNumberTransport = {
      transportLabel: "simulated",
      preflight: () => ({ phase: "ready" }),
      async execute() {
        throw new Error("handset socket closed");
      },
    };
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_throw",
        personalTransport: throwing,
        now,
      })
    ).rejects.toThrow(/Automatic retry is refused/);
    const stored = await row(draft.id);
    expect(stored.status).toBe("failed");
    expect(stored.dispatchAttemptedAt).not.toBeNull();
    const claimed = await claimDueOutreachLeases({
      leaseHolder: "worker_throw_retry",
      now: new Date(now.getTime() + 120_000),
    });
    expect(claimed.find((item) => item.id === draft.id)).toBeUndefined();
  });

  it("keeps personal-number modules off the Twilio adapter", () => {
    const files = [
      "server/experience/lanternCity/scheduledOutreachService.ts",
      "server/experience/lanternCity/cozyVillagerOutreachService.ts",
      "server/experience/lanternCity/personalNumber/androidDeviceSender.ts",
      "server/experience/lanternCity/personalNumber/googleMessagesBrowserTransport.ts",
      "server/experience/lanternCity/personalNumber/personalSenderIdentityStore.ts",
      "server/experience/lanternCity/personalNumber/personalSenderHealth.ts",
      "server/composition/goldlineWorldRouter.ts",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/twilioOutboundSendAdapter/);
      expect(source).not.toMatch(/sendSMSWithReceipt/);
    }
  });
});
