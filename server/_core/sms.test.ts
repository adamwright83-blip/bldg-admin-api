import { describe, expect, it } from "vitest";
import { classifyTwilioSendFailure } from "./sms";

describe("Twilio send failure classification", () => {
  it("treats authoritative 4xx refusals as provider_rejected", () => {
    expect(classifyTwilioSendFailure({ status: 400 })).toBe("provider_rejected");
    expect(classifyTwilioSendFailure({ status: 403, code: 21211 })).toBe("provider_rejected");
    expect(classifyTwilioSendFailure({ statusCode: 422 })).toBe("provider_rejected");
  });

  it("treats transport, timeout, 5xx, and rate-limit ambiguity as unknown", () => {
    expect(classifyTwilioSendFailure({ code: "ETIMEDOUT" })).toBe("send_outcome_unknown");
    expect(classifyTwilioSendFailure({ code: "ECONNRESET" })).toBe("send_outcome_unknown");
    expect(classifyTwilioSendFailure({ status: 500 })).toBe("send_outcome_unknown");
    expect(classifyTwilioSendFailure({ status: 429 })).toBe("send_outcome_unknown");
    expect(classifyTwilioSendFailure({ status: 408 })).toBe("send_outcome_unknown");
    expect(classifyTwilioSendFailure(new Error("socket hang up"))).toBe("send_outcome_unknown");
  });
});

describe("STOP gate on every outbound SMS", () => {
  it("never sends to a recipient who texted STOP, and says so", async () => {
    const { sendSMSWithReceipt, setSmsOptOutCheckForTests } = await import("./sms");
    const seen: Array<{ from: string; to: string }> = [];
    setSmsOptOutCheckForTests(async input => {
      seen.push(input);
      return "opted_out";
    });
    try {
      expect(await sendSMSWithReceipt("(323) 555-0101", "Your laundry is ready")).toEqual({
        accepted: false,
        providerMessageId: null,
        providerStatus: null,
        evidenceName: "recipient_opted_out",
      });
      expect(seen[0]?.to).toBe("(323) 555-0101");
    } finally {
      setSmsOptOutCheckForTests(null);
    }
  });

  it("refuses to send when the opt-out record cannot be read", async () => {
    const { sendSMSWithReceipt, setSmsOptOutCheckForTests } = await import("./sms");
    for (const check of [async () => "unavailable" as const, async () => { throw new Error("db down"); }]) {
      setSmsOptOutCheckForTests(check);
      try {
        expect((await sendSMSWithReceipt("3235550101", "hi")).evidenceName).toBe("opt_out_check_unavailable");
      } finally {
        setSmsOptOutCheckForTests(null);
      }
    }
  });

  it("a clear recipient continues to the provider", async () => {
    const { sendSMSWithReceipt, setSmsOptOutCheckForTests } = await import("./sms");
    setSmsOptOutCheckForTests(async () => "clear");
    try {
      // No Twilio credentials in unit tests, so the provider step reports unconfigured.
      expect((await sendSMSWithReceipt("3235550101", "hi")).evidenceName).toBe("provider_unconfigured");
    } finally {
      setSmsOptOutCheckForTests(null);
    }
  });
});
