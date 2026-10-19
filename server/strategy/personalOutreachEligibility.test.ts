import { describe, expect, it } from "vitest";
import { evaluateDormantOutreach } from "./dormantOutreachGate";
import {
  evaluatePersonalOutreach,
  messageOffersStopOption,
} from "./personalOutreachEligibility";

const TODAY = "2026-10-16";
const STOP = "Hey Mei. Reply STOP if you don't want these texts.";

function personal(overrides: Partial<Parameters<typeof evaluatePersonalOutreach>[0]> = {}) {
  return evaluatePersonalOutreach({
    tenantId: "tenant_test",
    freshness: "current",
    sourceReadable: true,
    matched: true,
    inTerritory: true,
    paidOrders: 3,
    capturedCents: 5400,
    lastOrderDate: "2026-08-17",
    dormant: true,
    contradictingRecentOrder: false,
    phoneDigits: "3105550141",
    optedOut: false,
    contactRestricted: false,
    permissionReadable: true,
    lastOutreachOn: null,
    today: TODAY,
    approvedMessage: STOP,
    ...overrides,
  });
}

function marketing(permission: "opted_in" | "opted_out" | "expired" | "unknown") {
  return evaluateDormantOutreach({
    tenantId: "tenant_test",
    freshness: "current",
    matched: true,
    inTerritory: true,
    paidOrders: 3,
    capturedCents: 5400,
    lastOrderDate: "2026-08-17",
    dormant: true,
    contradictingRecentOrder: false,
    phoneDigits: "3105550141",
    permission,
    permissionReadable: true,
    lastOutreachOn: null,
    today: TODAY,
  });
}

describe("personal outreach versus the marketing SMS gate", () => {
  it("allows a paid relationship with a stop line and no marketing opt-in", () => {
    const handoff = personal();
    expect(handoff.eligible).toBe(true);
    expect(handoff.blocks).toEqual([]);
    expect(marketing("unknown").eligible).toBe(false);
    expect(marketing("unknown").blocks).toContain("sms_consent_absent");
    expect(marketing("opted_in").eligible).toBe(true);
  });

  it("never bypasses a recorded opt-out, restriction, or cooldown", () => {
    expect(personal({ optedOut: true }).blocks).toContain("opted_out");
    expect(personal({ optedOut: true }).explanation).toMatch(/never bypassed/);
    expect(personal({ contactRestricted: true }).blocks).toContain("contact_restricted");
    expect(personal({ lastOutreachOn: "2026-10-10" }).blocks).toContain("outreach_frequency");
    expect(personal({ contradictingRecentOrder: true }).blocks).toContain("recent_order");
    expect(personal({ contradictingRecentOrder: true }).eligible).toBe(false);
    expect(personal({ permissionReadable: false }).blocks).toContain("permission_unreadable");
  });

  it("does not treat a phone number or an inquiry as an existing relationship", () => {
    const phoneOnly = personal({
      paidOrders: 0,
      capturedCents: 0,
      lastOrderDate: null,
    });
    expect(phoneOnly.eligible).toBe(false);
    expect(phoneOnly.blocks).toContain("no_paid_history");
    expect(phoneOnly.explanation).toMatch(/phone number alone is not an existing business relationship/i);
    expect(phoneOnly.blocks.join(" ")).not.toMatch(/sms_consent/);
  });

  it("keeps the 18-month purchase window and does not add the 3-month inquiry prong", () => {
    expect(personal({ lastOrderDate: "2025-04-16" }).eligible).toBe(true);
    const lapsed = personal({ lastOrderDate: "2025-04-15" });
    expect(lapsed.blocks).toContain("relationship_lapsed");
    expect(lapsed.eligible).toBe(false);
  });

  it("blocks a stale or unreadable book and does not call that an empty village", () => {
    const stale = personal({ freshness: "stale" });
    expect(stale.blocks).toContain("freshness_not_current");
    expect(stale.explanation).toMatch(/not proof that nobody is inactive/i);
    const unreadable = personal({ sourceReadable: false, freshness: "source_unavailable" });
    expect(unreadable.blocks).toContain("source_unreadable");
    expect(unreadable.explanation).toMatch(/not proof that nobody is inactive/i);
  });

  it("requires the approved text to offer a way not to receive further texts", () => {
    expect(messageOffersStopOption(STOP)).toBe(true);
    expect(personal({ approvedMessage: "Hey Mei, we can pick up laundry this week." }).blocks).toContain(
      "stop_option_missing"
    );
    expect(personal({ approvedMessage: undefined }).eligible).toBe(true);
  });
});
