import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { withUtcTimezone } from "../../db";
import { recordCommunicationPermission } from "../../strategy/communicationPermissionService";
import { loadCozyRecoverySurfaces } from "./cozyRecoverySurfaces";
import { createScheduledOutreachDraft } from "./scheduledOutreachService";
import { sendCozyOutreachNow } from "./cozyVillagerOutreachService";

/**
 * Durable unfinished-action proof against the existing Goldline proof fixture.
 *
 * Already covered elsewhere, and not repeated here:
 * - A future schedule stays scheduled and unsent after reload: the browser
 *   Day Line spec, and the in-memory journey.
 * - The projector leaves a past window open: shared/cozyVillagerEvidence.test.ts
 *   ("keeps one card for the existing objective and leaves a past window open").
 *
 * This file checks the proof-fixture customer on disposable MySQL 8: reload
 * does not create a second goal, a consent block stays blocked, an
 * awaiting-sender row stays unsent, and a stored past window stays open.
 */

const PROOF_GOAL = "dgoal_proof_silver_lake_objective";
const TENANT = "default";
const OPERATOR = "admin-owner";

function assertProofDatabase(url: string) {
  const parsed = new URL(url);
  const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (!local || !parsed.pathname.replace(/^\//, "").startsWith("goldline_proof")) {
    throw new Error("This proof only runs against the local goldline_proof database.");
  }
}

const databaseUrl = process.env.DATABASE_URL ?? "";
const describeProof = databaseUrl ? describe : describe.skip;

describeProof("unfinished Silver Lake recovery on the proof fixture", () => {
  let sql: mysql.Connection;
  const createdMessageIds: string[] = [];

  afterAll(async () => {
    if (!sql) return;
    if (createdMessageIds.length) {
      const marks = createdMessageIds.map(() => "?").join(", ");
      await sql.execute(
        `DELETE FROM scheduled_outreach_revisions WHERE outreach_message_id IN (${marks})`,
        createdMessageIds
      );
      await sql.execute(
        `DELETE FROM scheduled_outreach_messages WHERE id IN (${marks})`,
        createdMessageIds
      );
    }
    await sql.execute(
      "DELETE FROM communication_permissions WHERE tenantId = ? AND subjectType = 'customer' AND subjectId LIKE 'phone:%'",
      [TENANT]
    );
    await sql.end();
  });

  it("keeps one objective and leaves blocked, awaiting, and past-window work unfinished", async () => {
    assertProofDatabase(databaseUrl);
    sql = await mysql.createConnection(withUtcTimezone(databaseUrl));
    const [versionRows] = await sql.execute<mysql.RowDataPacket[]>("SELECT VERSION() AS version");
    expect(String(versionRows[0]?.version)).toMatch(/^8\./);

    const goalCount = async () => {
      const [rows] = await sql.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM daphne_goals WHERE tenantId = ? AND canonicalOperatorId = ?",
        [TENANT, OPERATOR]
      );
      return Number(rows[0]?.n);
    };
    const planCount = async () => {
      const [rows] = await sql.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM strategy_mission_plan WHERE tenantId = ?",
        [TENANT]
      );
      return Number(rows[0]?.n);
    };
    const recoveryEvents = async () => {
      const [rows] = await sql.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM goldline_world_events WHERE tenantId = ? AND eventType IN ('recovery_outreach_completed', 'customer_recovered')",
        [TENANT]
      );
      return Number(rows[0]?.n);
    };

    const goalsBefore = await goalCount();
    const plansBefore = await planCount();
    const recoveryBefore = await recoveryEvents();
    expect(goalsBefore).toBeGreaterThan(0);
    expect(recoveryBefore).toBe(0);

    const opened = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
    });
    const customer = opened.mission.targets[0];
    expect(customer?.customerId).toBeTruthy();
    expect(opened.mission.targets.filter(target => target.customerId === customer!.customerId)).toHaveLength(1);
    expect(opened.mission.missionId).toBe("mission_winback_silver-lake");
    expect(opened.dayLineCard?.objectiveId).toBe(PROOF_GOAL);
    expect(opened.dayLineCard?.customerId).toBe(customer!.customerId);
    expect(opened.dayLineCard?.objectiveComplete).toBe(false);
    expect(opened.mission.world.worldEventAppended).toBe(false);

    const reopened = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
    });
    expect(reopened.mission.missionId).toBe(opened.mission.missionId);
    expect(reopened.dayLineCard?.objectiveId).toBe(PROOF_GOAL);
    expect(reopened.dayLineCard?.customerId).toBe(customer!.customerId);
    expect(reopened.mission.targets.filter(target => target.customerId === customer!.customerId)).toHaveLength(1);
    expect(await goalCount()).toBe(goalsBefore);
    expect(await planCount()).toBe(plansBefore);

    await recordCommunicationPermission({
      tenantId: TENANT,
      subjectType: "customer",
      subjectId: customer!.customerId,
      channel: "sms",
      status: "opted_out",
      reason: "proof-fixture refusal for the unfinished-action check",
    });
    const blocked = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
    });
    const blockedCustomer = blocked.mission.targets.find(target => target.customerId === customer!.customerId);
    expect(blockedCustomer?.communicationState).toBe("consent_blocked");
    expect(blockedCustomer?.pose).toBe("idle");
    expect(blockedCustomer?.messageId ?? null).toBeNull();
    expect(blockedCustomer?.outreachActionComplete).toBe(false);
    expect(blocked.dayLineCard?.objectiveId).toBe(PROOF_GOAL);
    expect(blocked.dayLineCard?.customerId).toBe(customer!.customerId);
    expect(blocked.dayLineCard?.messageId ?? null).toBeNull();
    expect(blocked.dayLineCard?.objectiveComplete).toBe(false);
    const blockedAgain = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
    });
    expect(
      blockedAgain.mission.targets.find(target => target.customerId === customer!.customerId)?.communicationState
    ).toBe("consent_blocked");
    expect(blockedAgain.mission.missionId).toBe(opened.mission.missionId);
    expect(await goalCount()).toBe(goalsBefore);
    const [blockedRows] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM scheduled_outreach_messages WHERE tenant_id = ? AND customer_id = ?",
      [TENANT, customer!.customerId]
    );
    expect(Number(blockedRows[0]?.n)).toBe(0);

    await recordCommunicationPermission({
      tenantId: TENANT,
      subjectType: "customer",
      subjectId: customer!.customerId,
      channel: "sms",
      status: "unspecified",
    });

    const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const draft = await createScheduledOutreachDraft({
      tenantId: TENANT,
      operatorId: OPERATOR,
      customerId: customer!.customerId,
      customerName: customer!.displayName,
      recipientPhone: customer!.phone ?? "",
      originalSuggestedDraft: customer!.suggestedMessage,
      messageBody: "Proof fixture schedule. Not a live send.",
      scheduledFor: tomorrow.toISOString(),
      timezone: "America/Los_Angeles",
      slotId: customer!.slotId,
      territoryId: "silver-lake",
    });
    createdMessageIds.push(draft.id);
    await sql.execute(
      "UPDATE scheduled_outreach_messages SET scheduled_for = '2020-01-15 18:00:00' WHERE id = ?",
      [draft.id]
    );
    const past = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
    });
    const pastCustomer = past.mission.targets.find(target => target.customerId === customer!.customerId);
    expect(pastCustomer?.communicationState).toBe("scheduled");
    expect(pastCustomer?.pose).toBe("wave");
    expect(pastCustomer?.messageId).toBe(draft.id);
    expect(past.dayLineCard?.objectiveId).toBe(PROOF_GOAL);
    expect(past.dayLineCard?.customerId).toBe(customer!.customerId);
    expect(past.dayLineCard?.messageId).toBe(draft.id);
    expect(past.dayLineCard?.objectiveComplete).toBe(false);
    expect(past.dayLineCard?.timeWindow).toMatch(/window passed — still open/);
    expect(past.mission.missionId).toBe(opened.mission.missionId);
    const [pastRow] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT status, dispatched_at, external_message_id FROM scheduled_outreach_messages WHERE id = ?",
      [draft.id]
    );
    expect(pastRow[0]).toMatchObject({
      status: "pending",
      dispatched_at: null,
      external_message_id: null,
    });

    await sql.execute("DELETE FROM scheduled_outreach_revisions WHERE outreach_message_id = ?", [draft.id]);
    await sql.execute("DELETE FROM scheduled_outreach_messages WHERE id = ?", [draft.id]);

    const awaiting = await sendCozyOutreachNow({
      tenantId: TENANT,
      operatorId: OPERATOR,
      customerId: customer!.customerId,
      messageBody: "Proof fixture send now. No sender is connected.",
      slotId: customer!.slotId,
      territoryId: "silver-lake",
      expectedPhone: customer!.phone ?? undefined,
    });
    expect(awaiting.success).toBe(false);
    expect(awaiting.status).toBe("awaiting_sender_setup");
    expect(awaiting.dispatchedAt).toBeNull();
    expect(awaiting.externalMessageId).toBeNull();
    createdMessageIds.push(awaiting.messageId);

    const waiting = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
    });
    const waitingCustomer = waiting.mission.targets.find(target => target.customerId === customer!.customerId);
    expect(waitingCustomer?.communicationState).toBe("awaiting_sender");
    expect(waitingCustomer?.pose).toBe("wave");
    expect(waitingCustomer?.messageId).toBe(awaiting.messageId);
    expect(waiting.dayLineCard?.objectiveId).toBe(PROOF_GOAL);
    expect(waiting.dayLineCard?.customerId).toBe(customer!.customerId);
    expect(waiting.dayLineCard?.messageId).toBe(awaiting.messageId);
    expect(waiting.dayLineCard?.objectiveComplete).toBe(false);
    expect(waiting.mission.world.recoveryState).toBe("none");
    expect(waiting.mission.world.worldEventAppended).toBe(false);

    const waitingAgain = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
    });
    expect(waitingAgain.mission.missionId).toBe(opened.mission.missionId);
    expect(waitingAgain.dayLineCard?.objectiveId).toBe(PROOF_GOAL);
    expect(waitingAgain.dayLineCard?.customerId).toBe(customer!.customerId);
    expect(waitingAgain.dayLineCard?.messageId).toBe(awaiting.messageId);
    expect(
      waitingAgain.mission.targets.find(target => target.customerId === customer!.customerId)?.communicationState
    ).toBe("awaiting_sender");
    expect(await goalCount()).toBe(goalsBefore);
    expect(await planCount()).toBe(plansBefore);
    expect(await recoveryEvents()).toBe(0);
    const [waitingRow] = await sql.execute<mysql.RowDataPacket[]>(
      "SELECT status, dispatched_at, external_message_id FROM scheduled_outreach_messages WHERE id = ?",
      [awaiting.messageId]
    );
    expect(waitingRow[0]).toMatchObject({
      status: "awaiting_sender_setup",
      dispatched_at: null,
      external_message_id: null,
    });
  });
});
