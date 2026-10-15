import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { ANDROID_DEVICE_SENDER } from "./androidDeviceSender";
import {
  SMS_COMPOSE_APPROVAL_CONFIRMATION,
  SMS_COMPOSE_COPY_FALLBACK_LABEL,
  SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
  SMS_COMPOSE_USES_ANDROID_INTENT,
  approvedBodyDigest,
  buildSameOriginPhoneContinuation,
  buildSmsComposeUri,
  clientKindFromUserAgent,
  composeHandoffLeavesOutboxUndispatched,
  handoffCoversRevision,
  poseForIndependentReadback,
  poseForProjectedHandoff,
  projectHandoffForRevision,
  refuseVerifiedPromotion,
  type SmsComposeHandoffEvent,
} from "./smsComposeHandoff";
import {
  _resetSmsComposeHandoffAudit,
  openApprovedSmsCompose,
  reportSmsComposeOperatorSent,
  smsComposeHandoffEventsForOperator,
  smsComposeHandoffSnapshot,
} from "./smsComposeHandoffAudit";

const tenantId = "tenant_compose";
const operatorId = "operator_compose";
const messageId = "msg_compose_1";
const phone = "(213) 555-0199";
const body = "Hello Ada & friends?\nSee you at 100% #tag +plus";

beforeEach(() => {
  _resetSmsComposeHandoffAudit();
});

function openInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    operatorId,
    messageId,
    revisionCount: 1,
    approvedBody: body,
    recipientPhone: phone,
    confirmation: SMS_COMPOSE_APPROVAL_CONFIRMATION,
    clientKind: "ios" as const,
    surface: "cozy_composer" as const,
    pageUrl: "https://joystick.example/claire/outreach",
    origin: "https://joystick.example",
    ...overrides,
  };
}

describe("sms compose URI", () => {
  it("encodes the approved body on the sms: query used by the manual composer", () => {
    const result = buildSmsComposeUri({
      recipientPhone: phone,
      body,
      clientKind: "ios",
    });
    expect(result.kind).toBe("prefilled");
    expect(result.bodyPrefillClaimed).toBe(true);
    expect(result.prefillClaim).toBe("sms_uri_query");
    expect(result.uri).toBe(`sms:+12135550199?body=${encodeURIComponent(body)}`);
    expect(new URL(result.uri!).searchParams.get("body")).toBe(body);
    expect(result.actionSendto).toBe(false);
    expect(result.fallbackUri).toBe("sms:+12135550199");
  });

  it("uses a number-only URI and does not claim a prefill when the body is missing", () => {
    const result = buildSmsComposeUri({
      recipientPhone: "+1 213-555-0199",
      body: "   ",
      clientKind: "ios",
    });
    expect(result.kind).toBe("missing_body");
    expect(result.uri).toBe("sms:+12135550199");
    expect(result.uri).not.toContain("?");
    expect(result.bodyPrefillClaimed).toBe(false);
    expect(result.prefillClaim).toBe("not_prefilled");
    expect(result.copyBody).toBeNull();
    expect(result.copyLabel).toMatch(/Nothing was prefilled/);
  });

  it("falls back on Android without claiming the body was prefilled", () => {
    const result = buildSmsComposeUri({
      recipientPhone: phone,
      body,
      clientKind: "android",
    });
    expect(result.kind).toBe("copy_fallback");
    expect(result.uri).toBe("sms:+12135550199");
    expect(result.uri).not.toContain("body");
    expect(result.uri).not.toContain(encodeURIComponent(body));
    expect(result.bodyPrefillClaimed).toBe(false);
    expect(result.prefillClaim).toBe("not_prefilled");
    expect(result.copyBody).toBe(body);
    expect(result.copyLabel).toBe(SMS_COMPOSE_COPY_FALLBACK_LABEL);
    expect(result.copyLabel?.toLowerCase()).not.toMatch(/body was prefilled|prefilled the body|message is prefilled/);
    expect(result.actionSendto).toBe(false);
  });

  it("keeps a desktop continuation on the same origin without the recipient or body", () => {
    const result = buildSmsComposeUri({
      recipientPhone: phone,
      body,
      clientKind: "desktop",
      pageUrl: "https://joystick.example/claire/outreach?body=secret&phone=%2B12135550199#thread",
      origin: "https://joystick.example",
    });
    expect(result.uri).toBeNull();
    expect(result.bodyPrefillClaimed).toBe(false);
    expect(result.prefillClaim).toBe("not_prefilled");
    expect(result.continuationHref).toBe("https://joystick.example/claire/outreach");
    expect(result.continuationHref).not.toContain("secret");
    expect(result.continuationHref).not.toContain("2135550199");
    expect(result.continuationHref).not.toContain("body=");
    expect(result.copyBody).toBeNull();
  });

  it("rejects a third-party shortener as the phone continuation", () => {
    expect(() =>
      buildSameOriginPhoneContinuation({
        pageUrl: "https://bit.ly/abc",
        origin: "https://joystick.example",
      })
    ).toThrow(/stays on this site/);
    expect(() =>
      buildSameOriginPhoneContinuation({
        pageUrl: "https://bit.ly/abc?body=secret",
        origin: "https://bit.ly",
      })
    ).toThrow(/shortener/);
  });

  it("does not use an Android intent bridge", () => {
    expect(SMS_COMPOSE_USES_ANDROID_INTENT).toBe(false);
    expect(clientKindFromUserAgent("Mozilla/5.0 (Linux; Android 14)")).toBe("android");
    expect(clientKindFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
    expect(clientKindFromUserAgent("Mozilla/5.0 (Macintosh)")).toBe("desktop");
    const source = readFileSync(new URL("./smsComposeHandoff.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/startActivity/);
    expect(source).not.toMatch(/intent:/);
  });
});

describe("sms compose handoff state", () => {
  it("does not promote compose_opened or an operator report into a verified send", async () => {
    const outbox = {
      status: "awaiting_sender_setup",
      dispatchedAt: null,
      externalMessageId: null,
      dispatchAttemptedAt: null,
    };
    const opened = await openApprovedSmsCompose(openInput({ outbox }));
    expect(opened.state).toBe("compose_opened");
    expect(opened.verifiedSent).toBe(false);
    expect(opened.pose).toBe("idle");
    expect(opened.authorizedToTransmit).toBe(false);
    expect(opened.carrierReceipt).toBe(false);
    expect(opened.androidUnattendedStatus).toBe("BLOCKED");
    expect(ANDROID_DEVICE_SENDER.status).toBe("BLOCKED");
    expect(poseForProjectedHandoff("compose_opened")).toBe("idle");
    expect(poseForProjectedHandoff("operator_reported_sent")).toBe("idle");
    expect(poseForIndependentReadback("compose_opened")).toBe("idle");
    expect(poseForIndependentReadback("operator_reported_sent")).toBe("idle");
    expect(refuseVerifiedPromotion("compose_opened")).toEqual({
      state: "compose_opened",
      promoted: false,
      verifiedSent: false,
    });

    const reported = await reportSmsComposeOperatorSent({
      tenantId,
      operatorId,
      messageId,
      revisionCount: 1,
      approvedBody: body,
      confirmation: SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
      surface: "cozy_composer",
      outbox,
    });
    expect(reported.state).toBe("operator_reported_sent");
    expect(reported.verifiedSent).toBe(false);
    expect(reported.pose).toBe("idle");
    expect(reported.authorizedToTransmit).toBe(false);
    expect(refuseVerifiedPromotion("operator_reported_sent").state).toBe("operator_reported_sent");
    expect(outbox.status).toBe("awaiting_sender_setup");
    expect(outbox.dispatchedAt).toBeNull();
    expect(outbox.externalMessageId).toBeNull();

    const events = await smsComposeHandoffEventsForOperator({ tenantId, operatorId });
    const forged: SmsComposeHandoffEvent = {
      ...events[0]!,
      id: "forged_verified",
      handoffState: "independently_verified_sent" as SmsComposeHandoffEvent["handoffState"],
    };
    const projected = projectHandoffForRevision([...events, forged], {
      messageId,
      revisionCount: 1,
      bodyDigest: approvedBodyDigest(body),
    });
    expect(projected.state).toBe("operator_reported_sent");
    expect(projected.verifiedSent).toBe(false);
    expect(projected.pose).toBe("idle");
  });

  it("treats a changed revision or body as uncovered by the earlier handoff", async () => {
    await openApprovedSmsCompose(openInput());
    const events = await smsComposeHandoffEventsForOperator({ tenantId, operatorId });
    const originalDigest = approvedBodyDigest(body);
    expect(
      handoffCoversRevision(events, { messageId, revisionCount: 1, bodyDigest: originalDigest })
    ).toBe(true);

    const changed = await smsComposeHandoffSnapshot({
      tenantId,
      operatorId,
      items: [
        { messageId, revisionCount: 2, approvedBody: "Hello Ada again" },
        { messageId, revisionCount: 1, approvedBody: "A different approved body" },
        { messageId, revisionCount: 2, approvedBody: body },
      ],
    });
    expect(changed.map((item) => item.covers)).toEqual([false, false, false]);
    expect(changed.map((item) => item.state)).toEqual(["draft", "draft", "draft"]);
    expect(changed.every((item) => item.verifiedSent === false)).toBe(true);
    expect(changed.every((item) => item.pose === "idle")).toBe(true);

    const otherOperator = await smsComposeHandoffSnapshot({
      tenantId,
      operatorId: "someone_else",
      items: [{ messageId, revisionCount: 1, approvedBody: body }],
    });
    expect(otherOperator[0]?.covers).toBe(false);
    expect(otherOperator[0]?.state).toBe("draft");
  });

  it("does not mark the outbox dispatched and does not store the recipient or body", async () => {
    const outbox = {
      status: "pending",
      dispatchedAt: null,
      externalMessageId: null,
      dispatchAttemptedAt: null,
    };
    const result = await openApprovedSmsCompose(
      openInput({ clientKind: "android", surface: "scheduled_outreach", outbox })
    );
    expect(result.kind).toBe("copy_fallback");
    expect(result.bodyPrefillClaimed).toBe(false);
    expect(result.outboxEffect).toEqual({
      dispatchedAt: null,
      externalMessageId: null,
      markedDispatched: false,
      statusWritten: null,
    });
    expect(outbox).toEqual({
      status: "pending",
      dispatchedAt: null,
      externalMessageId: null,
      dispatchAttemptedAt: null,
    });
    const untouched = composeHandoffLeavesOutboxUndispatched(outbox);
    expect(untouched.row.status).toBe("pending");
    expect(untouched.markedDispatched).toBe(false);

    const events = await smsComposeHandoffEventsForOperator({ tenantId, operatorId });
    const packed = JSON.stringify(events);
    expect(packed).not.toContain("2135550199");
    expect(packed).not.toContain("Ada");
    expect(packed).not.toContain("token");
    expect(packed).not.toContain("pairing");
    for (const event of events) {
      expect(event).not.toHaveProperty("recipientPhone");
      expect(event).not.toHaveProperty("approvedBody");
      expect(event.bodyDigest).toBe(approvedBodyDigest(body));
      expect(event.handoffState).not.toBe("independently_verified_sent");
    }

    const source = readFileSync(new URL("./smsComposeHandoffAudit.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/scheduledOutreachMessages/);
    expect(source).not.toMatch(/scheduled_outreach_messages/);
    expect(source).not.toMatch(/twilioOutboundSendAdapter/);
    expect(source).not.toMatch(/sendSMSWithReceipt/);
    expect(source).not.toMatch(/startActivity/);
    expect(source).not.toMatch(/status:\s*"dispatched"/);
  });

  it("refuses a report when no compose handoff covers that revision", async () => {
    await expect(
      reportSmsComposeOperatorSent({
        tenantId,
        operatorId,
        messageId,
        revisionCount: 1,
        approvedBody: body,
        confirmation: SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
        surface: "scheduled_outreach",
      })
    ).rejects.toThrow(/no compose handoff/);
    await openApprovedSmsCompose(openInput());
    await expect(
      reportSmsComposeOperatorSent({
        tenantId,
        operatorId,
        messageId,
        revisionCount: 1,
        approvedBody: "Edited after the handoff",
        confirmation: SMS_COMPOSE_REPORTED_SENT_CONFIRMATION,
        surface: "cozy_composer",
      })
    ).rejects.toThrow(/no compose handoff/);
    const events = await smsComposeHandoffEventsForOperator({ tenantId, operatorId });
    expect(events.every((event) => event.handoffState !== "operator_reported_sent")).toBe(true);
  });
});
