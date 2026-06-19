import { describe, expect, it, vi } from "vitest";
import { AuthorityGrantStore } from "./authorityStore";
import { evaluateAuthority, isActive, isExpired, isRevoked, type AuthorityGrantPolicyView } from "./authorityPolicy";

const now = new Date("2026-06-19T12:00:00.000Z");
const grant = (patch: Partial<AuthorityGrantPolicyView> = {}): AuthorityGrantPolicyView => ({
  authorityType: "guest_readiness", status: "active", budgetCapCents: 30_000,
  deadlineAt: new Date("2026-06-22T12:00:00.000Z"), expiresAt: new Date("2026-06-22T12:00:00.000Z"),
  revokedAt: null, allowedRiskCategories: ["low", "medium"], disallowedCategories: [],
  accessConstraints: { allowedPatterns: ["no_entry", "resident_present"] }, ...patch,
});
const action = (patch: Record<string, unknown> = {}) => ({
  authorityType: "guest_readiness" as const, category: "flowers", spendCents: 5_000,
  scheduledAt: new Date("2026-06-20T12:00:00.000Z"), accessPattern: "no_entry" as const, ...patch,
});

describe("Guest Readiness authority policy", () => {
  it("recognizes an active authority", () => expect(isActive(grant(), now)).toBe(true));
  it("denies expired authority", () => {
    const value = grant({ expiresAt: now });
    expect(isExpired(value, now)).toBe(true);
    expect(evaluateAuthority(value, action(), now).denied).toBe(true);
  });
  it("denies revoked authority", () => {
    const value = grant({ revokedAt: new Date(now), status: "revoked" });
    expect(isRevoked(value)).toBe(true);
    expect(evaluateAuthority(value, action(), now).denied).toBe(true);
  });
  it("denies spend above the cap", () => expect(evaluateAuthority(grant(), action({ spendCents: 30_001 }), now).reasons).toContain("budget_cap_exceeded"));
  it("denies timing after the deadline", () => expect(evaluateAuthority(grant(), action({ scheduledAt: new Date("2026-06-23") }), now).reasons).toContain("deadline_exceeded"));
  it("denies a disallowed category", () => expect(evaluateAuthority(grant({ disallowedCategories: ["flowers"] }), action(), now).reasons).toContain("category_disallowed"));
  it("denies an unapproved access pattern", () => expect(evaluateAuthority(grant(), action({ accessPattern: "unattended_entry" }), now).reasons).toContain("access_pattern_denied"));
  it("allows an in-scope low-risk action", () => expect(evaluateAuthority(grant(), action(), now)).toMatchObject({ allowed: true, denied: false }));
  it("requires resident approval for medium risk", () => expect(evaluateAuthority(grant(), action({ category: "dog_grooming" }), now)).toMatchObject({ allowed: false, denied: false, residentApprovalRequired: true }));
  it("denies high risk", () => expect(evaluateAuthority(grant(), action({ category: "childcare" }), now).reasons).toContain("high_risk_excluded"));
  it("fails closed for unknown categories", () => expect(evaluateAuthority(grant(), action({ category: "invented_by_llm" }), now).reasons).toContain("unknown_category"));
  it("has no payment side effects", () => expect(JSON.stringify(evaluateAuthority(grant(), action(), now))).not.toMatch(/stripe|payment|charge|capture/i));
  it("creates append-only policy audit events", async () => {
    const execute = vi.fn().mockResolvedValue([{ insertId: 1 }, []]);
    const store = new AuthorityGrantStore({ execute } as never);
    await store.recordPolicyDecision("grant-1", evaluateAuthority(grant(), action(), now));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toContain("INSERT INTO authority_grant_audit");
    expect(execute.mock.calls[1][1][1]).toBe("attempted_use_allowed");
  });
});
