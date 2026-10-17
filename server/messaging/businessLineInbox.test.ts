import { describe, expect, it } from "vitest";
import { businessLineRecipientOptOutState, inboundId } from "./businessLineInbox";

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
