import { describe, expect, it } from "vitest";
import {
  customerIdentityHash,
  customerIdentityHashes,
  groupCustomerRecords,
  identityCandidateKeys,
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
    const hashes = customerIdentityHashes("tenant-a", input);
    expect(hashes[0]).toBe(customerIdentityHash("tenant-a", input));
    expect(hashes).toContain(legacyCustomerIdentityHash("tenant-a", input));
    expect(identityCandidateKeys(input)).toEqual([
      "bldg-user:42",
      "email:ada@example.com",
    ]);
  });

  it("keeps history together when a later order gains a stronger identifier", () => {
    const records = [
      {
        id: 1,
        createdAt: new Date("2025-01-01T00:00:00Z"),
        firstName: "Ada",
        lastName: "L",
        unit: "4",
        address: "1 Main",
        phone: "",
        email: "ada@example.com",
        bldgUserId: null,
      },
      {
        id: 2,
        createdAt: new Date("2025-02-01T00:00:00Z"),
        firstName: "Ada",
        lastName: "L",
        unit: "4",
        address: "1 Main",
        phone: "",
        email: "ada@example.com",
        bldgUserId: 42,
      },
    ];
    const groups = groupCustomerRecords("tenant-a", records, row => row);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.records.map(row => row.id)).toEqual([1, 2]);
    expect(groups[0]?.key).toBe(customerIdentityHash("tenant-a", records[0]!));
  });

  it("joins CleanCloud history by customer id, never by display name alone", () => {
    const records = [
      {
        cleancloudCustomerId: "7",
        firstName: "Example",
        lastName: "",
        phone: "",
        email: "",
        allowNameComposite: false as const,
      },
      {
        cleancloudCustomerId: "7",
        firstName: "Renamed",
        lastName: "Person",
        phone: "",
        email: "",
        allowNameComposite: false as const,
      },
      {
        cleancloudCustomerId: "8",
        firstName: "Example",
        lastName: "",
        phone: "",
        email: "",
        allowNameComposite: false as const,
      },
    ];
    const groups = groupCustomerRecords("tenant-a", records, row => row);
    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.records.length).sort()).toEqual([1, 2]);
    expect(
      identityCandidateKeys({
        firstName: "Example",
        allowNameComposite: false,
      })
    ).toEqual([]);
  });
});
