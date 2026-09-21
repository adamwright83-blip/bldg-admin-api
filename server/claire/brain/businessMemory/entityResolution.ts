/**
 * Contact → account resolution, from authoritative rows only.
 *
 * Perception reports that something was named. This decides what that name IS, by
 * matching it against real account rows and real contact rows. No part of this infers
 * person-vs-account from the shape of the string: a person's name can be two words
 * ("Dana Whitfield") and an account's can be one ("Louise"), so a whitespace rule is
 * wrong in both directions.
 *
 * Nothing here is hardcoded to any particular contact or account. "Dana at The Louise"
 * resolves because the rows say so, or it does not resolve at all.
 */

import { matchAccounts, type AccountContactRef, type AccountRef } from "../../knowledge/accountKnowledge";

export type EntityResolutionKind = "account" | "contact" | "ambiguous" | "unknown";

export type ResolvedEntity = {
  mention: string;
  kind: EntityResolutionKind;
  accountId: number | null;
  accountName: string | null;
  contactName: string | null;
  /** Every account a contact mention could belong to, when more than one matches. */
  candidateAccountIds: number[];
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function nameTokens(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(token => token.length >= 2);
}

/**
 * Does this mention name this contact?
 *
 * A mention matches when it is the full contact name, or when every token of the
 * mention appears in the contact's name (so "Dana" matches "Dana Whitfield", and
 * "Dana Whitfield" matches it too). Requiring containment in that direction stops a
 * bare surname collision from matching an unrelated first name.
 */
export function mentionMatchesContact(mention: string, contactName: string): boolean {
  const mentionTokens = nameTokens(mention);
  if (!mentionTokens.length) return false;
  const contactTokens = new Set(nameTokens(contactName));
  if (!contactTokens.size) return false;
  return mentionTokens.every(token => contactTokens.has(token));
}

/**
 * Resolve one mention against authoritative rows.
 *
 * Accounts are matched first because an account name is the more specific claim; a
 * mention that matches neither stays `unknown` rather than being guessed into a shape.
 */
export function resolveEntityMention(
  mention: string,
  accounts: readonly AccountRef[],
  contacts: readonly AccountContactRef[]
): ResolvedEntity {
  const base: ResolvedEntity = {
    mention,
    kind: "unknown",
    accountId: null,
    accountName: null,
    contactName: null,
    candidateAccountIds: [],
  };
  if (!mention.trim()) return base;

  const accountHits = matchAccounts(normalize(mention), [...accounts]);
  if (accountHits.length === 1) {
    return { ...base, kind: "account", accountId: accountHits[0].id, accountName: accountHits[0].name };
  }
  if (accountHits.length > 1) {
    return { ...base, kind: "ambiguous", candidateAccountIds: accountHits.map(account => account.id) };
  }

  const contactHits = contacts.filter(contact => mentionMatchesContact(mention, contact.contactName));
  if (contactHits.length === 1) {
    const hit = contactHits[0];
    return {
      ...base,
      kind: "contact",
      accountId: hit.accountId,
      accountName: hit.accountName,
      contactName: hit.contactName,
      candidateAccountIds: [hit.accountId],
    };
  }
  if (contactHits.length > 1) {
    // Same contact name at several accounts, or several people matched. Do not pick one.
    const unique = Array.from(new Set(contactHits.map(hit => hit.accountId)));
    return {
      ...base,
      kind: unique.length === 1 ? "contact" : "ambiguous",
      accountId: unique.length === 1 ? unique[0] : null,
      accountName: unique.length === 1 ? contactHits[0].accountName : null,
      contactName: unique.length === 1 ? contactHits[0].contactName : null,
      candidateAccountIds: unique,
    };
  }

  return base;
}

export function resolveEntityMentions(
  mentions: readonly string[],
  accounts: readonly AccountRef[],
  contacts: readonly AccountContactRef[]
): ResolvedEntity[] {
  return mentions.map(mention => resolveEntityMention(mention, accounts, contacts));
}

/** The one resolution worth scoping a judgment to, if any. */
export function primaryResolution(resolutions: readonly ResolvedEntity[]): ResolvedEntity | null {
  return (
    resolutions.find(entry => entry.kind === "contact") ??
    resolutions.find(entry => entry.kind === "account") ??
    resolutions.find(entry => entry.kind === "ambiguous") ??
    null
  );
}
