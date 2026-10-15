import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    sql = await mysql.createConnection(process.env.DATABASE_URL!);
    // Ensure table existence matching production schema
    await sql.execute(`
      CREATE TABLE IF NOT EXISTS scheduled_outreach_messages (
        id VARCHAR(64) PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL,
        operator_id VARCHAR(64) NOT NULL,
        customer_id VARCHAR(128) NOT NULL,
        customer_name VARCHAR(255) NOT NULL,
        recipient_phone VARCHAR(32) NOT NULL,
        sender_phone VARCHAR(32),
        original_suggested_draft TEXT NOT NULL,
        current_message_body TEXT NOT NULL,
        revision_count INT NOT NULL DEFAULT 1,
        scheduled_for TIMESTAMP NOT NULL,
        timezone VARCHAR(64) NOT NULL DEFAULT 'America/Los_Angeles',
        status ENUM('pending', 'claimed', 'dispatched', 'cancelled', 'failed', 'awaiting_sender_setup') NOT NULL DEFAULT 'pending',
        lease_holder VARCHAR(64),
        leased_until TIMESTAMP NULL,
        dispatch_attempted_at TIMESTAMP NULL,
        dispatched_at TIMESTAMP NULL,
        cancelled_at TIMESTAMP NULL,
        cancellation_reason TEXT,
        failure_reason TEXT,
        external_message_id VARCHAR(128),
        slot_id VARCHAR(32),
        territory_id VARCHAR(64),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_som_tenant_customer_status (tenant_id, customer_id, status),
        INDEX idx_som_tenant_sched_status (tenant_id, status, scheduled_for),
        INDEX idx_som_tenant_operator_status (tenant_id, operator_id, status),
        INDEX idx_som_lease (status, leased_until)
      );
    `);

    await sql.execute(`
      CREATE TABLE IF NOT EXISTS scheduled_outreach_revisions (
        id VARCHAR(64) PRIMARY KEY,
        outreach_message_id VARCHAR(64) NOT NULL,
        tenant_id VARCHAR(64) NOT NULL,
        revision_number INT NOT NULL,
        message_body TEXT NOT NULL,
        edited_by VARCHAR(128) NOT NULL,
        reason VARCHAR(255),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_sor_message_revision (outreach_message_id, revision_number),
        INDEX idx_sor_message_revision (outreach_message_id, revision_number)
      );
    `);
  });

  afterAll(async () => {
    if (sql) {
      await sql.execute("DELETE FROM scheduled_outreach_revisions WHERE tenant_id = ?", [tenantId]);
      await sql.execute("DELETE FROM scheduled_outreach_messages WHERE tenant_id = ?", [tenantId]);
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

    // Worker 1 and Worker 2 both attempt to edit from revision 1 simultaneously
    const edit1Promise = editScheduledOutreachDraft({
      tenantId,
      operatorId: "worker_1",
      messageId: created.id,
      newMessageBody: "Edit from worker 1",
      expectedRevisionCount: 1,
      now: baseNow,
    });

    const edit2Promise = editScheduledOutreachDraft({
      tenantId,
      operatorId: "worker_2",
      messageId: created.id,
      newMessageBody: "Edit from worker 2",
      expectedRevisionCount: 1,
      now: baseNow,
    });

    const results = await Promise.allSettled([edit1Promise, edit2Promise]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

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
});
