/**
 * Identity comes from rows, not from string shape.
 *
 * The removed heuristic read a one-word mention as a person and a multi-word mention as
 * an account. Both directions are wrong in practice, so these tests deliberately cover
 * all four shapes: one-word contact, multi-word contact, one-word account, multi-word
 * account. Nothing here is hardcoded to a particular contact or account.
 */

import { describe, expect, it } from "vitest";
import { primaryResolution, resolveEntityMention } from "../businessMemory/entityResolution";
import { perceiveTurn } from "../perception/perceive";
import type { AccountContactRef, AccountRef } from "../../knowledge/accountKnowledge";

const ACCOUNTS: AccountRef[] = [
  { id: 1, name: "The Louise", accountType: "property" },
  { id: 2, name: "Ravenswood", accountType: "property" },
  { id: 3, name: "Century Park East", accountType: "property" },
];

function contact(accountId: number, accountName: string, contactName: string): AccountContactRef {
  return { accountId, accountName, accountType: "property", contactName, title: null, relationshipType: "primary" };
}

const CONTACTS: AccountContactRef[] = [
  contact(1, "The Louise", "Dana"),
  contact(2, "Ravenswood", "Marcus Bell"),
  contact(3, "Century Park East", "Priya Raman"),
];

describe("all four name shapes resolve from rows", () => {
  it("one-word CONTACT resolves to a contact, not an account", () => {
    const resolved = resolveEntityMention("Dana", ACCOUNTS, CONTACTS);
    expect(resolved.kind).toBe("contact");
    expect(resolved.contactName).toBe("Dana");
    expect(resolved.accountName).toBe("The Louise");
  });

  it("multi-word CONTACT resolves to a contact, not an account", () => {
    // The old heuristic would have called this an account purely for having a space.
    const resolved = resolveEntityMention("Marcus Bell", ACCOUNTS, CONTACTS);
    expect(resolved.kind).toBe("contact");
    expect(resolved.contactName).toBe("Marcus Bell");
    expect(resolved.accountId).toBe(2);
  });

  it("one-word ACCOUNT resolves to an account, not a contact", () => {
    // The old heuristic would have called this a person purely for having no space.
    const resolved = resolveEntityMention("Ravenswood", ACCOUNTS, CONTACTS);
    expect(resolved.kind).toBe("account");
    expect(resolved.accountId).toBe(2);
    expect(resolved.contactName).toBeNull();
  });

  it("multi-word ACCOUNT resolves to an account", () => {
    const resolved = resolveEntityMention("Century Park East", ACCOUNTS, CONTACTS);
    expect(resolved.kind).toBe("account");
    expect(resolved.accountId).toBe(3);
  });

  it("a first name alone matches a multi-word contact", () => {
    expect(resolveEntityMention("Marcus", ACCOUNTS, CONTACTS).accountId).toBe(2);
  });
});

describe("resolution refuses to guess", () => {
  it("an unknown mention stays unknown rather than becoming a contact", () => {
    const resolved = resolveEntityMention("Winterbourne", ACCOUNTS, CONTACTS);
    expect(resolved.kind).toBe("unknown");
    expect(resolved.accountId).toBeNull();
  });

  it("the same contact name at two accounts is ambiguous, not arbitrarily picked", () => {
    const duplicated = [...CONTACTS, contact(3, "Century Park East", "Dana")];
    const resolved = resolveEntityMention("Dana", ACCOUNTS, duplicated);
    expect(resolved.kind).toBe("ambiguous");
    expect(resolved.accountId).toBeNull();
    expect(resolved.candidateAccountIds.sort()).toEqual([1, 3]);
  });

  it("an empty mention resolves to nothing", () => {
    expect(resolveEntityMention("  ", ACCOUNTS, CONTACTS).kind).toBe("unknown");
  });

  it("a contact is preferred as the judgment subject over a bare account", () => {
    const resolutions = [
      resolveEntityMention("The Louise", ACCOUNTS, CONTACTS),
      resolveEntityMention("Dana", ACCOUNTS, CONTACTS),
    ];
    expect(primaryResolution(resolutions)?.kind).toBe("contact");
  });
});

describe("Perception reports mentions without deciding what they are", () => {
  it("emits entity mentions, never a contact/account verdict", () => {
    const perceived = perceiveTurn({ rawText: "What should I do about Dana Tuesday?", completeness: "complete" });
    const kinds = new Set(perceived.entities.map(entity => entity.kind));
    expect(kinds.has("entity_mention")).toBe(true);
    // The contract no longer even has a shape for a perception-level identity guess.
    expect([...kinds].every(kind => kind === "entity_mention" || kind === "temporal")).toBe(true);
  });

  it("still separates a weekday from the name beside it", () => {
    const perceived = perceiveTurn({ rawText: "What should I do about Dana Tuesday?", completeness: "complete" });
    expect(perceived.temporalReferences).toContain("tuesday");
    expect(
      perceived.entities.some(entity => entity.kind === "entity_mention" && /tuesday/i.test(entity.raw))
    ).toBe(false);
  });
});
