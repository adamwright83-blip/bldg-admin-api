import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getCozyEncounterMission,
  sendCozyOutreachNow,
} from "./cozyVillagerOutreachService";
import { _resetScheduledOutreachMemoryStore } from "./scheduledOutreachService";

vi.mock("../../strategy/winBackDossier", () => ({
  readWinBackDossier: vi.fn().mockResolvedValue({
    area: "Silver Lake",
    lapsedCount: 7,
    contacts: [
      {
        identityId: "cust_sl_001_mei",
        name: "Mei Lin",
        phone: "+12135550141",
        daysSinceLastOrder: 34,
        paidOrders: 14,
        lifetimeCents: 62400,
        lastOrderDate: "2026-09-10",
        lastOrderSummary: "Wash & Fold 32 lbs",
      },
      {
        identityId: "cust_sl_002_barnaby",
        name: "Barnaby Hayes",
        phone: "+12135550142",
        daysSinceLastOrder: 48,
        paidOrders: 8,
        lifetimeCents: 38200,
        lastOrderDate: "2026-08-27",
        lastOrderSummary: "Standard Wash & Fold",
      },
      {
        identityId: "cust_sl_003_oliver",
        name: "Oliver Bennett",
        phone: "+12135550143",
        daysSinceLastOrder: 62,
        paidOrders: 11,
        lifetimeCents: 51900,
        lastOrderDate: "2026-08-13",
        lastOrderSummary: "Duvet Comforter",
      },
      {
        identityId: "cust_sl_004_bella",
        name: "Bella Ramos",
        phone: "+12135550144",
        daysSinceLastOrder: 29,
        paidOrders: 6,
        lifetimeCents: 29400,
        lastOrderDate: "2026-09-15",
        lastOrderSummary: "Eco Wash & Fold",
      },
      {
        identityId: "cust_sl_005_sammy",
        name: "Sammy Cruz",
        phone: "+12135550145",
        daysSinceLastOrder: 76,
        paidOrders: 19,
        lifetimeCents: 84600,
        lastOrderDate: "2026-07-30",
        lastOrderSummary: "Commercial uniform linens",
      },
      {
        identityId: "cust_sl_006_bramble",
        name: "Bramble Vance",
        phone: "+12135550146",
        daysSinceLastOrder: 91,
        paidOrders: 5,
        lifetimeCents: 21500,
        lastOrderDate: "2026-07-15",
        lastOrderSummary: "Standard Wash & Fold",
      },
      {
        identityId: "cust_sl_007_cleo",
        name: "Cleo Montgomery",
        phone: "+12135550147",
        daysSinceLastOrder: 42,
        paidOrders: 12,
        lifetimeCents: 56800,
        lastOrderDate: "2026-09-02",
        lastOrderSummary: "Sheets & Towels",
      },
    ],
  }),
}));

describe("cozyVillagerOutreachService", () => {
  beforeEach(() => {
    _resetScheduledOutreachMemoryStore();
  });

  it("loads the 7-customer Silver Lake recovery mission with 7 active houses and 1 inactive", async () => {
    const mission = await getCozyEncounterMission({
      tenantId: "tenant_test",
      canonicalOperatorId: "op_test",
      territoryId: "silver-lake",
    });

    expect(mission.territoryId).toBe("silver-lake");
    expect(mission.activeTargetCount).toBe(7);
    expect(mission.targets.length).toBe(7);

    // Slot IDs should be slot_01 to slot_07, slot_08 is inactive
    const slots = mission.targets.map((t) => t.slotId);
    expect(slots).toEqual([
      "slot_01",
      "slot_02",
      "slot_03",
      "slot_04",
      "slot_05",
      "slot_06",
      "slot_07",
    ]);
    expect(slots).not.toContain("slot_08");

    // Check Fox Mei in slot 1
    const mei = mission.targets[0];
    expect(mei.displayName).toBe("Mei Lin");
    expect(mei.villagerVariant).toBe("fox");
    expect(mei.daysSinceLastOrder).toBe(34);
    expect(mei.suggestedMessage).toContain("Hey Mei! It's Adam from Laundry Farm.");
    expect(mei.suggestedMessage).toContain("34 days");
    expect(mei.status).toBe("eligible");
  });

  it("commits outreach to personal scheduled outbox and returns awaiting_sender_setup in Phase 1", async () => {
    const result = await sendCozyOutreachNow({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: "Claire's suggestion",
      messageBody: "Hey Mei, checking in from Laundry Farm!",
      slotId: "slot_01",
      isTestSenderAllowed: false,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("awaiting_sender_setup");
    expect(result.messageId).toBeDefined();
    expect(result.evidenceName).toBe("awaiting_sender_setup");
    expect(result.dispatchedAt).toBeNull();
  });

  it("dispatches through personal sender when test sender is explicitly allowed", async () => {
    const result = await sendCozyOutreachNow({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: "Claire's suggestion",
      messageBody: "Hey Mei, checking in from Laundry Farm!",
      slotId: "slot_01",
      isTestSenderAllowed: true,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("dispatched");
    expect(result.externalMessageId).toContain("android_msg_");
    expect(result.dispatchedAt).toBeDefined();
  });

  it("blocks dispatch to opted-out recipients", async () => {
    await expect(
      sendCozyOutreachNow({
        tenantId: "tenant_test",
        operatorId: "op_test",
        customerId: "cust_opted_out",
        customerName: "Opted Out User",
        recipientPhone: "+15550009999", // Known opt-out
        originalSuggestedDraft: "Draft",
        messageBody: "Should fail",
        slotId: "slot_01",
      })
    ).rejects.toThrow("Recipient has opted out of SMS outreach");
  });

  it("rejects empty message body", async () => {
    await expect(
      sendCozyOutreachNow({
        tenantId: "tenant_test",
        operatorId: "op_test",
        customerId: "cust_sl_001_mei",
        customerName: "Mei Lin",
        recipientPhone: "+12135550141",
        originalSuggestedDraft: "Draft",
        messageBody: "   ",
        slotId: "slot_01",
      })
    ).rejects.toThrow("Message body cannot be empty");
  });

  it("reflects existing scheduled outbox messages in getCozyEncounterMission", async () => {
    // Schedule outreach for Mei
    await sendCozyOutreachNow({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: "Draft",
      messageBody: "Pending outbox message",
      slotId: "slot_01",
      isTestSenderAllowed: false,
    });

    const mission = await getCozyEncounterMission({
      tenantId: "tenant_test",
      canonicalOperatorId: "op_test",
      territoryId: "silver-lake",
    });

    const mei = mission.targets.find((t) => t.customerId === "cust_sl_001_mei");
    expect(mei?.status).toBe("scheduled");
    expect(mei?.scheduledDraft).toBeDefined();
    expect(mei?.scheduledDraft?.currentMessageBody).toBe("Pending outbox message");
  });
});
