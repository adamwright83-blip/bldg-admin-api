import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WIN_BACK_COOLDOWN_DAYS } from "./dormantOutreachGate";
import {
  SILVER_LAKE_AREA_TERMS,
  SilverLakeEligibilityProductionRefusal,
  evaluateSilverLakeEligibility,
  type SilverLakeEligibilityInput,
} from "./silverLakeEligibility";

/** Existing disposable proof identity. Not a live customer name. */
const PROOF_PHONE_KEY = "phone:3105550141";

function proofDigits(): string {
  return PROOF_PHONE_KEY.slice("phone:".length);
}

function ready(overrides: Partial<SilverLakeEligibilityInput> = {}): SilverLakeEligibilityInput {
  return {
    tenantId: "proof-tenant",
    freshness: "current",
    matched: true,
    paidOrders: 3,
    capturedCents: 5400,
    lastOrderDate: "2026-06-01",
    dormant: true,
    contradictingRecentOrder: false,
    phoneDigits: proofDigits(),
    permission: {
      channel: "sms",
      purpose: "win_back_marketing",
      state: "opted_in",
      readable: true,
    },
    lastOutreachOn: null,
    today: "2026-10-15",
    addressText: "2418 Silver Lake Blvd, Los Angeles, CA 90039",
    ...overrides,
  };
}

describe("Silver Lake eligibility predicate", () => {
  it("accepts disposable facts that meet every gate", () => {
    expect(WIN_BACK_COOLDOWN_DAYS).toBe(14);
    expect(proofDigits()).toBe("3105550141");
    expect(proofDigits()).toHaveLength(10);
    expect(SILVER_LAKE_AREA_TERMS).toEqual(["Silver Lake", "90026", "90039"]);
    expect(evaluateSilverLakeEligibility(ready())).toEqual({ eligible: true, blocks: [] });
    expect(
      evaluateSilverLakeEligibility(
        ready({ lastOutreachOn: "2026-10-01", addressText: "90039" })
      ).eligible
    ).toBe(true);
  });

  it("requires a tenant, paid history, dormancy, a 10-digit phone, and the area", () => {
    expect(evaluateSilverLakeEligibility(ready({ tenantId: "  " })).blocks).toContain(
      "tenant_missing"
    );
    expect(evaluateSilverLakeEligibility(ready({ paidOrders: 0 })).blocks).toContain(
      "no_paid_history"
    );
    expect(evaluateSilverLakeEligibility(ready({ capturedCents: 0 })).blocks).toContain(
      "no_paid_history"
    );
    expect(evaluateSilverLakeEligibility(ready({ dormant: false })).blocks).toContain(
      "not_dormant"
    );
    expect(
      evaluateSilverLakeEligibility(ready({ contradictingRecentOrder: true })).blocks
    ).toContain("recent_order");
    expect(evaluateSilverLakeEligibility(ready({ phoneDigits: "310555014" })).blocks).toContain(
      "phone_missing"
    );
    expect(evaluateSilverLakeEligibility(ready({ phoneDigits: null })).blocks).toContain(
      "phone_missing"
    );
    expect(
      evaluateSilverLakeEligibility(
        ready({ addressText: "1850 N Vermont Ave, Los Angeles, CA 90027" })
      ).blocks
    ).toContain("outside_territory");
  });

  it("requires opted-in sms win_back_marketing and does not treat a phone as consent", () => {
    const phoneOnly = evaluateSilverLakeEligibility(
      ready({
        permission: {
          channel: "sms",
          purpose: "win_back_marketing",
          state: "unknown",
          readable: true,
        },
      })
    );
    expect(phoneOnly.eligible).toBe(false);
    expect(phoneOnly.blocks).toContain("sms_consent_absent");

    expect(
      evaluateSilverLakeEligibility(
        ready({
          permission: {
            channel: "sms",
            purpose: "win_back_marketing",
            state: "opted_out",
            readable: true,
          },
        })
      ).blocks
    ).toContain("opted_out");

    expect(
      evaluateSilverLakeEligibility(
        ready({
          permission: {
            channel: "email",
            purpose: "win_back_marketing",
            state: "opted_in",
            readable: true,
          },
        })
      ).blocks
    ).toContain("sms_consent_absent");

    expect(
      evaluateSilverLakeEligibility(
        ready({
          permission: {
            channel: "sms",
            purpose: "transactional",
            state: "opted_in",
            readable: true,
          },
        })
      ).blocks
    ).toContain("sms_consent_absent");

    expect(
      evaluateSilverLakeEligibility(
        ready({
          permission: {
            channel: "sms",
            purpose: "win_back_marketing",
            state: "opted_in",
            readable: false,
          },
        })
      ).blocks
    ).toContain("permission_unreadable");
  });

  it("blocks outreach inside the 14-day cooldown and a book that is not current", () => {
    expect(
      evaluateSilverLakeEligibility(ready({ lastOutreachOn: "2026-10-02" })).blocks
    ).toContain("outreach_frequency");
    expect(
      evaluateSilverLakeEligibility(ready({ freshness: "import_failed" })).blocks
    ).toContain("freshness_not_current");
    expect(evaluateSilverLakeEligibility(ready({ freshness: "stale" })).eligible).toBe(false);
  });

  it("refuses to run when NODE_ENV is production", () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => evaluateSilverLakeEligibility(ready())).toThrow(
        SilverLakeEligibilityProductionRefusal
      );
      expect(() => evaluateSilverLakeEligibility(ready())).toThrow(/production/);
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  it("does not read a database or name a customer", () => {
    const source = readFileSync(new URL("./silverLakeEligibility.ts", import.meta.url), "utf8");
    expect(source).not.toContain("getDb");
    expect(source).not.toContain("DATABASE_URL");
    expect(source).not.toContain("customerName");
    expect(source).not.toContain("communication_permissions");
    expect(source).toContain('process.env.NODE_ENV === "production"');
    expect(source).toContain('purpose === "win_back_marketing"');
    const result = evaluateSilverLakeEligibility(ready());
    expect(JSON.stringify(result)).not.toMatch(/3105550141|Mei|Lin/);
  });
});
