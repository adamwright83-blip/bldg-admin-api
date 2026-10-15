import { describe, it, expect, beforeEach } from "vitest";
import {
  getCozyEncounterMission,
  sendCozyOutreachSms,
  resetSessionOutreachReceipts,
} from "./cozyVillagerOutreachService";
import { createFakeOutboundSendAdapter } from "../../spiritHumanRescue/outboundSendAdapter";

describe("cozyVillagerOutreachService", () => {
  beforeEach(() => {
    resetSessionOutreachReceipts();
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
    const slots = mission.targets.map(t => t.slotId);
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

  it("executes an authorized outreach SMS and returns a durable provider receipt", async () => {
    const fakeAdapter = createFakeOutboundSendAdapter({ mode: "accept" });

    const result = await sendCozyOutreachSms({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      recipientPhone: "+12135550141",
      messageBody: "Hey Mei, checking in from Laundry Farm!",
      idempotencyKey: "11111111-1111-4111-a111-111111111111",
      slotId: "slot_01",
      customAdapter: fakeAdapter,
    });

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toContain("SM_fake_");
    expect(result.evidenceName).toBe("provider_accepted");
    expect(fakeAdapter.attempts.length).toBe(1);
    expect(fakeAdapter.attempts[0].to).toBe("+12135550141");
    expect(fakeAdapter.attempts[0].body).toBe("Hey Mei, checking in from Laundry Farm!");
  });

  it("enforces idempotency on duplicate clicks/dispatches", async () => {
    const fakeAdapter = createFakeOutboundSendAdapter({ mode: "accept" });

    const first = await sendCozyOutreachSms({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      recipientPhone: "+12135550141",
      messageBody: "First attempt",
      idempotencyKey: "11111111-1111-4111-a111-111111111111",
      slotId: "slot_01",
      customAdapter: fakeAdapter,
    });

    const second = await sendCozyOutreachSms({
      tenantId: "tenant_test",
      operatorId: "op_test",
      customerId: "cust_sl_001_mei",
      recipientPhone: "+12135550141",
      messageBody: "Duplicate attempt",
      idempotencyKey: "11111111-1111-4111-a111-111111111111",
      slotId: "slot_01",
      customAdapter: fakeAdapter,
    });

    expect(first.providerMessageId).toBe(second.providerMessageId);
    // Adapter send should only have been called once!
    expect(fakeAdapter.attempts.length).toBe(1);
  });

  it("blocks dispatch to opted-out recipients", async () => {
    await expect(
      sendCozyOutreachSms({
        tenantId: "tenant_test",
        operatorId: "op_test",
        customerId: "cust_opted_out",
        recipientPhone: "+15550009999", // Known opt-out
        messageBody: "Should fail",
        idempotencyKey: "22222222-2222-4222-a222-222222222222",
        slotId: "slot_01",
      })
    ).rejects.toThrow("Recipient has opted out of SMS outreach");
  });

  it("rejects empty message body", async () => {
    await expect(
      sendCozyOutreachSms({
        tenantId: "tenant_test",
        operatorId: "op_test",
        customerId: "cust_sl_001_mei",
        recipientPhone: "+12135550141",
        messageBody: "   ",
        idempotencyKey: "33333333-3333-4333-a333-333333333333",
        slotId: "slot_01",
      })
    ).rejects.toThrow("Message body cannot be empty");
  });
});
