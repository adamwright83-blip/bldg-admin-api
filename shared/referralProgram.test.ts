import { describe, expect, it } from "vitest";
import {
  buildReferralActivity,
  cleanCloudReferralKey,
  convertedReferrals,
  makeReferralCode,
  normalizeReferralCode,
  parseCleanCloudReferralUsage,
  referralSyncFreshness,
  type ReferralRecord,
} from "./referralProgram";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("makeReferralCode", () => {
  it("is the first name plus three unambiguous characters", () => {
    const code = makeReferralCode("María-José", new Set(), () => 0);
    expect(code).toBe("MARIAJOS-222");
  });

  it("never reuses a taken code", () => {
    let n = 0;
    const seq = [0, 0, 0, 0.5, 0.5, 0.5];
    const code = makeReferralCode("Pat", new Set(["PAT-222"]), () => seq[n++ % seq.length]!);
    expect(code).not.toBe("PAT-222");
  });

  it("falls back to FRIEND when the name has no letters", () => {
    expect(makeReferralCode("123", new Set(), () => 0)).toBe("FRIEND-222");
  });

  it("normalizes typed codes", () => {
    expect(normalizeReferralCode(" pat-2ab ")).toBe("PAT-2AB");
  });
});

describe("buildReferralActivity, native tier", () => {
  const referral: ReferralRecord = {
    id: "r1",
    source: "joystick",
    referrerName: "Adam Wright",
    referredName: "Test",
    usedAt: day("2026-10-26"),
    referredPhone: "(310) 555-0101",
  };

  it("is pending until the new customer orders", () => {
    const [row] = buildReferralActivity([referral], []);
    expect(row).toMatchObject({ from: "Adam Wright", to: "Test", newCustomerOrders: 0, referrerReward: "pending" });
  });

  it("a free first order (FIRSTWASH) counts as an order but does not earn the referrer's credit", () => {
    const [row] = buildReferralActivity([referral], [{ occurredAt: day("2026-10-27"), cents: 0, phone: "+13105550101" }]);
    expect(row).toMatchObject({ newCustomerOrders: 1, newCustomerSpendingCents: 0, referrerReward: "pending" });
  });

  it("the first paid order earns it", () => {
    const [row] = buildReferralActivity(
      [referral],
      [
        { occurredAt: day("2026-10-27"), cents: 0, phone: "+13105550101" },
        { occurredAt: day("2026-11-03"), cents: 4200, phone: "3105550101" },
      ]
    );
    expect(row).toMatchObject({ newCustomerOrders: 2, newCustomerSpendingCents: 4200, referrerReward: "earned" });
  });

  it("ignores orders before the referral and other customers' orders", () => {
    const [row] = buildReferralActivity(
      [referral],
      [
        { occurredAt: day("2026-10-01"), cents: 5000, phone: "3105550101" },
        { occurredAt: day("2026-11-01"), cents: 5000, phone: "3105550199" },
      ]
    );
    expect(row.newCustomerOrders).toBe(0);
  });

  it("matches by email when there is no phone", () => {
    const [row] = buildReferralActivity(
      [{ ...referral, referredPhone: null, referredEmail: "Test@Example.com" }],
      [{ occurredAt: day("2026-11-01"), cents: 3500, email: "test@example.com" }]
    );
    expect(row.referrerReward).toBe("earned");
  });

  it("is applied once the operator marks the credit applied", () => {
    const [row] = buildReferralActivity(
      [{ ...referral, referrerCreditAppliedAt: day("2026-11-04") }],
      [{ occurredAt: day("2026-11-03"), cents: 4200, phone: "3105550101" }]
    );
    expect(row.referrerReward).toBe("applied");
  });
});

describe("buildReferralActivity, CleanCloud tier", () => {
  it("shows CleanCloud's own counts", () => {
    const rows = buildReferralActivity(
      [
        { id: "c1", source: "cleancloud", referrerName: "Adam Wright", referredName: "Test", usedAt: day("2026-10-26"), externalOrders: 0, externalSpendingCents: 0 },
        { id: "c2", source: "cleancloud", referrerName: "Ana", referredName: "Bo", usedAt: day("2026-10-27"), externalOrders: 2, externalSpendingCents: 7000 },
      ],
      []
    );
    expect(rows.map(r => [r.to, r.referrerReward])).toEqual([
      ["Bo", "applied"],
      ["Test", "pending"],
    ]);
    expect(convertedReferrals(rows).map(r => r.to)).toEqual(["Bo"]);
  });
});

describe("parseCleanCloudReferralUsage", () => {
  it("reads the window as Adam saw it", () => {
    const pasted = "From\tTo\tDate Used\tNew Customer Orders\tNew Customer Spending\nAdam Wright\tTest\t10/26/26\t0\t$0.00";
    const { rows, rejected } = parseCleanCloudReferralUsage(pasted);
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from: "Adam Wright", to: "Test", newCustomerOrders: 0, newCustomerSpendingCents: 0 });
    expect(rows[0]!.dateUsed.toISOString().slice(0, 10)).toBe("2026-10-26");
  });

  it("accepts cell arrays and money with commas", () => {
    const { rows } = parseCleanCloudReferralUsage([["Ana Lee", "Bo Chan", "1/5/2027", "3", "$1,204.50"]]);
    expect(rows[0]).toMatchObject({ newCustomerOrders: 3, newCustomerSpendingCents: 120450 });
  });

  it("rejects rows it can't read instead of guessing", () => {
    const { rows, rejected } = parseCleanCloudReferralUsage([["Ana", "Bo", "yesterday", "1", "$5"]]);
    expect(rows).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it("keys rows stably so a re-read updates instead of duplicating", () => {
    const a = cleanCloudReferralKey({ from: "Adam Wright", to: "Test", dateUsed: day("2026-10-26") });
    const b = cleanCloudReferralKey({ from: " adam wright", to: "TEST", dateUsed: day("2026-10-26") });
    expect(a).toBe(b);
  });
});

describe("referralSyncFreshness", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  it("never synced", () => expect(referralSyncFreshness(null, now).state).toBe("never"));
  it("fresh within a day and a half", () => expect(referralSyncFreshness(new Date("2026-10-27T12:00:00Z"), now).state).toBe("fresh"));
  it("stale after that", () => expect(referralSyncFreshness(new Date("2026-10-26T12:00:00Z"), now)).toMatchObject({ state: "stale", hoursAgo: 48 }));
});
