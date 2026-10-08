/* LEGACY DAYFORGE COMPATIBILITY: retained historical literals only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isPlatformAdministrator,
  tenantForAuthenticatedUser,
} from "../platform/tenancy/tenantIdentity";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("SaaS Slice 1 tenant admission certification", () => {
  it("binds SaaS members to persisted tenant and refuses client tenant override", () => {
    const bound = tenantForAuthenticatedUser({
      user: {
        openId: "dayforge:member-a",
        role: "user",
        tenantId: "tenant-a",
      },
      hostTenantId: "default",
      requestedTenantId: "tenant-b",
    });
    expect(bound).toEqual({
      tenantId: "tenant-a",
      authority: "membership",
      denial: "cross_tenant",
    });
  });

  it("does not manufacture default for a SaaS session missing persisted tenant", () => {
    const bound = tenantForAuthenticatedUser({
      user: {
        openId: "dayforge:member-missing",
        role: "user",
        tenantId: null,
      },
      hostTenantId: "default",
    });
    expect(bound.tenantId).toBe("__invalid_saas_session__");
    expect(bound.denial).toBe("invalid_saas_session");
  });

  it("keeps legacy shared-password host scope distinct from SaaS membership", () => {
    const bound = tenantForAuthenticatedUser({
      user: {
        openId: "admin-owner",
        role: "admin",
        tenantId: null,
      },
      hostTenantId: "default",
    });
    expect(bound).toEqual({
      tenantId: "default",
      authority: "legacy_platform",
      denial: null,
    });
    expect(
      isPlatformAdministrator({ openId: "admin-owner", role: "admin" })
    ).toBe(false);
  });

  it("keeps explicit platform administration separate from tenant-local membership", () => {
    expect(
      isPlatformAdministrator({
        openId: "oauth-platform-admin",
        role: "admin",
      })
    ).toBe(true);
    expect(
      isPlatformAdministrator({
        openId: "dayforge:member-a",
        role: "admin",
      })
    ).toBe(true);
  });

  it("constructs request tenant from authenticated identity rather than request body", () => {
    const context = source("../_core/context.ts");
    expect(context).toContain("tenantForAuthenticatedUser");
    expect(context).toContain("user?.tenantId?.trim()");
    expect(context).toContain('"__invalid_saas_session__"');
    expect(context).not.toContain("req.body?.tenantId");
    expect(context).not.toContain("req.query.tenantId");
  });

  it("takes authenticated SaaS tenant operations from ctx rather than caller input", () => {
    const router = source("./saasRouter.ts");
    expect(router).toContain("tenantId: ctx.tenantId");
    expect(router).toContain("listTenantMembers(ctx.tenantId)");
    expect(router).toContain("getTenantConfiguration(ctx.tenantId)");
    expect(router).not.toMatch(/importCsv:[\s\S]{0,900}tenantId:\s*input\./);
    expect(router).not.toMatch(/billingPortal:[\s\S]{0,500}tenantId:\s*input\./);
  });

  it("admits Stripe billing ingress only after signature verification and durable onboarding binding", () => {
    const billing = source("./saasBilling.ts");
    const webhook = source("./saasBillingWebhookRoute.ts");
    expect(webhook).toContain("rawBody: req.body");
    expect(webhook).toContain('req.headers["stripe-signature"]');
    expect(webhook).not.toContain("req.body.tenantId");
    expect(billing).toContain("stripe.webhooks.constructEvent");
    expect(billing).toContain("legacyDayforgeOnboardingSessionId");
    expect(billing).toContain("provisionTenantFromSubscription");
    expect(billing).not.toMatch(/tenantId:\s*metadata\./);
  });

  it("keeps the known tenantless CleanCloud legacy importer outside SaaS admission", () => {
    const legacy = source("../integrations/cleancloud/cleancloudLegacy.ts");
    expect(legacy).toContain("cleancloudLegacyOrders");
    expect(legacy).not.toContain("legacyDayforgeSaas");
    expect(legacy).not.toContain("tenantForAuthenticatedUser");
  });
});
