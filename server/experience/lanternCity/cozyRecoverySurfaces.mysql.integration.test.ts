import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withUtcTimezone } from "../../db";
import { projectCozyRecoverySurfaces } from "../../../shared/cozyVillagerEvidence";
import type { CozyCustomerTarget, CozyEncounterMission } from "../../../shared/cozyVillagerOutreach";
import {
  createScheduledOutreachDraft,
  listScheduledOutreachMessages,
  sendEarlyOutreachDraft,
} from "./scheduledOutreachService";
import { outreachEvidenceFromRow } from "./cozyRecoverySurfaces";

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("cozy recovery surfaces on disposable MySQL", () => {
  let sql: mysql.Connection;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `cozy-tenant-${suffix}`;
  const operatorId = `op-${suffix}`;
  const customerId = `cust_${suffix}`;
  const now = new Date("2026-10-15T18:00:00.000Z");

  beforeAll(async () => {
    sql = await mysql.createConnection(withUtcTimezone(process.env.DATABASE_URL!));
    const [described] = await sql.execute<mysql.RowDataPacket[]>("DESCRIBE scheduled_outreach_messages");
    expect(described.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    if (sql) {
      await sql.execute("DELETE FROM scheduled_outreach_revisions WHERE tenant_id = ?", [tenantId]);
      await sql.execute("DELETE FROM scheduled_outreach_messages WHERE tenant_id = ?", [tenantId]);
      await sql.end();
    }
  });

  it("projects the same customer from a simulated outbox send without completing the recovery objective", async () => {
    const draft = await createScheduledOutreachDraft({
      tenantId,
      operatorId,
      customerId,
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: "Hey Mei! It's Adam from Laundry Farm.",
      messageBody: "Hey Mei, this is the edited draft.",
      scheduledFor: "2026-10-16T17:00:00.000Z",
      timezone: "America/Los_Angeles",
      slotId: "slot_04",
      territoryId: "silver-lake",
      now,
    });

    const [pendingRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id, customer_id, operator_id, status, slot_id, current_message_body FROM scheduled_outreach_messages WHERE id = ?",
      [draft.id]
    );
    expect(pendingRows[0]).toMatchObject({
      id: draft.id,
      customer_id: customerId,
      operator_id: operatorId,
      status: "pending",
      slot_id: "slot_04",
      current_message_body: "Hey Mei, this is the edited draft.",
    });

    const target: CozyCustomerTarget = {
      slotId: "slot_01",
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
      villagerVariant: "fox",
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

    const beforeSend = await listScheduledOutreachMessages({ tenantId, operatorId });
    const scheduled = projectCozyRecoverySurfaces({
      tenantId,
      operatorId,
      mission,
      messages: beforeSend.map(outreachEvidenceFromRow),
      objective: {
        id: "goal_silver_lake_recovery",
        statement: "Recover dormant laundry customers in Silver Lake",
        areaLabel: "Silver Lake",
      },
      now,
    });
    expect(scheduled.mission.targets[0]?.slotId).toBe("slot_04");
    expect(scheduled.mission.targets[0]?.communicationState).toBe("scheduled");
    expect(scheduled.mission.targets[0]?.pose).toBe("wave");
    expect(scheduled.dayLineCard?.objectiveComplete).toBe(false);
    expect(scheduled.dayLineCard?.customerId).toBe(customerId);
    expect(scheduled.dayLineCard?.messageId).toBe(draft.id);

    const sent = await sendEarlyOutreachDraft({
      tenantId,
      operatorId,
      messageId: draft.id,
      leaseHolder: `operator_${operatorId}`,
      now: new Date("2026-10-15T18:10:00.000Z"),
      testSenderAdapter: {
        send: async () => ({
          externalMessageId: "simulated:mysql_android_msg",
          evidenceName: "simulated_personal_android_dispatch",
        }),
      },
    });
    expect(sent.evidenceName).toBe("simulated_personal_android_dispatch");

    const [dispatched] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT status, external_message_id, dispatched_at, customer_id FROM scheduled_outreach_messages WHERE id = ?",
      [draft.id]
    );
    expect(dispatched[0]?.status).toBe("dispatched");
    expect(dispatched[0]?.external_message_id).toBe("simulated:mysql_android_msg");
    expect(dispatched[0]?.customer_id).toBe(customerId);
    expect(dispatched[0]?.dispatched_at).toBeTruthy();

    const afterRows = await listScheduledOutreachMessages({ tenantId, operatorId });
    const after = projectCozyRecoverySurfaces({
      tenantId,
      operatorId,
      mission,
      messages: afterRows.map(outreachEvidenceFromRow),
      objective: {
        id: "goal_silver_lake_recovery",
        statement: "Recover dormant laundry customers in Silver Lake",
        areaLabel: "Silver Lake",
      },
      now: new Date("2026-10-15T18:11:00.000Z"),
    });
    expect(after.mission.targets[0]?.communicationState).toBe("send_observed");
    expect(after.mission.targets[0]?.pose).toBe("acknowledged");
    expect(after.mission.targets[0]?.transport).toBe("simulated");
    expect(after.mission.targets[0]?.paidOrder.status).toBe("unavailable");
    expect(after.mission.targets[0]?.reply.status).toBe("unavailable");
    expect(after.mission.world.recoveryState).toBe("none");
    expect(after.dayLineCard?.objectiveId).toBe("goal_silver_lake_recovery");
    expect(after.dayLineCard?.objectiveComplete).toBe(false);
    expect(after.dayLineCard?.customerId).toBeNull();
    expect(afterRows).toHaveLength(1);
    expect(afterRows[0]?.customerId).toBe(customerId);
    expect(afterRows[0]?.currentMessageBody).toBe(after.mission.targets[0]?.preparedMessage);
  });
});
