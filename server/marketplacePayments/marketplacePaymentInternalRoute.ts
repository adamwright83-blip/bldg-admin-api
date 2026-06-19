import type express from "express";
import { z } from "zod";
import { sdk } from "../_core/sdk";
import { isValidAgentSharedSecret } from "../agents/s2sEndpoint";
import { createProcurementPool } from "../procurement/migrations";
import type { AuthorityAction, AuthorityGrantPolicyView } from "../procurement/authorityPolicy";
import type { ProviderAcceptancePolicyView } from "../procurement/providerAcceptancePolicy";
import { MarketplacePaymentOrchestrator } from "./marketplacePaymentOrchestrator";
import { MarketplacePaymentStore } from "./marketplacePaymentStore";

async function assertAdminOrAgent(req: express.Request) {
  if (isValidAgentSharedSecret(req.headers["x-agent-shared-secret"])) return;

  let user = null;
  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    user = null;
  }
  if (!user || user.role !== "admin") {
    const err = new Error("Unauthorized");
    (err as any).statusCode = 401;
    throw err;
  }
}

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

const evaluateAuthorizationBodySchema = z.object({
  authority: authorityViewSchema,
  action: actionSchema,
  residentApprovalGranted: z.boolean(),
});

const createAuthorizationBodySchema = evaluateAuthorizationBodySchema.extend({
  guestReadinessPlanItemId: z.string(),
  authorityGrantId: z.string(),
  tenantId: z.string(),
  bldgUserId: z.number().int(),
  buildingSlug: z.string(),
  providerAcceptanceId: z.string().nullable().optional(),
  vendorId: z.number().int().nullable().optional(),
  vendorConnectAccountIdSnapshot: z.string().nullable().optional(),
  currency: z.string().optional(),
  expiresAt: z.string().nullable().optional(),
});

const evaluateCaptureBodySchema = z.object({
  authorizationState: z.enum([
    "no_payment_required", "authorization_required", "authorization_pending", "authorized", "cancelled",
  ]),
  acceptance: acceptanceViewSchema,
  budgetCapCents: z.number().int(),
  planDeadlineAt: z.string(),
});

const createCaptureBodySchema = evaluateCaptureBodySchema.extend({
  authorizationId: z.string(),
});

type OrchestratorDeps = { orchestrator?: MarketplacePaymentOrchestrator };

let lazyOrchestrator: MarketplacePaymentOrchestrator | null = null;
function resolveOrchestrator(deps: OrchestratorDeps): MarketplacePaymentOrchestrator {
  if (deps.orchestrator) return deps.orchestrator;
  if (!lazyOrchestrator) {
    lazyOrchestrator = new MarketplacePaymentOrchestrator(new MarketplacePaymentStore(createProcurementPool()));
  }
  return lazyOrchestrator;
}

function handleError(res: express.Response, error: unknown) {
  const statusCode = (error as any)?.statusCode === 401 ? 401 : error instanceof z.ZodError ? 400 : 500;
  return res.status(statusCode).json({
    error: error instanceof Error ? error.message : String(error),
    code:
      statusCode === 401 ? "MARKETPLACE_PAYMENTS_INTERNAL_UNAUTHORIZED"
      : statusCode === 400 ? "MARKETPLACE_PAYMENTS_INTERNAL_INVALID_REQUEST"
      : "MARKETPLACE_PAYMENTS_INTERNAL_FAILED",
  });
}

/**
 * Internal/admin-only marketplace-payments API. Every route here only ever
 * calls MarketplacePaymentOrchestrator — never the live-Stripe-calling
 * adapter functions — so no route in this file can ever place a live charge,
 * authorization, or transfer regardless of MARKETPLACE_PAYMENTS_ENABLED.
 * That flag only changes the informational `liveExecutionStatus` field a
 * future slice would act on.
 */
export function registerMarketplacePaymentInternalRoutes(app: express.Express, deps: OrchestratorDeps = {}) {
  app.post("/api/internal/marketplace-payments/authorizations/evaluate", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const body = evaluateAuthorizationBodySchema.parse(req.body ?? {});
      const orchestrator = resolveOrchestrator(deps);
      const decision = orchestrator.evaluateAuthorizationRequest({
        authority: toAuthorityView(body.authority),
        action: toAction(body.action),
        residentApprovalGranted: body.residentApprovalGranted,
      });
      return res.status(200).json({ decision });
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.post("/api/internal/marketplace-payments/authorizations", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const body = createAuthorizationBodySchema.parse(req.body ?? {});
      const orchestrator = resolveOrchestrator(deps);
      const result = await orchestrator.evaluateAndCreateAuthorization({
        guestReadinessPlanItemId: body.guestReadinessPlanItemId,
        providerAcceptanceId: body.providerAcceptanceId ?? null,
        authorityGrantId: body.authorityGrantId,
        tenantId: body.tenantId,
        bldgUserId: body.bldgUserId,
        buildingSlug: body.buildingSlug,
        vendorId: body.vendorId ?? null,
        vendorConnectAccountIdSnapshot: body.vendorConnectAccountIdSnapshot ?? null,
        currency: body.currency,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        authority: toAuthorityView(body.authority),
        action: toAction(body.action),
        residentApprovalGranted: body.residentApprovalGranted,
      });
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.post("/api/internal/marketplace-payments/captures/evaluate", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const body = evaluateCaptureBodySchema.parse(req.body ?? {});
      const orchestrator = resolveOrchestrator(deps);
      const decision = orchestrator.evaluateCaptureReadiness({
        authorizationState: body.authorizationState,
        acceptance: toAcceptanceView(body.acceptance),
        budgetCapCents: body.budgetCapCents,
        planDeadlineAt: new Date(body.planDeadlineAt),
      });
      return res.status(200).json({ decision });
    } catch (error) {
      return handleError(res, error);
    }
  });

  app.post("/api/internal/marketplace-payments/captures", async (req, res) => {
    try {
      await assertAdminOrAgent(req);
      const body = createCaptureBodySchema.parse(req.body ?? {});
      const orchestrator = resolveOrchestrator(deps);
      const result = await orchestrator.evaluateAndCreateCapture({
        authorizationId: body.authorizationId,
        authorizationState: body.authorizationState,
        acceptance: toAcceptanceView(body.acceptance),
        budgetCapCents: body.budgetCapCents,
        planDeadlineAt: new Date(body.planDeadlineAt),
      });
      return res.status(200).json(result);
    } catch (error) {
      return handleError(res, error);
    }
  });
}
