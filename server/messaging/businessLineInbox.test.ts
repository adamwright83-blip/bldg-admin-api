import { describe, expect, it } from "vitest";
import { businessLineRecipientOptOutState, enforceSmsOptOut, inboundId, phoneOptOutState } from "./businessLineInbox";

describe("business line STOP check fails closed", () => {
  it("refuses when the database is not configured", async () => {
    expect(await businessLineRecipientOptOutState("+18885550199", "3235550101", { getDb: async () => null })).toBe("unavailable");
  });

  it("refuses when the database cannot be reached", async () => {
    const getDb = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await businessLineRecipientOptOutState("+18885550199", "3235550101", { getDb })).toBe("unavailable");
  });

  it("refuses when the opt-out query fails", async () => {
    const db = {
      select: () => {
        throw new Error("Table doesn't exist");
      },
    };
    expect(
      await businessLineRecipientOptOutState("+18885550199", "3235550101", { getDb: async () => db as never })
    ).toBe("unavailable");
  });
});

describe("inbound message ids", () => {
  it("are fixed-length and distinct for near-limit tenant ids with similar MessageSids", () => {
    const tenant = "t".repeat(64);
    const a = inboundId(tenant, "SM1234567890abcdef1234567890abcdef");
    const b = inboundId(tenant, "SM1234567890abcdef1234567890abcdee");
    expect(a).not.toBe(b);
    expect(a.length).toBe(68);
    expect(inboundId("a", "b:c")).not.toBe(inboundId("a:b", "c"));
  });
});

describe("phone-keyed opt-out check fails closed", () => {
  it("refuses when the database is missing, unreachable or failing", async () => {
    expect(await phoneOptOutState("default", "3235550101", { getDb: async () => null })).toBe("unavailable");
    expect(
      await phoneOptOutState("default", "3235550101", {
        getDb: async () => {
          throw new Error("ECONNREFUSED");
        },
      })
    ).toBe("unavailable");
    const failing = { select: () => { throw new Error("boom"); } };
    expect(await phoneOptOutState("default", "3235550101", { getDb: async () => failing as never })).toBe("unavailable");
  });
});

describe("enforceSmsOptOut", () => {
  function fakeDb(readBackStatus: string | undefined) {
    const chain = {
      values: () => chain,
      onDuplicateKeyUpdate: async () => undefined,
      from: () => chain,
      where: () => chain,
      limit: async () => (readBackStatus ? [{ status: readBackStatus }] : []),
    };
    return { insert: () => chain, select: () => chain } as never;
  }
  const base = {
    tenantId: "default",
    phone: "3235550101",
    customerSubjectIds: ["cust_1"],
    channels: ["sms", "any"] as const,
    sourceReference: "test",
    capturedAt: new Date("2026-10-17T00:00:00.000Z"),
    recordedBy: "test",
  };

  it("is true only when every store reads back opted_out", async () => {
    expect(await enforceSmsOptOut(fakeDb("opted_out"), base)).toBe(true);
    expect(await enforceSmsOptOut(fakeDb("opted_in"), base)).toBe(false);
    expect(await enforceSmsOptOut(fakeDb(undefined), base)).toBe(false);
  });

  it("refuses when there is nothing to key the opt-out on", async () => {
    expect(await enforceSmsOptOut(fakeDb("opted_out"), { ...base, phone: null, customerSubjectIds: [] })).toBe(false);
  });
});
