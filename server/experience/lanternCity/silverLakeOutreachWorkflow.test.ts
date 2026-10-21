import { beforeEach, describe, expect, it } from "vitest";
import type { CozyCustomerTarget, CozyEncounterMission } from "../../../shared/cozyVillagerOutreach";
import { projectCozyRecoverySurfaces } from "../../../shared/cozyVillagerEvidence";
import { approvedBodyDigest } from "../../../shared/silverLakeOutreachStatus";
import { recordCommunicationPermission } from "../../strategy/communicationPermissionService";
import { evaluatePersonalOutreach } from "../../strategy/personalOutreachEligibility";
import {
  _resetSmsComposeHandoffAudit,
  recordExplicitOutreachApproval,
  smsComposeHandoffEventsForOperator,
} from "./personalNumber/smsComposeHandoffAudit";
import { PERSONAL_OUTREACH_SCHEDULE_APPROVAL } from "./personalNumber/smsComposeHandoff";
import { approveDurablePersonalOutreach } from "./cozyVillagerOutreachService";
import { outreachEvidenceFromRow } from "./cozyRecoverySurfaces";
import {
  _resetScheduledOutreachMemoryStore,
  claimDueOutreachLeases,
  createScheduledOutreachDraft,
  editScheduledOutreachDraft,
  getScheduledOutreachMessage,
  listScheduledOutreachMessages,
  normalizeScheduledForUtc,
  rescheduleOutreachDraft,
} from "./scheduledOutreachService";

const FARM = "laundry_farm";
const BUTLER = "default";
const OPERATOR = "adam-admin";
const CUSTOMER = "phone:3105550141";
const BODY = "Hey Mei! It's Adam from Laundry Farm. Reply STOP if you don't want these texts.";
const ELEVEN_PM = new Date("2026-10-20T06:00:00.000Z");
const TEN_AM = "2026-10-20T10:00:00";

function target(): CozyCustomerTarget {
  return {
    slotId: "slot_01",
    customerId: CUSTOMER,
    displayName: "Mei Lin",
    phone: "+13105550141",
    address: "Silver Lake, Los Angeles",
    territoryId: "silver-lake",
    territoryName: "Silver Lake",
    daysSinceLastOrder: 40,
    paidOrders: 6,
    lifetimeCents: 18000,
    lastOrderDate: "2026-09-10",
    lastOrderSummary: "Wash and fold",
    hasConsent: true,
    consentStatus: "existing_customer_relationship",
    consentBasis: "transactional_dormant_recovery",
    villagerVariant: "fox",
    suggestedMessage: BODY,
    status: "eligible",
  };
}

function mission(): CozyEncounterMission {
  const one = target();
  return {
    missionId: "mission_winback_silver-lake",
    title: "Claire's Recovery Mission: Silver Lake",
    objective: "Reconnect with dormant customers in Silver Lake",
    territoryId: "silver-lake",
    territoryName: "Silver Lake",
    totalLapsedInTerritory: 1,
    activeTargetCount: 1,
    targets: [one],
  };
}

async function savedDraft() {
  return createScheduledOutreachDraft({
    tenantId: FARM,
    operatorId: OPERATOR,
    customerId: CUSTOMER,
    customerName: "Mei Lin",
    recipientPhone: "+13105550141",
    originalSuggestedDraft: BODY,
    messageBody: BODY,
    scheduledFor: TEN_AM,
    timezone: "America/Los_Angeles",
    status: "awaiting_sender_setup",
    deliveryIntent: "scheduled",
    territoryId: "silver-lake",
    idempotencyKey: "silver-lake-mei-2026-10-20",
    now: ELEVEN_PM,
  });
}

describe("Silver Lake overnight outreach", () => {
  beforeEach(() => {
    _resetScheduledOutreachMemoryStore();
    _resetSmsComposeHandoffAudit();
  });

  it("stores 10:00 America/Los_Angeles as 17:00 UTC while Pacific is on daylight time", () => {
    expect(normalizeScheduledForUtc(TEN_AM, "America/Los_Angeles").toISOString()).toBe(
      "2026-10-20T17:00:00.000Z"
    );
  });

  it("rejects a spring-forward wall time and requires a choice when the clock falls back", () => {
    expect(() => normalizeScheduledForUtc("2026-03-08T02:30:00", "America/Los_Angeles")).toThrow(/Daylight Saving Time/);
    expect(() => normalizeScheduledForUtc("2026-11-01T01:30:00", "America/Los_Angeles")).toThrow(/ambiguous/);
    const first = normalizeScheduledForUtc("2026-11-01T01:30:00", "America/Los_Angeles", "first");
    const second = normalizeScheduledForUtc("2026-11-01T01:30:00", "America/Los_Angeles", "second");
    expect(second.getTime() - first.getTime()).toBe(60 * 60 * 1000);
  });

  it("reloads the same saved message and does not duplicate it or its approval", async () => {
    const draft = await savedDraft();
    const again = await savedDraft();
    expect(again.id).toBe(draft.id);
    expect((await listScheduledOutreachMessages({ tenantId: FARM, operatorId: OPERATOR })).filter(row => row.customerId === CUSTOMER)).toHaveLength(1);

    const firstApproval = await recordExplicitOutreachApproval({
      tenantId: FARM,
      operatorId: OPERATOR,
      messageId: draft.id,
      revisionCount: draft.revisionCount,
      approvedBody: draft.currentMessageBody,
      confirmation: PERSONAL_OUTREACH_SCHEDULE_APPROVAL,
      surface: "scheduled_outreach",
    });
    const secondApproval = await recordExplicitOutreachApproval({
      tenantId: FARM,
      operatorId: OPERATOR,
      messageId: draft.id,
      revisionCount: draft.revisionCount,
      approvedBody: draft.currentMessageBody,
      confirmation: PERSONAL_OUTREACH_SCHEDULE_APPROVAL,
      surface: "scheduled_outreach",
    });
    expect(secondApproval.id).toBe(firstApproval.id);
    const events = await smsComposeHandoffEventsForOperator({ tenantId: FARM, operatorId: OPERATOR });
    expect(events.filter(event => event.handoffState === "approved")).toHaveLength(1);

    const reloaded = await getScheduledOutreachMessage({
      tenantId: FARM,
      operatorId: OPERATOR,
      messageId: draft.id,
    });
    expect(reloaded?.currentMessageBody).toBe(BODY);
    expect(reloaded?.scheduledFor.toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(reloaded?.timezone).toBe("America/Los_Angeles");
    expect(reloaded?.status).toBe("awaiting_sender_setup");
  });

  it("shows scheduled before 10am and a due operator action at 10am, never an automatic send", async () => {
    const draft = await savedDraft();
    await recordExplicitOutreachApproval({
      tenantId: FARM,
      operatorId: OPERATOR,
      messageId: draft.id,
      revisionCount: draft.revisionCount,
      approvedBody: BODY,
      confirmation: PERSONAL_OUTREACH_SCHEDULE_APPROVAL,
      surface: "scheduled_outreach",
    });
    const handoffEvents = await smsComposeHandoffEventsForOperator({ tenantId: FARM, operatorId: OPERATOR });
    const before = projectCozyRecoverySurfaces({
      tenantId: FARM,
      operatorId: OPERATOR,
      mission: mission(),
      messages: [outreachEvidenceFromRow(draft)],
      handoffEvents,
      objective: { id: "goal_silver_lake", statement: "Recover Silver Lake", areaLabel: "Silver Lake" },
      now: ELEVEN_PM,
    });
    expect(before.mission.targets[0]!.silverLakeStatus.message).toBe("scheduled");
    expect(before.mission.targets[0]!.silverLakeStatus.automaticTransmission).toBe(false);
    expect(before.dayLineCard?.silverLakeStatus.message).toBe(before.mission.targets[0]!.silverLakeStatus.message);
    expect(before.dayLineCard?.messageId).toBe(before.mission.targets[0]!.messageId);

    const due = projectCozyRecoverySurfaces({
      tenantId: FARM,
      operatorId: OPERATOR,
      mission: mission(),
      messages: [outreachEvidenceFromRow(draft)],
      handoffEvents,
      objective: { id: "goal_silver_lake", statement: "Recover Silver Lake", areaLabel: "Silver Lake" },
      now: new Date("2026-10-20T17:00:00.000Z"),
    });
    expect(due.mission.targets[0]!.silverLakeStatus.message).toBe("due_operator_action");
    expect(due.mission.targets[0]!.silverLakeStatus.detail).toMatch(/will not arrive on its own/);
    expect(due.dayLineCard?.silverLakeStatus.message).toBe("due_operator_action");

    const claimed = await claimDueOutreachLeases({
      leaseHolder: "worker",
      now: new Date("2026-10-20T17:05:00.000Z"),
    });
    expect(claimed).toEqual([]);
    const still = await getScheduledOutreachMessage({ tenantId: FARM, operatorId: OPERATOR, messageId: draft.id });
    expect(still?.status).toBe("awaiting_sender_setup");
    expect(still?.dispatchedAt).toBeNull();
  });

  it("does not keep approval after an edit or a reschedule", async () => {
    const draft = await savedDraft();
    await recordExplicitOutreachApproval({
      tenantId: FARM,
      operatorId: OPERATOR,
      messageId: draft.id,
      revisionCount: 1,
      approvedBody: BODY,
      confirmation: PERSONAL_OUTREACH_SCHEDULE_APPROVAL,
      surface: "scheduled_outreach",
    });
    const edited = await editScheduledOutreachDraft({
      tenantId: FARM,
      operatorId: OPERATOR,
      messageId: draft.id,
      newMessageBody: `${BODY} We can pick up tomorrow.`,
      expectedRevisionCount: 1,
      now: ELEVEN_PM,
    });
    const events = await smsComposeHandoffEventsForOperator({ tenantId: FARM, operatorId: OPERATOR });
    const surfaces = projectCozyRecoverySurfaces({
      tenantId: FARM,
      operatorId: OPERATOR,
      mission: mission(),
      messages: [outreachEvidenceFromRow(edited)],
      handoffEvents: events,
      objective: { id: "goal_silver_lake", statement: "Recover Silver Lake", areaLabel: "Silver Lake" },
      now: ELEVEN_PM,
    });
    expect(edited.revisionCount).toBe(2);
    expect(surfaces.mission.targets[0]!.silverLakeStatus.message).toBe("saved_draft");
    expect(surfaces.mission.targets[0]!.silverLakeStatus.approvalCoversCurrentRevision).toBe(false);
    expect(approvedBodyDigest(edited.currentMessageBody)).not.toBe(approvedBodyDigest(BODY));

    const unsaved = projectCozyRecoverySurfaces({
      tenantId: FARM,
      operatorId: OPERATOR,
      mission: mission(),
      messages: [outreachEvidenceFromRow(draft)],
      handoffEvents: events,
      unsavedDrafts: [{ customerId: CUSTOMER, body: "A different sentence. Reply STOP." }],
      objective: { id: "goal_silver_lake", statement: "Recover Silver Lake", areaLabel: "Silver Lake" },
      now: ELEVEN_PM,
    });
    expect(unsaved.mission.targets[0]!.silverLakeStatus.message).toBe("draft_edited_unsaved");
    expect(unsaved.mission.targets[0]!.silverLakeStatus.explicitlyApproved).toBe(false);

    const moved = await rescheduleOutreachDraft({
      tenantId: FARM,
      operatorId: OPERATOR,
      messageId: edited.id,
      newScheduledFor: "2026-10-21T10:00:00",
      timezone: "America/Los_Angeles",
      now: ELEVEN_PM,
    });
    expect(moved.status).toBe("awaiting_sender_setup");
    expect(moved.revisionCount).toBe(3);
    const afterMove = projectCozyRecoverySurfaces({
      tenantId: FARM,
      operatorId: OPERATOR,
      mission: mission(),
      messages: [outreachEvidenceFromRow(moved)],
      handoffEvents: events,
      objective: { id: "goal_silver_lake", statement: "Recover Silver Lake", areaLabel: "Silver Lake" },
      now: ELEVEN_PM,
    });
    expect(afterMove.mission.targets[0]!.silverLakeStatus.approvalCoversCurrentRevision).toBe(false);
  });

  it("refuses an opted-out recipient and does not record approval", async () => {
    const draft = await createScheduledOutreachDraft({
      tenantId: FARM,
      operatorId: OPERATOR,
      customerId: "phone:3105550199",
      customerName: "Rex Out",
      recipientPhone: "+13105550199",
      originalSuggestedDraft: BODY,
      messageBody: BODY,
      scheduledFor: TEN_AM,
      timezone: "America/Los_Angeles",
      status: "awaiting_sender_setup",
      deliveryIntent: "scheduled",
      now: ELEVEN_PM,
    });
    await recordCommunicationPermission({
      tenantId: FARM,
      subjectType: "customer",
      subjectId: "phone:3105550199",
      channel: "sms",
      status: "opted_out",
      reason: "STOP",
    });
    await expect(
      approveDurablePersonalOutreach({
        tenantId: FARM,
        operatorId: OPERATOR,
        messageId: draft.id,
        expectedRevisionCount: draft.revisionCount,
        confirmation: PERSONAL_OUTREACH_SCHEDULE_APPROVAL,
        now: ELEVEN_PM,
      })
    ).rejects.toThrow(/opted out/i);
    const events = await smsComposeHandoffEventsForOperator({ tenantId: FARM, operatorId: OPERATOR });
    expect(events.filter(event => event.messageId === draft.id)).toHaveLength(0);
    await expect(
      createScheduledOutreachDraft({
        tenantId: FARM,
        operatorId: OPERATOR,
        customerId: "phone:3105550199",
        customerName: "Rex Out",
        recipientPhone: "+13105550199",
        originalSuggestedDraft: BODY,
        messageBody: BODY,
        scheduledFor: "2026-10-21T10:00:00",
        timezone: "America/Los_Angeles",
        idempotencyKey: "rex-must-not-write",
        now: ELEVEN_PM,
      })
    ).rejects.toThrow(/opted out/i);
  });

  it("does not let Laundry Butler read a Laundry Farm message", async () => {
    const farm = await savedDraft();
    await createScheduledOutreachDraft({
      tenantId: BUTLER,
      operatorId: OPERATOR,
      customerId: "phone:3105550108",
      customerName: "Butler Customer",
      recipientPhone: "+13105550108",
      originalSuggestedDraft: "Butler draft. Reply STOP.",
      messageBody: "Butler draft. Reply STOP.",
      scheduledFor: TEN_AM,
      timezone: "America/Los_Angeles",
      now: ELEVEN_PM,
    });
    const farmRows = await listScheduledOutreachMessages({ tenantId: FARM, operatorId: OPERATOR });
    const butlerRows = await listScheduledOutreachMessages({ tenantId: BUTLER, operatorId: OPERATOR });
    expect(farmRows.map(row => row.customerId)).toEqual([CUSTOMER]);
    expect(butlerRows.map(row => row.customerId)).toEqual(["phone:3105550108"]);
    expect(await getScheduledOutreachMessage({ tenantId: BUTLER, operatorId: OPERATOR, messageId: farm.id })).toBeNull();

    const crossed = projectCozyRecoverySurfaces({
      tenantId: BUTLER,
      operatorId: OPERATOR,
      mission: mission(),
      messages: farmRows.map(outreachEvidenceFromRow),
      objective: { id: "goal_butler", statement: "Butler", areaLabel: "Silver Lake" },
      now: ELEVEN_PM,
    });
    expect(crossed.mission.targets[0]!.silverLakeStatus.message).toBe("draft_prepared");
    expect(crossed.mission.targets[0]!.messageId).toBeNull();
  });

  it("keeps a failed or reported send from looking independently verified, and withholds revenue", () => {
    const failed = projectCozyRecoverySurfaces({
      tenantId: FARM,
      operatorId: OPERATOR,
      mission: mission(),
      messages: [{
        ...outreachEvidenceFromRow({
          id: "som_failed",
          tenantId: FARM,
          operatorId: OPERATOR,
          customerId: CUSTOMER,
          customerName: "Mei Lin",
          recipientPhone: "+13105550141",
          senderPhone: null,
          originalSuggestedDraft: BODY,
          currentMessageBody: BODY,
          revisionCount: 1,
          scheduledFor: new Date("2026-10-20T17:00:00.000Z"),
          timezone: "America/Los_Angeles",
          status: "failed",
          leaseHolder: null,
          leasedUntil: null,
          dispatchAttemptedAt: new Date("2026-10-20T17:01:00.000Z"),
          dispatchedAt: null,
          cancelledAt: null,
          cancellationReason: null,
          failureReason: "Messages did not open",
          externalMessageId: null,
          idempotencyKey: null,
          deliveryIntent: "scheduled",
          slotId: null,
          territoryId: "silver-lake",
          createdAt: ELEVEN_PM,
          updatedAt: ELEVEN_PM,
        }),
      }],
      handoffEvents: [{
        messageId: "som_failed",
        revisionCount: 1,
        bodyDigest: approvedBodyDigest(BODY),
        handoffState: "operator_reported_sent",
      }],
      objective: { id: "goal_silver_lake", statement: "Recover Silver Lake", areaLabel: "Silver Lake" },
      paidOrderEvidence: [{ customerId: CUSTOMER, orderId: "order_1", paidAt: "2026-10-21T18:00:00.000Z" }],
      now: new Date("2026-10-21T18:00:00.000Z"),
    });
    expect(failed.mission.targets[0]!.silverLakeStatus.message).toBe("failed");
    expect(failed.mission.targets[0]!.silverLakeStatus.operatorReportIsVerifiedSend).toBe(false);
    expect(failed.mission.targets[0]!.silverLakeStatus.revenue).toBe("unavailable");
    expect(failed.mission.targets[0]!.silverLakeStatus.revenueAttributedToOutreach).toBe(false);
    expect(failed.mission.targets[0]!.objectiveComplete).toBe(false);
    const reported = projectCozyRecoverySurfaces({
      tenantId: FARM,
      operatorId: OPERATOR,
      mission: mission(),
      messages: [outreachEvidenceFromRow({
        id: "som_reported",
        tenantId: FARM,
        operatorId: OPERATOR,
        customerId: CUSTOMER,
        customerName: "Mei Lin",
        recipientPhone: "+13105550141",
        senderPhone: null,
        originalSuggestedDraft: BODY,
        currentMessageBody: BODY,
        revisionCount: 1,
        scheduledFor: new Date("2026-10-20T17:00:00.000Z"),
        timezone: "America/Los_Angeles",
        status: "awaiting_sender_setup",
        leaseHolder: null,
        leasedUntil: null,
        dispatchAttemptedAt: null,
        dispatchedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        failureReason: null,
        externalMessageId: null,
        idempotencyKey: null,
        deliveryIntent: "scheduled",
        slotId: null,
        territoryId: "silver-lake",
        createdAt: ELEVEN_PM,
        updatedAt: ELEVEN_PM,
      })],
      handoffEvents: [
        { messageId: "som_reported", revisionCount: 1, bodyDigest: approvedBodyDigest(BODY), handoffState: "approved" },
        { messageId: "som_reported", revisionCount: 1, bodyDigest: approvedBodyDigest(BODY), handoffState: "compose_opened" },
        { messageId: "som_reported", revisionCount: 1, bodyDigest: approvedBodyDigest(BODY), handoffState: "operator_reported_sent" },
      ],
      objective: { id: "goal_silver_lake", statement: "Recover Silver Lake", areaLabel: "Silver Lake" },
      now: new Date("2026-10-20T17:05:00.000Z"),
    });
    expect(reported.mission.targets[0]!.silverLakeStatus.message).toBe("operator_reported_sent");
    expect(reported.mission.targets[0]!.silverLakeStatus.operatorReportIsVerifiedSend).toBe(false);
    expect(reported.dayLineCard?.silverLakeStatus.message).toBe("operator_reported_sent");

    expect(evaluatePersonalOutreach({
      tenantId: FARM,
      freshness: "current",
      sourceReadable: true,
      matched: true,
      inTerritory: true,
      paidOrders: 4,
      capturedCents: 1000,
      lastOrderDate: "2026-10-18",
      dormant: true,
      contradictingRecentOrder: true,
      phoneDigits: "3105550141",
      optedOut: false,
      contactRestricted: false,
      permissionReadable: true,
      lastOutreachOn: null,
      today: "2026-10-20",
    }).eligible).toBe(false);
  });
});
