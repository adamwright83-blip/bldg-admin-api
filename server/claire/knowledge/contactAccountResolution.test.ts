import { describe, expect, it } from "vitest";
import {
  accountsFromResolution,
  resolveEntitiesToAccounts,
  speakScopedContactJudgment,
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

  it("keeps Tuesday out of the spoken name", () => {
    const spoken = speakScopedContactJudgment({
      resolved: resolveEntitiesToAccounts(["Dana"], [LOUISE])[0]!,
      temporal: ["tuesday"],
      lastContact: null,
      openFollowUp: null,
    });
    expect(spoken).toMatch(/Dana/);
    expect(spoken).toMatch(/Louise/);
    expect(spoken).toMatch(/Tuesday is the time you named/i);
    expect(spoken).not.toMatch(/Dana Tuesday/);
  });
});
