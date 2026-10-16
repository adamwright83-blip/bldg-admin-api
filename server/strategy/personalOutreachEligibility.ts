/**
 * Operator-initiated personal outreach.
 *
 * This is a manual, one-to-one text from the operator's own phone. It is not
 * an automated campaign and it does not call Twilio. Opening the handset
 * conversation is not a send.
 *
 * California Business and Professions Code §17538.41(a)(1) says no person or
 * entity conducting business in this state shall transmit, or cause to be
 * transmitted, a text message advertisement, except as provided in (b), (c),
 * (d), or (e). A text message advertisement is a message whose principal
 * purpose is to promote the sale of goods or services.
 *
 * §17538.41(c): "This section shall not apply to text messages transmitted by
 * a business, candidate, or political committee that has an existing
 * relationship with the subscriber if the subscriber is offered an option not
 * to receive text messages from that business, candidate, or political
 * committee."
 *
 * The statute does not define "existing relationship" and does not say a
 * phone number is one. This rule treats a recorded paid transaction as the
 * relationship, and only while that purchase is inside the 18-month window
 * in 47 CFR 64.1200(f)(5) for an established business relationship based on
 * a purchase or transaction. It does not add the 3-month inquiry prong.
 *
 * That relationship is not prior express written consent for an autodialed
 * or prerecorded telemarketing text. 47 USC 227(b)(1)(A) and 47 CFR
 * 64.1200(a)(2) still govern the automated path. 47 CFR 64.1200(f)(5)(i)
 * says a seller-specific do-not-call request terminates the relationship for
 * solicitation. 47 CFR 64.1200(a)(10) says consent, once revoked, stays
 * revoked. An opt-out is never bypassed.
 */
import { DEFAULT_DOCTRINE } from "../../shared/claireProactive";
import type { CustomerTruthDisposition } from "../analytics/sourceCoverage";

/** Eighteen calendar months. Matches 47 CFR 64.1200(f)(5)'s purchase window. */
export const PERSONAL_RELATIONSHIP_MONTHS = 18;

export const PERSONAL_OUTREACH_COOLDOWN_DAYS = DEFAULT_DOCTRINE.outreachCooldownDays;

export type PersonalOutreachBlock =
  | "tenant_missing"
  | "freshness_not_current"
  | "source_unreadable"
  | "unmatched_identity"
  | "outside_territory"
  | "no_paid_history"
  | "relationship_lapsed"
  | "unknown_last_order"
  | "not_dormant"
  | "recent_order"
  | "phone_missing"
  | "opted_out"
  | "contact_restricted"
  | "outreach_frequency"
  | "permission_unreadable"
  | "stop_option_missing";

export type PersonalOutreachDecision = {
  eligible: boolean;
  blocks: PersonalOutreachBlock[];
  explanation: string;
};

const BLOCK_SENTENCE: Record<PersonalOutreachBlock, string> = {
  tenant_missing: "This operator has no tenant, so the handoff is blocked.",
  freshness_not_current:
    "CleanCloud customer truth is not current. This person is not shown as contactable. Missing customers are not proof that nobody is inactive.",
  source_unreadable:
    "CleanCloud customer truth could not be read. Outreach is blocked. Missing customers are not proof that nobody is inactive.",
  unmatched_identity:
    "This person is not a verified customer in the current book. A phone number is not an existing relationship. A missing customer is not proof that nobody is inactive.",
  outside_territory: "This customer is outside the objective area.",
  no_paid_history:
    "There is no recorded paid transaction with this person. A phone number alone is not an existing business relationship.",
  relationship_lapsed:
    "The last recorded purchase is outside the 18-month purchase window. That is not treated as a current existing relationship.",
  unknown_last_order: "The last paid order date could not be read, so the relationship cannot be checked.",
  not_dormant: "This customer is not inactive, so this recovery handoff is blocked.",
  recent_order: "A recent order conflicts with this recovery handoff.",
  phone_missing: "A verified 10-digit phone is missing. A phone number on a partial record is not a relationship.",
  opted_out: "A recorded opt-out blocks this handoff. An opt-out is never bypassed.",
  contact_restricted: "A contact restriction blocks this handoff.",
  outreach_frequency: "An earlier outreach is still inside the cooldown, so this handoff is blocked.",
  permission_unreadable:
    "Opt-out and contact-restriction records could not be read. The handoff is blocked so an opt-out cannot be missed.",
  stop_option_missing:
    "The approved message does not offer a way to not receive further texts. The handoff stays closed until it does.",
};

/** §17538.41(c) requires an option not to receive further texts from this business. */
export function messageOffersStopOption(body: string): boolean {
  return /\b(reply\s+stop|text\s+stop|opt[\s-]?out|unsubscribe)\b/i.test(body);
}

export function addCalendarMonths(ymd: string, months: number): string {
  const [year, month, day] = ymd.slice(0, 10).split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, (month ?? 1) - 1 + months, day ?? 1));
  return shifted.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year!, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

export function explainPersonalOutreachBlocks(
  blocks: readonly PersonalOutreachBlock[],
  freshness?: CustomerTruthDisposition
): string {
  if (blocks.length === 0) return "";
  const sentences = blocks.map(block => {
    if (block === "freshness_not_current" && freshness && freshness !== "current") {
      return `CleanCloud customer truth is ${freshness}. Personalized outreach is withheld until the book is current. Missing customers are not proof that nobody is inactive.`;
    }
    return BLOCK_SENTENCE[block];
  });
  return sentences.join(" ");
}

export function evaluatePersonalOutreach(input: {
  tenantId: string;
  freshness: CustomerTruthDisposition;
  sourceReadable: boolean;
  matched: boolean;
  inTerritory: boolean;
  paidOrders: number;
  capturedCents: number;
  lastOrderDate: string | null;
  dormant: boolean;
  contradictingRecentOrder: boolean;
  phoneDigits: string | null;
  /** Recorded opt-out on SMS or a do-not-contact flag. Never optional. */
  optedOut: boolean;
  contactRestricted: boolean;
  /** False when the opt-out store could not be read. Absence of a row is not this. */
  permissionReadable: boolean;
  lastOutreachOn: string | null;
  today: string;
  cooldownDays?: number;
  /**
   * When set, the approved text must offer a way not to receive further texts.
   * Omit it when only deciding whether the person may be presented.
   */
  approvedMessage?: string | null;
}): PersonalOutreachDecision {
  const blocks: PersonalOutreachBlock[] = [];
  if (!input.sourceReadable) blocks.push("source_unreadable");
  if (!input.tenantId.trim()) blocks.push("tenant_missing");
  if (input.freshness !== "current") blocks.push("freshness_not_current");
  if (!input.matched) blocks.push("unmatched_identity");
  if (!input.inTerritory) blocks.push("outside_territory");
  if (input.paidOrders < 1 || input.capturedCents <= 0) blocks.push("no_paid_history");
  if (!input.lastOrderDate) blocks.push("unknown_last_order");
  else if (addCalendarMonths(input.lastOrderDate, PERSONAL_RELATIONSHIP_MONTHS) < input.today) {
    blocks.push("relationship_lapsed");
  }
  if (!input.dormant) blocks.push("not_dormant");
  if (input.contradictingRecentOrder) blocks.push("recent_order");
  if (!input.phoneDigits || input.phoneDigits.length !== 10) blocks.push("phone_missing");
  if (!input.permissionReadable) blocks.push("permission_unreadable");
  if (input.optedOut) blocks.push("opted_out");
  if (input.contactRestricted) blocks.push("contact_restricted");
  if (input.lastOutreachOn) {
    const cooldownUntil = addDays(
      input.lastOutreachOn.slice(0, 10),
      input.cooldownDays ?? PERSONAL_OUTREACH_COOLDOWN_DAYS
    );
    if (cooldownUntil > input.today) blocks.push("outreach_frequency");
  }
  if (input.approvedMessage !== undefined && input.approvedMessage !== null) {
    if (!messageOffersStopOption(input.approvedMessage)) blocks.push("stop_option_missing");
  }
  return {
    eligible: blocks.length === 0,
    blocks,
    explanation: explainPersonalOutreachBlocks(blocks, input.freshness),
  };
}
