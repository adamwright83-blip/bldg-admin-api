import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CozyRecoveryDayLineCard } from "@shared/cozyVillagerEvidence";
import { projectSilverLakeOutreachStatus } from "@shared/silverLakeOutreachStatus";
import {
  RECOVERY_SCHEDULED_LABEL,
  RecoveryOutreachCard,
  editExistingRecoveryDraft,
  scheduleExistingRecoveryDraft,
  type RecoveryOutreachScheduleInput,
  type RecoveryOutreachScheduleRow,
} from "./GoldlineDayPlan";

const PROOF_OBJECTIVE = "dgoal_proof_silver_lake_objective";
const PROOF_CUSTOMER = "phone:3105550141";
const STORED_DRAFT = "Hey, this is the stored Silver Lake draft.";

function proofCard(overrides: Partial<CozyRecoveryDayLineCard> = {}): CozyRecoveryDayLineCard {
  return {
    objectiveId: PROOF_OBJECTIVE,
    objectiveStatement: "Recover dormant laundry customers in Silver Lake",
    missionTitle: "Recover dormant laundry customers in Silver Lake",
    missionType: "customer_recovery",
    customerId: PROOF_CUSTOMER,
    customerDisplayName: "Proof Customer",
    nextAction: "Review the prepared draft, then Send Now or Schedule. Nothing has been sent.",
    nextActionId: `draft:${PROOF_OBJECTIVE}:${PROOF_CUSTOMER}`,
    messageId: null,
    messageBody: STORED_DRAFT,
    timeWindow: null,
    communicationState: "draft_prepared",
    communicationLabel: "Draft Prepared",
    transport: null,
    evidenceToComplete:
      "A dispatched row with dispatchedAt and a provider reference completes this outreach action only.",
    outreachActionComplete: false,
    objectiveComplete: false,
    presentationNote: null,
    openHref: "/growth/lantern-city?cozy=1&territory=silver-lake",
    reply: { status: "unavailable", reason: "Reply evidence is unavailable." },
    paidOrder: { status: "unavailable", reason: "A paid order is not verified here." },
    world: {
      recoveryState: "none",
      worldEventAppended: false,
      note: "No recovery world event.",
    },
    silverLakeStatus: projectSilverLakeOutreachStatus({
      tenantId: "laundry_farm",
      operatorId: "adam-admin",
      customerId: PROOF_CUSTOMER,
      suggestedBody: STORED_DRAFT,
    }),
    ...overrides,
  };
}

function pendingRow(
  input: RecoveryOutreachScheduleInput,
  id: string
): RecoveryOutreachScheduleRow & { idempotencyKey: string } {
  return {
    id,
    customerId: input.customerId,
    status: "pending",
    currentMessageBody: input.messageBody,
    dispatchedAt: null,
    externalMessageId: null,
    deliveryIntent: "scheduled",
    idempotencyKey: input.idempotencyKey,
  };
}

describe("Day Line recovery card schedules the existing draft", () => {
  it("schedules that draft once, keeps one objective and one customer, and does not send or complete it", async () => {
    const card = proofCard();
    const calls: RecoveryOutreachScheduleInput[] = [];
    const rows = new Map<string, RecoveryOutreachScheduleRow & { idempotencyKey: string }>();
    const schedule = async (input: RecoveryOutreachScheduleInput) => {
      calls.push(input);
      const existing = [...rows.values()].find(row => row.idempotencyKey === input.idempotencyKey);
      if (existing) return existing;
      const row = pendingRow(input, "som_one");
      rows.set(row.id, row);
      return row;
    };

    const edited = `${STORED_DRAFT} Thursday works.`;
    const first = await scheduleExistingRecoveryDraft({
      card,
      editedBody: edited,
      scheduledFor: "2026-10-16T10:00",
      schedule,
    });
    const second = await scheduleExistingRecoveryDraft({
      card,
      editedBody: edited,
      scheduledFor: "2026-10-16T10:00",
      schedule,
    });

    expect(rows.size).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      customerId: PROOF_CUSTOMER,
      messageBody: edited,
      scheduledFor: "2026-10-16T10:00",
      timezone: "America/Los_Angeles",
      territoryId: "silver-lake",
      idempotencyKey: `day-line-recovery:${PROOF_OBJECTIVE}:${PROOF_CUSTOMER}`,
    });
    expect(calls[0]).not.toHaveProperty("missionId");
    expect(calls[0]).not.toHaveProperty("expectedPhone");
    expect(first).toEqual({
      objectiveId: PROOF_OBJECTIVE,
      customerId: PROOF_CUSTOMER,
      messageId: "som_one",
      objectiveComplete: false,
      communicationState: "scheduled",
      label: RECOVERY_SCHEDULED_LABEL,
      messageSent: false,
    });
    expect(second.messageId).toBe(first.messageId);
    expect(second.objectiveId).toBe(PROOF_OBJECTIVE);
    expect(second.customerId).toBe(PROOF_CUSTOMER);
    expect(second.objectiveComplete).toBe(false);
    expect(second.messageSent).toBe(false);
    expect(first.label.startsWith("Scheduled")).toBe(true);
    expect(rows.get("som_one")?.status).toBe("pending");
    expect(rows.get("som_one")?.dispatchedAt).toBeNull();
    expect(rows.get("som_one")?.externalMessageId).toBeNull();

    const html = renderToStaticMarkup(
      createElement(RecoveryOutreachCard, {
        card,
        onSchedule: schedule,
      })
    );
    expect(html).toContain('data-testid="recovery-outreach-day-line-card"');
    expect(html).toContain(`data-objective-id="${PROOF_OBJECTIVE}"`);
    expect(html).toContain(`data-customer-id="${PROOF_CUSTOMER}"`);
    expect(html).toContain('data-message-id=""');
    expect(html).toContain('data-communication-state="draft_prepared"');
    expect(html).toContain('data-objective-complete="false"');
    expect(html).toContain(STORED_DRAFT);
    expect(html).toContain('data-testid="recovery-outreach-schedule"');
    expect(html).toContain(">Schedule<");
    expect(html).toContain("Scheduling keeps this draft pending. It does not send it.");
    expect(html).toContain(">OPEN<");
    expect(html).not.toContain("SEND NOW");
    expect(html).not.toContain("Send observed");
    expect(html).not.toContain("data-pose=");
    expect(html).not.toMatch(/\bXP\b|\bcoins\b|\bstreak\b/i);
  });

  it("keeps the stored message id and does not schedule a second outreach", async () => {
    const card = proofCard({
      messageId: "som_existing",
      communicationState: "scheduled",
      communicationLabel: "Scheduled",
      messageBody: STORED_DRAFT,
      timeWindow: "Thu, Oct 16, 10:00 AM PDT",
    });
    const schedule = vi.fn();
    await expect(
      scheduleExistingRecoveryDraft({
        card,
        editedBody: `${STORED_DRAFT} Revised.`,
        scheduledFor: "2026-10-16T10:00",
        schedule,
      })
    ).rejects.toThrow(/already has a message/);
    expect(schedule).not.toHaveBeenCalled();

    const edited = await editExistingRecoveryDraft({
      card,
      editedBody: `${STORED_DRAFT} Revised on the card.`,
      edit: async input => ({
        id: input.messageId,
        customerId: PROOF_CUSTOMER,
        status: "pending",
        currentMessageBody: input.newMessageBody,
        dispatchedAt: null,
        externalMessageId: null,
        deliveryIntent: "scheduled",
      }),
    });
    expect(edited).toMatchObject({
      objectiveId: PROOF_OBJECTIVE,
      customerId: PROOF_CUSTOMER,
      messageId: "som_existing",
      objectiveComplete: false,
      communicationState: "scheduled",
      label: RECOVERY_SCHEDULED_LABEL,
      messageSent: false,
    });

    const html = renderToStaticMarkup(createElement(RecoveryOutreachCard, { card }));
    expect(html).toContain('data-message-id="som_existing"');
    expect(html).toContain('data-objective-id="dgoal_proof_silver_lake_objective"');
    expect(html).toContain('data-customer-id="phone:3105550141"');
    expect(html).toContain('data-communication-state="scheduled"');
    expect(html).toContain('data-objective-complete="false"');
    expect(html).toContain(RECOVERY_SCHEDULED_LABEL);
    expect(html).toContain(STORED_DRAFT);
    expect(html).toContain('data-testid="recovery-outreach-save-draft"');
    expect(html).not.toContain('data-testid="recovery-outreach-schedule"');
    expect(html).toContain(">OPEN<");
  });

  it("refuses a schedule result that looks sent", async () => {
    await expect(
      scheduleExistingRecoveryDraft({
        card: proofCard(),
        editedBody: STORED_DRAFT,
        scheduledFor: "2026-10-16T10:00",
        schedule: async () => ({
          id: "som_sent",
          customerId: PROOF_CUSTOMER,
          status: "dispatched",
          currentMessageBody: STORED_DRAFT,
          dispatchedAt: "2026-10-16T17:00:00.000Z",
          externalMessageId: "SM123",
          deliveryIntent: "immediate",
        }),
      })
    ).rejects.toThrow(/must not mark the message sent/);
  });
});
