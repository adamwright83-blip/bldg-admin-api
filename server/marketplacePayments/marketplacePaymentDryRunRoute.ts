import type express from "express";
import { z } from "zod";
import type { AuthorityAction, AuthorityGrantPolicyView } from "../procurement/authorityPolicy";
import type { ProviderAcceptancePolicyView } from "../procurement/providerAcceptancePolicy";
import { assertAdminOrAgent, handleError } from "./marketplacePaymentInternalRoute";
import { runMarketplacePaymentDryRun } from "./marketplacePaymentDryRun";

const accessPatternSchema = z.enum([
  "no_entry", "resident_present", "building_or_operator_approved", "unattended_entry",
]);

const authorityViewSchema = z.object({
  authorityType: z.literal("guest_readiness"),
  status: z.enum(["draft", "signed", "active", "revoked", "expired"]),
  budgetCapCents: z.number().int(),
  deadlineAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable(),
  allowedRiskCategories: z.array(z.enum(["low", "medium", "high"])),
  disallowedCategories: z.array(z.string()),
  accessConstraints: z.object({ allowedPatterns: z.array(accessPatternSchema) }),
});

const actionSchema = z.object({
  authorityType: z.literal("guest_readiness"),
  category: z.string(),
  spendCents: z.number(),
  scheduledAt: z.string(),
  accessPattern: accessPatternSchema,
});

const acceptanceViewSchema = z.object({
  acceptanceType: z.enum(["provider_accepted", "verified_existing_booking", "operator_verified"]),
  acceptanceStatus: z.enum([
    "draft", "offered", "accepted", "declined", "countered", "expired", "cancelled", "operator_verified",
  ]),
  expiresAt: z.string().nullable(),
  serviceWindowStart: z.string().nullable(),
  serviceWindowEnd: z.string().nullable(),
  acceptedPriceCents: z.number().nullable(),
});

function toAuthorityView(input: z.infer<typeof authorityViewSchema>): AuthorityGrantPolicyView {
  return {
    authorityType: input.authorityType,
    status: input.status,
    budgetCapCents: input.budgetCapCents,
    deadlineAt: new Date(input.deadlineAt),
    expiresAt: new Date(input.expiresAt),
    revokedAt: input.revokedAt ? new Date(input.revokedAt) : null,
    allowedRiskCategories: input.allowedRiskCategories,
    disallowedCategories: input.disallowedCategories,
    accessConstraints: input.accessConstraints,
  };
}

function toAction(input: z.infer<typeof actionSchema>): AuthorityAction {
  return {
    authorityType: input.authorityType,
    category: input.category,
    spendCents: input.spendCents,
    scheduledAt: new Date(input.scheduledAt),
    accessPattern: input.accessPattern,
  };
}

function toAcceptanceView(input: z.infer<typeof acceptanceViewSchema>): ProviderAcceptancePolicyView {
  return {
    acceptanceType: input.acceptanceType,
    acceptanceStatus: input.acceptanceStatus,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    serviceWindowStart: input.serviceWindowStart ? new Date(input.serviceWindowStart) : null,
    serviceWindowEnd: input.serviceWindowEnd ? new Date(input.serviceWindowEnd) : null,
    acceptedPriceCents: input.acceptedPriceCents,
  };
}

const dryRunBodySchema = z.object({
  authorization: z.object({
    authority: authorityViewSchema,
    action: actionSchema,
    residentApprovalGranted: z.boolean(),
  }).optional(),
  capture: z.object({
    authorizationState: z.enum([
      "no_payment_required", "authorization_required", "authorization_pending", "authorized", "cancelled",
    ]),
    acceptance: acceptanceViewSchema,
    budgetCapCents: z.number().int(),
    planDeadlineAt: z.string(),
  }).optional(),
});

/**
 * Internal/admin-only end-to-end dry run across the marketplace payment
 * spine. Read/evaluate-only: this route calls only
 * `runMarketplacePaymentDryRun`/`reportActivationFlags`, neither of which
 * touches a database, calls Stripe, processes a webhook, or enqueues a
 * workflow step — see marketplacePaymentDryRun.ts. There is no DB-writing
 * code path in this route at all.
 */
export function registerMarketplacePaymentDryRunRoutes(app: express.Express) {
  app.post("/api/internal/marketplace-payments/dry-run", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const body = dryRunBodySchema.parse(req.body ?? {});
      const report = runMarketplacePaymentDryRun({
        authorization: body.authorization
          ? {
              authority: toAuthorityView(body.authorization.authority),
              action: toAction(body.authorization.action),
              residentApprovalGranted: body.authorization.residentApprovalGranted,
            }
          : undefined,
        capture: body.capture
          ? {
              authorizationState: body.capture.authorizationState,
              acceptance: toAcceptanceView(body.capture.acceptance),
              budgetCapCents: body.capture.budgetCapCents,
              planDeadlineAt: new Date(body.capture.planDeadlineAt),
            }
          : undefined,
      });
      return res.status(200).json(report);
    } catch (error) {
      return handleError(res, error);
    }
  });
}
