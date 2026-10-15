import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withUtcTimezone } from "../../db";
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
} from "./scheduledOutreachService";

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("Scheduled Outreach Service: Real-MySQL Journey", () => {
  let sql: mysql.Connection;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `sched-tenant-${suffix}`;
  const operatorId = `op-user-${suffix}`;
  const baseNow = new Date("2026-10-20T10:00:00Z");

  beforeAll(async () => {
    sql = await mysql.createConnection(withUtcTimezone(process.env.DATABASE_URL!));
    // Assert production migration script has run and created the tables;
    // tests must NOT create their own schema shortcuts.
    const [msgDesc] = await sql.execute<mysql.RowDataPacket[]>("DESCRIBE scheduled_outreach_messages");
    const [revDesc] = await sql.execute<mysql.RowDataPacket[]>("DESCRIBE scheduled_outreach_revisions");
    expect(msgDesc.length).toBeGreaterThan(0);
    expect(revDesc.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (sql) {
      await sql.execute("DELETE FROM scheduled_outreach_revisions WHERE tenant_id = ?", [tenantId]);
      await sql.execute("DELETE FROM scheduled_outreach_messages WHERE tenant_id = ?", [tenantId]);
      await sql.execute("DELETE FROM scheduled_outreach_revisions WHERE tenant_id = ?", [`${tenantId}_other`]);
      await sql.execute("DELETE FROM scheduled_outreach_messages WHERE tenant_id = ?", [`${tenantId}_other`]);
      await sql.end();
    }
  });

  it("Step 1: Creates scheduled draft, verifies real MySQL persistence and initial revision", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 48 * 3600 * 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_1`,
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: "Hey Mei, checking in from Laundry Farm!",
      messageBody: "Hey Mei, checking in from Laundry Farm!",
      scheduledFor,
      slotId: "slot_01",
      territoryId: "silver-lake",
      now: baseNow,
    });

    expect(created.id).toBeDefined();

    // Query raw MySQL connection directly to prove physical persistence
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM scheduled_outreach_messages WHERE id = ? AND tenant_id = ?",
      [created.id, tenantId]
    );

    expect(rows.length).toBe(1);
    expect(rows[0].customer_name).toBe("Mei Lin");
    expect(rows[0].operator_id).toBe(operatorId);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].revision_count).toBe(1);

    // Verify initial revision in SQL
    const [revRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM scheduled_outreach_revisions WHERE outreach_message_id = ?",
      [created.id]
    );
    expect(revRows.length).toBe(1);
    expect(revRows[0].revision_number).toBe(1);
  });

  it("Step 2: Edits message in place, verifies revision increment and replacement of pending text", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 48 * 3600 * 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_2`,
      customerName: "Barnaby Hayes",
      recipientPhone: "+12135550142",
      originalSuggestedDraft: "Initial draft",
      messageBody: "Initial draft",
      scheduledFor,
      now: baseNow,
    });

    const edited = await editScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      newMessageBody: "Personalized message edited outside Lantern City",
      expectedRevisionCount: 1,
      reason: "Added friendly detail",
      now: new Date(baseNow.getTime() + 60000),
    });

    expect(edited.revisionCount).toBe(2);
    expect(edited.currentMessageBody).toBe("Personalized message edited outside Lantern City");

    // Check DB
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT current_message_body, revision_count FROM scheduled_outreach_messages WHERE id = ?",
      [created.id]
    );
    expect(rows[0].current_message_body).toBe("Personalized message edited outside Lantern City");
    expect(rows[0].revision_count).toBe(2);

    const revisions = await getScheduledOutreachRevisions({
      tenantId,
      operatorId,
      messageId: created.id,
    });
    expect(revisions.length).toBe(2);
  });

  it("Step 3: Simultaneous-edit protection: race between two competing edits rejects conflicting revision", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 48 * 3600 * 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_race`,
      customerName: "Race Customer",
      recipientPhone: "+12135550149",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    // Two competing browser sessions for the same operator both attempt to edit from revision 1 simultaneously
    const edit1Promise = editScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      newMessageBody: "Edit from session 1",
      expectedRevisionCount: 1,
      now: baseNow,
    });

    const edit2Promise = editScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      newMessageBody: "Edit from session 2",
      expectedRevisionCount: 1,
      now: baseNow,
    });

    const results = await Promise.allSettled([edit1Promise, edit2Promise]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one must win the compare-and-set revision increment; the second must be rejected with revision conflict
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Exactly one must win the compare-and-set revision increment; the second must be rejected with revision conflict
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(1);

    // Verify DB shows revision_count = 2 and exactly 2 revision records exist
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT revision_count FROM scheduled_outreach_messages WHERE id = ?",
      [created.id]
    );
    expect(rows[0].revision_count).toBe(2);

    const [revs] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT revision_number FROM scheduled_outreach_revisions WHERE outreach_message_id = ?",
      [created.id]
    );
    expect(revs.length).toBe(2);
  });

  it("Step 4: Reschedules message to a different time", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 24 * 3600 * 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_3`,
      customerName: "Oliver Bennett",
      recipientPhone: "+12135550143",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const newTarget = new Date(baseNow.getTime() + 72 * 3600 * 1000);
    const updated = await rescheduleOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      newScheduledFor: newTarget,
      now: baseNow,
    });

    expect(new Date(updated.scheduledFor).getTime()).toBe(newTarget.getTime());
  });

  it("Step 5: Prohibits cancelling an actively claimed message; cancels when unleased and prevents worker lease", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000); // 1s from now
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_4`,
      customerName: "Bella Ramos",
      recipientPhone: "+12135550144",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    // Claim the message
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
        messageId: created.id,
        reason: "Attempted cancellation during claim",
        now: futureTime,
      })
    ).rejects.toThrow("Cannot cancel message: draft is currently claimed");

    // After lease expiry (61s later), cancellation is permitted
    const expiredTime = new Date(futureTime.getTime() + 65000);
    const cancelled = await cancelScheduledOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      reason: "Cancelled after lease expiry",
      now: expiredTime,
    });
    expect(cancelled.status).toBe("cancelled");

    // Workers cannot claim cancelled message
    const laterClaims = await claimDueOutreachLeases({
      leaseHolder: "worker_subsequent",
      now: new Date(expiredTime.getTime() + 1000),
    });
    expect(laterClaims.find((c) => c.id === created.id)).toBeUndefined();
  });

  it("Step 6: Worker lease crash recovery: expired claimed row without dispatch is safely recovered", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_recovery`,
      customerName: "Crash Customer",
      recipientPhone: "+12135550145",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    // Worker 1 claims with 5s lease
    const claimTime = new Date(baseNow.getTime() + 2000);
    const [firstClaim] = await claimDueOutreachLeases({
      leaseHolder: "worker_crashed",
      leaseDurationMs: 5000,
      now: claimTime,
    });
    expect(firstClaim.leaseHolder).toBe("worker_crashed");

    // Advance 10s into future: Worker 1 crashed without dispatching. Worker 2 recovers lease!
    const recoveryTime = new Date(claimTime.getTime() + 10000);
    const [recovered] = await claimDueOutreachLeases({
      leaseHolder: "worker_recovery",
      now: recoveryTime,
    });

    expect(recovered).toBeDefined();
    expect(recovered.id).toBe(created.id);
    expect(recovered.leaseHolder).toBe("worker_recovery");
  });

  it("Step 7: Concurrency lease race condition test: two workers competing for the same due message", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_5`,
      customerName: "Sammy Cruz",
      recipientPhone: "+12135550145",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const futureNow = new Date(baseNow.getTime() + 2000);

    // Simulate two competing workers simultaneously attempting to claim leases
    const [worker1Result, worker2Result] = await Promise.all([
      claimDueOutreachLeases({ leaseHolder: "worker_alpha", now: futureNow }),
      claimDueOutreachLeases({ leaseHolder: "worker_beta", now: futureNow }),
    ]);

    const alphaClaimed = worker1Result.some((m) => m.id === created.id);
    const betaClaimed = worker2Result.some((m) => m.id === created.id);

    // Exactly one worker must win the lease; never both
    expect(alphaClaimed !== betaClaimed).toBe(true);
  });

  it("Step 8: SEND EARLY with test adapter competing with scheduled lease race", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_6`,
      customerName: "Bramble Vance",
      recipientPhone: "+12135550146",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const fakeAdapter = {
      send: async () => ({
        externalMessageId: `test_msg_${randomUUID()}`,
        evidenceName: "personal_android_dispatched",
      }),
    };

    // Send early
    const early = await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      leaseHolder: "op_early",
      testSenderAdapter: fakeAdapter,
      now: baseNow,
    });

    expect(early.success).toBe(true);
    expect(early.status).toBe("dispatched");

    // Later scheduled worker attempts to claim
    const laterClaimed = await claimDueOutreachLeases({
      leaseHolder: "worker_scheduled",
      now: new Date(baseNow.getTime() + 5000),
    });
    expect(laterClaimed.find((m) => m.id === created.id)).toBeUndefined();
  });

  it("Step 9: Real-MySQL cross-operator and cross-tenant authorization isolation", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 24 * 3600 * 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_iso`,
      customerName: "Isolated Customer",
      recipientPhone: "+12135550150",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    const imposterOperator = `imposter_${suffix}`;

    // Tampering by another operator in same tenant must fail
    await expect(
      editScheduledOutreachDraft({
        tenantId,
        operatorId: imposterOperator,
        messageId: created.id,
        newMessageBody: "Hacked by imposter",
        now: baseNow,
      })
    ).rejects.toThrow(/not found or unauthorized for operator/);

    await expect(
      rescheduleOutreachDraft({
        tenantId,
        operatorId: imposterOperator,
        messageId: created.id,
        newScheduledFor: new Date(baseNow.getTime() + 48 * 3600 * 1000),
        now: baseNow,
      })
    ).rejects.toThrow(/not found or unauthorized for operator/);

    await expect(
      cancelScheduledOutreachDraft({
        tenantId,
        operatorId: imposterOperator,
        messageId: created.id,
        reason: "Malicious cancel",
        now: baseNow,
      })
    ).rejects.toThrow(/not found or unauthorized for operator/);

    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId: imposterOperator,
        messageId: created.id,
        leaseHolder: "imposter_worker",
        now: baseNow,
      })
    ).rejects.toThrow(/not found or unauthorized for operator/);

    await expect(
      getScheduledOutreachRevisions({
        tenantId,
        operatorId: imposterOperator,
        messageId: created.id,
      })
    ).rejects.toThrow(/not found or unauthorized for operator/);

    // Cross-tenant isolation: another tenant querying cannot see this message
    const otherTenantList = await listScheduledOutreachMessages({
      tenantId: `${tenantId}_other`,
    });
    expect(otherTenantList.find((m) => m.id === created.id)).toBeUndefined();
  });

  it("Step 10: Crash after dispatch attempt: lease expiration does NOT reclaim message in MySQL", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_crash`,
      customerName: "Crash Recipient",
      recipientPhone: "+12135550151",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    // Failing adapter that drops connection after dispatch attempt
    const crashingAdapter = {
      send: async () => {
        throw new Error("Carrier socket dropped mid-transmission");
      },
    };

    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: created.id,
        leaseHolder: "worker_crash_sim",
        testSenderAdapter: crashingAdapter,
        now: baseNow,
      })
    ).rejects.toThrow("Carrier socket dropped mid-transmission");

    // In MySQL, check that dispatch_attempted_at was durably recorded
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT dispatch_attempted_at, status, lease_holder FROM scheduled_outreach_messages WHERE id = ?",
      [created.id]
    );
    expect(rows[0].dispatch_attempted_at).not.toBeNull();

    // Advance 2 hours past lease duration
    const farFuture = new Date(baseNow.getTime() + 7200 * 1000);

    // Lease runner must NOT reclaim this message because it could have been transmitted
    const claimed = await claimDueOutreachLeases({
      leaseHolder: "worker_rescuer",
      now: farFuture,
    });
    expect(claimed.find((m) => m.id === created.id)).toBeUndefined();

    // Cancellation must also be blocked
    await expect(
      cancelScheduledOutreachDraft({
        tenantId,
        operatorId,
        messageId: created.id,
        reason: "Attempted cancel after crash",
        now: farFuture,
      })
    ).rejects.toThrow(/Cannot cancel message: an external dispatch attempt has already been initiated/);
  });

  it("Step 11: Real-MySQL concurrent sendEarly race: only one caller executes adapter", async () => {
    const scheduledFor = new Date(baseNow.getTime() + 1000);
    const created = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_sendearly_race`,
      customerName: "Concurrent Early Customer",
      recipientPhone: "+12135550152",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    let adapterCalls = 0;
    const testAdapter = {
      send: async () => {
        adapterCalls++;
        return {
          externalMessageId: `msg_${randomUUID()}`,
          evidenceName: "personal_android_dispatched",
        };
      },
    };

    // Two callers try sendEarly simultaneously
    const call1 = sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      leaseHolder: "caller_1",
      testSenderAdapter: testAdapter,
      now: baseNow,
    });

    const call2 = sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: created.id,
      leaseHolder: "caller_2",
      testSenderAdapter: testAdapter,
      now: baseNow,
    });

    const results = await Promise.allSettled([call1, call2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one caller acquires the lease and executes the send adapter
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect(adapterCalls).toBe(1);
  });

  it("Step 12: Real-MySQL Timezone and DST persistence roundtrip", async () => {
    // Summer PDT (UTC-7) in future
    const summerUtc = normalizeScheduledForUtc("2027-07-15 14:30:00", "America/Los_Angeles");
    const summerDraft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_summer`,
      customerName: "Summer Customer",
      recipientPhone: "+12135550153",
      originalSuggestedDraft: "Summer draft",
      messageBody: "Summer draft",
      scheduledFor: summerUtc,
      now: baseNow,
    });
    const [summerRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT scheduled_for FROM scheduled_outreach_messages WHERE id = ?",
      [summerDraft.id]
    );
    expect(new Date(summerRows[0].scheduled_for).toISOString()).toBe("2027-07-15T21:30:00.000Z");

    // Winter PST (UTC-8)
    const winterUtc = normalizeScheduledForUtc("2026-12-15 14:30:00", "America/Los_Angeles");
    const winterDraft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: `cust_sql_${suffix}_winter`,
      customerName: "Winter Customer",
      recipientPhone: "+12135550154",
      originalSuggestedDraft: "Winter draft",
      messageBody: "Winter draft",
      scheduledFor: winterUtc,
      now: baseNow,
    });
    const [winterRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT scheduled_for FROM scheduled_outreach_messages WHERE id = ?",
      [winterDraft.id]
    );
    expect(new Date(winterRows[0].scheduled_for).toISOString()).toBe("2026-12-15T22:30:00.000Z");

    // DST ambiguity on Fall-back (November 1, 2026 1:30 AM)
    expect(() => {
      normalizeScheduledForUtc("2026-11-01 01:30:00", "America/Los_Angeles");
    }).toThrow(/is ambiguous in timezone .* because clocks turn back/);

    const fallFirst = normalizeScheduledForUtc("2026-11-01 01:30:00", "America/Los_Angeles", "first");
    expect(fallFirst.toISOString()).toBe("2026-11-01T08:30:00.000Z");

    const fallSecond = normalizeScheduledForUtc("2026-11-01 01:30:00", "America/Los_Angeles", "second");
    expect(fallSecond.toISOString()).toBe("2026-11-01T09:30:00.000Z");

    // Spring gap rejection
    expect(() => {
      normalizeScheduledForUtc("2027-03-14 02:30:00", "America/Los_Angeles");
    }).toThrow(/does not exist in timezone .* due to Daylight Saving Time/);
  });

  it("Step 13: Stale customer permission opt-out cancels draft and blocks dispatch attempt", async () => {
    const customerId = `cust_sql_${suffix}_optout`;
    const scheduledFor = new Date(baseNow.getTime() + 3600 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId,
      customerName: "OptOut Customer",
      recipientPhone: "+12135550155",
      originalSuggestedDraft: "Draft",
      messageBody: "Draft",
      scheduledFor,
      now: baseNow,
    });

    // Customer subsequently opts out before dispatch occurs
    const { recordCommunicationPermission } = await import("../../strategy/communicationPermissionService");
    await recordCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: customerId,
      channel: "sms",
      status: "opted_out",
      reason: "Customer replied STOP",
    });

    let adapterCalled = false;
    const testAdapter = {
      send: async () => {
        adapterCalled = true;
        return { externalMessageId: "should_not_reach_here" };
      },
    };

    // Attempting send early must block transmission and cancel the draft
    await expect(
      sendEarlyOutreachDraft({
        tenantId,
        operatorId,
        messageId: draft.id,
        leaseHolder: "worker_dispatch",
        testSenderAdapter: testAdapter,
        now: baseNow,
      })
    ).rejects.toThrow(/Customer is no longer eligible/);

    expect(adapterCalled).toBe(false);

    // Verify in MySQL that draft was cancelled and cancellation reason reflects customer opt-out
    const [rows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT status, cancellation_reason FROM scheduled_outreach_messages WHERE id = ?",
      [draft.id]
    );
    expect(rows[0].status).toBe("cancelled");
    expect(rows[0].cancellation_reason).toContain("Pre-send permission check failed");
  });
});
