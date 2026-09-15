import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
});

vi.mock("../_core/env", () => ({ ENV: { adminBaseUrl: "https://api.example.test" } }));
vi.mock("twilio", async importOriginal => {
  const actual = (await importOriginal()) as { default?: Record<string, unknown> } & Record<string, unknown>;
  const real = (actual.default ?? actual) as Record<string, unknown>;
  const factory = Object.assign(() => ({ calls: { create: vi.fn() } }), real, { twiml: real.twiml });
  return { ...actual, default: factory };
});

import { operatorPhoneFor, preDriveConversationTwiML } from "./claireTwilio";

afterEach(() => {
  delete process.env.CLAIRE_OPERATOR_PHONES;
});

describe("Claire dials the authenticated operator's own phone", () => {
  it("uses the single configured operator phone when no per-operator map exists", () => {
    expect(operatorPhoneFor("adam-admin")).toBe("+13105550001");
  });

  it("with a per-operator map, never dials another operator's number", () => {
    process.env.CLAIRE_OPERATOR_PHONES = JSON.stringify({ "adam-admin": "(310) 555-0199" });
    expect(operatorPhoneFor("adam-admin")).toBe("+13105550199");
    expect(() => operatorPhoneFor("driver-2")).toThrow("No Claire phone number is configured for this operator");
  });

  it("rejects a malformed map instead of guessing", () => {
    process.env.CLAIRE_OPERATOR_PHONES = "adam=3105550199";
    expect(() => operatorPhoneFor("adam-admin")).toThrow("CLAIRE_OPERATOR_PHONES must be a JSON object");
  });
});

describe("Claire's ears for a spoken briefing", () => {
  it("allows a full minute of speech, waits through list pauses, and hints business names", () => {
    const xml = preDriveConversationTwiML({ text: "Go ahead.", token: "t", hints: "KITH TREATS, OPUS LA, Century Park East" });
    expect(xml).toContain('maxSpeechTime="60"');
    expect(xml).toContain('speechTimeout="3"');
    expect(xml).toContain('hints="KITH TREATS, OPUS LA, Century Park East"');
  });

  it("listens silently when Adam paused mid-thought", () => {
    const xml = preDriveConversationTwiML({ text: "", token: "t", listenOnly: true });
    expect(xml).toContain("<Gather");
    expect(xml).not.toContain("<Say");
  });
});
