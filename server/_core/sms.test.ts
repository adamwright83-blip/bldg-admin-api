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
