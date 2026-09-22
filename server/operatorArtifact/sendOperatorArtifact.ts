import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import { authorizedOperatorPhone } from "../claire/claireTwilio";
import { isValidTwilioWebhook } from "../claire/conversation/twilioSignature";
import {
  communicationReceiptEventFromProviderStatus,
  redactEndpointForLog,
  type CommunicationCandidateEvidence,
  type CommunicationReceiptEventType,
  type TwilioCommunicationReceipt,
} from "@shared/twilioPlatform";
import { assertTwilioCapability } from "../twilioPlatform/capabilities";
import { getTwilioPlatformClient } from "../twilioPlatform/client";
import {
  recordCommunicationReceipt,
  TwilioCommunicationReceiptError,
} from "../twilioPlatform/communicationReceipts";
import { toCommunicationCandidateEvidence } from "../twilioPlatform/communicationEvidence";
import {
  readTwilioPlatformConfig,
  readTwilioRestCredentials,
} from "../twilioPlatform/config";

/**
 * Operator SMS artifact port.
 *
 * The action is "send this artifact to the currently authorized operator."
 * The caller never supplies the destination number. V1 transport is SMS
 * through the platform client. WhatsApp, MMS, and Conversations are not
 * required. This module is not wired into Claire's turn loop.
 */

export const OPERATOR_ARTIFACT_STATUS_PATH =
  "/api/twilio/operator-artifact/status";

export const OPERATOR_ARTIFACT_KINDS = [
  "plain_text",
  "address",
  "phone_number",
  "route_link",
  "customer_reference",
  "mission_reference",
  "document_link",
  "image_link",
  "field_kit",
] as const;

export type OperatorArtifactKind = (typeof OPERATOR_ARTIFACT_KINDS)[number];

export type OperatorArtifact =
  | { kind: "plain_text"; text: string }
  | { kind: "address"; label?: string; lines: string[] }
  | { kind: "phone_number"; label: string; e164: string }
  | { kind: "route_link"; label: string; url: string }
  | { kind: "customer_reference"; customerRef: string; label?: string }
  | { kind: "mission_reference"; missionRef: string; label?: string }
  | { kind: "document_link"; label: string; url: string }
  | { kind: "image_link"; label: string; url: string }
  | { kind: "field_kit"; missionRef: string; requirements: string[] };

const DESTINATION_FIELDS = [
  "to",
  "destination",
  "recipient",
  "phone",
  "operatorPhone",
  "recipientPhone",
  "destinationPhone",
] as const;

const MEDIA_FIELDS = [
  "mediaUrl",
  "mediaUrls",
  "media",
  "mms",
  "whatsapp",
  "persistentAction",
] as const;

type NoCallerDestination = {
  to?: never;
  destination?: never;
  recipient?: never;
  phone?: never;
  operatorPhone?: never;
  recipientPhone?: never;
  destinationPhone?: never;
  mediaUrl?: never;
  mediaUrls?: never;
  media?: never;
  mms?: never;
  whatsapp?: never;
  persistentAction?: never;
};

export type SendOperatorArtifactInput = {
  tenantId: string;
  operatorUserId: string;
  artifact: OperatorArtifact;
} & NoCallerDestination;

export type OperatorSmsPort = {
  send(input: {
    to: string;
    body: string;
    statusCallback?: string;
  }): Promise<{ messageSid: string; status: string }>;
};

export type SendOperatorArtifactResult = {
  providerAccepted: boolean;
  delivered: false;
  resolvedTo: string;
  messageSid: string | null;
  providerStatus: string | null;
  receipt: TwilioCommunicationReceipt | null;
  receiptDuplicate: boolean;
  evidence: CommunicationCandidateEvidence[];
};

export class OperatorArtifactRequestError extends Error {
  readonly code:
    | "caller_destination"
    | "unsupported_payload"
    | "invalid_payload";

  constructor(code: OperatorArtifactRequestError["code"], message: string) {
    super(message);
    this.name = "OperatorArtifactRequestError";
    this.code = code;
  }
}

const KIND_FIELDS: Record<
  OperatorArtifactKind,
  { required: string[]; optional: string[] }
> = {
  plain_text: { required: ["text"], optional: [] },
  address: { required: ["lines"], optional: ["label"] },
  phone_number: { required: ["label", "e164"], optional: [] },
  route_link: { required: ["label", "url"], optional: [] },
  customer_reference: { required: ["customerRef"], optional: ["label"] },
  mission_reference: { required: ["missionRef"], optional: ["label"] },
  document_link: { required: ["label", "url"], optional: [] },
  image_link: { required: ["label", "url"], optional: [] },
  field_kit: { required: ["missionRef", "requirements"], optional: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertHttpUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      `${field} must be an http(s) URL`
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      `${field} must be an http(s) URL`
    );
  }
  return url.toString();
}

function assertE164(value: string, field: string): string {
  const digits = value.replace(/\D/g, "");
  const normalized = value.trim().startsWith("+")
    ? `+${digits}`
    : digits.startsWith("1")
      ? `+${digits}`
      : `+1${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      `${field} must be E.164`
    );
  }
  return normalized;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      `${field} must be a string`
    );
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      `${field} is empty or too long`
    );
  }
  return trimmed;
}

function optionalText(
  value: unknown,
  field: string,
  max: number
): string | undefined {
  if (value == null) return undefined;
  return requiredText(value, field, max);
}

export function parseOperatorArtifact(value: unknown): OperatorArtifact {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new OperatorArtifactRequestError(
      "unsupported_payload",
      "Operator artifact kind is required"
    );
  }
  if (!(OPERATOR_ARTIFACT_KINDS as readonly string[]).includes(value.kind)) {
    throw new OperatorArtifactRequestError(
      "unsupported_payload",
      `Operator artifact kind "${value.kind}" is not supported`
    );
  }
  const kind = value.kind as OperatorArtifactKind;
  const fields = KIND_FIELDS[kind];
  const allowed = new Set(["kind", ...fields.required, ...fields.optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new OperatorArtifactRequestError(
        "unsupported_payload",
        `Operator artifact field "${key}" is not part of ${kind}`
      );
    }
  }
  for (const key of fields.required) {
    if (!(key in value)) {
      throw new OperatorArtifactRequestError(
        "invalid_payload",
        `${kind} requires ${key}`
      );
    }
  }

  switch (kind) {
    case "plain_text":
      return { kind, text: requiredText(value.text, "text", 1000) };
    case "address": {
      if (
        !Array.isArray(value.lines) ||
        value.lines.length < 1 ||
        value.lines.length > 6
      ) {
        throw new OperatorArtifactRequestError(
          "invalid_payload",
          "address.lines must be 1 to 6 strings"
        );
      }
      return {
        kind,
        label: optionalText(value.label, "label", 80),
        lines: value.lines.map((line, index) =>
          requiredText(line, `lines[${index}]`, 120)
        ),
      };
    }
    case "phone_number":
      return {
        kind,
        label: requiredText(value.label, "label", 80),
        e164: assertE164(requiredText(value.e164, "e164", 20), "e164"),
      };
    case "route_link":
      return {
        kind,
        label: requiredText(value.label, "label", 80),
        url: assertHttpUrl(requiredText(value.url, "url", 500), "url"),
      };
    case "customer_reference":
      return {
        kind,
        customerRef: requiredText(value.customerRef, "customerRef", 80),
        label: optionalText(value.label, "label", 80),
      };
    case "mission_reference":
      return {
        kind,
        missionRef: requiredText(value.missionRef, "missionRef", 80),
        label: optionalText(value.label, "label", 80),
      };
    case "document_link":
      return {
        kind,
        label: requiredText(value.label, "label", 80),
        url: assertHttpUrl(requiredText(value.url, "url", 500), "url"),
      };
    case "image_link":
      return {
        kind,
        label: requiredText(value.label, "label", 80),
        url: assertHttpUrl(requiredText(value.url, "url", 500), "url"),
      };
    case "field_kit": {
      if (
        !Array.isArray(value.requirements) ||
        value.requirements.length > 12
      ) {
        throw new OperatorArtifactRequestError(
          "invalid_payload",
          "field_kit.requirements must be an array of strings"
        );
      }
      return {
        kind,
        missionRef: requiredText(value.missionRef, "missionRef", 80),
        requirements: value.requirements.map((item, index) =>
          requiredText(item, `requirements[${index}]`, 120)
        ),
      };
    }
    default: {
      const unreachable: never = kind;
      throw new OperatorArtifactRequestError(
        "unsupported_payload",
        `Unsupported artifact ${unreachable}`
      );
    }
  }
}

export function renderOperatorArtifactSms(artifact: OperatorArtifact): string {
  switch (artifact.kind) {
    case "plain_text":
      return artifact.text;
    case "address":
      return [artifact.label, ...artifact.lines].filter(Boolean).join("\n");
    case "phone_number":
      return `${artifact.label}: ${artifact.e164}`;
    case "route_link":
      return `${artifact.label}\n${artifact.url}`;
    case "customer_reference":
      return artifact.label
        ? `${artifact.label}: ${artifact.customerRef}`
        : `Customer ${artifact.customerRef}`;
    case "mission_reference":
      return artifact.label
        ? `${artifact.label}: ${artifact.missionRef}`
        : `Mission ${artifact.missionRef}`;
    case "document_link":
      return `${artifact.label}\n${artifact.url}`;
    case "image_link":
      return `${artifact.label}\n${artifact.url}`;
    case "field_kit":
      return [
        `Field kit ${artifact.missionRef}`,
        ...artifact.requirements.map(item => `- ${item}`),
      ].join("\n");
    default: {
      const unreachable: never = artifact;
      return unreachable;
    }
  }
}

function assertCallerSuppliesNoDestination(input: object): void {
  const record = input as Record<string, unknown>;
  for (const key of DESTINATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new OperatorArtifactRequestError(
        "caller_destination",
        "Operator SMS destination is the authorized operator. The caller cannot supply a phone number."
      );
    }
  }
  for (const key of MEDIA_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      throw new OperatorArtifactRequestError(
        "unsupported_payload",
        "Operator SMS does not accept a media or alternate-channel payload."
      );
    }
  }
}

function statusCallbackUrl(tenantId: string, operatorUserId: string): string {
  const base = ENV.adminBaseUrl.replace(/\/$/, "");
  const params = new URLSearchParams({ tenantId, operatorUserId });
  return `${base}${OPERATOR_ARTIFACT_STATUS_PATH}?${params.toString()}`;
}

/**
 * SMS port. Uses the platform client only. The message body is text.
 * There is no MediaUrl and no Conversations or WhatsApp send.
 */
export function createTwilioOperatorSmsPort(
  env: NodeJS.ProcessEnv = process.env
): OperatorSmsPort {
  return {
    async send(input) {
      assertTwilioCapability("sms", env);
      const from = readTwilioPlatformConfig(env).smsFromNumber;
      if (!from) {
        throw new OperatorArtifactRequestError(
          "invalid_payload",
          "SMS from number is not configured"
        );
      }
      const client = getTwilioPlatformClient(env);
      const created = await client.messages.create({
        to: input.to,
        from,
        body: input.body,
        ...(input.statusCallback
          ? { statusCallback: input.statusCallback }
          : {}),
      });
      const messageSid =
        typeof created.sid === "string" ? created.sid.trim() : "";
      const status = typeof created.status === "string" ? created.status : "";
      return { messageSid, status };
    },
  };
}

function acceptanceEvent(
  status: string
): "MESSAGE_SENT" | "MESSAGE_FAILED" | null {
  if (!status.trim()) return "MESSAGE_SENT";
  const event = communicationReceiptEventFromProviderStatus({
    channel: "message",
    status,
  });
  if (event === "MESSAGE_DELIVERED" || event === "MESSAGE_SENT")
    return "MESSAGE_SENT";
  if (event === "MESSAGE_FAILED") return "MESSAGE_FAILED";
  return null;
}

function evidenceFor(
  receipt: TwilioCommunicationReceipt | null
): CommunicationCandidateEvidence[] {
  return receipt ? toCommunicationCandidateEvidence(receipt) : [];
}

function failureResult(resolvedTo: string): SendOperatorArtifactResult {
  return {
    providerAccepted: false,
    delivered: false,
    resolvedTo,
    messageSid: null,
    providerStatus: null,
    receipt: null,
    receiptDuplicate: false,
    evidence: [],
  };
}

async function recordMessageReceipt(input: {
  tenantId: string;
  operatorUserId: string;
  eventType: CommunicationReceiptEventType;
  messageSid: string;
  from: string | null;
  to: string | null;
  status: string | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
}): Promise<{ receipt: TwilioCommunicationReceipt; duplicate: boolean }> {
  return recordCommunicationReceipt({
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    eventType: input.eventType,
    messageSid: input.messageSid,
    direction: "outbound",
    from: input.from,
    to: input.to,
    status: input.status,
    providerErrorCode: input.providerErrorCode,
    providerErrorMessage: input.providerErrorMessage,
  });
}

export async function sendOperatorArtifact(
  input: SendOperatorArtifactInput,
  options?: { port?: OperatorSmsPort; env?: NodeJS.ProcessEnv }
): Promise<SendOperatorArtifactResult> {
  assertCallerSuppliesNoDestination(input);
  const artifact = parseOperatorArtifact(input.artifact);
  const body = renderOperatorArtifactSms(artifact);
  if (!body.trim() || body.length > 1600) {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      "Operator SMS body is empty or too long"
    );
  }
  const tenantId = input.tenantId?.trim() ?? "";
  const operatorUserId = input.operatorUserId?.trim() ?? "";
  if (!tenantId || !operatorUserId) {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      "tenantId and operatorUserId are required"
    );
  }
  const resolvedTo = await authorizedOperatorPhone({
    tenantId,
    actorId: operatorUserId,
  });
  const env = options?.env ?? process.env;
  const from = readTwilioPlatformConfig(env).smsFromNumber;
  const port = options?.port ?? createTwilioOperatorSmsPort(env);

  let sent: { messageSid: string; status: string };
  try {
    sent = await port.send({
      to: resolvedTo,
      body,
      statusCallback: statusCallbackUrl(tenantId, operatorUserId),
    });
  } catch (error) {
    if (
      error instanceof TwilioCommunicationReceiptError ||
      error instanceof OperatorArtifactRequestError
    ) {
      throw error;
    }
    console.error("[operator-artifact] provider did not accept SMS", {
      to: redactEndpointForLog(resolvedTo),
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return failureResult(resolvedTo);
  }

  if (!sent.messageSid) {
    return {
      ...failureResult(resolvedTo),
      providerStatus: sent.status || null,
    };
  }

  const eventType = acceptanceEvent(sent.status);
  if (eventType !== "MESSAGE_SENT") {
    const recorded =
      eventType === "MESSAGE_FAILED"
        ? await recordMessageReceipt({
            tenantId,
            operatorUserId,
            eventType: "MESSAGE_FAILED",
            messageSid: sent.messageSid,
            from,
            to: resolvedTo,
            status: sent.status || null,
          })
        : null;
    return {
      providerAccepted: false,
      delivered: false,
      resolvedTo,
      messageSid: sent.messageSid,
      providerStatus: sent.status || null,
      receipt: recorded?.receipt ?? null,
      receiptDuplicate: recorded?.duplicate ?? false,
      evidence: [],
    };
  }

  let recorded: { receipt: TwilioCommunicationReceipt; duplicate: boolean };
  try {
    recorded = await recordMessageReceipt({
      tenantId,
      operatorUserId,
      eventType: "MESSAGE_SENT",
      messageSid: sent.messageSid,
      from,
      to: resolvedTo,
      status: sent.status || "accepted",
    });
  } catch (error) {
    if (
      error instanceof TwilioCommunicationReceiptError &&
      error.code === "persistence_unconfigured"
    ) {
      console.warn(
        "[operator-artifact] provider accepted SMS but the receipt store is not configured",
        {
          messageSid: sent.messageSid,
          to: redactEndpointForLog(resolvedTo),
        }
      );
      return {
        providerAccepted: true,
        delivered: false,
        resolvedTo,
        messageSid: sent.messageSid,
        providerStatus: sent.status || null,
        receipt: null,
        receiptDuplicate: false,
        evidence: [],
      };
    }
    throw error;
  }

  return {
    providerAccepted: true,
    delivered: false,
    resolvedTo,
    messageSid: sent.messageSid,
    providerStatus: sent.status || null,
    receipt: recorded.receipt,
    receiptDuplicate: recorded.duplicate,
    evidence: evidenceFor(recorded.receipt),
  };
}

export async function recordOperatorArtifactProviderStatus(input: {
  tenantId: string;
  operatorUserId?: string | null;
  messageSid: string;
  messageStatus: string;
  from?: string | null;
  to?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<{
  delivered: boolean;
  duplicate: boolean;
  receipt: TwilioCommunicationReceipt | null;
}> {
  const tenantId = input.tenantId.trim();
  const messageSid = input.messageSid.trim();
  if (!tenantId || !messageSid) {
    throw new OperatorArtifactRequestError(
      "invalid_payload",
      "A delivery callback requires tenantId and MessageSid"
    );
  }
  const eventType = communicationReceiptEventFromProviderStatus({
    channel: "message",
    status: input.messageStatus,
  });
  if (!eventType) {
    return { delivered: false, duplicate: false, receipt: null };
  }
  if (
    eventType === "MESSAGE_DELIVERED" &&
    (meaningfulProviderError(input.errorCode) ||
      meaningfulProviderError(input.errorMessage))
  ) {
    return { delivered: false, duplicate: false, receipt: null };
  }
  const recorded = await recordCommunicationReceipt({
    tenantId,
    operatorUserId: input.operatorUserId,
    eventType,
    messageSid,
    direction: "outbound",
    from: input.from,
    to: input.to,
    status: input.messageStatus,
    providerErrorCode: eventType === "MESSAGE_FAILED" ? input.errorCode : null,
    providerErrorMessage:
      eventType === "MESSAGE_FAILED" ? input.errorMessage : null,
  });
  return {
    delivered: eventType === "MESSAGE_DELIVERED",
    duplicate: recorded.duplicate,
    receipt: recorded.receipt,
  };
}

function meaningfulProviderError(value: string | null | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 && trimmed !== "0";
}

function webhookUrls(req: Request): string[] {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ||
    req.protocol;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0] ||
    req.get("host");
  const forwarded = `${proto}://${host}${req.originalUrl}`;
  const configured = `${ENV.adminBaseUrl.replace(/\/$/, "")}${req.originalUrl}`;
  return forwarded === configured ? [forwarded] : [forwarded, configured];
}

function formBody(body: unknown): Record<string, string> {
  if (!isRecord(body)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") out[key] = value;
    else if (typeof value === "number" || typeof value === "boolean")
      out[key] = String(value);
  }
  return out;
}

function queryValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string")
    return value[0].trim();
  return "";
}

/**
 * Provider status callback for operator SMS. This is a new path.
 * It does not replace Claire inbound voice, recording, or call-status URLs.
 * MESSAGE_DELIVERED is written only when the provider status maps to delivered.
 */
export function registerOperatorArtifactSmsRoutes(app: Express): void {
  app.post(
    OPERATOR_ARTIFACT_STATUS_PATH,
    async (req: Request, res: Response) => {
      const credentials = readTwilioRestCredentials();
      const body = formBody(req.body);
      const valid = isValidTwilioWebhook({
        authToken: credentials?.authToken ?? "",
        signature: req.headers["x-twilio-signature"],
        urls: webhookUrls(req),
        body,
        nodeEnv: process.env.NODE_ENV ?? "development",
      });
      if (!valid) {
        res.status(403).send("Forbidden");
        return;
      }
      const tenantId = queryValue(req.query.tenantId);
      const operatorUserId = queryValue(req.query.operatorUserId);
      const messageSid = body.MessageSid || body.SmsSid || "";
      const messageStatus = body.MessageStatus || body.SmsStatus || "";
      try {
        await recordOperatorArtifactProviderStatus({
          tenantId,
          operatorUserId: operatorUserId || null,
          messageSid,
          messageStatus,
          from: body.From || null,
          to: body.To || null,
          errorCode: body.ErrorCode || null,
          errorMessage: body.ErrorMessage || null,
        });
        res.status(204).end();
      } catch (error) {
        if (
          error instanceof TwilioCommunicationReceiptError &&
          error.code === "persistence_unconfigured"
        ) {
          res.status(204).end();
          return;
        }
        if (error instanceof OperatorArtifactRequestError) {
          res.status(400).send(error.message);
          return;
        }
        console.error("[operator-artifact] status callback failed", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
        res.status(500).end();
      }
    }
  );
}
