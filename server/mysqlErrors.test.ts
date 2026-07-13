import { describe, expect, it } from "vitest";
import { isMysqlDuplicateKeyError } from "./mysqlErrors";

describe("MySQL duplicate-key recovery", () => {
  it("recognizes direct and Drizzle-wrapped duplicate errors", () => {
    expect(isMysqlDuplicateKeyError({ code: "ER_DUP_ENTRY", errno: 1062 })).toBe(
      true
    );
    expect(
      isMysqlDuplicateKeyError({
        message: "Failed query",
        cause: { code: "ER_DUP_ENTRY", errno: 1062 },
      })
    ).toBe(true);
    expect(isMysqlDuplicateKeyError(new Error("Duplicate entry for key"))).toBe(
      true
    );
  });

  it("does not turn unrelated or unbounded cause chains into replays", () => {
    expect(isMysqlDuplicateKeyError(new Error("connection closed"))).toBe(false);
    expect(
      isMysqlDuplicateKeyError({
        cause: { cause: { cause: { cause: { cause: { errno: 1062 } } } } },
      })
    ).toBe(false);
  });
});
