import { randomUUID } from "node:crypto";
import {
  COMMUNICATION_RECEIPT_TABLE,
  type CommunicationDirection,
  type CommunicationReceiptEventType,
  type TwilioCommunicationReceipt,
  communicationReceiptIdempotencyKey,
  isCommunicationReceiptEvent,
} from "@shared/twilioPlatform";

/**
 * One communications receipt log. Twilio retries collapse onto the same row.
 * This module does not create product tables and does not place calls.
 */

export const COMMUNICATION_RECEIPTS_TABLE = COMMUNICATION_RECEIPT_TABLE;

export type CommunicationReceiptStore = {
  insertOrGet(
    receipt: TwilioCommunicationReceipt
  ): Promise<{ receipt: TwilioCommunicationReceipt; duplicate: boolean }>;
};

export type RecordTwilioCommunicationReceiptInput = {
  tenantId: string;
  operatorUserId?: string | null;
  providerEventId?: string | null;
  eventType: CommunicationReceiptEventType;
  callSid?: string | null;
  parentCallSid?: string | null;
  messageSid?: string | null;
  direction?: CommunicationDirection | null;
  from?: string | null;
  to?: string | null;
  status?: string | null;
  startedAt?: string | null;
  answeredAt?: string | null;
  completedAt?: string | null;
  durationSeconds?: number | null;
  providerErrorCode?: string | null;
  providerErrorMessage?: string | null;
  createdAt?: string;
};

export type RecordTwilioCommunicationReceiptResult = {
  receipt: TwilioCommunicationReceipt;
  duplicate: boolean;
};

export class TwilioCommunicationReceiptError extends Error {
  readonly code:
    | "invalid_event"
    | "missing_identity"
    | "invalid_duration"
    | "invalid_direction"
    | "persistence_unconfigured";

  constructor(
    code: TwilioCommunicationReceiptError["code"],
    message: string
  ) {
    super(message);
    this.name = "TwilioCommunicationReceiptError";
    this.code = code;
  }
}

const ENDPOINT_MAX = 64;
const ERROR_MESSAGE_MAX = 512;
const ERROR_CODE_MAX = 32;

let testStore: CommunicationReceiptStore | null = null;

export function createMemoryCommunicationReceiptStore(): CommunicationReceiptStore {
  const byKey = new Map<string, TwilioCommunicationReceipt>();
  const byProviderEvent = new Map<string, TwilioCommunicationReceipt>();
  return {
    async insertOrGet(receipt) {
      const eventKey = receipt.providerEventId
        ? `${receipt.provider}:${receipt.providerEventId}`
        : null;
      const existing =
        byKey.get(receipt.idempotencyKey) ??
        (eventKey ? byProviderEvent.get(eventKey) : undefined);
      if (existing) return { receipt: existing, duplicate: true };
      byKey.set(receipt.idempotencyKey, receipt);
      if (eventKey) byProviderEvent.set(eventKey, receipt);
      return { receipt, duplicate: false };
    },
  };
}

export function setCommunicationReceiptStoreForTests(
  store: CommunicationReceiptStore | null
): void {
  testStore = store;
}

function optionalText(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function scrubProviderErrorMessage(
  value: string | null | undefined,
  env: NodeJS.ProcessEnv
): string | null {
  const trimmed = optionalText(value, ERROR_MESSAGE_MAX);
  if (!trimmed) return null;
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (token && token.length >= 8 && trimmed.includes(token)) {
    return trimmed.replaceAll(token, "[redacted]").slice(0, ERROR_MESSAGE_MAX);
  }
  return trimmed;
}

function optionalTimestamp(value: string | null | undefined, label: string): string | null {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TwilioCommunicationReceiptError("invalid_event", `${label} is not a timestamp`);
  }
  return parsed.toISOString();
}

export function buildTwilioCommunicationReceipt(
  input: RecordTwilioCommunicationReceiptInput,
  env: NodeJS.ProcessEnv = process.env
): TwilioCommunicationReceipt {
  if (!isCommunicationReceiptEvent(input.eventType)) {
    throw new TwilioCommunicationReceiptError(
      "invalid_event",
      "communication receipt event is not in the provider vocabulary"
    );
  }
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new TwilioCommunicationReceiptError("missing_identity", "communication receipt requires tenantId");
  }
  const direction = input.direction ?? null;
  if (direction != null && direction !== "inbound" && direction !== "outbound") {
    throw new TwilioCommunicationReceiptError("invalid_direction", "communication receipt direction is invalid");
  }
  let durationSeconds: number | null = input.durationSeconds ?? null;
  if (durationSeconds != null) {
    if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
      throw new TwilioCommunicationReceiptError(
        "invalid_duration",
        "communication receipt durationSeconds must be a non-negative integer"
      );
    }
  }
  const providerEventId = optionalText(input.providerEventId, 191);
  const callSid = optionalText(input.callSid, 64);
  const messageSid = optionalText(input.messageSid, 64);
  const idempotencyKey = communicationReceiptIdempotencyKey({
    tenantId,
    eventType: input.eventType,
    providerEventId,
    callSid,
    messageSid,
  });
  return {
    id: randomUUID(),
    tenantId,
    operatorUserId: optionalText(input.operatorUserId, 128),
    provider: "twilio",
    providerEventId,
    eventType: input.eventType,
    callSid,
    parentCallSid: optionalText(input.parentCallSid, 64),
    messageSid,
    direction,
    from: optionalText(input.from, ENDPOINT_MAX),
    to: optionalText(input.to, ENDPOINT_MAX),
    status: optionalText(input.status, 64),
    startedAt: optionalTimestamp(input.startedAt, "startedAt"),
    answeredAt: optionalTimestamp(input.answeredAt, "answeredAt"),
    completedAt: optionalTimestamp(input.completedAt, "completedAt"),
    durationSeconds,
    providerErrorCode: optionalText(input.providerErrorCode, ERROR_CODE_MAX),
    providerErrorMessage: scrubProviderErrorMessage(input.providerErrorMessage, env),
    idempotencyKey,
    createdAt: optionalTimestamp(input.createdAt, "createdAt") ?? new Date().toISOString(),
  };
}

async function resolveStore(
  explicit: CommunicationReceiptStore | undefined
): Promise<CommunicationReceiptStore> {
  if (explicit) return explicit;
  if (testStore) return testStore;
  throw new TwilioCommunicationReceiptError(
    "persistence_unconfigured",
    "communication receipts require the database store or a test store"
  );
}

export async function recordCommunicationReceipt(
  input: RecordTwilioCommunicationReceiptInput,
  options?: { store?: CommunicationReceiptStore; env?: NodeJS.ProcessEnv }
): Promise<RecordTwilioCommunicationReceiptResult> {
  const receipt = buildTwilioCommunicationReceipt(input, options?.env ?? process.env);
  const store = await resolveStore(options?.store);
  return store.insertOrGet(receipt);
}
