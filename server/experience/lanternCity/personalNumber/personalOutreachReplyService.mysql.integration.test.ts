import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withUtcTimezone } from "../../../db";
import { projectCozyRecoverySurfaces } from "../../../../shared/cozyVillagerEvidence";
import type { CozyCustomerTarget, CozyEncounterMission } from "../../../../shared/cozyVillagerOutreach";
import { checkCommunicationPermission } from "../../../strategy/communicationPermissionService";
import { hashIdentityKey, loadDormantContactFacts, permissionForKeys } from "../../../strategy/dormantOutreachGate";
import { phoneOptOutState } from "../../../messaging/businessLineInbox";
import { outreachEvidenceFromRow } from "../cozyRecoverySurfaces";
import {
  createScheduledOutreachDraft,
  listScheduledOutreachMessages,
} from "../scheduledOutreachService";
import {
  createTrustedMessagingConnectorProofForTest,
  listPersonalOutreachReplies,
  recordMessagingEvidenceEvent,
  recordPersonalOutreachReply,
  resetPersonalOutreachReplyMemoryForTest,
} from "./personalOutreachReplyService";

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("personalOutreachReplyService on disposable MySQL", () => {
  let sql: mysql.Connection;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `por-tenant-${suffix}`;
  const otherTenantId = `por-other-${suffix}`;
  const operatorId = `op-${suffix}`;
  const customerId = `cust_${suffix}`;
  const now = new Date("2026-10-17T18:00:00.000Z");

  beforeAll(async () => {
    sql = await mysql.createConnection(withUtcTimezone(process.env.DATABASE_URL!));
    const ddl = await readFile(
      new URL("../../../../drizzle/0136_personal_outreach_replies.sql", import.meta.url),
      "utf8"
    );
    for (const statement of ddl
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map(s => s.trim())
      .filter(Boolean)) {
      await sql.execute(statement);
    }
    const [described] = await sql.execute<mysql.RowDataPacket[]>(
      "DESCRIBE personal_outreach_replies"
    );
    expect(described.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (sql) {
      await sql.execute("DELETE FROM personal_outreach_replies WHERE tenant_id IN (?, ?)", [
        tenantId,
        otherTenantId,
      ]);
      await sql.execute("DELETE FROM scheduled_outreach_revisions WHERE tenant_id = ?", [
        tenantId,
      ]);
      await sql.execute("DELETE FROM scheduled_outreach_messages WHERE tenant_id = ?", [
        tenantId,
      ]);
      await sql.end();
    }
  });

  it("persists outbound and inbound message events in MySQL, rejects spoofed/mismatched outbound events, and transitions an awaiting draft to dispatched only after a verified outbound event", async () => {
    const trustedDevice = createTrustedMessagingConnectorProofForTest({
      adapterId: "android_handset_bridge_verified",
    });
    const trustedWebhook = createTrustedMessagingConnectorProofForTest({
      adapterId: "twilio_webhook_verified",
    });

    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId,
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: "Hey Mei! It's Adam from Laundry Farm.",
      messageBody: "Hey Mei, checking in from Laundry Farm.",
      scheduledFor: "2026-10-17T19:00:00.000Z",
      timezone: "America/Los_Angeles",
      slotId: "slot_02",
      territoryId: "silver-lake",
      status: "awaiting_sender_setup",
      deliveryIntent: "immediate",
      now,
    });

    // 0a. Spoofed outbound without connector proof is rejected and leaves outbox untouched
    await expect(
      recordMessagingEvidenceEvent({
        tenantId,
        operatorId,
        source: "device_observed",
        direction: "outbound",
        customerId,
        rawPhone: "+12135550141",
        providerMessageId: `gmsg_spoof_${suffix}`,
        messageId: draft.id,
        body: "Hey Mei, checking in from Laundry Farm.",
        observedAt: new Date("2026-10-17T18:02:00.000Z"),
      })
    ).rejects.toThrow(/Authority violation/i);

    // 0b. Mismatched body on trusted connector is rejected and leaves outbox untouched
    await expect(
      recordMessagingEvidenceEvent({
        tenantId,
        operatorId,
        source: "device_observed",
        direction: "outbound",
        customerId,
        rawPhone: "+12135550141",
        providerMessageId: `gmsg_badbody_${suffix}`,
        messageId: draft.id,
        body: "Edited text that was never approved in the outbox",
        observedAt: new Date("2026-10-17T18:03:00.000Z"),
        trustedConnector: trustedDevice,
      })
    ).rejects.toThrow(/body_mismatch/i);

    // 0c. Operator-reported inbound reply never transitions outbox to dispatched
    await recordPersonalOutreachReply({
      tenantId,
      operatorId,
      customerId,
      customerName: "Mei Lin",
      replyText: "Just checking if you got my message",
      messageId: draft.id,
      now: new Date("2026-10-17T18:04:00.000Z"),
    });

    const [beforeDispatchRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT status, external_message_id, dispatched_at FROM scheduled_outreach_messages WHERE id = ?",
      [draft.id]
    );
    expect(beforeDispatchRows[0]?.status).toBe("awaiting_sender_setup");
    expect(beforeDispatchRows[0]?.external_message_id).toBeNull();

    // 1. Observe verified outbound send from device connector matching exact messageId, phone, and approved body
    const outboundSaved = await recordMessagingEvidenceEvent({
      tenantId,
      operatorId,
      source: "device_observed",
      direction: "outbound",
      customerId,
      customerName: "Mei Lin",
      rawPhone: "+12135550141",
      providerMessageId: `gmsg_out_${suffix}`,
      messageId: draft.id,
      territoryId: "silver-lake",
      body: "Hey Mei, checking in from Laundry Farm.",
      observedAt: new Date("2026-10-17T18:05:00.000Z"),
      trustedConnector: trustedDevice,
    });

    expect(outboundSaved.source).toBe("device_observed");
    expect(outboundSaved.direction).toBe("outbound");

    // Verify outbox row transitioned to dispatched in MySQL
    const [outboxRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT status, external_message_id, dispatched_at FROM scheduled_outreach_messages WHERE id = ?",
      [draft.id]
    );
    expect(outboxRows[0]?.status).toBe("dispatched");
    expect(outboxRows[0]?.external_message_id).toBe(`gmsg_out_${suffix}`);

    // 2. Observe inbound reply from provider webhook
    const inboundSaved = await recordMessagingEvidenceEvent({
      tenantId,
      operatorId,
      source: "provider_webhook",
      direction: "inbound",
      customerId,
      customerName: "Mei Lin",
      rawPhone: "+12135550141",
      providerMessageId: `SM_in_${suffix}`,
      messageId: draft.id,
      territoryId: "silver-lake",
      body: "Can you pick up 2 bags Thursday morning?",
      observedAt: new Date("2026-10-17T18:10:00.000Z"),
      trustedConnector: trustedWebhook,
    });

    expect(inboundSaved.source).toBe("provider_webhook");
    expect(inboundSaved.direction).toBe("inbound");
    expect(inboundSaved.classification).toBe("pickup_interest");

    // 3. Simulate process restart by clearing in-memory cache and reading back from MySQL
    resetPersonalOutreachReplyMemoryForTest();

    const persisted = await listPersonalOutreachReplies({
      tenantId,
      operatorId,
    });
    expect(persisted).toHaveLength(3);

    const otherTenantPersisted = await listPersonalOutreachReplies({
      tenantId: otherTenantId,
      operatorId,
    });
    expect(otherTenantPersisted).toHaveLength(0);

    const target: CozyCustomerTarget = {
      slotId: "slot_02",
      customerId,
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
      villagerVariant: "bear",
      suggestedMessage: "Hey Mei! It's Adam from Laundry Farm.",
      status: "eligible",
    };
    const mission: CozyEncounterMission = {
      missionId: "mission_winback_silver-lake",
      title: "Claire's Recovery Mission: Silver Lake",
      objective: "Recover dormant laundry customers in Silver Lake",
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      totalLapsedInTerritory: 1,
      activeTargetCount: 1,
      targets: [target],
    };

    const messagesAfter = await listScheduledOutreachMessages({ tenantId, operatorId });
    const projected = projectCozyRecoverySurfaces({
      tenantId,
      operatorId,
      mission,
      messages: messagesAfter.map(outreachEvidenceFromRow),
      replies: persisted,
      objective: {
        id: "goal_silver_lake_recovery",
        statement: "Recover dormant laundry customers in Silver Lake",
        areaLabel: "Silver Lake",
      },
      now: new Date("2026-10-17T18:15:00.000Z"),
    });

    expect(projected.mission.targets[0]?.communicationState).toBe("send_observed");
    expect(projected.mission.targets[0]?.reply.status).toBe("provider_webhook");
    expect(projected.mission.targets[0]?.paidOrder.status).toBe("unavailable");
    expect(projected.mission.targets[0]?.objectiveComplete).toBe(false);
    expect(projected.dayLineCard?.reply.status).toBe("provider_webhook");
    expect(projected.dayLineCard?.objectiveComplete).toBe(false);
  });

  it("persists STOP opt-outs in MySQL and blocks communication permissions", async () => {
    const trustedDevice = createTrustedMessagingConnectorProofForTest({
      adapterId: "android_handset_bridge_verified",
    });
    const optOutCustomerId = `cust_stop_${suffix}`;
    const stopEvent = await recordMessagingEvidenceEvent({
      tenantId,
      operatorId,
      source: "device_observed",
      direction: "inbound",
      customerId: optOutCustomerId,
      customerName: "Alex Rivera",
      rawPhone: "+12135550177",
      body: "STOP",
      observedAt: new Date("2026-10-17T18:20:00.000Z"),
      trustedConnector: trustedDevice,
    });
    expect(stopEvent.classification).toBe("opt_out");
    expect(stopEvent.permissionEffect).toBe("opted_out");

    const perm = await checkCommunicationPermission({
      tenantId,
      subjectType: "customer",
      subjectId: optOutCustomerId,
      channel: "sms",
    });
    expect(perm.allowed).toBe(false);
    expect(perm.permissionStatus).toBe("opted_out");
    // Every gate an outbound path reads now says opted_out.
    const anyChannel = await checkCommunicationPermission({ tenantId, subjectType: "customer", subjectId: optOutCustomerId, channel: "any" });
    expect(anyChannel.permissionStatus).toBe("opted_out");
    const byPhoneId = await checkCommunicationPermission({ tenantId, subjectType: "customer", subjectId: "phone:2135550177", channel: "sms" });
    expect(byPhoneId.permissionStatus).toBe("opted_out");
    const facts = await loadDormantContactFacts({ tenantId, now: new Date("2026-10-17T18:30:00.000Z") });
    expect(facts.readable).toBe(true);
    expect(permissionForKeys(facts, tenantId, ["phone:2135550177"]).state).toBe("opted_out");
    expect(await phoneOptOutState(tenantId, "+12135550177")).toBe("opted_out");
  });

  it("an operator-reported STOP (no phone from the client) reaches Silver Lake's phone-keyed gate", async () => {
    const stopCustomerId = `cust_opstop_${suffix}`;
    const phoneDigits = "2135550188";
    // The customer had opted in before.
    await sql.execute(
      `INSERT INTO customer_contact_permissions
        (tenantId, customerKeyHash, channel, purpose, status, sourceReference, capturedAt, recordedBy)
       VALUES (?, ?, 'sms', 'win_back_marketing', 'opted_in', 'fixture:prior-consent', ?, 'fixture')`,
      [tenantId, hashIdentityKey(tenantId, `phone:${phoneDigits}`), new Date("2026-09-01T00:00:00.000Z")]
    );
    // The operator's own outreach draft is the server-side record of this customer's phone.
    await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId: stopCustomerId,
      customerName: "Jamie Lee",
      recipientPhone: `+1${phoneDigits}`,
      originalSuggestedDraft: "Hi Jamie, it's Adam from Laundry Farm.",
      messageBody: "Hi Jamie, checking in from Laundry Farm.",
      scheduledFor: "2026-10-17T19:00:00.000Z",
      timezone: "America/Los_Angeles",
      slotId: "slot_03",
      territoryId: "silver-lake",
      status: "awaiting_sender_setup",
      deliveryIntent: "immediate",
      now,
    });
    const before = await loadDormantContactFacts({ tenantId, now: new Date("2026-10-17T18:39:00.000Z") });
    expect(permissionForKeys(before, tenantId, [`phone:${phoneDigits}`]).state).toBe("opted_in");

    const saved = await recordPersonalOutreachReply({
      tenantId,
      operatorId,
      customerId: stopCustomerId,
      customerName: "Jamie Lee",
      replyText: "STOP",
      now: new Date("2026-10-17T18:40:00.000Z"),
    });
    expect(saved.permissionEffect).toBe("opted_out");
    expect(saved.rawPhone).toBeNull();

    const after = await loadDormantContactFacts({ tenantId, now: new Date("2026-10-17T18:41:00.000Z") });
    expect(after.readable).toBe(true);
    expect(permissionForKeys(after, tenantId, [`phone:${phoneDigits}`]).state).toBe("opted_out");
    expect(await phoneOptOutState(tenantId, `+1${phoneDigits}`)).toBe("opted_out");
    for (const subjectId of [stopCustomerId, `phone:${phoneDigits}`]) {
      for (const channel of ["sms", "any"] as const) {
        const perm = await checkCommunicationPermission({ tenantId, subjectType: "customer", subjectId, channel });
        expect(perm.permissionStatus).toBe("opted_out");
      }
    }
  });

  it("an operator-reported STOP blocks every number the operator has for that customer", async () => {
    const twoPhoneCustomerId = `cust_twophone_${suffix}`;
    const oldDigits = "2135550191";
    const currentDigits = "2135550192";
    for (const [digits, slotId, at] of [
      [oldDigits, "slot_04", "2026-10-17T20:00:00.000Z"],
      [currentDigits, "slot_05", "2026-10-17T21:00:00.000Z"],
    ] as const) {
      await sql.execute(
        `INSERT INTO customer_contact_permissions
          (tenantId, customerKeyHash, channel, purpose, status, sourceReference, capturedAt, recordedBy)
         VALUES (?, ?, 'sms', 'win_back_marketing', 'opted_in', 'fixture:prior-consent', ?, 'fixture')`,
        [tenantId, hashIdentityKey(tenantId, `phone:${digits}`), new Date("2026-08-01T00:00:00.000Z")]
      );
      await createScheduledOutreachDraft({
        tenantId,
        operatorId,
        customerId: twoPhoneCustomerId,
        customerName: "Dana Cruz",
        recipientPhone: `+1${digits}`,
        originalSuggestedDraft: "Hi Dana, it's Adam from Laundry Farm.",
        messageBody: `Hi Dana, checking in from Laundry Farm (${slotId}).`,
        scheduledFor: at,
        timezone: "America/Los_Angeles",
        slotId,
        territoryId: "silver-lake",
        status: "awaiting_sender_setup",
        deliveryIntent: "immediate",
        now,
      });
    }

    await recordPersonalOutreachReply({
      tenantId,
      operatorId,
      customerId: twoPhoneCustomerId,
      customerName: "Dana Cruz",
      replyText: "STOP",
      now: new Date("2026-10-17T18:45:00.000Z"),
    });

    const facts = await loadDormantContactFacts({ tenantId, now: new Date("2026-10-17T18:46:00.000Z") });
    for (const digits of [oldDigits, currentDigits]) {
      expect(permissionForKeys(facts, tenantId, [`phone:${digits}`]).state).toBe("opted_out");
      expect(await phoneOptOutState(tenantId, `+1${digits}`)).toBe("opted_out");
      const perm = await checkCommunicationPermission({ tenantId, subjectType: "customer", subjectId: `phone:${digits}`, channel: "sms" });
      expect(perm.permissionStatus).toBe("opted_out");
    }
  });

  it("an operator-reported STOP whose phone cannot be found blocks the customer id and says the phone block is missing", async () => {
    const unknownCustomerId = `cust_nophone_${suffix}`;
    await expect(
      recordPersonalOutreachReply({
        tenantId,
        operatorId,
        customerId: unknownCustomerId,
        customerName: "Robin Park",
        replyText: "STOP",
        now: new Date("2026-10-17T18:50:00.000Z"),
      })
    ).rejects.toThrow("phone number could not be found");
    for (const channel of ["sms", "any"] as const) {
      const perm = await checkCommunicationPermission({ tenantId, subjectType: "customer", subjectId: unknownCustomerId, channel });
      expect(perm.permissionStatus).toBe("opted_out");
    }
  });
});
