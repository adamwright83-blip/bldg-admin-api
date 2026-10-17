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

const inboundId = (tenantId: string, sid: string) => `twilio:${tenantId}:${sid}`.slice(0, 80);
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
    const sourceReference = `twilio:${optOut.providerMessageSid}`;
    await this.db
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
    for (const subjectId of optOut.snapshotCustomerIds) {
      await this.db
        .insert(communicationPermissions)
        .values({
          id: `perm_${createHash("sha256").update(`${optOut.tenantId}:customer:${subjectId}:sms`).digest("hex").slice(0, 40)}`,
          tenantId: optOut.tenantId,
          subjectType: "customer",
          subjectId,
          channel: "sms",
          status: "opted_out",
          reason: `Customer texted STOP (${sourceReference})`,
          frequencyCapDays: 7,
        })
        .onDuplicateKeyUpdate({ set: { status: "opted_out", reason: `Customer texted STOP (${sourceReference})` } });
    }

    const hashed = await this.db
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
    for (const subjectId of optOut.snapshotCustomerIds) {
      const rows = await this.db
        .select({ status: communicationPermissions.status })
        .from(communicationPermissions)
        .where(
          and(
            eq(communicationPermissions.tenantId, optOut.tenantId),
            eq(communicationPermissions.subjectType, "customer"),
            eq(communicationPermissions.subjectId, subjectId),
            eq(communicationPermissions.channel, "sms")
          )
        )
        .limit(1);
      if (rows[0]?.status !== "opted_out") return false;
    }
    return true;
  }
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
  recipient: string
): Promise<RecipientOptOutState> {
  const line = normalizeIdentityPhone(lineNumber);
  const to = normalizeIdentityPhone(recipient);
  if (!line || !to) return "clear";
  const db = await getDb().catch(() => null);
  if (!db) return "clear"; // No durable store, so no STOP can have been recorded.
  try {
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
