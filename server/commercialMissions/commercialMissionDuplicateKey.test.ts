import { describe, expect, it } from "vitest";
import { isDuplicateKeyError } from "./commercialMissionStore";

describe("commercial mission duplicate-key recovery", () => {
  it("recognizes direct and Drizzle-wrapped MySQL duplicate errors", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY", errno: 1062 })).toBe(true);
    expect(
      isDuplicateKeyError({
        message: "Failed query",
        cause: { code: "ER_DUP_ENTRY", errno: 1062 },
      })
    ).toBe(true);
  });

  it("does not turn unrelated or unbounded cause chains into replays", () => {
    expect(isDuplicateKeyError(new Error("connection closed"))).toBe(false);
    expect(
      isDuplicateKeyError({
        cause: { cause: { cause: { cause: { cause: { errno: 1062 } } } } },
      })
    ).toBe(false);
  });
});
