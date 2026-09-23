import { describe, expect, it } from "vitest";
import {
  createFatalCorrelationId,
  customerFatalNotice,
  fatalLogRecordFromError,
  isFatalCorrelationId,
  sanitizeFatalText,
} from "./clientFatal";

const ID = "6f1e2d3c-4b5a-4698-8abc-def012345678";

describe("sanitizeFatalText", () => {
  it("removes phones, emails, tokens, and labeled message bodies", () => {
    const raw = [
      "send failed for +1 (310) 555-0199",
      "ada@example.com",
      "Bearer super-secret-token",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue",
      "https://app.example/cb?token=abc123&phone=3105550199",
      'smsBody: "pick up the blue shirts tomorrow"',
      "sk_live_51HabcSecretKey",
    ].join(" ");
    const cleaned = sanitizeFatalText(raw, 800);
    expect(cleaned).not.toContain("555-0199");
    expect(cleaned).not.toContain("3105550199");
    expect(cleaned).not.toContain("ada@example.com");
    expect(cleaned).not.toContain("super-secret-token");
    expect(cleaned).not.toContain("eyJhbGci");
    expect(cleaned).not.toContain("abc123");
    expect(cleaned).not.toContain("blue shirts");
    expect(cleaned).not.toContain("sk_live_");
    expect(cleaned).toContain("[redacted]");
  });

  it("keeps a short diagnostic that has no secrets", () => {
    expect(sanitizeFatalText("Cannot read properties of undefined", 80)).toBe(
      "Cannot read properties of undefined"
    );
    expect(sanitizeFatalText("somebody: hello", 80)).toBe("somebody: hello");
  });

  it("redacts unquoted bodies, wrapped bodies, and basic auth on every call", () => {
    const once = sanitizeFatalText(
      "smsBody: pick up the blue shirts\nauthorization: Basic dXNlcjpwYXNz\ncookie: session=abc123",
      800
    );
    const twice = sanitizeFatalText("call 555-0199 then smsBody:\npick up the blue shirts", 800);
    expect(once).not.toContain("blue shirts");
    expect(once).not.toContain("dXNlcjpwYXNz");
    expect(once).not.toContain("abc123");
    expect(twice).not.toContain("555-0199");
    expect(twice).not.toContain("blue shirts");
    expect(twice).toContain("[redacted]");
  });
});

describe("customerFatalNotice", () => {
  it("shows a concise recovery notice and hides technical detail", () => {
    const notice = customerFatalNotice(ID);
    expect(notice).toEqual({
      headline: "Something went wrong.",
      recovery: "Reload to try again.",
      correlationId: ID,
    });
    expect(JSON.stringify(notice)).not.toMatch(/stack|\/Users\/|secret/i);
  });

  it("omits a correlation id that is not a uuid", () => {
    expect(customerFatalNotice("not-an-id").correlationId).toBeNull();
    expect(customerFatalNotice(null).correlationId).toBeNull();
  });
});

describe("createFatalCorrelationId", () => {
  it("returns a different id each time, including when randomUUID is unavailable", () => {
    const first = createFatalCorrelationId();
    const second = createFatalCorrelationId();
    expect(isFatalCorrelationId(first)).toBe(true);
    expect(isFatalCorrelationId(second)).toBe(true);
    expect(first).not.toBe(second);

    const original = crypto.randomUUID;
    crypto.randomUUID = () => {
      throw new Error("insecure context");
    };
    try {
      const fallbackA = createFatalCorrelationId();
      const fallbackB = createFatalCorrelationId();
      expect(isFatalCorrelationId(fallbackA)).toBe(true);
      expect(isFatalCorrelationId(fallbackB)).toBe(true);
      expect(fallbackA).not.toBe(fallbackB);
      expect(fallbackA).not.toBe("00000000-0000-4000-8000-000000000000");
    } finally {
      crypto.randomUUID = original;
    }
  });
});

describe("fatalLogRecordFromError", () => {
  it("logs a sanitized record and drops raw contact data", () => {
    const error = new Error(
      "SMS to +13105550199 failed for ada@example.com Bearer tok_live_secret smsBody: pick up the blue shirts"
    );
    error.stack = `${error.message}\n    at send (/srv/app/server/sms.ts:10:4)`;
    const record = fatalLogRecordFromError(error, ID);
    const serialized = JSON.stringify(record);
    expect(record?.correlationId).toBe(ID);
    expect(record?.name).toBe("Error");
    expect(serialized).not.toContain("3105550199");
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("tok_live_secret");
    expect(serialized).not.toContain("blue shirts");
  });

  it("does not copy a thrown non-error into the log", () => {
    const record = fatalLogRecordFromError("call +13105550199 ada@example.com", ID);
    expect(record?.message).toBe("Unknown failure");
    expect(JSON.stringify(record)).not.toContain("3105550199");
    expect(JSON.stringify(record)).not.toContain("ada@example.com");
  });

  it("refuses a non-uuid correlation id", () => {
    expect(fatalLogRecordFromError(new Error("boom"), "nope")).toBeNull();
    expect(fatalLogRecordFromError(new Error("boom"), "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
