import { describe, expect, it } from "vitest";
import {
  accountsFromResolution,
  composeScopedBusinessJudgment,
  resolveEntitiesToAccounts,
} from "./contactAccountResolution";

const LOUISE = {
  id: 11,
  name: "The Louise",
  accountType: "luxury_hotel",
  contacts: [{ name: "Dana", title: "General Manager" }],
};
const MAYBOURNE = {
  id: 12,
  name: "Maybourne",
  accountType: "luxury_hotel",
  contacts: [{ name: "Priya", title: "Director of Rooms" }],
};

describe("contact → account resolution", () => {
  it("resolves Dana to The Louise without special-casing the pair", () => {
    const resolved = resolveEntitiesToAccounts(["Dana"], [LOUISE, MAYBOURNE]);
    expect(resolved[0]).toMatchObject({ kind: "contact", contactName: "Dana", account: { name: "The Louise" } });
    expect(accountsFromResolution(resolved)[0]?.name).toBe("The Louise");
  });

  it("resolves a different contact on a different account the same way", () => {
    const resolved = resolveEntitiesToAccounts(["Priya"], [LOUISE, MAYBOURNE]);
    expect(resolved[0]?.account?.name).toBe("Maybourne");
  });

  it("does not invent an account for an unknown person", () => {
    const resolved = resolveEntitiesToAccounts(["Marcus"], [LOUISE, MAYBOURNE]);
    expect(resolved[0]?.kind).toBe("unresolved");
  });

  it("recommends from account state instead of dumping the file", () => {
    const composed = composeScopedBusinessJudgment({
      resolved: resolveEntitiesToAccounts(["Dana"], [LOUISE])[0]!,
      temporal: ["tuesday"],
      lastContact: { at: "2026-09-10T18:00:00.000Z", what: "you checked in on site" },
      openFollowUp: {
        dueAt: "2026-09-22T17:00:00.000Z",
        note: "Bring the revised rate card and confirm Tuesday access",
        status: "open",
      },
      today: "2026-09-20",
    });
    expect(composed.facts.some(fact => /Dana/.test(fact.text) && /Louise/.test(fact.text))).toBe(true);
    expect(composed.judgment).toMatch(/rate card|follow-up|Tuesday/i);
    expect(composed.judgment).toMatch(/will not|won't/i);
    expect(composed.judgment).not.toMatch(/Dana Tuesday/);
  });
});
