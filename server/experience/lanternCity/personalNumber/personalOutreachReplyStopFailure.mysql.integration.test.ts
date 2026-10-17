import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// Simulate a consent store that does not confirm the opt-out.
vi.mock("../../../messaging/businessLineInbox", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../messaging/businessLineInbox")>()),
  enforceSmsOptOut: async () => false,
}));

const { recordPersonalOutreachReply } = await import("./personalOutreachReplyService");

const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("personal-number STOP when the opt-out cannot be verified", () => {
  it("fails loudly instead of acknowledging the STOP", async () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    await expect(
      recordPersonalOutreachReply({
        tenantId: `por-fail-${suffix}`,
        operatorId: `op-${suffix}`,
        customerId: `cust_${suffix}`,
        customerName: "Sam Ortiz",
        replyText: "STOP",
        now: new Date("2026-10-17T19:00:00.000Z"),
      })
    ).rejects.toThrow("opt-out could not be verified");
  });
});
