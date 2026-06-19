import { describe, expect, it } from "vitest";
import type { AuthorityGrantPolicyView } from "../procurement/authorityPolicy";
import type { ProviderAcceptancePolicyView } from "../procurement/providerAcceptancePolicy";
import {
  evaluateMarketplaceAuthorization,
  evaluateMarketplaceCapture,
  type AuthorizationState,
} from "./marketplacePaymentPolicy";

const now = new Date("2026-06-19T12:00:00.000Z");

const authority = (patch: Partial<AuthorityGrantPolicyView> = {}): AuthorityGrantPolicyView => ({
  authorityType: "guest_readiness",
  status: "active",
  budgetCapCents: 30_000,
  deadlineAt: new Date("2026-06-22T12:00:00.000Z"),
  expiresAt: new Date("2026-06-22T12:00:00.000Z"),
  revokedAt: null,
  allowedRiskCategories: ["low", "medium"],
  disallowedCategories: [],
  accessConstraints: { allowedPatterns: ["no_entry", "resident_present"] },
  ...patch,
});

const action = (patch: Partial<{
  category: string; spendCents: number; scheduledAt: Date; accessPattern: "no_entry" | "resident_present" | "building_or_operator_approved" | "unattended_entry";
}> = {}) => ({
  authorityType: "guest_readiness" as const,
  category: "flowers",
  spendCents: 5_000,
  scheduledAt: new Date("2026-06-20T12:00:00.000Z"),
  accessPattern: "no_entry" as const,
  ...patch,
});

describe("Marketplace authorization gate", () => {
  it("allows authorization for an active grant within budget", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority(), action: action(), residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(true);
    expect(result.state).toBe("authorization_required");
  });

  it("returns no_payment_required for a zero-amount item", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority(), action: action({ spendCents: 0 }), residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(true);
    expect(result.state).toBe("no_payment_required");
  });

  it("denies an authorization when authority is not active (revoked)", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority({ status: "revoked", revokedAt: now }), action: action(),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("authority_not_active");
    expect(result.state).toBe("cancelled");
  });

  it("denies an authorization when authority is expired", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority({ expiresAt: new Date("2026-06-18T00:00:00.000Z") }), action: action(),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("authority_not_active");
  });

  it("denies an authorization over budget", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority({ budgetCapCents: 1_000 }), action: action({ spendCents: 5_000 }),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("budget_cap_exceeded");
  });

  it("denies an authorization for an unsupported category", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority(), action: action({ category: "llm_invented" }),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("unknown_category");
  });

  it("denies an authorization for a high-risk/prohibited category", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority(), action: action({ category: "childcare" }),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("high_risk_excluded");
  });

  it("denies an authorization for an explicitly disallowed category", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority({ disallowedCategories: ["flowers"] }), action: action(),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("category_disallowed");
  });

  it("denies an authorization when an unknown amount is supplied", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority(), action: action({ spendCents: Number.NaN }),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("amount_unknown");
  });

  it("requires resident approval for medium-risk categories and denies without it", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority(), action: action({ category: "dog_grooming" }),
      residentApprovalGranted: false, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("resident_approval_required");
  });

  it("allows a medium-risk category once resident approval is granted", () => {
    const result = evaluateMarketplaceAuthorization({
      authority: authority(), action: action({ category: "dog_grooming" }),
      residentApprovalGranted: true, now,
    });
    expect(result.allowed).toBe(true);
  });
});

const acceptance = (patch: Partial<ProviderAcceptancePolicyView> = {}): ProviderAcceptancePolicyView => ({
  acceptanceType: "provider_accepted",
  acceptanceStatus: "accepted",
  expiresAt: new Date("2026-06-21T12:00:00.000Z"),
  serviceWindowStart: new Date("2026-06-20T10:00:00.000Z"),
  serviceWindowEnd: new Date("2026-06-20T12:00:00.000Z"),
  acceptedPriceCents: 5_000,
  ...patch,
});

const planDeadlineAt = new Date("2026-06-22T12:00:00.000Z");
const budgetCapCents = 30_000;

describe("Marketplace capture gate", () => {
  it("allows capture when authorization is authorized and provider acceptance is current", () => {
    const result = evaluateMarketplaceCapture({
      authorizationState: "authorized", acceptance: acceptance(), budgetCapCents, planDeadlineAt, now,
    });
    expect(result.allowed).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it.each<AuthorizationState>(["no_payment_required", "authorization_required", "authorization_pending", "cancelled"])(
    "denies capture when authorization state is %s",
    state => {
      const result = evaluateMarketplaceCapture({
        authorizationState: state, acceptance: acceptance(), budgetCapCents, planDeadlineAt, now,
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons).toContain("authorization_not_in_authorized_state");
    },
  );

  it("denies capture without provider acceptance or verified booking", () => {
    const result = evaluateMarketplaceCapture({
      authorizationState: "authorized", acceptance: acceptance({ acceptanceStatus: "offered" }),
      budgetCapCents, planDeadlineAt, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("denies capture when acceptance is declined", () => {
    const result = evaluateMarketplaceCapture({
      authorizationState: "authorized", acceptance: acceptance({ acceptanceStatus: "declined" }),
      budgetCapCents, planDeadlineAt, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("acceptance_declined");
  });

  it("denies capture when acceptance is expired", () => {
    const result = evaluateMarketplaceCapture({
      authorizationState: "authorized",
      acceptance: acceptance({ expiresAt: new Date("2026-06-18T00:00:00.000Z") }),
      budgetCapCents, planDeadlineAt, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("acceptance_expired");
  });

  it("denies capture when accepted price exceeds budget", () => {
    const result = evaluateMarketplaceCapture({
      authorizationState: "authorized", acceptance: acceptance({ acceptedPriceCents: 31_000 }),
      budgetCapCents, planDeadlineAt, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("accepted_price_over_budget");
  });

  it("denies capture when service window is after the plan deadline", () => {
    const result = evaluateMarketplaceCapture({
      authorizationState: "authorized",
      acceptance: acceptance({ serviceWindowEnd: new Date("2026-06-23T12:00:00.000Z") }),
      budgetCapCents, planDeadlineAt, now,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("service_window_after_deadline");
  });

  it("allows capture for an operator_verified booking when all constraints pass", () => {
    const result = evaluateMarketplaceCapture({
      authorizationState: "authorized",
      acceptance: acceptance({ acceptanceType: "operator_verified", acceptanceStatus: "operator_verified" }),
      budgetCapCents, planDeadlineAt, now,
    });
    expect(result.allowed).toBe(true);
  });
});
