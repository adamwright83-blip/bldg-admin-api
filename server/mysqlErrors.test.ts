import { describe, expect, it } from "vitest";
import { isMysqlDuplicateKeyError, isMysqlMissingTableError } from "./mysqlErrors";

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

describe("MySQL missing-table recovery", () => {
  it("recognizes direct and Drizzle-wrapped missing tables", () => {
    expect(isMysqlMissingTableError({ code: "ER_NO_SUCH_TABLE", errno: 1146 })).toBe(
      true
    );
    expect(
      isMysqlMissingTableError({
        message: "Failed query",
        cause: { code: "ER_NO_SUCH_TABLE", errno: 1146 },
      })
    ).toBe(true);
    expect(
      isMysqlMissingTableError(
        new Error("Table 'dayforge_release.claire_relationship_events' doesn't exist")
      )
    ).toBe(true);
  });

  it("does not treat unrelated errors as missing tables", () => {
    expect(isMysqlMissingTableError(new Error("connection closed"))).toBe(false);
    expect(isMysqlDuplicateKeyError({ code: "ER_NO_SUCH_TABLE" })).toBe(false);
  });
});
