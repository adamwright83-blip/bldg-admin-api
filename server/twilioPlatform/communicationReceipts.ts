import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { communicationReceipts } from "../../drizzle/schema";
import {
  COMMUNICATION_RECEIPT_TABLE,
  type CommunicationDirection,
  type CommunicationReceiptEventType,
  type TwilioCommunicationReceipt,
  communicationReceiptIdempotencyKey,
  isCommunicationReceiptEvent,
} from "@shared/twilioPlatform";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";

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
const IDEMPOTENCY_KEY_MAX = 191;

type CommunicationReceiptQuery = {
  insert: (table: unknown) => {
    values: (row: typeof communicationReceipts.$inferInsert) => Promise<unknown>;
  };
  select: () => {
    from: (table: unknown) => {
      where: (clause: unknown) => {
        limit: (count: number) => Promise<Array<typeof communicationReceipts.$inferSelect>>;
      };
    };
  };
};

function fitIdempotencyKey(raw: string): string {
  if (raw.length <= IDEMPOTENCY_KEY_MAX) return raw;
  return `twilio:hash:${createHash("sha256").update(raw).digest("hex")}`.slice(0, IDEMPOTENCY_KEY_MAX);
}

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
  const idempotencyKey = fitIdempotencyKey(
    communicationReceiptIdempotencyKey({
      tenantId: tenantId.slice(0, 64),
      eventType: input.eventType,
      providerEventId,
      callSid,
      messageSid,
    })
  );
  return {
    id: randomUUID(),
    tenantId: tenantId.slice(0, 64),
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

function isoTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function communicationReceiptFromRow(
  row: typeof communicationReceipts.$inferSelect
): TwilioCommunicationReceipt {
  if (row.provider !== "twilio") {
    throw new TwilioCommunicationReceiptError(
      "invalid_event",
      "stored communication receipt provider is not twilio"
    );
  }
  if (!isCommunicationReceiptEvent(row.eventType)) {
    throw new TwilioCommunicationReceiptError(
      "invalid_event",
      "stored communication receipt event is not in the provider vocabulary"
    );
  }
  const direction =
    row.direction === "inbound" || row.direction === "outbound" ? row.direction : null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    provider: "twilio",
    providerEventId: row.providerEventId,
    eventType: row.eventType,
    callSid: row.callSid,
    parentCallSid: row.parentCallSid,
    messageSid: row.messageSid,
    direction,
    from: row.fromNumber,
    to: row.toNumber,
    status: row.status,
    startedAt: isoTimestamp(row.startedAt),
    answeredAt: isoTimestamp(row.answeredAt),
    completedAt: isoTimestamp(row.completedAt),
    durationSeconds: row.durationSeconds,
    providerErrorCode: row.providerErrorCode,
    providerErrorMessage: row.providerErrorMessage,
    idempotencyKey: row.idempotencyKey,
    createdAt: isoTimestamp(row.createdAt) ?? new Date(0).toISOString(),
  };
}

function receiptInsertValues(
  receipt: TwilioCommunicationReceipt
): typeof communicationReceipts.$inferInsert {
  return {
    id: receipt.id,
    tenantId: receipt.tenantId,
    operatorUserId: receipt.operatorUserId,
    provider: receipt.provider,
    providerEventId: receipt.providerEventId,
    eventType: receipt.eventType,
    callSid: receipt.callSid,
    parentCallSid: receipt.parentCallSid,
    messageSid: receipt.messageSid,
    direction: receipt.direction,
    fromNumber: receipt.from,
    toNumber: receipt.to,
    status: receipt.status,
    startedAt: receipt.startedAt ? new Date(receipt.startedAt) : null,
    answeredAt: receipt.answeredAt ? new Date(receipt.answeredAt) : null,
    completedAt: receipt.completedAt ? new Date(receipt.completedAt) : null,
    durationSeconds: receipt.durationSeconds,
    providerErrorCode: receipt.providerErrorCode,
    providerErrorMessage: receipt.providerErrorMessage,
    idempotencyKey: receipt.idempotencyKey,
    createdAt: new Date(receipt.createdAt),
  };
}

async function findStoredReceipt(
  db: CommunicationReceiptQuery,
  receipt: TwilioCommunicationReceipt
): Promise<TwilioCommunicationReceipt | null> {
  const byKey = await db
    .select()
    .from(communicationReceipts)
    .where(eq(communicationReceipts.idempotencyKey, receipt.idempotencyKey))
    .limit(1);
  if (byKey[0]) return communicationReceiptFromRow(byKey[0]);
  if (!receipt.providerEventId) return null;
  const byEvent = await db
    .select()
    .from(communicationReceipts)
    .where(
      and(
        eq(communicationReceipts.provider, receipt.provider),
        eq(communicationReceipts.providerEventId, receipt.providerEventId)
      )
    )
    .limit(1);
  return byEvent[0] ? communicationReceiptFromRow(byEvent[0]) : null;
}

export async function persistCommunicationReceipt(
  db: CommunicationReceiptQuery,
  receipt: TwilioCommunicationReceipt
): Promise<RecordTwilioCommunicationReceiptResult> {
  try {
    await db.insert(communicationReceipts).values(receiptInsertValues(receipt));
    return { receipt, duplicate: false };
  } catch (error) {
    if (!isMysqlDuplicateKeyError(error)) throw error;
    const existing = await findStoredReceipt(db, receipt);
    if (!existing) throw error;
    return { receipt: existing, duplicate: true };
  }
}

export function createDrizzleCommunicationReceiptStore(): CommunicationReceiptStore {
  return {
    async insertOrGet(receipt) {
      const db = await getDb();
      if (!db) {
        throw new TwilioCommunicationReceiptError(
          "persistence_unconfigured",
          "communication receipts require a database"
        );
      }
      return persistCommunicationReceipt(db as unknown as CommunicationReceiptQuery, receipt);
    },
  };
}

async function resolveStore(
  explicit: CommunicationReceiptStore | undefined
): Promise<CommunicationReceiptStore> {
  if (explicit) return explicit;
  if (testStore) return testStore;
  if (process.env.DATABASE_URL) return createDrizzleCommunicationReceiptStore();
  throw new TwilioCommunicationReceiptError(
    "persistence_unconfigured",
    "communication receipts require the database store or a test store"
  );
}

/**
 * Read path for Claire's communications context. Returns nothing when the
 * database is not configured. Does not write a receipt.
 */
export async function listCommunicationReceiptsForOperator(input: {
  tenantId: string;
  operatorUserId: string;
  limit?: number;
}): Promise<TwilioCommunicationReceipt[]> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId || !operatorUserId || !process.env.DATABASE_URL) return [];
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const rows = await db
    .select()
    .from(communicationReceipts)
    .where(
      and(
        eq(communicationReceipts.tenantId, tenantId),
        eq(communicationReceipts.operatorUserId, operatorUserId)
      )
    )
    .orderBy(desc(communicationReceipts.createdAt))
    .limit(limit);
  return rows.map(row => communicationReceiptFromRow(row));
}

export async function recordCommunicationReceipt(
  input: RecordTwilioCommunicationReceiptInput,
  options?: { store?: CommunicationReceiptStore; env?: NodeJS.ProcessEnv }
): Promise<RecordTwilioCommunicationReceiptResult> {
  const receipt = buildTwilioCommunicationReceipt(input, options?.env ?? process.env);
  const store = await resolveStore(options?.store);
  return store.insertOrGet(receipt);
}
