import type { Express, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TwilioCommunicationReceipt } from "@shared/twilioPlatform";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test_token_value";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.TWILIO_FROM_NUMBER = "+13105550022";
  return {
    twilioFactoryCalls: 0,
    messagesCreate: vi.fn(async () => ({
      sid: "SM_accepted",
      status: "queued",
    })),
    twilioRequest: vi.fn(async () => ({
      body: {
        sid: "SM_accepted",
        status: "queued",
      },
    })),
    getUserByOpenId: vi.fn(async (openId: string) => ({
      tenantId: "goldline",
      openId,
    })),
  };
});

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    ownerOpenId: "adam-admin",
  },
}));

vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getUserByOpenId: (openId: string) => hoisted.getUserByOpenId(openId),
}));

vi.mock("twilio", async importOriginal => {
  const actual = (await importOriginal()) as {
    default?: Record<string, unknown>;
  } & Record<string, unknown>;
  const real = (actual.default ?? actual) as Record<string, unknown>;
  const factory = Object.assign(
    () => {
      hoisted.twilioFactoryCalls += 1;
      return {
        messages: {
          create: (...args: unknown[]) => hoisted.messagesCreate(...args),
        },
        request: (...args: unknown[]) => hoisted.twilioRequest(...args),
        calls: { create: vi.fn() },
      };
    },
    real,
    { twiml: real.twiml }
  );
  return { ...actual, default: factory };
});

import {
  OPERATOR_ARTIFACT_KINDS,
  OPERATOR_ARTIFACT_STATUS_PATH,
  parseOperatorArtifact,
  recordOperatorArtifactProviderStatus,
  registerOperatorArtifactSmsRoutes,
  sendOperatorArtifact,
  type SendOperatorArtifactInput,
} from "./sendOperatorArtifact";
import {
  createMemoryCommunicationReceiptStore,
  setCommunicationReceiptStoreForTests,
} from "../twilioPlatform/communicationReceipts";
import { resetTwilioPlatformClientForTests } from "../twilioPlatform/client";
import { resetTwilioCapabilityFailuresForTests } from "../twilioPlatform/capabilities";

let seen: TwilioCommunicationReceipt[] = [];

function plain(text = "Gate code is 1924"): SendOperatorArtifactInput {
  return {
    tenantId: "goldline",
    operatorUserId: "adam-admin",
    artifact: { kind: "plain_text", text },
  };
}

beforeEach(() => {
  delete process.env.CLAIRE_OPERATOR_PHONES;
  seen = [];
  const inner = createMemoryCommunicationReceiptStore();
  setCommunicationReceiptStoreForTests({
    async insertOrGet(receipt) {
      const result = await inner.insertOrGet(receipt);
      if (!result.duplicate) seen.push(result.receipt);
      return result;
    },
  });
  resetTwilioPlatformClientForTests();
  resetTwilioCapabilityFailuresForTests();
  hoisted.messagesCreate.mockReset();
  hoisted.messagesCreate.mockResolvedValue({
    sid: "SM_accepted",
    status: "queued",
  });
  hoisted.twilioRequest.mockReset();
  hoisted.twilioRequest.mockResolvedValue({
    body: {
      sid: "SM_accepted",
      status: "queued",
    },
  });
  hoisted.getUserByOpenId.mockReset();
  hoisted.getUserByOpenId.mockImplementation(async (openId: string) => ({
    tenantId: "goldline",
    openId,
  }));
});

afterEach(() => {
  setCommunicationReceiptStoreForTests(null);
  delete process.env.CLAIRE_OPERATOR_PHONES;
});

describe("sendOperatorArtifact", () => {
  it("rejects a caller-supplied destination, including Text Dana", async () => {
    await expect(
      sendOperatorArtifact({
        ...plain("Text Dana"),
        to: "+15551230000",
      } as SendOperatorArtifactInput)
    ).rejects.toThrow(/cannot supply a phone number/);
    await expect(
      sendOperatorArtifact({
        ...plain("Text Dana"),
        destinationPhone: "+15551230000",
      } as SendOperatorArtifactInput)
    ).rejects.toThrow(/cannot supply a phone number/);
    expect(hoisted.messagesCreate).not.toHaveBeenCalled();
    expect(seen).toHaveLength(0);
  });

  it("fails a cross-tenant send before any provider call", async () => {
    hoisted.getUserByOpenId.mockResolvedValue({
      tenantId: "goldline",
      openId: "adam-admin",
    });
    await expect(
      sendOperatorArtifact({
        tenantId: "other-tenant",
        operatorUserId: "adam-admin",
        artifact: { kind: "plain_text", text: "hello" },
      })
    ).rejects.toThrow(/belongs to tenant "goldline"/);
    expect(hoisted.messagesCreate).not.toHaveBeenCalled();
  });

  it("fails when the operator is unknown", async () => {
    hoisted.getUserByOpenId.mockResolvedValue(undefined);
    await expect(sendOperatorArtifact(plain())).rejects.toThrow(
      /no such operator/
    );
    await expect(
      sendOperatorArtifact({
        tenantId: "goldline",
        operatorUserId: "dana",
        artifact: { kind: "plain_text", text: "Text Dana" },
      })
    ).rejects.toThrow(/belongs to "adam-admin"|no such operator/);
    expect(hoisted.messagesCreate).not.toHaveBeenCalled();
  });

  it("resolves the authorized operator's existing E.164 and does not dial a payload number", async () => {
    const before = hoisted.twilioFactoryCalls;
    const result = await sendOperatorArtifact({
      tenantId: "goldline",
      operatorUserId: "adam-admin",
      artifact: { kind: "phone_number", label: "Dana", e164: "+15551230000" },
    });
    expect(result.resolvedTo).toBe("+13105550001");
    expect(result.providerAccepted).toBe(true);
    expect(result.delivered).toBe(false);
    expect(result.receipt?.eventType).toBe("MESSAGE_SENT");
    expect(result.receipt?.to).toBe("+13105550001");
    expect(result.evidence.map(item => item.concept)).toEqual(["MESSAGE_SENT"]);
    const payload = hoisted.messagesCreate.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(payload.to).toBe("+13105550001");
    expect(payload.from).toBe("+13105550022");
    expect(payload.body).toBe("Dana: +15551230000");
    expect(payload).not.toHaveProperty("mediaUrl");
    expect(payload).not.toHaveProperty("mediaUrls");
    expect(hoisted.twilioFactoryCalls).toBe(before + 1);
    await sendOperatorArtifact(plain("second"));
    expect(hoisted.twilioFactoryCalls).toBe(before + 1);
  });

  it("persists goal-cycle lineage on provider acceptance and delivery receipts", async () => {
    const decisionId = "11111111-1111-4111-8111-111111111111";
    const accepted = await sendOperatorArtifact({
      ...plain("lineage"),
      agentEventId: 42,
      decisionId,
    });

    expect(accepted.receipt).toMatchObject({
      eventType: "MESSAGE_SENT",
      agentEventId: 42,
      decisionId,
    });
    expect(hoisted.messagesCreate).not.toHaveBeenCalled();
    const request = hoisted.twilioRequest.mock.calls.at(-1)?.[0] as {
      headers?: Record<string, string>;
      data?: Record<string, string>;
    };
    expect(request.headers?.["Idempotency-Key"]).toBe(
      `operator-artifact:goldline:${decisionId}`
    );
    expect(request.data?.StatusCallback).toContain("agentEventId=42");
    expect(request.data?.StatusCallback).toContain(
      "decisionId=11111111-1111-4111-8111-111111111111"
    );

    const delivered = await recordOperatorArtifactProviderStatus({
      tenantId: "goldline",
      operatorUserId: "adam-admin",
      messageSid: "SM_accepted",
      messageStatus: "delivered",
      agentEventId: 42,
      decisionId,
    });
    expect(delivered.receipt).toMatchObject({
      eventType: "MESSAGE_DELIVERED",
      agentEventId: 42,
      decisionId,
    });
  });

  it("accepts only the supported artifact kinds", async () => {
    const supported = [
      { kind: "plain_text", text: "Bring the key" },
      {
        kind: "address",
        label: "Loading dock",
        lines: ["100 Main St", "Los Angeles"],
      },
      { kind: "phone_number", label: "Front desk", e164: "(310) 555-0199" },
      {
        kind: "route_link",
        label: "Route",
        url: "https://maps.example.test/route/1",
      },
      { kind: "customer_reference", customerRef: "cust_19", label: "Opus" },
      { kind: "mission_reference", missionRef: "msn_4" },
      {
        kind: "document_link",
        label: "Permit",
        url: "https://files.example.test/permit",
      },
      {
        kind: "image_link",
        label: "Dock photo",
        url: "https://files.example.test/dock.jpg",
      },
      {
        kind: "field_kit",
        missionRef: "msn_4",
        requirements: ["badge", "closed-toe shoes"],
      },
    ] as const;
    expect(supported.map(item => item.kind)).toEqual([
      ...OPERATOR_ARTIFACT_KINDS,
    ]);
    for (const artifact of supported) {
      expect(parseOperatorArtifact(artifact).kind).toBe(artifact.kind);
    }

    const fieldKit = await sendOperatorArtifact({
      tenantId: "goldline",
      operatorUserId: "adam-admin",
      artifact: {
        kind: "field_kit",
        missionRef: "msn_4",
        requirements: ["badge", "closed-toe shoes"],
      },
    });
    const body = (
      hoisted.messagesCreate.mock.calls.at(-1)?.[0] as { body: string }
    ).body;
    expect(body).toBe("Field kit msn_4\n- badge\n- closed-toe shoes");
    expect(fieldKit.receipt?.eventType).toBe("MESSAGE_SENT");
    expect(
      hoisted.messagesCreate.mock.calls.at(-1)?.[0] as object
    ).not.toHaveProperty("mediaUrl");

    expect(() =>
      parseOperatorArtifact({ kind: "mms", body: "hello" })
    ).toThrow(/not supported/);
    expect(() =>
      parseOperatorArtifact({ kind: "whatsapp", text: "hello" })
    ).toThrow(/not supported/);
    expect(() =>
      parseOperatorArtifact({
        kind: "plain_text",
        text: "hello",
        mediaUrl: "https://x.test/a.jpg",
      })
    ).toThrow(/not part of plain_text/);
    expect(() =>
      parseOperatorArtifact({
        kind: "field_kit",
        missionRef: "msn_4",
        requirements: "bring everything",
      })
    ).toThrow(/requirements/);
    await expect(
      sendOperatorArtifact({
        ...plain(),
        mms: true,
      } as SendOperatorArtifactInput)
    ).rejects.toThrow(/does not accept a media/);
  });

  it("does not claim sent or delivered when the provider fails", async () => {
    hoisted.messagesCreate.mockRejectedValue(
      Object.assign(new Error("refused"), { status: 400 })
    );
    const refused = await sendOperatorArtifact(plain());
    expect(refused.providerAccepted).toBe(false);
    expect(refused.sendOutcome).toBe("rejected");
    expect(refused.delivered).toBe(false);
    expect(refused.receipt).toBeNull();
    expect(refused.evidence).toEqual([]);

    hoisted.messagesCreate.mockRejectedValue(new Error("socket timeout"));
    const unknown = await sendOperatorArtifact(plain("uncertain"));
    expect(unknown.providerAccepted).toBe(false);
    expect(unknown.sendOutcome).toBe("unknown");
    expect(unknown.receipt).toBeNull();

    hoisted.messagesCreate.mockResolvedValue({
      sid: "SM_failed",
      status: "failed",
    });
    const failed = await sendOperatorArtifact(plain("again"));
    expect(failed.providerAccepted).toBe(false);
    expect(failed.delivered).toBe(false);
    expect(failed.receipt?.eventType).toBe("MESSAGE_FAILED");
    expect(seen.some(receipt => receipt.eventType === "MESSAGE_SENT")).toBe(
      false
    );
    expect(
      seen.some(receipt => receipt.eventType === "MESSAGE_DELIVERED")
    ).toBe(false);

    hoisted.messagesCreate.mockResolvedValue({
      sid: "SM_fast",
      status: "delivered",
    });
    const premature = await sendOperatorArtifact(plain("too soon"));
    expect(premature.providerAccepted).toBe(true);
    expect(premature.delivered).toBe(false);
    expect(premature.receipt?.eventType).toBe("MESSAGE_SENT");
    expect(
      seen.some(receipt => receipt.eventType === "MESSAGE_DELIVERED")
    ).toBe(false);
  });

  it("keeps provider acceptance separate from missing durable receipt proof", async () => {
    setCommunicationReceiptStoreForTests({
      async insertOrGet() {
        throw new Error("receipt database unavailable");
      },
    });

    const result = await sendOperatorArtifact(plain("receipt down"));

    expect(result.providerAccepted).toBe(true);
    expect(result.sendOutcome).toBe("accepted");
    expect(result.messageSid).toBe("SM_accepted");
    expect(result.receipt).toBeNull();
    expect(result.evidence).toEqual([]);
  });

  it("does not duplicate the receipt when the same provider message is retried", async () => {
    hoisted.messagesCreate.mockResolvedValue({
      sid: "SM_same",
      status: "queued",
    });
    const first = await sendOperatorArtifact(plain("retry me"));
    const second = await sendOperatorArtifact(plain("retry me"));
    expect(first.receiptDuplicate).toBe(false);
    expect(second.receiptDuplicate).toBe(true);
    expect(second.receipt?.id).toBe(first.receipt?.id);
    expect(second.receipt?.idempotencyKey).toBe(first.receipt?.idempotencyKey);
    expect(
      seen.filter(receipt => receipt.eventType === "MESSAGE_SENT")
    ).toHaveLength(1);

    const delivered = await recordOperatorArtifactProviderStatus({
      tenantId: "goldline",
      operatorUserId: "adam-admin",
      messageSid: "SM_same",
      messageStatus: "delivered",
    });
    const deliveredAgain = await recordOperatorArtifactProviderStatus({
      tenantId: "goldline",
      operatorUserId: "adam-admin",
      messageSid: "SM_same",
      messageStatus: "delivered",
    });
    expect(delivered.delivered).toBe(true);
    expect(delivered.receipt?.eventType).toBe("MESSAGE_DELIVERED");
    expect(deliveredAgain.duplicate).toBe(true);
    expect(deliveredAgain.receipt?.id).toBe(delivered.receipt?.id);
    expect(
      seen.filter(receipt => receipt.eventType === "MESSAGE_DELIVERED")
    ).toHaveLength(1);

    const undelivered = await recordOperatorArtifactProviderStatus({
      tenantId: "goldline",
      operatorUserId: "adam-admin",
      messageSid: "SM_same",
      messageStatus: "undelivered",
      errorCode: "30008",
      errorMessage: "Unknown error",
    });
    expect(undelivered.delivered).toBe(false);
    expect(undelivered.receipt?.eventType).toBe("MESSAGE_FAILED");
    expect(
      seen.filter(
        receipt =>
          receipt.messageSid === "SM_same" &&
          receipt.eventType === "MESSAGE_DELIVERED"
      )
    ).toHaveLength(1);
  });

  it("refuses an unsigned delivery callback and does not record delivered", async () => {
    const handlers = new Map<
      string,
      (req: Request, res: Response) => Promise<void>
    >();
    registerOperatorArtifactSmsRoutes({
      post(
        path: string,
        handler: (req: Request, res: Response) => Promise<void>
      ) {
        handlers.set(path, handler);
      },
    } as unknown as Express);
    const handler = handlers.get(OPERATOR_ARTIFACT_STATUS_PATH);
    expect(handler).toBeTypeOf("function");
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      send(body?: unknown) {
        this.body = body;
        return this;
      },
      end() {
        return this;
      },
    };
    await handler!(
      {
        headers: {},
        protocol: "https",
        originalUrl: `${OPERATOR_ARTIFACT_STATUS_PATH}?tenantId=goldline&operatorUserId=adam-admin`,
        query: { tenantId: "goldline", operatorUserId: "adam-admin" },
        body: {
          MessageSid: "SM_forged",
          MessageStatus: "delivered",
          To: "+19998887777",
        },
        get: () => "api.example.test",
      } as unknown as Request,
      res as unknown as Response
    );
    expect(res.statusCode).toBe(403);
    expect(
      seen.some(receipt => receipt.eventType === "MESSAGE_DELIVERED")
    ).toBe(false);
    expect(seen.some(receipt => receipt.to === "+19998887777")).toBe(false);
  });
});
