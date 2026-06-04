import { describe, expect, it } from "vitest";
import { normalizePhoneForStorage, sameNormalizedPhone } from "./phone";

describe("phone normalization", () => {
  it("normalizes common US phone formats to the same stored value", () => {
    expect(normalizePhoneForStorage("(323) 807-4661")).toBe("+13238074661");
    expect(normalizePhoneForStorage("3238074661")).toBe("+13238074661");
    expect(normalizePhoneForStorage("+1 323 807 4661")).toBe("+13238074661");
    expect(sameNormalizedPhone("+13238074661", "323-807-4661")).toBe(true);
  });

  it("rejects unusably short phone values", () => {
    expect(normalizePhoneForStorage("123")).toBeNull();
  });
});
