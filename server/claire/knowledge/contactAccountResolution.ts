/**
 * Reusable contact → account resolution.
 *
 * "Dana" is a person. "The Louise" is an account. A weekday is neither.
 * When Goldline already knows Dana as a contact on The Louise, Claire must
 * resolve that link from authoritative contact rows — not by searching the
 * paid-order ledger for a customer named "Dana Tuesday", and not by special-
 * casing this pair.
 */

import type { AccountRef } from "./accountKnowledge";

export type AccountContact = { name: string | null; title?: string | null };

export type AccountWithContacts = AccountRef & { contacts?: AccountContact[] };

export type ContactAccountLink = {
  contactName: string;
  title: string | null;
  account: AccountRef;
};

export type ResolvedEntity = {
  mentioned: string;
  kind: "contact" | "account" | "unresolved";
  contactName: string | null;
  account: AccountRef | null;
  title: string | null;
};

function normalizePerson(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return normalizePerson(value)
    .split(/\s+/)
    .filter(token => token.length >= 2);
}

function namesMatch(mentioned: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const want = normalizePerson(mentioned);
  const have = normalizePerson(candidate);
  if (!want || !have) return false;
  if (want === have) return true;
  const wantTokens = tokens(mentioned);
  const haveTokens = tokens(candidate);
  if (wantTokens.length === 1) return haveTokens.includes(wantTokens[0]!);
  return wantTokens.every(token => haveTokens.includes(token));
}

export function contactLinksFromAccounts(accounts: AccountWithContacts[]): ContactAccountLink[] {
  const links: ContactAccountLink[] = [];
  for (const account of accounts) {
    for (const contact of account.contacts ?? []) {
      if (!contact.name?.trim()) continue;
      links.push({
        contactName: contact.name.trim(),
        title: contact.title ?? null,
        account: { id: account.id, name: account.name, accountType: account.accountType },
      });
    }
  }
  return links;
}

export function resolveEntitiesToAccounts(
  mentioned: string[],
  accounts: AccountWithContacts[],
  links: ContactAccountLink[] = contactLinksFromAccounts(accounts)
): ResolvedEntity[] {
  return mentioned.map(name => {
    const accountHits = accounts.filter(account => namesMatch(name, account.name));
    if (accountHits.length === 1) {
      return {
        mentioned: name,
        kind: "account" as const,
        contactName: null,
        account: { id: accountHits[0]!.id, name: accountHits[0]!.name, accountType: accountHits[0]!.accountType },
        title: null,
      };
    }
    const contactHits = links.filter(link => namesMatch(name, link.contactName));
    const uniqueAccounts = new Map(contactHits.map(link => [link.account.id, link]));
    if (uniqueAccounts.size === 1) {
      const hit = contactHits[0]!;
      return {
        mentioned: name,
        kind: "contact" as const,
        contactName: hit.contactName,
        account: hit.account,
        title: hit.title,
      };
    }
    return { mentioned: name, kind: "unresolved" as const, contactName: null, account: null, title: null };
  });
}

export function accountsFromResolution(resolved: ResolvedEntity[]): AccountRef[] {
  const unique = new Map<number, AccountRef>();
  for (const item of resolved) {
    if (item.account) unique.set(item.account.id, item.account);
  }
  return [...unique.values()];
}

export function resolvedContactNames(resolved: ResolvedEntity[]): Set<string> {
  return new Set(
    resolved
      .filter(item => item.kind === "contact" && item.contactName)
      .map(item => item.contactName!.toLowerCase())
  );
}

/**
 * A judgment/advice question about a known contact is not a paid-order
 * customer lookup. Temporal tokens stay out of the name.
 */
export function speakScopedContactJudgment(input: {
  resolved: ResolvedEntity;
  temporal: string[];
  lastContact?: string | null;
  openFollowUp?: string | null;
}): string {
  const { resolved, temporal, lastContact, openFollowUp } = input;
  const accountName = resolved.account?.name ?? "that account";
  const who =
    resolved.kind === "contact"
      ? `${resolved.contactName}${resolved.title ? `, ${resolved.title}` : ""} at ${accountName}`
      : accountName;
  const when = temporal[0] ? ` ${temporal[0]!.replace(/\b\w/g, letter => letter.toUpperCase())}` : "";
  const parts = [`${who} is on file.`];
  if (lastContact) parts.push(lastContact);
  if (openFollowUp) parts.push(openFollowUp);
  if (when) parts.push(`${when.trim()} is the time you named — not a person.`);
  parts.push("That's the file. I won't change anything unless you ask me to.");
  return parts.join(" ");
}
