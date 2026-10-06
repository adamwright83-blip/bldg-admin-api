import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { residentOrderReuseMatchesAuthority } from "./db";

describe("resident order idempotency authority", () => {
  const incoming = {
    tenantId: "tenant-a",
    bldgUserId: 42,
    phone: "+13235550123",
  };

  it("allows reuse only for the same tenant and resident owner", () => {
    expect(
      residentOrderReuseMatchesAuthority(incoming as never, {
        tenantId: "tenant-a",
        bldgUserId: 42,
        phone: "+13235550123",
      } as never)
    ).toBe(true);

    expect(
      residentOrderReuseMatchesAuthority(incoming as never, {
        tenantId: "tenant-b",
        bldgUserId: 42,
        phone: "+13235550123",
      } as never)
    ).toBe(false);

    expect(
      residentOrderReuseMatchesAuthority(incoming as never, {
        tenantId: "tenant-a",
        bldgUserId: 99,
        phone: "+13235550123",
      } as never)
    ).toBe(false);
  });

  it("does not fall back to phone when an authenticated resident id is present", () => {
    expect(
      residentOrderReuseMatchesAuthority(incoming as never, {
        tenantId: "tenant-a",
        bldgUserId: null,
        phone: "+13235550123",
      } as never)
    ).toBe(false);
  });

  it("preserves legacy phone reuse only when the incoming order has no resident id", () => {
    expect(
      residentOrderReuseMatchesAuthority(
        {
          tenantId: "default",
          bldgUserId: null,
          phone: "(323) 555-0123",
        } as never,
        {
          tenantId: null,
          bldgUserId: null,
          phone: "+1 323 555 0123",
        } as never
      )
    ).toBe(true);
  });

  it("guards both the fast-path reuse and duplicate-key race recovery", () => {
    const source = readFileSync(
      new URL("./db.ts", import.meta.url),
      "utf8"
    );
    const uses =
      source.match(/residentOrderReuseMatchesAuthority\(order, (?:existing|raced)\)/g) ??
      [];
    expect(uses).toHaveLength(2);
    expect(source).toContain(
      "Resident idempotency key belongs to a different tenant or resident"
    );
  });
});
