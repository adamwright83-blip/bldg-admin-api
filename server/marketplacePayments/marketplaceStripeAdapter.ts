import type Stripe from "stripe";

export function marketplacePaymentsEnabled(): boolean {
  return process.env.MARKETPLACE_PAYMENTS_ENABLED === "true";
}

export function marketplacePaymentsWorkerEnabled(): boolean {
  return process.env.MARKETPLACE_PAYMENTS_WORKER_ENABLED === "true";
}

type GetStripeFn = () => Stripe;

async function resolveGetStripe(injected?: GetStripeFn): Promise<GetStripeFn> {
  if (injected) return injected;
  const routers = await import("../routers");
  return routers.getStripe;
}

export type CreateAuthorizationIntentInput = {
  idempotencyKey: string;
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
};

/**
 * Authorizes (reserves) funds via a platform PaymentIntent with manual capture.
 * Refuses to run unless MARKETPLACE_PAYMENTS_ENABLED=true, so the heavy
 * `../routers` import (and any live Stripe call) never happens by default.
 */
export async function createAuthorizationPaymentIntent(
  input: CreateAuthorizationIntentInput,
  deps: { getStripe?: GetStripeFn } = {},
) {
  if (!marketplacePaymentsEnabled()) {
    throw new Error("MARKETPLACE_PAYMENTS_ENABLED is not set; refusing to create a live PaymentIntent.");
  }
  if (!input.idempotencyKey) {
    throw new Error("createAuthorizationPaymentIntent requires an explicit idempotencyKey.");
  }
  const getStripe = await resolveGetStripe(deps.getStripe);
  const stripe = getStripe();
  return stripe.paymentIntents.create(
    {
      customer: input.customerId,
      payment_method: input.paymentMethodId,
      amount: input.amountCents,
      currency: input.currency,
      capture_method: "manual",
      confirm: true,
      off_session: true,
      metadata: input.metadata,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}

export type CaptureAuthorizedIntentInput = {
  idempotencyKey: string;
  paymentIntentId: string;
  amountToCaptureCents?: number;
};

export async function captureAuthorizedPaymentIntent(
  input: CaptureAuthorizedIntentInput,
  deps: { getStripe?: GetStripeFn } = {},
) {
  if (!marketplacePaymentsEnabled()) {
    throw new Error("MARKETPLACE_PAYMENTS_ENABLED is not set; refusing to capture a live PaymentIntent.");
  }
  if (!input.idempotencyKey) {
    throw new Error("captureAuthorizedPaymentIntent requires an explicit idempotencyKey.");
  }
  const getStripe = await resolveGetStripe(deps.getStripe);
  const stripe = getStripe();
  return stripe.paymentIntents.capture(
    input.paymentIntentId,
    input.amountToCaptureCents !== undefined ? { amount_to_capture: input.amountToCaptureCents } : undefined,
    { idempotencyKey: input.idempotencyKey },
  );
}

export type CreateVendorTransferInput = {
  idempotencyKey: string;
  destinationAccountId: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string>;
};

export async function createVendorTransfer(
  input: CreateVendorTransferInput,
  deps: { getStripe?: GetStripeFn } = {},
) {
  if (!marketplacePaymentsEnabled()) {
    throw new Error("MARKETPLACE_PAYMENTS_ENABLED is not set; refusing to create a live Transfer.");
  }
  if (!input.idempotencyKey) {
    throw new Error("createVendorTransfer requires an explicit idempotencyKey.");
  }
  const getStripe = await resolveGetStripe(deps.getStripe);
  const stripe = getStripe();
  return stripe.transfers.create(
    {
      amount: input.amountCents,
      currency: input.currency,
      destination: input.destinationAccountId,
      metadata: input.metadata,
    },
    { idempotencyKey: input.idempotencyKey },
  );
}
