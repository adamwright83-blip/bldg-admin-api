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

export type ScopedJudgmentFact = {
  text: string;
  evidence: { source: string; reader: string };
};

export type ScopedBusinessJudgment = {
  facts: ScopedJudgmentFact[];
  judgment: string;
  accountId: number | null;
  contactName: string | null;
};

function capitalizeDay(value: string): string {
  return value.replace(/\b\w/g, letter => letter.toUpperCase());
}

function quoteNote(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 137).replace(/\s+\S*$/, "")}…` : trimmed;
}

/**
 * Advice for a known contact, grounded in account-history evidence.
 * Recommends a next move. Does not schedule, mutate, or invent global board work.
 */
export function composeScopedBusinessJudgment(input: {
  resolved: ResolvedEntity;
  temporal: string[];
  lastContact?: { at: string; what: string } | null;
  openFollowUp?: { dueAt: string; note: string; status: string } | null;
  today?: string;
}): ScopedBusinessJudgment {
  const { resolved, temporal, lastContact, openFollowUp, today } = input;
  const accountName = resolved.account?.name ?? "that account";
  const who =
    resolved.kind === "contact"
      ? `${resolved.contactName}${resolved.title ? `, ${resolved.title}` : ""} at ${accountName}`
      : accountName;
  const namedDay = temporal[0] ? capitalizeDay(temporal[0]!) : null;
  const facts: ScopedJudgmentFact[] = [
    {
      text: `${who} is on file.`,
      evidence: { source: "commercial_account_contacts", reader: "contact_account_resolution" },
    },
  ];
  if (lastContact) {
    facts.push({
      text: `Last recorded contact: ${lastContact.what}.`,
      evidence: { source: "account_history.last_contact", reader: "account_history" },
    });
  }
  if (openFollowUp) {
    const dueDay = openFollowUp.dueAt.slice(0, 10);
    const dueLabel = today && dueDay === today ? "today" : dueDay;
    facts.push({
      text: openFollowUp.note
        ? `An open follow-up is due ${dueLabel}: ${quoteNote(openFollowUp.note)}.`
        : `An open follow-up is due ${dueLabel}.`,
      evidence: { source: "commercial_follow_ups", reader: "account_history" },
    });
  }

  let judgment: string;
  if (openFollowUp && namedDay) {
    const dueDay = openFollowUp.dueAt.slice(0, 10);
    const sameWindow = today ? dueDay === today : false;
    const note = openFollowUp.note ? ` Use that window to ${quoteNote(openFollowUp.note).replace(/\.$/, "")}.` : "";
    judgment = sameWindow
      ? `I'd spend ${namedDay} finishing the follow-up already on file for ${who}, not opening a new thread.${note} I can recommend that; I will not schedule or move anything unless you ask.`
      : `I'd treat ${namedDay} as the day to work the existing follow-up for ${who} (due ${dueDay}), rather than starting something new.${note} That's the next move I'd make. I will not put it on the Day Line unless you ask.`;
  } else if (openFollowUp) {
    const note = openFollowUp.note ? ` The open item is: ${quoteNote(openFollowUp.note)}.` : "";
    judgment = `I'd work the open follow-up already on file for ${who} before inventing a new touch.${note} I won't change the Day Line unless you ask.`;
  } else if (lastContact && namedDay) {
    judgment = `There's no open follow-up after that last contact, so I'd use ${namedDay} for a check-in with ${who} and decide the next step from what you hear. I will not book or schedule it unless you ask.`;
  } else if (namedDay) {
    judgment = `Nothing is queued for ${who}, so if ${namedDay} is the window you have, I'd use it for a first-touch call and then decide from the conversation. I will not change anything unless you ask.`;
  } else if (lastContact) {
    judgment = `I'd follow the last recorded contact with ${who} rather than wait for a new prompt — there's no open follow-up behind it. Tell me if you want that on the Day Line.`;
  } else {
    judgment = `I don't have a recorded next step for ${who}, so I would not invent one. If you want a call or visit, say so and I'll propose it — I won't create the work myself.`;
  }

  return {
    facts,
    judgment,
    accountId: resolved.account?.id ?? null,
    contactName: resolved.kind === "contact" ? resolved.contactName : null,
  };
}

/** @deprecated Prefer composeScopedBusinessJudgment — kept as a rendered convenience. */
export function speakScopedContactJudgment(input: {
  resolved: ResolvedEntity;
  temporal: string[];
  lastContact?: string | null;
  openFollowUp?: string | null;
}): string {
  const composed = composeScopedBusinessJudgment({
    resolved: input.resolved,
    temporal: input.temporal,
    lastContact: input.lastContact ? { at: "", what: input.lastContact.replace(/^Last recorded contact:\s*/i, "").replace(/\.$/, "") } : null,
    openFollowUp: input.openFollowUp ? { dueAt: "2099-01-01", note: "", status: "open" } : null,
  });
  return [...composed.facts.map(fact => fact.text), composed.judgment].join(" ");
}
