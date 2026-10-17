import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  businessLineInboundMessages,
  communicationPermissions,
  customerContactPermissions,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { normalizeIdentityPhone } from "../analytics/customerIdentityResolution";
import { hashIdentityKey } from "../strategy/dormantOutreachGate";

/**
 * The business line's inbox: every signed inbound text, saved and read back
 * before any other handling, plus STOP opt-outs written to both consent stores
 * that outbound paths check. Nothing here sends or replies.
 */

/** Twilio's default opt-out keywords. A message that is exactly one of these opts the sender out. */
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "STOP ALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_KEYWORDS = new Set(["START", "UNSTOP", "YES"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);

export type OptOutKeyword = "stop" | "start" | "help";

export function optOutKeywordFor(body: string, twilioOptOutType?: string): OptOutKeyword | null {
  const type = String(twilioOptOutType ?? "").trim().toUpperCase();
  if (type === "STOP") return "stop";
  if (type === "START") return "start";
  if (type === "HELP") return "help";
  const word = body.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ").toUpperCase();
  if (STOP_KEYWORDS.has(word)) return "stop";
  if (START_KEYWORDS.has(word)) return "start";
  if (HELP_KEYWORDS.has(word)) return "help";
  return null;
}

/** Same `phone:` identity key the consent gate reads; short codes fall back to their raw digits. */
export function customerKeyHashForPhone(tenantId: string, phone: string): string | null {
  const digits = normalizeIdentityPhone(phone) ?? (String(phone).replace(/\D/g, "") || null);
  return digits ? hashIdentityKey(tenantId, `phone:${digits}`) : null;
}

export type BusinessLineInboundRecord = {
  tenantId: string;
  providerMessageSid: string;
  toDigits: string;
  fromDigits: string;
  customerKeyHash: string;
  body: string;
  numMedia: number;
  optOutKeyword: OptOutKeyword | null;
  receivedAt: Date;
};

export type BusinessLineOptOut = {
  tenantId: string;
  customerKeyHash: string;
  /** Customer ids the rescue path checks consent under, when the sender resolved to them. */
  snapshotCustomerIds: readonly string[];
  providerMessageSid: string;
  capturedAt: Date;
};

export interface BusinessLineInboxStore {
  /** Saves the message (a repeat of the same MessageSid is a no-op) and returns true only if it reads back. */
  recordInbound(record: BusinessLineInboundRecord): Promise<boolean>;
  /** Writes opted_out to every consent store an outbound path checks, and returns true only if all read back. */
  recordOptOut(optOut: BusinessLineOptOut): Promise<boolean>;
}

/** Fixed-length digest of the full tenant and MessageSid, so no valid id pair can collide. */
export const inboundId = (tenantId: string, sid: string) =>
  `bli_${createHash("sha256").update(`${tenantId}\u0000${sid}`).digest("hex")}`;
const OPT_OUT_RECORDER = "business_line_inbound_stop";

export class MemoryBusinessLineInbox implements BusinessLineInboxStore {
  readonly messages = new Map<string, BusinessLineInboundRecord>();
  readonly optOuts = new Map<string, BusinessLineOptOut>();
  failInbound = false;
  failOptOut = false;

  async recordInbound(record: BusinessLineInboundRecord): Promise<boolean> {
    if (this.failInbound) return false;
    const id = inboundId(record.tenantId, record.providerMessageSid);
    if (!this.messages.has(id)) this.messages.set(id, record);
    return true;
  }

  async recordOptOut(optOut: BusinessLineOptOut): Promise<boolean> {
    if (this.failOptOut) return false;
    this.optOuts.set(`${optOut.tenantId}:${optOut.customerKeyHash}`, optOut);
    return true;
  }
}

type InboxDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export type SmsOptOutWrite = {
  tenantId: string;
  /** Phone the customer opted out from; drives the phone-keyed gate Silver Lake reads. */
  phone: string | null;
  /** Customer ids that consent checks use (rescue snapshot ids, dossier identity ids, `phone:` ids). */
  customerSubjectIds: readonly string[];
  channels: readonly ("sms" | "any")[];
  sourceReference: string;
  capturedAt: Date;
  recordedBy: string;
};

const permissionRowId = (tenantId: string, subjectId: string, channel: string) =>
  `perm_${createHash("sha256").update(`${tenantId}:customer:${subjectId}:${channel}`).digest("hex").slice(0, 40)}`;

/**
 * Writes opted_out to every consent store an outbound path reads, then reads each
 * back. Returns true only if all of them now say opted_out. Throws only on driver errors.
 */
export async function enforceSmsOptOut(db: InboxDb, input: SmsOptOutWrite): Promise<boolean> {
  const customerKeyHash = input.phone ? customerKeyHashForPhone(input.tenantId, input.phone) : null;
  if (!customerKeyHash && input.customerSubjectIds.length === 0) return false;
  if (customerKeyHash) {
    await db
      .insert(customerContactPermissions)
      .values({
        tenantId: input.tenantId,
        customerKeyHash,
        status: "opted_out",
        sourceReference: input.sourceReference,
        capturedAt: input.capturedAt,
        expiresAt: null,
        recordedBy: input.recordedBy,
      })
      .onDuplicateKeyUpdate({
        set: {
          status: "opted_out",
          sourceReference: input.sourceReference,
          capturedAt: input.capturedAt,
          expiresAt: null,
          recordedBy: input.recordedBy,
        },
      });
  }
  const reason = `Customer opted out (${input.sourceReference})`;
  for (const subjectId of input.customerSubjectIds) {
    for (const channel of input.channels) {
      await db
        .insert(communicationPermissions)
        .values({
          id: permissionRowId(input.tenantId, subjectId, channel),
          tenantId: input.tenantId,
          subjectType: "customer",
          subjectId,
          channel,
          status: "opted_out",
          reason,
          frequencyCapDays: 7,
        })
        .onDuplicateKeyUpdate({ set: { status: "opted_out", reason } });
    }
  }

  if (customerKeyHash) {
    const hashed = await db
      .select({ status: customerContactPermissions.status })
      .from(customerContactPermissions)
      .where(
        and(
          eq(customerContactPermissions.tenantId, input.tenantId),
          eq(customerContactPermissions.customerKeyHash, customerKeyHash),
          eq(customerContactPermissions.channel, "sms"),
          eq(customerContactPermissions.purpose, "win_back_marketing")
        )
      )
      .limit(1);
    if (hashed[0]?.status !== "opted_out") return false;
  }
  for (const subjectId of input.customerSubjectIds) {
    for (const channel of input.channels) {
      const rows = await db
        .select({ status: communicationPermissions.status })
        .from(communicationPermissions)
        .where(
          and(
            eq(communicationPermissions.tenantId, input.tenantId),
            eq(communicationPermissions.subjectType, "customer"),
            eq(communicationPermissions.subjectId, subjectId),
            eq(communicationPermissions.channel, channel)
          )
        )
        .limit(1);
      if (rows[0]?.status !== "opted_out") return false;
    }
  }
  return true;
}

/**
 * Whether this phone is opted out in the tenant's phone-keyed consent gate. Fails
 * closed: a missing or unreadable store is "unavailable", never "clear".
 */
export async function phoneOptOutState(
  tenantId: string,
  phone: string,
  deps: { getDb?: () => Promise<InboxDb | null> } = {}
): Promise<RecipientOptOutState> {
  const customerKeyHash = customerKeyHashForPhone(tenantId, phone);
  if (!customerKeyHash) return "clear";
  try {
    const db = await (deps.getDb ?? getDb)();
    if (!db) return "unavailable";
    const rows = await db
      .select({ status: customerContactPermissions.status })
      .from(customerContactPermissions)
      .where(
        and(
          eq(customerContactPermissions.tenantId, tenantId),
          eq(customerContactPermissions.customerKeyHash, customerKeyHash),
          eq(customerContactPermissions.channel, "sms"),
          eq(customerContactPermissions.purpose, "win_back_marketing")
        )
      )
      .limit(1);
    return rows[0]?.status === "opted_out" ? "opted_out" : "clear";
  } catch (error) {
    console.error("[Messaging] phone opt-out check failed; refusing to send", error instanceof Error ? error.name : "unknown");
    return "unavailable";
  }
}

export class DrizzleBusinessLineInbox implements BusinessLineInboxStore {
  constructor(private readonly db: InboxDb) {}

  async recordInbound(record: BusinessLineInboundRecord): Promise<boolean> {
    const id = inboundId(record.tenantId, record.providerMessageSid);
    await this.db
      .insert(businessLineInboundMessages)
      .values({ id, ...record })
      .onDuplicateKeyUpdate({ set: { id } });
    const rows = await this.db
      .select({ sid: businessLineInboundMessages.providerMessageSid })
      .from(businessLineInboundMessages)
      .where(
        and(
          eq(businessLineInboundMessages.tenantId, record.tenantId),
          eq(businessLineInboundMessages.providerMessageSid, record.providerMessageSid)
        )
      )
      .limit(1);
    return rows[0]?.sid === record.providerMessageSid;
  }

  async recordOptOut(optOut: BusinessLineOptOut): Promise<boolean> {
    // The hash was derived from the sender's number by the caller; write the same
    // phone-keyed row directly, plus the rescue ids.
    return enforceSmsOptOutByHash(this.db, optOut);
  }
}

async function enforceSmsOptOutByHash(db: InboxDb, optOut: BusinessLineOptOut): Promise<boolean> {
  const sourceReference = `twilio:${optOut.providerMessageSid}`;
  await db
    .insert(customerContactPermissions)
    .values({
      tenantId: optOut.tenantId,
      customerKeyHash: optOut.customerKeyHash,
      status: "opted_out",
      sourceReference,
      capturedAt: optOut.capturedAt,
      expiresAt: null,
      recordedBy: OPT_OUT_RECORDER,
    })
    .onDuplicateKeyUpdate({
      set: { status: "opted_out", sourceReference, capturedAt: optOut.capturedAt, expiresAt: null, recordedBy: OPT_OUT_RECORDER },
    });
  const hashed = await db
    .select({ status: customerContactPermissions.status })
    .from(customerContactPermissions)
    .where(
      and(
        eq(customerContactPermissions.tenantId, optOut.tenantId),
        eq(customerContactPermissions.customerKeyHash, optOut.customerKeyHash),
        eq(customerContactPermissions.channel, "sms"),
        eq(customerContactPermissions.purpose, "win_back_marketing")
      )
    )
    .limit(1);
  if (hashed[0]?.status !== "opted_out") return false;
  if (!optOut.snapshotCustomerIds.length) return true;
  return enforceSmsOptOut(db, {
    tenantId: optOut.tenantId,
    phone: null,
    customerSubjectIds: optOut.snapshotCustomerIds,
    channels: ["sms"],
    sourceReference,
    capturedAt: optOut.capturedAt,
    recordedBy: OPT_OUT_RECORDER,
  });
}

export async function requireDurableBusinessLineInbox(): Promise<BusinessLineInboxStore> {
  const db = await getDb();
  if (!db) {
    throw Object.assign(new Error("The business line inbox requires a durable database."), {
      code: "STORE_UNAVAILABLE",
    });
  }
  return new DrizzleBusinessLineInbox(db);
}

export type RecipientOptOutState = "opted_out" | "clear" | "unavailable";

/**
 * Whether a recipient's latest STOP/START to this business number was a STOP.
 * This mirrors the carrier rule (STOP blocks the number pair; START lifts it), so
 * it applies to every SMS sent from the line, transactional or not. Marketing
 * consent is separate: STOP also writes opted_out there, and START does not undo it.
 */
export async function businessLineRecipientOptOutState(
  lineNumber: string,
  recipient: string,
  deps: { getDb?: () => Promise<InboxDb | null> } = {}
): Promise<RecipientOptOutState> {
  const line = normalizeIdentityPhone(lineNumber);
  const to = normalizeIdentityPhone(recipient);
  // No line number means no provider to send through; an unparseable recipient
  // cannot match any recorded STOP. Neither is a send we could wrongly allow.
  if (!line || !to) return "clear";
  try {
    // A missing or unreachable database does not prove the recipient never texted STOP.
    const db = await (deps.getDb ?? getDb)();
    if (!db) return "unavailable";
    const rows = await db
      .select({ keyword: businessLineInboundMessages.optOutKeyword })
      .from(businessLineInboundMessages)
      .where(
        and(
          eq(businessLineInboundMessages.toDigits, line),
          eq(businessLineInboundMessages.fromDigits, to),
          inArray(businessLineInboundMessages.optOutKeyword, ["stop", "start"])
        )
      )
      .orderBy(desc(businessLineInboundMessages.receivedAt), desc(businessLineInboundMessages.createdAt))
      .limit(1);
    return rows[0]?.keyword === "stop" ? "opted_out" : "clear";
  } catch (error) {
    console.error("[BusinessLine] opt-out check failed; refusing to send", error instanceof Error ? error.name : "unknown");
    return "unavailable";
  }
}
