import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createScheduledOutreachDraft,
  editScheduledOutreachDraft,
  rescheduleOutreachDraft,
  cancelScheduledOutreachDraft,
  claimDueOutreachLeases,
  sendEarlyOutreachDraft,
  listScheduledOutreachMessages,
  getScheduledOutreachRevisions,
  normalizeScheduledForUtc,
  _resetScheduledOutreachMemoryStore,
} from "./scheduledOutreachService";

describe("scheduledOutreachService unit tests", () => {
  const tenantId = "tenant_outbox_test";
  const operatorId = "op_adam_001";
  const baseNow = new Date("2026-10-20T10:00:00Z");

  beforeEach(() => {
    _resetScheduledOutreachMemoryStore();
  });

  describe("Timezone and DST Normalization", () => {
    it("converts Pacific Daylight Time (PDT, UTC-7) wall clock correctly", () => {
      const utc = normalizeScheduledForUtc("2026-10-25 14:30:00", "America/Los_Angeles");
      expect(utc.toISOString()).toBe("2026-10-25T21:30:00.000Z");
    });

    it("converts Pacific Standard Time (PST, UTC-8) wall clock correctly", () => {
      const utc = normalizeScheduledForUtc("2026-12-25 14:30:00", "America/Los_Angeles");
      expect(utc.toISOString()).toBe("2026-12-25T22:30:00.000Z");
    });

    it("rejects nonexistent DST spring-forward gap time (2:30 AM on March 14, 2027)", () => {
      expect(() => {
        normalizeScheduledForUtc("2027-03-14 02:30:00", "America/Los_Angeles");
      }).toThrow(/does not exist in timezone .* due to Daylight Saving Time/);
    });

    it("safely handles ambiguous DST fall-back time (1:30 AM on November 1, 2026)", () => {
      const utc = normalizeScheduledForUtc("2026-11-01 01:30:00", "America/Los_Angeles");
      expect(utc.toISOString()).toBe("2026-11-01T08:30:00.000Z");
    });
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
    expect(draft.operatorId).toBe(operatorId);
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

  it("rejects scheduled times in the past unless allowImmediate is set", async () => {
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

  it("edits a pending scheduled draft in-place and increments revision", async () => {
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
      expectedRevisionCount: 1,
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

  it("enforces compare-and-set version check to prevent simultaneous overwrite", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 12 * 3600 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_cas",
      customerName: "Oliver",
      recipientPhone: "+12135550143",
      originalSuggestedDraft: "Original draft",
      messageBody: "Original draft",
      scheduledFor,
      now: baseNow,
    });

    // First edit succeeds (advancing from rev 1 to 2)
    await editScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      newMessageBody: "First edit",
      expectedRevisionCount: 1,
      now: baseNow,
    });

    // Second edit with stale expected revision 1 must be rejected
    await expect(
      editScheduledOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        newMessageBody: "Conflicting edit",
        expectedRevisionCount: 1,
        now: baseNow,
      })
    ).rejects.toThrow("Revision conflict");
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

  it("prohibits cancelling an actively claimed draft", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_claim_cancel",
      customerName: "Sammy",
      recipientPhone: "+12135550145",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    // Claim the lease
    const futureTime = new Date(baseNow.getTime() + 2000);
    const [claimed] = await claimDueOutreachLeases({
      leaseHolder: "worker_active",
      leaseDurationMs: 60000,
      now: futureTime,
    });
    expect(claimed).toBeDefined();

    // Cancellation while actively claimed must fail
    await expect(
      cancelScheduledOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        reason: "Attempt cancellation during active claim",
        now: futureTime,
      })
    ).rejects.toThrow("Cannot cancel message: draft is currently claimed");
  });

  it("recovers expired claimed rows after worker crash", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_crash_recovery",
      customerName: "Bramble",
      recipientPhone: "+12135550146",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    // Worker A claims with 5s lease duration
    const workerATime = new Date(baseNow.getTime() + 2000);
    const [claimedA] = await claimDueOutreachLeases({
      leaseHolder: "worker_crashed",
      leaseDurationMs: 5000,
      now: workerATime,
    });
    expect(claimedA.leaseHolder).toBe("worker_crashed");

    // Time advances past lease expiry (6s later); worker A has crashed without dispatching
    const workerBTime = new Date(workerATime.getTime() + 8000);
    const [claimedB] = await claimDueOutreachLeases({
      leaseHolder: "worker_rescuer",
      now: workerBTime,
    });

    expect(claimedB).toBeDefined();
    expect(claimedB.id).toBe(draft.id);
    expect(claimedB.leaseHolder).toBe("worker_rescuer");
  });

  it("SEND EARLY marks awaiting_sender_setup without modifying draft status when no adapter is passed", async () => {
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
      now: baseNow,
    });

    expect(earlyResult.success).toBe(false);
    expect(earlyResult.status).toBe("awaiting_sender_setup");
    expect(earlyResult.message.status).toBe("pending");
    expect(earlyResult.evidenceName).toBe("awaiting_sender_setup");

    // Prove it remains editable!
    const edited = await editScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      newMessageBody: "Updated message while awaiting sender",
      now: baseNow,
    });
    expect(edited.currentMessageBody).toBe("Updated message while awaiting sender");
  });

  it("SEND EARLY dispatches when an explicit test adapter is injected", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 3600 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: "cust_injected",
      customerName: "Bramble",
      recipientPhone: "+12135550146",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const fakeAdapter = {
      send: vi.fn().mockResolvedValue({
        externalMessageId: "android_custom_msg_456",
        evidenceName: "personal_android_dispatched",
      }),
    };

    const earlyResult = await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      leaseHolder: "operator_early",
      testSenderAdapter: fakeAdapter,
      now: baseNow,
    });

    expect(earlyResult.success).toBe(true);
    expect(earlyResult.status).toBe("dispatched");
    expect(earlyResult.message.status).toBe("dispatched");
    expect(earlyResult.message.externalMessageId).toBe("android_custom_msg_456");
    expect(fakeAdapter.send).toHaveBeenCalledTimes(1);
  });
});
