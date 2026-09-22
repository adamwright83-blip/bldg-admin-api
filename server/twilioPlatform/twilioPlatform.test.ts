import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import {
  BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS,
  COMMUNICATION_RECEIPT_TABLE,
  communicationReceiptEventFromProviderStatus,
  providerSidIsGoldlineEntityId,
} from "@shared/twilioPlatform";
import {
  TwilioCapabilityUnavailableError,
  assertTwilioCapability,
  evaluateTwilioCapabilities,
  evaluateTwilioCapability,
  logTwilioCapabilitySummary,
  noteTwilioCapabilityFailure,
  resetTwilioCapabilityFailuresForTests,
} from "./capabilities";
import { TwilioPlatformConfigError, getTwilioPlatformClient, resetTwilioPlatformClientForTests } from "./client";
import { logContainsTwilioSecret, readTwilioPlatformConfig } from "./config";
import {
  communicationEvidenceImpliesBusinessOutcome,
  communicationsEvidenceContainsBusinessOutcome,
  toCommunicationCandidateEvidence,
} from "./communicationEvidence";
import { isValidTwilioWebhook } from "../claire/conversation/twilioSignature";
import {
  TwilioCommunicationReceiptError,
  buildTwilioCommunicationReceipt,
  communicationReceiptFromRow,
  createMemoryCommunicationReceiptStore,
  persistCommunicationReceipt,
  recordCommunicationReceipt,
} from "./communicationReceipts";

const AUTH_TOKEN = "auth_test_secret_value";
const VOICE_ENV = {
  TWILIO_ACCOUNT_SID: "AC_test",
  TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  CLAIRE_TWILIO_FROM_NUMBER: "+13105550100",
  CLAIRE_OPERATOR_PHONE: "+13105550101",
} as NodeJS.ProcessEnv;

afterEach(() => {
  resetTwilioCapabilityFailuresForTests();
  resetTwilioPlatformClientForTests();
});

describe("Twilio capability registry", () => {
  it("keeps conversation relay disabled and proxy unconfigured until they are actually set", () => {
    expect(evaluateTwilioCapability("conversationRelay", {})).toEqual({
      id: "conversationRelay",
      state: "DISABLED",
      reason: "feature_flag_off",
    });
    expect(evaluateTwilioCapability("proxy", VOICE_ENV)).toEqual({
      id: "proxy",
      state: "UNCONFIGURED",
      reason: "missing_service_sid",
    });
  });

  it("treats the existing Claire Gather env as live and does not mark unprovisioned products live", () => {
    const records = evaluateTwilioCapabilities(VOICE_ENV);
    expect(records.find(item => item.id === "voiceGather")).toEqual({
      id: "voiceGather",
      state: "LIVE",
      reason: null,
    });
    expect(records.filter(item => item.state === "LIVE").map(item => item.id)).toEqual(["voiceGather"]);
    expect(evaluateTwilioCapability("sms", VOICE_ENV).state).toBe("UNCONFIGURED");
  });

  it("marks SMS live only when the existing SMS sender env is present", () => {
    expect(
      evaluateTwilioCapability("sms", { ...VOICE_ENV, TWILIO_FROM_NUMBER: "+13105550102" }).state
    ).toBe("LIVE");
  });

  it("configures a proxy SID without calling it live", () => {
    const record = evaluateTwilioCapability("proxy", {
      ...VOICE_ENV,
      TWILIO_PROXY_SERVICE_SID: "KS_present",
    });
    expect(record).toEqual({ id: "proxy", state: "CONFIGURED", reason: null });
  });

  it("does not promote conversation relay to live when the flag is on", () => {
    const record = evaluateTwilioCapability("conversationRelay", {
      ...VOICE_ENV,
      CLAIRE_TWILIO_CONVERSATION_RELAY: "true",
    });
    expect(record.state).toBe("CONFIGURED");
    expect(record.state).not.toBe("LIVE");
  });

  it("fails an unconfigured capability explicitly", () => {
    expect(() => assertTwilioCapability("proxy", {})).toThrow(TwilioCapabilityUnavailableError);
    try {
      assertTwilioCapability("proxy", {});
    } catch (error) {
      expect(error).toBeInstanceOf(TwilioCapabilityUnavailableError);
      expect((error as TwilioCapabilityUnavailableError).state).toBe("UNCONFIGURED");
      expect((error as TwilioCapabilityUnavailableError).reason).toBe("missing_service_sid");
    }
  });

  it("fails a feature-disabled capability explicitly", () => {
    try {
      assertTwilioCapability("conversationRelay", VOICE_ENV);
      throw new Error("expected capability failure");
    } catch (error) {
      expect(error).toBeInstanceOf(TwilioCapabilityUnavailableError);
      expect((error as TwilioCapabilityUnavailableError).state).toBe("DISABLED");
      expect((error as TwilioCapabilityUnavailableError).reason).toBe("feature_flag_off");
    }
  });

  it("records a configured capability as failing without turning it off silently", () => {
    noteTwilioCapabilityFailure("voiceGather");
    const record = evaluateTwilioCapability("voiceGather", VOICE_ENV);
    expect(record.state).toBe("CONFIGURED_FAILING");
    expect(() => assertTwilioCapability("voiceGather", VOICE_ENV)).toThrow(/CONFIGURED_FAILING/);
  });
});

describe("Twilio platform client and config", () => {
  it("does not put the auth token on the public config or in the capability log", () => {
    const config = readTwilioPlatformConfig(VOICE_ENV);
    expect(JSON.stringify(config)).not.toContain(AUTH_TOKEN);
    expect(config.authTokenPresent).toBe(true);
    expect(config.claireFromNumber).toBe("+13105550100");

    const lines: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(item => String(item)).join(" "));
    });
    logTwilioCapabilitySummary(VOICE_ENV);
    spy.mockRestore();
    const logged = lines.join("\n");
    expect(logContainsTwilioSecret(logged, VOICE_ENV)).toBe(false);
    expect(logged).not.toContain(AUTH_TOKEN);
    expect(logged).not.toContain("+13105550100");
    expect(logged).not.toContain("+13105550101");
    expect(logged).toContain("***0100");
  });

  it("fails explicitly when credentials are missing and does not echo a token", () => {
    expect(() => getTwilioPlatformClient({ TWILIO_AUTH_TOKEN: AUTH_TOKEN })).toThrow(TwilioPlatformConfigError);
    try {
      getTwilioPlatformClient({ TWILIO_AUTH_TOKEN: AUTH_TOKEN });
    } catch (error) {
      expect(String(error)).not.toContain(AUTH_TOKEN);
      expect((error as TwilioPlatformConfigError).code).toBe("missing_account_sid");
    }
  });

  it("reuses one REST client for the same credentials", () => {
    const first = getTwilioPlatformClient(VOICE_ENV);
    const second = getTwilioPlatformClient(VOICE_ENV);
    expect(second).toBe(first);
  });
});

describe("communication receipts", () => {
  it("collapses Twilio retries of the same provider event and the same call class", async () => {
    const store = createMemoryCommunicationReceiptStore();
    const first = await recordCommunicationReceipt(
      {
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
        providerEventId: "EV_retry",
        eventType: "CALL_CONNECTED",
        callSid: "CA_connected",
        direction: "outbound",
        from: "+13105550100",
        to: "+13105550101",
        durationSeconds: 224,
        createdAt: "2026-09-22T00:00:00.000Z",
      },
      { store }
    );
    const retry = await recordCommunicationReceipt(
      {
        tenantId: "tenant-1",
        providerEventId: "EV_retry",
        eventType: "CALL_CONNECTED",
        callSid: "CA_connected",
        durationSeconds: 224,
        createdAt: "2026-09-22T00:00:05.000Z",
      },
      { store }
    );
    expect(retry.duplicate).toBe(true);
    expect(retry.receipt.id).toBe(first.receipt.id);

    const byClass = await recordCommunicationReceipt(
      {
        tenantId: "tenant-1",
        eventType: "CALL_NO_ANSWER",
        callSid: "CA_other",
      },
      { store }
    );
    const classRetry = await recordCommunicationReceipt(
      {
        tenantId: "tenant-1",
        eventType: "CALL_NO_ANSWER",
        callSid: "CA_other",
      },
      { store }
    );
    expect(classRetry.duplicate).toBe(true);
    expect(classRetry.receipt.id).toBe(byClass.receipt.id);

    const otherClass = await recordCommunicationReceipt(
      {
        tenantId: "tenant-1",
        eventType: "CALL_COMPLETED",
        callSid: "CA_other",
      },
      { store }
    );
    expect(otherClass.duplicate).toBe(false);
  });

  it("keeps a stable hashed key when the provider identity does not fit the column", async () => {
    const store = createMemoryCommunicationReceiptStore();
    const input = {
      tenantId: "t".repeat(64),
      providerEventId: "E".repeat(191),
      eventType: "MESSAGE_SENT" as const,
      messageSid: "SM_long",
    };
    const first = await recordCommunicationReceipt(input, { store });
    const second = await recordCommunicationReceipt(input, { store });
    expect(first.receipt.idempotencyKey.startsWith("twilio:hash:")).toBe(true);
    expect(first.receipt.idempotencyKey.length).toBeLessThanOrEqual(191);
    expect(second.duplicate).toBe(true);
    expect(second.receipt.id).toBe(first.receipt.id);
  });

  it("rejects business outcome names and scrubs an auth token from a provider error", () => {
    expect(() =>
      buildTwilioCommunicationReceipt({
        tenantId: "tenant-1",
        eventType: "CUSTOMER_INTERESTED" as "CALL_FAILED",
        callSid: "CA1",
      })
    ).toThrow(TwilioCommunicationReceiptError);

    const receipt = buildTwilioCommunicationReceipt(
      {
        tenantId: "tenant-1",
        eventType: "CALL_FAILED",
        callSid: "CA_fail",
        providerErrorMessage: `carrier rejected ${AUTH_TOKEN}`,
      },
      VOICE_ENV
    );
    expect(receipt.providerErrorMessage).toContain("[redacted]");
    expect(receipt.providerErrorMessage).not.toContain(AUTH_TOKEN);
  });

  it("returns the original row when the database reports a duplicate", async () => {
    const stored: Array<Record<string, unknown>> = [];
    const db = {
      insert: () => ({
        values: async (row: Record<string, unknown>) => {
          if (stored.length > 0) {
            const error = new Error("Duplicate entry 'twilio:event' for key");
            Object.assign(error, { code: "ER_DUP_ENTRY", errno: 1062 });
            throw error;
          }
          stored.push(row);
        },
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => stored,
          }),
        }),
      }),
    };
    const receipt = buildTwilioCommunicationReceipt({
      tenantId: "tenant-1",
      providerEventId: "EV_db",
      eventType: "CALL_RINGING",
      callSid: "CA_db",
      from: "+13105550100",
      to: "+13105550101",
      createdAt: "2026-09-22T01:00:00.000Z",
    });
    const inserted = await persistCommunicationReceipt(db, receipt);
    const duplicate = await persistCommunicationReceipt(db, {
      ...receipt,
      id: "different-id",
    });
    expect(inserted.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.receipt.id).toBe(receipt.id);
    expect(duplicate.receipt.from).toBe("+13105550100");
    expect(communicationReceiptFromRow(stored[0] as never).callSid).toBe("CA_db");
  });

  it("defines one communications receipt table and no Twilio product tables", () => {
    const sql = readFileSync("drizzle/0094_communication_receipts.sql", "utf8");
    const migrate = readFileSync("scripts/migrate.mjs", "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS `communication_receipts`");
    expect(sql).toContain("uq_communication_receipts_idempotency");
    expect(sql).toContain("uq_communication_receipts_provider_event");
    expect(sql).not.toMatch(/create table[^;]*twilio_/i);
    expect(migrate).toContain("CREATE TABLE IF NOT EXISTS communication_receipts");
    expect(COMMUNICATION_RECEIPT_TABLE).toBe("communication_receipts");
    expect(sql.match(/CREATE TABLE/gi)).toHaveLength(1);
  });
});

describe("communications evidence", () => {
  it("does not turn a 224 second connected call into a business outcome", () => {
    const receipt = buildTwilioCommunicationReceipt({
      tenantId: "tenant-1",
      operatorUserId: "adam-admin",
      providerEventId: "EV224",
      eventType: "CALL_CONNECTED",
      callSid: "CA224",
      parentCallSid: "CA_parent",
      direction: "outbound",
      from: "+13105550100",
      to: "+13105550199",
      status: "in-progress",
      startedAt: "2026-09-22T02:00:00.000Z",
      answeredAt: "2026-09-22T02:00:08.000Z",
      durationSeconds: 224,
      createdAt: "2026-09-22T02:00:08.000Z",
    });
    const evidence = toCommunicationCandidateEvidence(receipt);
    expect(evidence.map(item => item.concept)).toEqual(["CALL_CONNECTED", "CALL_DURATION_OBSERVED"]);
    expect(evidence[1]?.durationSeconds).toBe(224);
    for (const item of evidence) {
      expect(communicationEvidenceImpliesBusinessOutcome(item)).toBe(false);
      expect(item.kind).toBe("communications_evidence");
      expect(item.goldlineEntityId).toBeNull();
      expect(providerSidIsGoldlineEntityId(item.callSid)).toBe(false);
    }
    expect(communicationsEvidenceContainsBusinessOutcome(evidence)).toBeNull();
    const serialized = JSON.stringify(evidence);
    for (const outcome of BUSINESS_OUTCOMES_NOT_IMPLIED_BY_COMMUNICATIONS) {
      expect(serialized).not.toContain(outcome);
    }
    expect(serialized).not.toMatch(/WeeklyIntent|Daily Command|Narrator|missionId|saleId|orderId/i);
    expect(evidence[0]?.callSid).toBe("CA224");
  });

  it("maps provider statuses into the receipt vocabulary and leaves failed messages as receipts only", () => {
    expect(
      communicationReceiptEventFromProviderStatus({ channel: "voice", status: "in-progress" })
    ).toBe("CALL_CONNECTED");
    expect(
      communicationReceiptEventFromProviderStatus({
        channel: "voice",
        status: "completed",
        answeredBy: "machine_end_beep",
      })
    ).toBe("VOICEMAIL_DETECTED");
    expect(
      communicationReceiptEventFromProviderStatus({ channel: "message", status: "delivered" })
    ).toBe("MESSAGE_DELIVERED");
    const failed = buildTwilioCommunicationReceipt({
      tenantId: "tenant-1",
      eventType: "MESSAGE_FAILED",
      messageSid: "SM_fail",
    });
    expect(toCommunicationCandidateEvidence(failed)).toEqual([]);
  });
});

describe("this slice does not add an autonomous Claire dialer", () => {
  it("does not place calls, send messages, or schedule retries", () => {
    const directory = "server/twilioPlatform";
    const source = readdirSync(directory)
      .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map(name => readFileSync(join(directory, name), "utf8"))
      .join("\n");
    expect(source).not.toMatch(/calls\.create/);
    expect(source).not.toMatch(/messages\.create/);
    expect(source).not.toMatch(/setInterval/);
    expect(source).not.toMatch(/setTimeout/);
    expect(source).not.toMatch(/\bwhile\s*\(/);
    expect(source).not.toMatch(/redial|auto-?dial|repeat(?:ed)? dial/i);
  });
});

describe("webhook validation stays on the existing Claire host", () => {
  it("rejects an invalid Twilio signature and accepts a valid one", () => {
    const url = "https://api.example.test/api/claire/twilio/inbound";
    const body = { CallSid: "CA_inbound", From: "+13105550101", To: "+13105550100" };
    expect(
      isValidTwilioWebhook({
        authToken: AUTH_TOKEN,
        signature: "not-a-real-signature",
        urls: [url],
        body,
        nodeEnv: "production",
      })
    ).toBe(false);
    expect(
      isValidTwilioWebhook({
        authToken: AUTH_TOKEN,
        signature: twilio.getExpectedTwilioSignature(AUTH_TOKEN, url, body),
        urls: [url],
        body,
        nodeEnv: "production",
      })
    ).toBe(true);
  });

  it("does not replace signature verification or the inbound webhook path", () => {
    const voice = readFileSync("server/claire/claireTwilio.ts", "utf8");
    const signature = readFileSync("server/claire/conversation/twilioSignature.ts", "utf8");
    expect(voice).toContain('export const CLAIRE_INBOUND_VOICE_PATH = "/api/claire/twilio/inbound"');
    expect(voice).toContain("isValidTwilioWebhook");
    expect(voice).not.toContain("twilioPlatform");
    expect(signature).toContain("twilio.validateRequest");
    const platform = readdirSync("server/twilioPlatform")
      .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map(name => readFileSync(join("server/twilioPlatform", name), "utf8"))
      .join("\n");
    expect(platform).not.toContain("validateRequest");
    expect(platform).not.toContain("/api/claire/twilio/inbound");
  });
});
