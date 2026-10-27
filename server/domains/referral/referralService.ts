/**
 * JOYSTICK referrals: persistence and reads. The rules live in shared/referralProgram.ts.
 *
 * Two tiers (see README.md): CleanCloud businesses keep CleanCloud's scheme and JOYSTICK copies its Referral Code
 * Usage list (`importCleanCloudReferralUsage`, the entry point GumballPals and Jawbreaker will call). Native POS
 * businesses use JOYSTICK's own codes and referrals, and the referrer's credit is earned from the paid-order ledger.
 *
 * JOYSTICK has no store-credit wallet yet, so on the native tier an earned credit is owed and the operator marks it
 * applied. Never mark one applied on the operator's behalf.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { referralCodes, referralPrograms, referrals } from "../../../drizzle/schema";
import {
  CLEANCLOUD_SETUP_STEPS,
  DEFAULT_CREDIT_CENTS,
  buildReferralActivity,
  cleanCloudReferralKey,
  convertedReferrals,
  makeReferralCode,
  normalizeReferralCode,
  parseCleanCloudReferralUsage,
  referralSyncFreshness,
  type ReferralMode,
  type ReferralProgram,
  type ReferralRecord,
  type ReferralSource,
} from "../../../shared/referralProgram";
import { loadPaidOrderLedger } from "../../analytics/paidOrderLedger";
import { getDashboardTimeZone } from "../../dashboardZoned";
import { getDb } from "../../db";
import { isCleanCloudDirectConfigured } from "../../integrations/cleancloud/browserSync/cleancloudDirectSync";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Referrals need the database");
  return d;
}

function requireTenant(tenantId: string): string {
  const id = String(tenantId ?? "").trim();
  if (!id) throw new Error("Referrals require a tenantId");
  return id;
}

/** A business that syncs from CleanCloud starts on the CleanCloud tier; everyone else starts native. */
export function defaultReferralSource(tenantId: string): ReferralSource {
  return isCleanCloudDirectConfigured(undefined, tenantId) ? "cleancloud" : "joystick";
}

export async function getReferralProgram(tenantId: string): Promise<
  ReferralProgram & { cleancloudSetupConfirmedAt: string | null; cleancloudLastSyncedAt: string | null; stored: boolean }
> {
  const tid = requireTenant(tenantId);
  const [row] = await (await db()).select().from(referralPrograms).where(eq(referralPrograms.tenantId, tid)).limit(1);
  if (!row) {
    return {
      tenantId: tid,
      source: defaultReferralSource(tid),
      mode: "off",
      referrerCreditCents: DEFAULT_CREDIT_CENTS,
      newCustomerCreditCents: DEFAULT_CREDIT_CENTS,
      cleancloudSetupConfirmedAt: null,
      cleancloudLastSyncedAt: null,
      stored: false,
    };
  }
  return {
    tenantId: tid,
    source: row.source,
    mode: row.mode,
    referrerCreditCents: row.referrerCreditCents,
    newCustomerCreditCents: row.newCustomerCreditCents,
    cleancloudSetupConfirmedAt: row.cleancloudSetupConfirmedAt?.toISOString() ?? null,
    cleancloudLastSyncedAt: row.cleancloudLastSyncedAt?.toISOString() ?? null,
    stored: true,
  };
}

export async function saveReferralProgram(input: {
  tenantId: string;
  source: ReferralSource;
  mode: ReferralMode;
  referrerCreditCents: number;
  newCustomerCreditCents: number;
  /** CleanCloud tier: the operator says they did the CleanCloud steps. */
  cleancloudSetupConfirmed?: boolean;
  actor: string;
}) {
  const tid = requireTenant(input.tenantId);
  for (const cents of [input.referrerCreditCents, input.newCustomerCreditCents]) {
    if (!Number.isInteger(cents) || cents < 0 || cents > 50_000) throw new Error("Referral credit must be $0–$500");
  }
  const confirmedAt = input.cleancloudSetupConfirmed ? new Date() : undefined;
  const values = {
    tenantId: tid,
    source: input.source,
    mode: input.mode,
    referrerCreditCents: input.referrerCreditCents,
    newCustomerCreditCents: input.newCustomerCreditCents,
    updatedBy: input.actor,
    ...(confirmedAt ? { cleancloudSetupConfirmedAt: confirmedAt } : {}),
  };
  await (await db())
    .insert(referralPrograms)
    .values(values)
    .onDuplicateKeyUpdate({ set: { ...values, tenantId: undefined } as any });
  return getReferralProgram(tid);
}

/** Native tier: the customer's code, created the first time it's asked for. */
export async function ensureReferralCode(input: {
  tenantId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
}): Promise<{ code: string; created: boolean }> {
  const tid = requireTenant(input.tenantId);
  const d = await db();
  const phone = input.customerPhone?.trim() || null;
  if (phone) {
    const [existing] = await d
      .select()
      .from(referralCodes)
      .where(and(eq(referralCodes.tenantId, tid), eq(referralCodes.customerPhone, phone)))
      .limit(1);
    if (existing) return { code: existing.code, created: false };
  }
  const taken = new Set((await d.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.tenantId, tid))).map(r => r.code));
  const code = makeReferralCode(input.customerName, taken);
  await d.insert(referralCodes).values({
    tenantId: tid,
    code,
    customerName: input.customerName.trim() || "Customer",
    customerPhone: phone,
    customerEmail: input.customerEmail?.trim() || null,
  });
  return { code, created: true };
}

/** Native tier: a new customer signed up with a code. */
export async function recordReferral(input: {
  tenantId: string;
  code: string;
  referredName: string;
  referredPhone?: string | null;
  referredEmail?: string | null;
  usedAt?: Date;
}): Promise<{ id: string }> {
  const tid = requireTenant(input.tenantId);
  const program = await getReferralProgram(tid);
  if (program.source !== "joystick") throw new Error("This business runs referrals in CleanCloud");
  if (program.mode === "off") throw new Error("Referrals are switched off for this business");
  if (!input.referredPhone?.trim() && !input.referredEmail?.trim()) {
    throw new Error("A referral needs the new customer's phone or email, so their first paid order can be matched");
  }
  const code = normalizeReferralCode(input.code);
  const d = await db();
  const [owner] = await d
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.tenantId, tid), eq(referralCodes.code, code)))
    .limit(1);
  if (!owner) throw new Error(`No customer has the code ${code}`);
  if (owner.customerPhone && owner.customerPhone === input.referredPhone?.trim()) {
    throw new Error("A customer can't refer themselves");
  }
  const id = randomUUID();
  await d.insert(referrals).values({
    id,
    tenantId: tid,
    source: "joystick",
    code,
    referrerName: owner.customerName,
    referredName: input.referredName.trim() || "New customer",
    referredPhone: input.referredPhone?.trim() || null,
    referredEmail: input.referredEmail?.trim() || null,
    usedAt: input.usedAt ?? new Date(),
  });
  return { id };
}

/**
 * CleanCloud tier: store a read of CleanCloud's Referral Code Usage window. GumballPals (reading the page) and
 * Jawbreaker (fetching it) will call this with cell rows; until they do, an operator can paste the window.
 */
export async function importCleanCloudReferralUsage(input: {
  tenantId: string;
  rows: string | readonly (readonly string[])[];
  syncedAt?: Date;
}): Promise<{ upserted: number; rejected: string[] }> {
  const tid = requireTenant(input.tenantId);
  const { rows, rejected } = parseCleanCloudReferralUsage(input.rows);
  const d = await db();
  for (const row of rows) {
    const externalKey = cleanCloudReferralKey(row);
    const values = {
      id: randomUUID(),
      tenantId: tid,
      source: "cleancloud" as const,
      externalKey,
      referrerName: row.from,
      referredName: row.to,
      usedAt: row.dateUsed,
      externalOrders: row.newCustomerOrders,
      externalSpendingCents: row.newCustomerSpendingCents,
    };
    await d
      .insert(referrals)
      .values(values)
      .onDuplicateKeyUpdate({ set: { externalOrders: values.externalOrders, externalSpendingCents: values.externalSpendingCents } });
  }
  const syncedAt = input.syncedAt ?? new Date();
  const program = await getReferralProgram(tid);
  await d
    .insert(referralPrograms)
    .values({
      tenantId: tid,
      source: program.source,
      mode: program.mode,
      referrerCreditCents: program.referrerCreditCents,
      newCustomerCreditCents: program.newCustomerCreditCents,
      cleancloudLastSyncedAt: syncedAt,
    })
    .onDuplicateKeyUpdate({ set: { cleancloudLastSyncedAt: syncedAt } });
  return { upserted: rows.length, rejected };
}

/** Native tier: the operator applied an earned credit in their POS. */
export async function markReferrerCreditApplied(input: { tenantId: string; referralId: string; actor: string }) {
  const tid = requireTenant(input.tenantId);
  await (await db())
    .update(referrals)
    .set({ referrerCreditAppliedAt: new Date(), referrerCreditAppliedBy: input.actor })
    .where(and(eq(referrals.tenantId, tid), eq(referrals.id, input.referralId), eq(referrals.source, "joystick")));
}

const LEDGER_LOOKBACK_DAYS = 365;

/** The activity table every surface reads: Claire, Small Comforts, the settings page. */
export async function getReferralActivity(tenantId: string, now: Date = new Date()) {
  const tid = requireTenant(tenantId);
  const program = await getReferralProgram(tid);
  const rows = await (await db())
    .select()
    .from(referrals)
    .where(and(eq(referrals.tenantId, tid), eq(referrals.source, program.source)))
    .orderBy(desc(referrals.usedAt))
    .limit(500);
  const records: ReferralRecord[] = rows.map(r => ({
    id: r.id,
    source: r.source,
    referrerName: r.referrerName,
    referredName: r.referredName,
    usedAt: r.usedAt,
    referredPhone: r.referredPhone,
    referredEmail: r.referredEmail,
    externalOrders: r.externalOrders,
    externalSpendingCents: r.externalSpendingCents,
    referrerCreditAppliedAt: r.referrerCreditAppliedAt,
  }));

  let paidOrders: { occurredAt: Date; cents: number; phone?: string | null; email?: string | null }[] = [];
  let ledgerNote: string | null = null;
  const native = records.filter(r => r.source === "joystick");
  if (native.length) {
    const earliest = native.reduce((min, r) => (r.usedAt < min ? r.usedAt : min), native[0]!.usedAt);
    const floor = new Date(now.getTime() - LEDGER_LOOKBACK_DAYS * 86_400_000);
    try {
      const ledger = await loadPaidOrderLedger({
        tenantId: tid,
        startUtc: earliest < floor ? floor : earliest,
        endExclusiveUtc: new Date(now.getTime() + 60_000),
        timeZone: getDashboardTimeZone(),
      });
      paidOrders = ledger.events.map(e => ({ occurredAt: e.occurredAt, cents: e.cents, phone: e.identity?.phone, email: e.identity?.email }));
    } catch (error) {
      ledgerNote = "Paid orders couldn't be read, so rewards may show as pending.";
      console.warn("[referrals] paid-order ledger unavailable", error);
    }
  }

  const activity = buildReferralActivity(records, paidOrders);
  return {
    program,
    activity,
    converted: convertedReferrals(activity).length,
    earnedUnapplied: activity.filter(a => a.referrerReward === "earned").length,
    freshness:
      program.source === "cleancloud"
        ? referralSyncFreshness(program.cleancloudLastSyncedAt ? new Date(program.cleancloudLastSyncedAt) : null, now)
        : null,
    cleancloudSetupSteps: program.source === "cleancloud" ? CLEANCLOUD_SETUP_STEPS : [],
    ledgerNote,
  };
}
