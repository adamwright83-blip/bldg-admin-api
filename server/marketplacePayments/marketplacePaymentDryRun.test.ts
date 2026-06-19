import { afterEach, describe, expect, it } from "vitest";
import type { AuthorityGrantPolicyView } from "../procurement/authorityPolicy";
import type { ProviderAcceptancePolicyView } from "../procurement/providerAcceptancePolicy";
import { reportActivationFlags, runMarketplacePaymentDryRun } from "./marketplacePaymentDryRun";

const ORIGINAL_ENABLED = process.env.MARKETPLACE_PAYMENTS_ENABLED;
const ORIGINAL_WORKER_ENABLED = process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;
const ORIGINAL_SECRET = process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_WORKER_ENABLED === undefined) delete process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;
  else process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED = ORIGINAL_WORKER_ENABLED;
  if (ORIGINAL_SECRET === undefined) delete process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;
  else process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

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
  category: string; spendCents: number; scheduledAt: Date;
  accessPattern: "no_entry" | "resident_present" | "building_or_operator_approved" | "unattended_entry";
}> = {}) => ({
  authorityType: "guest_readiness" as const,
  category: "flowers",
  spendCents: 5_000,
  scheduledAt: new Date("2026-06-20T12:00:00.000Z"),
  accessPattern: "no_entry" as const,
  ...patch,
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

describe("reportActivationFlags", () => {
  it("reports all flags unset/off and live Stripe blocked by default", () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    delete process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED;
    delete process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;
    const flags = reportActivationFlags();
    expect(flags).toEqual({
      marketplacePaymentsEnabled: false,
      marketplacePaymentsWorkerEnabled: false,
      webhookSecretConfigured: false,
      liveStripeBlocked: true,
      webhookIntakeBlocked: true,
    });
  });

  it("reports webhookIntakeBlocked even with the payments flag on, if the webhook secret is missing", () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    delete process.env.MARKETPLACE_STRIPE_WEBHOOK_SECRET;
    const flags = reportActivationFlags();
    expect(flags.liveStripeBlocked).toBe(false);
    expect(flags.webhookIntakeBlocked).toBe(true);
  });
});

describe("runMarketplacePaymentDryRun", () => {
  it("returns not_evaluated when no scenario is supplied at all", () => {
    const report = runMarketplacePaymentDryRun({});
    expect(report.overallStatus).toBe("not_evaluated");
    expect(report.authorization.evaluated).toBe(false);
    expect(report.capture.evaluated).toBe(false);
    expect(report.missingGates).toEqual([]);
  });

  it("denies capture without provider acceptance or verified booking", () => {
    const report = runMarketplacePaymentDryRun({
      capture: {
        authorizationState: "authorized",
        acceptance: acceptance({ acceptanceStatus: "offered" }),
        budgetCapCents: 30_000,
        planDeadlineAt: new Date("2026-06-22T12:00:00.000Z"),
        now,
      },
    });
    expect(report.capture.decision?.allowed).toBe(false);
    expect(report.overallStatus).toBe("blocked_by_policy");
    expect(report.missingGates.length).toBeGreaterThan(0);
  });

  it("denies capture unless the authorization is in the authorized state", () => {
    const report = runMarketplacePaymentDryRun({
      capture: {
        authorizationState: "authorization_pending",
        acceptance: acceptance(),
        budgetCapCents: 30_000,
        planDeadlineAt: new Date("2026-06-22T12:00:00.000Z"),
        now,
      },
    });
    expect(report.capture.decision?.allowed).toBe(false);
    expect(report.capture.decision?.reasons).toContain("authorization_not_in_authorized_state");
    expect(report.overallStatus).toBe("blocked_by_policy");
  });

  it("reports blocked_by_flags when every policy gate passes but live Stripe is still off", () => {
    delete process.env.MARKETPLACE_PAYMENTS_ENABLED;
    const report = runMarketplacePaymentDryRun({
      authorization: { authority: authority(), action: action(), residentApprovalGranted: false, now },
      capture: {
        authorizationState: "authorized", acceptance: acceptance(),
        budgetCapCents: 30_000, planDeadlineAt: new Date("2026-06-22T12:00:00.000Z"), now,
      },
    });
    expect(report.authorization.decision?.allowed).toBe(true);
    expect(report.capture.decision?.allowed).toBe(true);
    expect(report.flags.liveStripeBlocked).toBe(true);
    expect(report.overallStatus).toBe("blocked_by_flags");
  });

  it("reports ready only when every gate passes and the live-payments flag is on", () => {
    process.env.MARKETPLACE_PAYMENTS_ENABLED = "true";
    const report = runMarketplacePaymentDryRun({
      authorization: { authority: authority(), action: action(), residentApprovalGranted: false, now },
      capture: {
        authorizationState: "authorized", acceptance: acceptance(),
        budgetCapCents: 30_000, planDeadlineAt: new Date("2026-06-22T12:00:00.000Z"), now,
      },
    });
    expect(report.overallStatus).toBe("ready");
  });

  it("aggregates missing gates across both authorization and capture without duplicates", () => {
    const report = runMarketplacePaymentDryRun({
      authorization: {
        authority: authority({ status: "revoked", revokedAt: now }), action: action(),
        residentApprovalGranted: false, now,
      },
      capture: {
        authorizationState: "authorization_pending", acceptance: acceptance({ acceptanceStatus: "declined" }),
        budgetCapCents: 30_000, planDeadlineAt: new Date("2026-06-22T12:00:00.000Z"), now,
      },
    });
    expect(report.missingGates).toContain("authority_not_active");
    expect(report.missingGates).toContain("authorization_not_in_authorized_state");
    expect(report.missingGates).toContain("acceptance_declined");
    expect(new Set(report.missingGates).size).toBe(report.missingGates.length);
  });
});

describe("Slice 9 production-safety invariants", () => {
  it("the dry-run module never imports a store, pool, the orchestrator, or Stripe", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "marketplacePaymentDryRun.ts"), "utf8");
    const importLines = source.split("\n").filter(line => line.trim().startsWith("import"));
    expect(importLines.join("\n")).not.toMatch(
      /MarketplacePaymentStore|MarketplacePaymentOrchestrator|ProcurementWorkflowStore|createProcurementPool|["']stripe["']/,
    );
  });

  it("the dry-run module never calls Stripe's constructEvent or any live-call adapter function", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(path.resolve(__dirname, "marketplacePaymentDryRun.ts"), "utf8");
    expect(source).not.toMatch(/constructEvent|createAuthorizationPaymentIntent|captureAuthorizedPaymentIntent|createVendorTransfer|createWorkflowWithStep/);
  });
});
