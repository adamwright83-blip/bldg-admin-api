import { describe, expect, it } from "vitest";
import {
  customerIdentityHash,
  customerIdentityHashes,
  legacyCustomerIdentityHash,
  rawCustomerIdentityKey,
} from "./customerIdentity";

describe("customer asset identity", () => {
  it("uses normalized phone when it is trustworthy", () => {
    expect(
      rawCustomerIdentityKey({
        phone: "+1 (415) 555-1212",
        firstName: "A",
      })
    ).toBe("phone:4155551212");
  });

  it("uses a deterministic composite without merging ambiguous records", () => {
    const a = customerIdentityHash("tenant-a", {
      firstName: "Ada",
      lastName: "L",
      unit: "4",
      address: "1 Main",
    });
    const b = customerIdentityHash("tenant-a", {
      firstName: "Ada",
      lastName: "L",
      unit: "5",
      address: "1 Main",
    });
    expect(a).not.toBe(b);
    expect(a).not.toBe(
      customerIdentityHash("tenant-b", {
        firstName: "Ada",
        lastName: "L",
        unit: "4",
        address: "1 Main",
      })
    );
  });

  it("keeps the persisted composite churn key as a compatibility candidate", () => {
    const input = {
      phone: "",
      email: "ada@example.com",
      bldgUserId: 42,
      firstName: "Ada",
      lastName: "L",
      unit: "4",
      address: "1 Main",
    };
    expect(customerIdentityHash("tenant-a", input)).not.toBe(
      legacyCustomerIdentityHash("tenant-a", input)
    );
    expect(customerIdentityHashes("tenant-a", input)).toEqual([
      customerIdentityHash("tenant-a", input),
      legacyCustomerIdentityHash("tenant-a", input),
    ]);
  });
});
