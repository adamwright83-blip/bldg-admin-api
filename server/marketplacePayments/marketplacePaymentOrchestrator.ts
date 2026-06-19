import crypto from "node:crypto";
import type { ProcurementWorkflowStore } from "../procurement/workflowStore";
import type { AuthorityAction, AuthorityGrantPolicyView } from "../procurement/authorityPolicy";
import type { ProviderAcceptancePolicyView } from "../procurement/providerAcceptancePolicy";
import {
  evaluateMarketplaceAuthorization,
  evaluateMarketplaceCapture,
  type AuthorizationState,
  type MarketplaceAuthorizationGateDecision,
  type MarketplaceCaptureGateDecision,
} from "./marketplacePaymentPolicy";
import { marketplacePaymentsEnabled, marketplacePaymentsWorkerEnabled } from "./marketplaceStripeAdapter";
import { MarketplacePaymentStore } from "./marketplacePaymentStore";

export type LiveExecutionStatus = "disabled" | "not_applicable" | "would_attempt";

export type AuthorizationOrchestrationInput = {
  id?: string;
  guestReadinessPlanItemId: string;
  providerAcceptanceId?: string | null;
  authorityGrantId: string;
  tenantId: string;
  bldgUserId: number;
  buildingSlug: string;
  vendorId?: number | null;
  vendorConnectAccountIdSnapshot?: string | null;
  currency?: string;
  expiresAt?: Date | null;
  authority: AuthorityGrantPolicyView;
  action: AuthorityAction;
  residentApprovalGranted: boolean;
  idempotencyKey?: string;
  now?: Date;
};

export type AuthorizationOrchestrationResult = {
  authorizationId: string;
  decision: MarketplaceAuthorizationGateDecision;
  liveExecutionStatus: LiveExecutionStatus;
};

export type CaptureOrchestrationInput = {
  id?: string;
  authorizationId: string;
  authorizationState: AuthorizationState;
  acceptance: ProviderAcceptancePolicyView;
  budgetCapCents: number;
  planDeadlineAt: Date;
  idempotencyKey?: string;
  now?: Date;
};

export type CaptureOrchestrationResult = {
  captureId: string | null;
  decision: MarketplaceCaptureGateDecision;
  liveExecutionStatus: LiveExecutionStatus;
};

function deriveIdempotencyKey(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

/**
 * Orchestrates marketplace payment authorization: evaluates the deterministic
 * policy gate, persists the resulting authorization record transactionally
 * (which reserves its Stripe idempotency key before any future live call),
 * and never invokes a live Stripe call itself. Live execution is a separate,
 * explicitly-flagged concern left to a future slice.
 */
export class MarketplacePaymentOrchestrator {
  constructor(
    private readonly store: MarketplacePaymentStore,
    private readonly workflowStore?: ProcurementWorkflowStore,
  ) {}

  evaluateAuthorizationRequest(input: {
    authority: AuthorityGrantPolicyView;
    action: AuthorityAction;
    residentApprovalGranted: boolean;
    now?: Date;
  }): MarketplaceAuthorizationGateDecision {
    return evaluateMarketplaceAuthorization(input);
  }

  /**
   * Creates the authorization record transactionally regardless of outcome
   * (allowed → authorization_required/no_payment_required, denied →
   * cancelled), so every evaluated request leaves a durable audit trail.
   * Never calls Stripe: `liveExecutionStatus` only reports what a future,
   * explicitly-enabled slice would do — it never does it here.
   */
  async evaluateAndCreateAuthorization(
    input: AuthorizationOrchestrationInput,
  ): Promise<AuthorizationOrchestrationResult> {
    const decision = evaluateMarketplaceAuthorization({
      authority: input.authority,
      action: input.action,
      residentApprovalGranted: input.residentApprovalGranted,
      now: input.now,
    });

    const id = input.id ?? crypto.randomUUID();
    const idempotencyKey = input.idempotencyKey
      ?? deriveIdempotencyKey(`marketplace_authorization:${id}`);

    await this.store.createAuthorization({
      id,
      guestReadinessPlanItemId: input.guestReadinessPlanItemId,
      providerAcceptanceId: input.providerAcceptanceId ?? null,
      authorityGrantId: input.authorityGrantId,
      tenantId: input.tenantId,
      bldgUserId: input.bldgUserId,
      buildingSlug: input.buildingSlug,
      vendorId: input.vendorId ?? null,
      vendorConnectAccountIdSnapshot: input.vendorConnectAccountIdSnapshot ?? null,
      amountCents: Number.isSafeInteger(input.action.spendCents) ? input.action.spendCents : 0,
      currency: input.currency,
      state: decision.state,
      policyDecision: decision,
      idempotencyKey,
      expiresAt: input.expiresAt ?? null,
    });

    const liveExecutionStatus: LiveExecutionStatus =
      decision.state === "no_payment_required" ? "not_applicable"
      : !decision.allowed ? "not_applicable"
      : marketplacePaymentsEnabled() ? "would_attempt"
      : "disabled";

    return { authorizationId: id, decision, liveExecutionStatus };
  }

  evaluateCaptureReadiness(input: {
    authorizationState: AuthorizationState;
    acceptance: ProviderAcceptancePolicyView;
    budgetCapCents: number;
    planDeadlineAt: Date;
    now?: Date;
  }): MarketplaceCaptureGateDecision {
    return evaluateMarketplaceCapture(input);
  }

  /**
   * Refuses to persist a capture record at all unless the deterministic gate
   * allows it (authorization is `authorized` AND provider acceptance or
   * verified booking truth holds AND price/budget/deadline all check out).
   * Never calls Stripe.
   */
  async evaluateAndCreateCapture(
    input: CaptureOrchestrationInput,
  ): Promise<CaptureOrchestrationResult> {
    const decision = evaluateMarketplaceCapture({
      authorizationState: input.authorizationState,
      acceptance: input.acceptance,
      budgetCapCents: input.budgetCapCents,
      planDeadlineAt: input.planDeadlineAt,
      now: input.now,
    });

    if (!decision.allowed) {
      return { captureId: null, decision, liveExecutionStatus: "not_applicable" };
    }

    const id = input.id ?? crypto.randomUUID();
    const idempotencyKey = input.idempotencyKey
      ?? deriveIdempotencyKey(`marketplace_capture:${id}`);

    await this.store.createCapture({
      id,
      authorizationId: input.authorizationId,
      state: "capture_pending",
      truthCheckDecision: decision,
      idempotencyKey,
    });

    return {
      captureId: id,
      decision,
      liveExecutionStatus: marketplacePaymentsEnabled() ? "would_attempt" : "disabled",
    };
  }

  /**
   * Optional, explicit, never auto-invoked by the methods above: enqueues an
   * internal workflow/outbox record (no external side effects, no Stripe)
   * describing intent to authorize, reusing the Slice 1 workflow engine's
   * own idempotency guarantees. No handler is registered for this step type
   * anywhere, and `marketplacePaymentsWorkerEnabled()` gates whether a
   * future worker would ever claim it.
   */
  async enqueueAuthorizationWorkflowStep(input: {
    authorizationId: string;
    guestReadinessPlanItemId: string;
    idempotencyKey?: string;
  }) {
    if (!this.workflowStore) {
      throw new Error("MarketplacePaymentOrchestrator was constructed without a workflowStore.");
    }
    const idempotencyKey = input.idempotencyKey
      ?? deriveIdempotencyKey(`marketplace_authorization_workflow:${input.authorizationId}`);
    return this.workflowStore.createWorkflowWithStep({
      workflowKey: `marketplace-authorization:${input.authorizationId}`,
      workflowType: "marketplace_payment_authorization",
      stepKey: "evaluate_live_authorization",
      stepType: "marketplace_payment_authorization_pending",
      idempotencyKey,
      payload: {
        authorizationId: input.authorizationId,
        guestReadinessPlanItemId: input.guestReadinessPlanItemId,
        workerEnabledAtEnqueueTime: marketplacePaymentsWorkerEnabled(),
      },
    });
  }
}
