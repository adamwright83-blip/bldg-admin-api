import { describe, it, expect, beforeEach, vi } from "vitest";
import { assertPersonalOutreachHandoff } from "../../strategy/personalOutreachWrite";
import {
  getCozyEncounterMission,
  sendCozyOutreachNow,
  resolveCanonicalCustomerContact,
} from "./cozyVillagerOutreachService";
import {
  _resetScheduledOutreachMemoryStore,
  listScheduledOutreachMessages,
} from "./scheduledOutreachService";

vi.mock("../../strategy/personalOutreachWrite", () => ({
  readPersonalOutreachRoster: vi.fn(async () => ({
    area: "Silver Lake",
    freshness: "current",
    lapsedCount: 7,
    emptyMeansNoLapsedCustomers: false,
    withheldReason: null,
    contacts: [
      ["cust_sl_001_mei", "Mei Lin", "+12135550141", 34, 14, 62400],
      ["cust_sl_002_barnaby", "Barnaby Hayes", "+12135550142", 48, 8, 38200],
      ["cust_sl_003_oliver", "Oliver Bennett", "+12135550143", 62, 11, 51900],
      ["cust_sl_004_bella", "Bella Ramos", "+12135550144", 29, 6, 29400],
      ["cust_sl_005_sammy", "Sammy Cruz", "+12135550145", 76, 19, 84600],
      ["cust_sl_006_bramble", "Bramble Vance", "+12135550146", 91, 5, 21500],
      ["cust_sl_007_cleo", "Cleo Montgomery", "+12135550147", 42, 12, 56800],
    ].map(([identityId, name, phone, daysSinceLastOrder, paidOrders, lifetimeCents]) => ({
      identityId,
      name,
      phone,
      daysSinceLastOrder,
      paidOrders,
      lifetimeCents,
      lastOrderDate: "2026-08-01",
      lastOrderSummary: "Wash & Fold",
      smsConsent: "unknown",
      blocks: [],
    })),
  })),
  assertPersonalOutreachHandoff: vi.fn(async (input: { customerId: string; messageBody: string }) => {
    if (!input.messageBody.trim()) throw new Error("Message body cannot be empty");
    return {
      customerId: input.customerId,
      customerName: "Mei Lin",
      phone: "+12135550141",
      daysSinceLastOrder: 34,
      territoryId: "silver-lake",
      territoryName: "Silver Lake",
      suggestedMessage: "Hey Mei! It's Adam from Laundry Farm. Reply STOP if you don't want these texts.",
    };
  }),
  buildPersonalSuggestedMessage: (name: string, days: number) =>
    `Hey ${name.split(" ")[0]}! It's Adam from Laundry Farm. It's been about ${days} days since your last pickup. Reply STOP if you don't want these texts.`,
}));

vi.mock("../../strategy/winBackDossier", () => ({
  readWinBackDossier: vi.fn().mockImplementation((input: { tenantId: string; limit?: number }) => {
    return Promise.resolve({
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
    });
  }),
}));

describe("cozyVillagerOutreachService", () => {
  beforeEach(() => {
    _resetScheduledOutreachMemoryStore();
  });

  it("loads the 7-customer Silver Lake recovery mission with truthful consent status", async () => {
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
    expect(mei.status).toBe("eligible");
    // Unspecified G14 permission must NOT claim "verified_opt_in"
    expect(mei.consentStatus).toBe("existing_customer_relationship");
  });

  it("resolves canonical customer contact details server-authoritatively", async () => {
    const resolved = await resolveCanonicalCustomerContact({
      tenantId: "tenant_test",
      canonicalOperatorId: "op_test",
      customerId: "cust_sl_001_mei",
      territoryId: "silver-lake",
      expectedPhone: "+12135550141",
    });

    expect(resolved.customerId).toBe("cust_sl_001_mei");
    expect(resolved.customerName).toBe("Mei Lin");
    expect(resolved.phone).toBe("+12135550141");
    expect(resolved.territoryName).toBe("Silver Lake");
    expect(resolved.consentStatus).toBe("existing_customer_relationship");
  });

  it("rejects caller attempt to associate a different phone number with an eligible customer ID", async () => {
    await expect(
      resolveCanonicalCustomerContact({
        tenantId: "tenant_test",
        canonicalOperatorId: "op_test",
        customerId: "cust_sl_001_mei",
        territoryId: "silver-lake",
        expectedPhone: "+15559998888", // Attacker-provided phone
      })
    ).rejects.toThrow("Security violation: requested phone");
  });

  it("rejects territory mismatch when requesting customers outside their objective area", async () => {
    await expect(
      resolveCanonicalCustomerContact({
        tenantId: "tenant_test",
        canonicalOperatorId: "op_test",
        customerId: "cust_sl_001_mei",
        territoryId: "downtown-la", // Mismatch with Silver Lake dossier
      })
    ).rejects.toThrow("Territory mismatch");
  });

  it("commits outreach to personal scheduled outbox and returns awaiting_sender_setup in Phase 1", async () => {
    const result = await sendCozyOutreachNow({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      expectedPhone: "+12135550141",
      messageBody: "Hey Mei, checking in from Laundry Farm!",
      slotId: "slot_01",
      territoryId: "silver-lake",
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("awaiting_sender_setup");
    expect(result.messageId).toBeDefined();
    expect(result.evidenceName).toBe("awaiting_sender_setup");
    expect(result.dispatchedAt).toBeNull();
  });

  it("does not dispatch through a sender adapter on the personal handoff", async () => {
    const fakeAdapter = {
      send: vi.fn().mockResolvedValue({
        externalMessageId: "android_msg_verified_123",
        evidenceName: "personal_android_dispatched",
      }),
    };

    const result = await sendCozyOutreachNow({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      expectedPhone: "+12135550141",
      messageBody: "Hey Mei, checking in from Laundry Farm! Reply STOP if you don't want these texts.",
      slotId: "slot_01",
      territoryId: "silver-lake",
      testSenderAdapter: fakeAdapter,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe("awaiting_sender_setup");
    expect(result.externalMessageId).toBeNull();
    expect(result.dispatchedAt).toBeNull();
    expect(result.carrierDeliveryObserved).toBe(false);
    expect(fakeAdapter.send).not.toHaveBeenCalled();
  });

  it("does not write a draft when the personal handoff is refused", async () => {
    vi.mocked(assertPersonalOutreachHandoff).mockRejectedValueOnce(
      new Error("A recorded opt-out blocks this handoff. An opt-out is never bypassed.")
    );
    await expect(
      sendCozyOutreachNow({
        tenantId: "tenant_refused",
        operatorId: "op_test",
        customerId: "phone:3105550199",
        messageBody: "Hey Rex. Reply STOP if you don't want these texts.",
        territoryId: "silver-lake",
      })
    ).rejects.toThrow(/never bypassed/);
    expect(await listScheduledOutreachMessages({ tenantId: "tenant_refused" })).toEqual([]);
  });

  it("rejects empty message body", async () => {
    await expect(
      sendCozyOutreachNow({
        tenantId: "tenant_test",
        operatorId: "op_test",
        customerId: "cust_sl_001_mei",
        messageBody: "   ",
        slotId: "slot_01",
        territoryId: "silver-lake",
      })
    ).rejects.toThrow("Message body cannot be empty");
  });

  it("reflects existing scheduled outbox messages in getCozyEncounterMission", async () => {
    // Immediate outreach in Phase 1 (no sender adapter) reflects as awaiting_sender_setup
    await sendCozyOutreachNow({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      messageBody: "Pending outbox message",
      slotId: "slot_01",
      territoryId: "silver-lake",
    });

    const mission = await getCozyEncounterMission({
      tenantId: "tenant_test",
      canonicalOperatorId: "op_test",
      territoryId: "silver-lake",
    });

    const mei = mission.targets.find((t) => t.customerId === "cust_sl_001_mei");
    expect(mei?.status).toBe("awaiting_sender_setup");
    expect(mei?.scheduledDraft).toBeDefined();
    expect(mei?.scheduledDraft?.currentMessageBody).toBe("Pending outbox message");
  });
});
