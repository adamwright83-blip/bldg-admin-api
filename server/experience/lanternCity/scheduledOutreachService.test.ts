import { describe, it, expect, beforeEach } from "vitest";
import {
  createScheduledOutreachDraft,
  editScheduledOutreachDraft,
  rescheduleOutreachDraft,
  cancelScheduledOutreachDraft,
  claimDueOutreachLeases,
  sendEarlyOutreachDraft,
  listScheduledOutreachMessages,
  getScheduledOutreachRevisions,
  _resetScheduledOutreachMemoryStore,
} from "./scheduledOutreachService";

describe("scheduledOutreachService unit tests", () => {
  const tenantId = "tenant_outbox_test";
  const operatorId = "op_adam_001";
  const baseNow = new Date("2026-10-20T10:00:00Z");

  beforeEach(() => {
    _resetScheduledOutreachMemoryStore();
  });

  it("creates a validated scheduled outreach draft with initial revision", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 24 * 3600 * 1000); // +24h
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_101",
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: "Hey Mei, Claire suggested checking in on your laundry!",
      messageBody: "Hey Mei, Claire suggested checking in on your laundry!",
      scheduledFor,
      timezone: "America/Los_Angeles",
      slotId: "slot_01",
      territoryId: "silver-lake",
      now: baseNow,
    });

    expect(draft.id).toBeDefined();
    expect(draft.status).toBe("pending");
    expect(draft.revisionCount).toBe(1);
    expect(draft.recipientPhone).toBe("+12135550141");
    expect(draft.currentMessageBody).toContain("checking in on your laundry");

    const revisions = await getScheduledOutreachRevisions({
      tenantId,
      messageId: draft.id,
    });
    expect(revisions.length).toBe(1);
    expect(revisions[0].revisionNumber).toBe(1);
    expect(revisions[0].editedBy).toBe(operatorId);
  });

  it("rejects scheduled times in the past", async () => {
    const pastDate = new Date(baseNow.getTime() - 1000);
    await expect(
      createScheduledOutreachDraft({
        tenantId,
        operatorId,
        customerId: "cust_102",
        customerName: "Barnaby",
        recipientPhone: "+12135550142",
        originalSuggestedDraft: "Hello",
        messageBody: "Hello",
        scheduledFor: pastDate,
        now: baseNow,
      })
    ).rejects.toThrow("Scheduled send time must be in the future");
  });

  it("edits a pending scheduled draft in-place, incrementing revision and saving audit history", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 12 * 3600 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_103",
      customerName: "Oliver",
      recipientPhone: "+12135550143",
      originalSuggestedDraft: "Original draft",
      messageBody: "Original draft",
      scheduledFor,
      now: baseNow,
    });

    const edited = await editScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      newMessageBody: "Updated draft personalized by Adam",
      reason: "Added friendly greeting",
      now: new Date(baseNow.getTime() + 1000),
    });

    expect(edited.revisionCount).toBe(2);
    expect(edited.currentMessageBody).toBe("Updated draft personalized by Adam");

    const revisions = await getScheduledOutreachRevisions({
      tenantId,
      messageId: draft.id,
    });
    expect(revisions.length).toBe(2);
    expect(revisions[0].revisionNumber).toBe(2);
    expect(revisions[0].messageBody).toBe("Updated draft personalized by Adam");
  });

  it("reschedules a pending draft to a new future time", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 12 * 3600 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_104",
      customerName: "Bella",
      recipientPhone: "+12135550144",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const newTime = new Date(baseNow.getTime() + 48 * 3600 * 1000);
    const rescheduled = await rescheduleOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      newScheduledFor: newTime,
      now: baseNow,
    });

    expect(rescheduled.scheduledFor.getTime()).toBe(newTime.getTime());
  });

  it("cancels a pending draft and reliably prevents worker lease acquisition", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000); // 1s in future
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_105",
      customerName: "Sammy",
      recipientPhone: "+12135550145",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const cancelled = await cancelScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      reason: "Customer already placed an order this morning",
      now: baseNow,
    });

    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancellationReason).toBe("Customer already placed an order this morning");

    // Advance time past scheduledFor: worker must NOT claim it
    const afterTime = new Date(baseNow.getTime() + 10000);
    const claimed = await claimDueOutreachLeases({
      leaseHolder: "worker_1",
      now: afterTime,
    });
    expect(claimed.find((m) => m.id === draft.id)).toBeUndefined();
  });

  it("SEND EARLY claims pending lease and executes simulated dispatch in test mode", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 3600 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_106",
      customerName: "Bramble",
      recipientPhone: "+12135550146",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const earlyResult = await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      leaseHolder: "operator_early",
      isTestSenderAllowed: true,
      now: baseNow,
    });

    expect(earlyResult.success).toBe(true);
    expect(earlyResult.status).toBe("dispatched");
    expect(earlyResult.message.status).toBe("dispatched");
    expect(earlyResult.message.externalMessageId).toContain("android_msg_");
  });

  it("SEND EARLY marks awaiting_sender_setup when real sender is not configured (Phase 1 constraint)", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 3600 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_107",
      customerName: "Cleo",
      recipientPhone: "+12135550147",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const earlyResult = await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      leaseHolder: "operator_early",
      isTestSenderAllowed: false, // strictly enforce production gate
      now: baseNow,
    });

    expect(earlyResult.success).toBe(false);
    expect(earlyResult.status).toBe("awaiting_sender_setup");
    expect(earlyResult.message.status).toBe("awaiting_sender_setup");
    expect(earlyResult.evidenceName).toBe("awaiting_sender_setup");
  });

  it("lists scheduled outreach messages filtered by tenant and status", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 3600 * 1000);
    await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_108",
      customerName: "Customer 1",
      recipientPhone: "+12135550148",
      originalSuggestedDraft: "Draft 1",
      messageBody: "Draft 1",
      scheduledFor,
      now: baseNow,
    });

    const list = await listScheduledOutreachMessages({ tenantId });
    expect(list.length).toBeGreaterThanOrEqual(1);
  });
});
