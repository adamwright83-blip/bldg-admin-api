import { describe, expect, it } from "vitest";
import { accountAspect, isAccountQuestion, matchAccounts, type AccountRef } from "./accountKnowledge";

const accounts: AccountRef[] = [
  { id: 1, name: "The Louise", accountType: "apartment", aliases: ["Dana"] },
  { id: 2, name: "OPUS LA", accountType: "gym", aliases: ["Andrew"] },
];

describe("commercial contact aliases", () => {
  it("resolves a contact name to the parent account while leaving weekday language out of the entity", () => {
    const matched = matchAccounts("what should i do about dana tuesday", accounts);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.name).toBe("The Louise");
  });

  it("recognizes account advice as account-scoped judgment", () => {
    const lower = "what should i do about dana tuesday";
    expect(isAccountQuestion(lower)).toBe(true);
    expect(accountAspect(lower)).toBe("follow_up");
  });
});
