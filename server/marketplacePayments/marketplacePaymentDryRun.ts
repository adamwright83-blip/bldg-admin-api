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
import { marketplaceStripeWebhookSecret } from "./marketplaceStripeWebhook";

export type ActivationFlagsReport = {
  marketplacePaymentsEnabled: boolean;
  marketplacePaymentsWorkerEnabled: boolean;
  webhookSecretConfigured: boolean;
  liveStripeBlocked: boolean;
  webhookIntakeBlocked: boolean;
};

export type AuthorizationDryRunInput = {
  authority: AuthorityGrantPolicyView;
  action: AuthorityAction;
  residentApprovalGranted: boolean;
  now?: Date;
};

export type CaptureDryRunInput = {
  authorizationState: AuthorizationState;
  acceptance: ProviderAcceptancePolicyView;
  budgetCapCents: number;
  planDeadlineAt: Date;
  now?: Date;
};

export type ActivationReadinessReport = {
  flags: ActivationFlagsReport;
  authorization: { evaluated: boolean; decision: MarketplaceAuthorizationGateDecision | null };
  capture: { evaluated: boolean; decision: MarketplaceCaptureGateDecision | null };
  missingGates: string[];
  overallStatus: "ready" | "blocked_by_policy" | "blocked_by_flags" | "not_evaluated";
};

/**
 * Reports the current state of every flag/secret that gates live marketplace
 * payment execution. Pure env reads via the existing Slice 4/8 helpers —
 * never sets anything, never touches the database, never calls Stripe.
 */
export function reportActivationFlags(): ActivationFlagsReport {
  const enabled = marketplacePaymentsEnabled();
  const workerEnabled = marketplacePaymentsWorkerEnabled();
  const webhookSecretConfigured = marketplaceStripeWebhookSecret() !== undefined;
  return {
    marketplacePaymentsEnabled: enabled,
    marketplacePaymentsWorkerEnabled: workerEnabled,
    webhookSecretConfigured,
    liveStripeBlocked: !enabled,
    webhookIntakeBlocked: !(enabled && webhookSecretConfigured),
  };
}

/**
 * End-to-end dry run across the marketplace payment spine: evaluates
 * authorization and/or capture readiness using the exact same deterministic
 * policy functions the real orchestrator uses (Slice 5), reports which
 * gates are missing, and reports whether live Stripe execution would still
 * be blocked by feature flags even if every policy gate passed.
 *
 * Calls only pure functions from `marketplacePaymentPolicy.ts` — there is
 * no store, no pool, no Stripe client anywhere in this module, so it is
 * structurally incapable of writing to the database, calling Stripe,
 * processing a webhook, or enqueueing a workflow step.
 */
export function runMarketplacePaymentDryRun(input: {
  authorization?: AuthorizationDryRunInput;
  capture?: CaptureDryRunInput;
}): ActivationReadinessReport {
  const flags = reportActivationFlags();

  const authorizationDecision = input.authorization
    ? evaluateMarketplaceAuthorization({
        authority: input.authorization.authority,
        action: input.authorization.action,
        residentApprovalGranted: input.authorization.residentApprovalGranted,
        now: input.authorization.now,
      })
    : null;

  const captureDecision = input.capture
    ? evaluateMarketplaceCapture({
        authorizationState: input.capture.authorizationState,
        acceptance: input.capture.acceptance,
        budgetCapCents: input.capture.budgetCapCents,
        planDeadlineAt: input.capture.planDeadlineAt,
        now: input.capture.now,
      })
    : null;

  const missingGates = Array.from(new Set([
    ...(authorizationDecision?.reasons ?? []),
    ...(captureDecision?.reasons ?? []),
  ]));

  const authorizationEvaluated = authorizationDecision !== null;
  const captureEvaluated = captureDecision !== null;
  const anyDenied =
    (authorizationEvaluated && authorizationDecision!.allowed === false)
    || (captureEvaluated && captureDecision!.allowed === false);

  const overallStatus: ActivationReadinessReport["overallStatus"] =
    !authorizationEvaluated && !captureEvaluated ? "not_evaluated"
    : anyDenied ? "blocked_by_policy"
    : flags.liveStripeBlocked ? "blocked_by_flags"
    : "ready";

  return {
    flags,
    authorization: { evaluated: authorizationEvaluated, decision: authorizationDecision },
    capture: { evaluated: captureEvaluated, decision: captureDecision },
    missingGates,
    overallStatus,
  };
}
