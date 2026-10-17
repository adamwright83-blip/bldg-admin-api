import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withUtcTimezone } from "../../../db";
import { projectCozyRecoverySurfaces } from "../../../../shared/cozyVillagerEvidence";
import type { CozyCustomerTarget, CozyEncounterMission } from "../../../../shared/cozyVillagerOutreach";
import { checkCommunicationPermission } from "../../../strategy/communicationPermissionService";
import { outreachEvidenceFromRow } from "../cozyRecoverySurfaces";
import {
  createScheduledOutreachDraft,
  listScheduledOutreachMessages,
} from "../scheduledOutreachService";
import {
  listPersonalOutreachReplies,
  recordMessagingEvidenceEvent,
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

  it("persists outbound and inbound message events in MySQL, survives memory reset, and transitions an awaiting draft to dispatched only after an outbound event is observed", async () => {
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

    // 1. Observe outbound send from device connector
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
    expect(persisted).toHaveLength(2);

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
  });
});
