/**
 * JOYSTICK referrals: one feature, two tiers.
 *
 * - "cleancloud": the business checks out in CleanCloud. CleanCloud runs the referral scheme (codes, credit,
 *   payout). JOYSTICK walks the operator through switching it on and reads CleanCloud's Referral Code Usage list.
 * - "joystick": the business uses JOYSTICK's native POS. JOYSTICK is the referral system: a code per customer,
 *   a recorded referral, the new customer's credit at signup, and the referrer's credit only after the new
 *   customer's first verified paid order. Same rules as CleanCloud's "one time credit to existing and new customer".
 *
 * Everything here is pure so the rules can be tested without a database.
 */

export type ReferralSource = "cleancloud" | "joystick";
export type ReferralMode = "off" | "one_time_credit";

export type ReferralProgram = {
  tenantId: string;
  source: ReferralSource;
  mode: ReferralMode;
  referrerCreditCents: number;
  newCustomerCreditCents: number;
};

export const DEFAULT_CREDIT_CENTS = 1000;

/** The exact clicks for a CleanCloud business. Matches CleanCloud's admin as of 2026-10-26. */
export const CLEANCLOUD_SETUP_STEPS: readonly string[] = [
  "Open CleanCloud and go to Admin.",
  "Open Discounts & Promos, then Invite Codes / Referrals.",
  'Set "Allow Customers Referrals" to "Give One Time Credit to Existing and New Customer".',
  "Enter 10.00 in both credit boxes (Existing Customer and New Customer).",
  "Reload the page and check both boxes still say 10.00.",
];

export type ReferralRewardStatus =
  /** Waiting for the new customer's first verified paid order. */
  | "pending"
  /** The new customer paid; the referrer's credit is owed. */
  | "earned"
  /** The operator applied the credit (native tier), or the POS applied it (CleanCloud tier). */
  | "applied";

export type ReferralRecord = {
  id: string;
  source: ReferralSource;
  referrerName: string;
  referredName: string;
  usedAt: Date;
  /** Native tier: matched against the paid-order ledger. */
  referredPhone?: string | null;
  referredEmail?: string | null;
  /** CleanCloud tier: copied from CleanCloud's Referral Code Usage list. */
  externalOrders?: number | null;
  externalSpendingCents?: number | null;
  referrerCreditAppliedAt?: Date | null;
};

export type ReferralActivityRow = {
  id: string;
  source: ReferralSource;
  from: string;
  to: string;
  usedAt: string;
  newCustomerOrders: number;
  newCustomerSpendingCents: number;
  referrerReward: ReferralRewardStatus;
};

export type PaidOrderForReferral = {
  occurredAt: Date;
  cents: number;
  phone?: string | null;
  email?: string | null;
};

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I: they get misread off a bag card

/** A short code a person can read off a card: the first name, a dash, three characters. */
export function makeReferralCode(name: string, taken: ReadonlySet<string>, random: () => number = Math.random): string {
  const stem =
    String(name ?? "")
      .normalize("NFKD")
      .replace(/[^A-Za-z]/g, "")
      .toUpperCase()
      .slice(0, 8) || "FRIEND";
  for (let attempt = 0; attempt < 50; attempt++) {
    let tail = "";
    for (let i = 0; i < 3; i++) tail += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
    const code = `${stem}-${tail}`;
    if (!taken.has(code)) return code;
  }
  throw new Error("Could not find a free referral code");
}

export function normalizeReferralCode(value: string): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function digits(value: string | null | undefined): string {
  const d = String(value ?? "").replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

function sameCustomer(r: ReferralRecord, o: PaidOrderForReferral): boolean {
  const rp = digits(r.referredPhone);
  if (rp.length >= 10 && rp === digits(o.phone)) return true;
  const re = String(r.referredEmail ?? "").trim().toLowerCase();
  return re.includes("@") && re === String(o.email ?? "").trim().toLowerCase();
}

/**
 * The activity table (From, To, date, orders, spending) plus the referrer's reward state.
 * Native tier: orders and spending come from verified paid orders on or after the referral; the referrer's
 * credit is earned by the first one with money in it, so a free first order does not earn it.
 * CleanCloud tier: CleanCloud's own counts are shown and CleanCloud applies the credit itself.
 */
export function buildReferralActivity(
  referrals: readonly ReferralRecord[],
  paidOrders: readonly PaidOrderForReferral[]
): ReferralActivityRow[] {
  return referrals
    .map(r => {
      if (r.source === "cleancloud") {
        const orders = Math.max(0, r.externalOrders ?? 0);
        const spent = Math.max(0, r.externalSpendingCents ?? 0);
        return {
          id: r.id,
          source: r.source,
          from: r.referrerName,
          to: r.referredName,
          usedAt: r.usedAt.toISOString(),
          newCustomerOrders: orders,
          newCustomerSpendingCents: spent,
          referrerReward: spent > 0 ? ("applied" as const) : ("pending" as const),
        };
      }
      const theirs = paidOrders.filter(o => o.occurredAt >= r.usedAt && sameCustomer(r, o));
      const paid = theirs.filter(o => o.cents > 0);
      const reward: ReferralRewardStatus = r.referrerCreditAppliedAt ? "applied" : paid.length ? "earned" : "pending";
      return {
        id: r.id,
        source: r.source,
        from: r.referrerName,
        to: r.referredName,
        usedAt: r.usedAt.toISOString(),
        newCustomerOrders: theirs.length,
        newCustomerSpendingCents: paid.reduce((sum, o) => sum + o.cents, 0),
        referrerReward: reward,
      };
    })
    .sort((a, b) => b.usedAt.localeCompare(a.usedAt));
}

/** A referral only counts as a new customer once they have ordered. */
export function convertedReferrals(rows: readonly ReferralActivityRow[]): ReferralActivityRow[] {
  return rows.filter(r => r.newCustomerOrders > 0);
}

export type ReferralSyncFreshness = { state: "never" | "fresh" | "stale"; lastSyncedAt: string | null; hoursAgo: number | null };

/**
 * For CleanCloud businesses a missing referral looks exactly like no referral, so every surface shows how old the
 * copy is. Older than 36 hours (a missed daily sync and then some) is stale.
 */
export function referralSyncFreshness(lastSyncedAt: Date | null, now: Date = new Date()): ReferralSyncFreshness {
  if (!lastSyncedAt) return { state: "never", lastSyncedAt: null, hoursAgo: null };
  const hoursAgo = Math.max(0, Math.round(((now.getTime() - lastSyncedAt.getTime()) / 3_600_000) * 10) / 10);
  return { state: hoursAgo > 36 ? "stale" : "fresh", lastSyncedAt: lastSyncedAt.toISOString(), hoursAgo };
}

export type CleanCloudReferralUsageRow = {
  from: string;
  to: string;
  dateUsed: Date;
  newCustomerOrders: number;
  newCustomerSpendingCents: number;
};

function parseUsDate(value: string): Date | null {
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const d = new Date(Date.UTC(year, Number(m[1]) - 1, Number(m[2]), 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

function moneyCents(value: string): number | null {
  const n = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/**
 * Parses CleanCloud's "Referral Code Usage" table (From | To | Date Used | New Customer Orders | New Customer
 * Spending), given as rows of cell text. GumballPals and Jawbreaker will hand rows in this shape; a pasted copy of
 * the window (tab- or multi-space-separated) works too. Rows that don't parse are returned, not guessed at.
 */
export function parseCleanCloudReferralUsage(input: string | readonly (readonly string[])[]): {
  rows: CleanCloudReferralUsageRow[];
  rejected: string[];
} {
  const lines: string[][] =
    typeof input === "string"
      ? input
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .map(line => line.split(/\t|\s{2,}/).map(c => c.trim()).filter(Boolean))
      : input.map(cells => cells.map(c => String(c ?? "").trim()));
  const rows: CleanCloudReferralUsageRow[] = [];
  const rejected: string[] = [];
  for (const cells of lines) {
    if (/^from$/i.test(cells[0] ?? "")) continue; // the header row
    if (cells.length < 5) {
      rejected.push(cells.join(" | "));
      continue;
    }
    const [from, to, date, orders, spending] = cells.slice(-5) as [string, string, string, string, string];
    const dateUsed = parseUsDate(date);
    const count = Number(orders);
    const cents = moneyCents(spending);
    if (!from || !to || !dateUsed || !Number.isInteger(count) || count < 0 || cents == null) {
      rejected.push(cells.join(" | "));
      continue;
    }
    rows.push({ from, to, dateUsed, newCustomerOrders: count, newCustomerSpendingCents: cents });
  }
  return { rows, rejected };
}

/** Stable identity for a CleanCloud usage row, so re-reading the window updates instead of duplicating. */
export function cleanCloudReferralKey(row: Pick<CleanCloudReferralUsageRow, "from" | "to" | "dateUsed">): string {
  return `cc:${row.from.trim().toLowerCase()}|${row.to.trim().toLowerCase()}|${row.dateUsed.toISOString().slice(0, 10)}`;
}

// ── Native tier: store credit at checkout ─────────────────────────────
export const STRIPE_MIN_CHARGE_CENTS = 50;

export type CreditRedemptionPlan = {
  /** Credit taken off this order. */
  creditUsedCents: number;
  /** What the customer's card is charged. */
  chargeCents: number;
  /** The platform's fee on this charge. */
  applicationFeeCents: number;
  /** The cleaner's payout: unchanged by credit. */
  vendorPayoutCents: number;
};

/**
 * Referral credit is a platform marketing cost, so it comes out of the platform's fee, never the cleaner's payout:
 * charge = price − credit, fee = original fee − credit, payout unchanged. Credit beyond the fee (or below Stripe's
 * $0.50 minimum charge) stays in the wallet for the next order.
 */
export function planCreditRedemption(input: {
  amountCents: number;
  platformFeeCents: number;
  availableCreditCents: number;
}): CreditRedemptionPlan {
  const amount = Math.max(0, Math.round(input.amountCents));
  const fee = Math.min(amount, Math.max(0, Math.round(input.platformFeeCents)));
  const available = Math.max(0, Math.round(input.availableCreditCents));
  const creditUsedCents = Math.max(0, Math.min(available, fee, amount - STRIPE_MIN_CHARGE_CENTS));
  const chargeCents = amount - creditUsedCents;
  const applicationFeeCents = fee - creditUsedCents;
  return { creditUsedCents, chargeCents, applicationFeeCents, vendorPayoutCents: chargeCents - applicationFeeCents };
}

/** Phone numbers compared as their last ten digits (US). */
export function referralPhoneKey(value: string | null | undefined): string | null {
  const d = String(value ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? ten : null;
}

// ── CleanCloud tier: the Referral Code Usage window as Jawbreaker fetches it ──
function htmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#36;|&dollar;/gi, "$")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The window's content arrives either as an HTML table or as JSON. Returns cell rows for
 * `parseCleanCloudReferralUsage`; anything unrecognised returns no rows rather than a guess.
 */
export function referralUsageCellsFromResponse(body: string): string[][] {
  const text = String(body ?? "").trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      const list: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray((parsed as any)?.data) ? (parsed as any).data : [];
      return list
        .map(item => {
          if (Array.isArray(item)) return item.map(v => String(v ?? ""));
          const o = item as Record<string, unknown>;
          const pick = (...keys: string[]) => String(keys.map(k => o?.[k]).find(v => v != null) ?? "");
          return [
            pick("from", "From", "referrer", "referrerName"),
            pick("to", "To", "referred", "customerName"),
            pick("dateUsed", "Date Used", "date", "date_used"),
            pick("newCustomerOrders", "New Customer Orders", "orders"),
            pick("newCustomerSpending", "New Customer Spending", "spending"),
          ];
        })
        .filter(cells => cells.some(Boolean));
    } catch {
      return [];
    }
  }
  const rows: string[][] = [];
  for (const tr of text.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) ?? []).map(htmlText);
    if (cells.length) rows.push(cells);
  }
  return rows;
}
