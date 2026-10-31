/* LEGACY DAYFORGE COMPATIBILITY: retained historical Stripe environment literals and billing plan references only; canonical product is JOYSTICK. */
import mysql, { type Connection } from "mysql2/promise";
import Stripe from "stripe";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import {
  checkAdvertisedStripePrice,
  JOYSTICK_ANNUAL_PLAN_KEY,
  JOYSTICK_ANNUAL_TRIAL_DAYS,
  JOYSTICK_MONTHLY_PLAN_KEY,
  JOYSTICK_MONTHLY_TRIAL_DAYS,
  JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS,
  resolveConfiguredAnnualPriceId,
} from "./joystickStripeOffer";
import { billingSecretGate } from "./paidCustomerLifecycle";
import {
  createLegacyDayforgeBillingPortalSession,
  createLegacyDayforgeSubscriptionCheckout,
  processLegacyDayforgeBillingWebhook,
} from "./saasBilling";
import {
  activateOnboardingOwner,
  generateJoystickDraftPreview,
  saveJoystickDraftAnswer,
  saveJoystickOnboardingIdentity,
  startJoystickOnboardingDraft,
  syncConfiguredSaasPlan,
} from "./saasStore";
import { invoiceSubscriptionId, subscriptionScheduledToCancel } from "./stripeWebhookShapes";

/**
 * The real Stripe SANDBOX acceptance run for the advertised JOYSTICK monthly offer: $79 a month, no trial, card at
 * signup, charged at checkout. Test mode only: anything but an sk_test_ key is refused before any Stripe call, and
 * every Stripe object it reads must say livemode false.
 *
 * Two targets:
 * - "local": a loopback JOYSTICK app and a disposable local MySQL named joystick_stripe_acceptance, with Stripe test
 *   webhooks forwarded to the app (Stripe CLI).
 * - "railway_sandbox": inside the deployed bldg-admin-api container over `railway ssh`, against the deployed app on
 *   its own loopback port and the deployed database, with the sandbox webhook endpoint delivering to the deployed
 *   app. It leaves one canceled sandbox tenant behind (slug and email start with stripe-acceptance-).
 *
 * See docs/billing/JOYSTICK_STRIPE_SANDBOX.md for exactly how to run it.
 */

export type StripeAcceptanceTarget = "local" | "railway_sandbox";

export const JOYSTICK_WEBHOOK_ENDPOINT_PATH = "/api/dayforge/billing/stripe-webhook";
/** The sandbox endpoint's API version; event payloads arrive in this shape. */
export const JOYSTICK_WEBHOOK_ENDPOINT_API_VERSION = "2026-09-30";
/** Every event type the billing webhook acts on (server/saas/saasBilling.ts). */
export const JOYSTICK_WEBHOOK_EVENT_TYPES = [
  "checkout.session.completed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

const STRIPE_API_VERSION = "2025-03-31.basil";

export interface StripeAcceptanceResult {
  status: "PASSED" | "BLOCKED" | "FAILED";
  reason?: string;
  missingConfig?: string[];
  failureStep?: string;
  details?: {
    target?: StripeAcceptanceTarget;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeAccountId?: string;
    tenantId?: string;
    planKey?: string;
    checkoutSessionId?: string;
    checkoutUrl?: string;
    invoiceId?: string;
    amountPaidCents?: number;
    portalConfigurationId?: string;
    webhookEndpointId?: string;
    webhookEndpointApiVersion?: string;
    provenSteps?: string[];
  };
}

export interface RunStripeAcceptanceOptions {
  target?: StripeAcceptanceTarget;
  databaseUrl?: string;
  allowlistedAccountId?: string;
  stripeClient?: Stripe;
  dbConnection?: Connection;
  onCheckoutReady?: (details: { sessionId: string; url: string }) => void;
  onProgress?: (step: string) => void;
}

type Failure = { failureStep: string; reason: string };

function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  const id = (value as { id?: unknown } | null)?.id;
  return typeof id === "string" ? id : null;
}

/** The sandbox webhook endpoint must deliver every handled event, in the 2026-09-30 shape, to the billing route. */
export function checkWebhookEndpoint(endpoint: {
  livemode?: boolean | null;
  status?: string | null;
  url?: string | null;
  api_version?: string | null;
  enabled_events?: readonly string[] | null;
}): Failure | null {
  if (endpoint.livemode !== false) {
    return { failureStep: "webhook_endpoint_mode", reason: "The webhook endpoint is not a test-mode (sandbox) endpoint" };
  }
  if (endpoint.status !== "enabled") {
    return { failureStep: "webhook_endpoint_status", reason: `The webhook endpoint is '${endpoint.status}', expected 'enabled'` };
  }
  let path = "";
  try {
    path = new URL(endpoint.url ?? "").pathname.replace(/\/$/, "");
  } catch {
    path = "";
  }
  if (path !== JOYSTICK_WEBHOOK_ENDPOINT_PATH) {
    return { failureStep: "webhook_endpoint_url", reason: `The webhook endpoint delivers to '${endpoint.url}', expected a URL ending ${JOYSTICK_WEBHOOK_ENDPOINT_PATH}` };
  }
  if (!String(endpoint.api_version ?? "").startsWith(JOYSTICK_WEBHOOK_ENDPOINT_API_VERSION)) {
    return {
      failureStep: "webhook_endpoint_api_version",
      reason: `The webhook endpoint's API version is '${endpoint.api_version ?? "account default"}', expected ${JOYSTICK_WEBHOOK_ENDPOINT_API_VERSION}`,
    };
  }
  const enabled = new Set(endpoint.enabled_events ?? []);
  const missing = enabled.has("*") ? [] : JOYSTICK_WEBHOOK_EVENT_TYPES.filter(type => !enabled.has(type));
  if (missing.length > 0) {
    return { failureStep: "webhook_endpoint_events", reason: `The webhook endpoint does not send: ${missing.join(", ")}` };
  }
  return null;
}

/**
 * No trial, card on file, and the first invoice charged $79 at checkout, all in test mode.
 * The invoice's subscription is read the way the webhook reads it (invoice.parent.subscription_details first).
 */
export function checkFirstChargeNoTrial(input: {
  planPriceId: string;
  session: {
    livemode?: boolean | null;
    mode?: string | null;
    payment_status?: string | null;
    amount_total?: number | null;
    currency?: string | null;
  };
  subscription: {
    id: string;
    livemode?: boolean | null;
    status?: string | null;
    trial_start?: number | null;
    trial_end?: number | null;
    default_payment_method?: unknown;
    items?: { data?: Array<{ price?: { id?: string | null } | null }> | null } | null;
  };
  invoice: {
    id?: string | null;
    livemode?: boolean | null;
    status?: string | null;
    billing_reason?: string | null;
    amount_paid?: number | null;
    currency?: string | null;
  } | null;
}): Failure | null {
  const { session, subscription, invoice } = input;
  if (session.livemode !== false || subscription.livemode !== false || invoice?.livemode !== false) {
    return { failureStep: "test_mode_check", reason: "A Checkout session, subscription or invoice is not in test mode" };
  }
  if (session.mode !== "subscription") {
    return { failureStep: "checkout_mode_check", reason: `Checkout mode is '${session.mode}', expected 'subscription'` };
  }
  if (!subscription.default_payment_method) {
    return { failureStep: "payment_method_check", reason: `Subscription ${subscription.id} does not have a default payment method attached` };
  }
  if (subscription.status !== "active") {
    return { failureStep: "subscription_status_check", reason: `Subscription status is '${subscription.status}', expected 'active' (no trial)` };
  }
  if (subscription.trial_end != null || subscription.trial_start != null) {
    return { failureStep: "no_trial_check", reason: `Subscription ${subscription.id} has a trial (trial_end ${subscription.trial_end}); the advertised offer has none` };
  }
  const prices = (subscription.items?.data ?? []).map(item => item.price?.id ?? null);
  if (prices.length !== 1 || prices[0] !== input.planPriceId) {
    return { failureStep: "subscription_price_check", reason: `Subscription prices are [${prices.join(", ")}], expected [${input.planPriceId}]` };
  }
  if (!invoice) {
    return { failureStep: "first_charge_check", reason: "The subscription has no first invoice" };
  }
  if (
    invoice.status !== "paid" ||
    invoice.amount_paid !== JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS ||
    invoice.currency !== "usd" ||
    invoice.billing_reason !== "subscription_create"
  ) {
    return {
      failureStep: "first_charge_check",
      reason: `First invoice ${invoice.id}: status=${invoice.status}, amount_paid=${invoice.amount_paid}, currency=${invoice.currency}, billing_reason=${invoice.billing_reason}; expected paid, ${JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS}, usd, subscription_create`,
    };
  }
  if (session.payment_status !== "paid" || session.amount_total !== JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS || session.currency !== "usd") {
    return {
      failureStep: "checkout_charge_check",
      reason: `Checkout payment_status=${session.payment_status}, amount_total=${session.amount_total}, currency=${session.currency}; expected paid, ${JOYSTICK_MONTHLY_UNIT_AMOUNT_CENTS}, usd`,
    };
  }
  return null;
}

function insideRailway(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT_NAME?.trim() ||
      process.env.RAILWAY_ENVIRONMENT?.trim() ||
      process.env.RAILWAY_SERVICE_NAME?.trim()
  );
}

function loopbackHttpOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function assertConfiguredAnnualPrice(
  db: Connection,
  stripe: Stripe
): Promise<StripeAcceptanceResult | null> {
  const [annualRows] = await db.query(
    "SELECT planKey, stripePriceId, trialDays FROM dayforge_saas_billing_plans WHERE planKey = ? AND active = true",
    [JOYSTICK_ANNUAL_PLAN_KEY]
  );
  const annualPlan = (annualRows as Array<{
    stripePriceId?: string;
    trialDays?: number;
  }>)[0];
  const annualConfig = resolveConfiguredAnnualPriceId({
    planPriceId: annualPlan?.stripePriceId,
    envPriceId: process.env.JOYSTICK_STRIPE_ANNUAL_PRICE_ID,
  });
  if (annualConfig.status === "absent") return null;
  if (annualConfig.status === "conflict") {
    return {
      status: "FAILED",
      failureStep: "stripe_annual_price_validation",
      reason: annualConfig.reason,
    };
  }
  if (annualPlan && annualPlan.trialDays !== JOYSTICK_ANNUAL_TRIAL_DAYS) {
    return {
      status: "FAILED",
      failureStep: "plan_trial_days_check",
      reason: `Plan '${JOYSTICK_ANNUAL_PLAN_KEY}' has trialDays = ${annualPlan.trialDays}, expected ${JOYSTICK_ANNUAL_TRIAL_DAYS}`,
    };
  }
  let annualPrice: Stripe.Price;
  try {
    annualPrice = await stripe.prices.retrieve(annualConfig.priceId);
  } catch (err: any) {
    return {
      status: "FAILED",
      failureStep: "stripe_annual_price_retrieval",
      reason: `Failed to retrieve Stripe annual price ${annualConfig.priceId}: ${err.message}`,
    };
  }
  const annualCheck = checkAdvertisedStripePrice({
    planKey: JOYSTICK_ANNUAL_PLAN_KEY,
    trialDays: annualPlan?.trialDays ?? JOYSTICK_ANNUAL_TRIAL_DAYS,
    configuredPriceId: annualConfig.priceId,
    price: annualPrice,
  });
  if (!annualCheck.ok) {
    return {
      status: "FAILED",
      failureStep:
        annualCheck.code === "trial_days"
          ? "plan_trial_days_check"
          : "stripe_annual_price_validation",
      reason: annualCheck.reason,
    };
  }
  return null;
}

export async function runStripeProviderAcceptance(
  options?: RunStripeAcceptanceOptions
): Promise<StripeAcceptanceResult> {
  const target: StripeAcceptanceTarget = options?.target ?? "local";
  const secretKey = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET?.trim();
  const appUrl = process.env.DAYFORGE_BILLING_APP_URL?.trim();
  const portalConfigurationId = process.env.DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID?.trim();
  const webhookEndpointId = process.env.JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID?.trim();
  const allowlistedAccountId =
    options?.allowlistedAccountId ??
    process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID?.trim();
  const progress = (step: string) => options?.onProgress?.(step);
  const proven: string[] = [];

  // Injected clients are useful for unit tests, never for a real-provider PASSED result.
  const injectedDependencies = Boolean(options?.stripeClient || options?.dbConnection);
  const missing: string[] = [];
  // Sandbox only. The same gate checkout uses: a live key (sk_live_/rk_live_) or anything that is not sk_test_ stops
  // the run here, before any Stripe call.
  const keyGate = billingSecretGate(secretKey);
  if (keyGate.action === "absent") {
    missing.push("DAYFORGE_BILLING_STRIPE_SECRET_KEY");
  } else if (keyGate.action === "refuse") {
    missing.push("DAYFORGE_BILLING_STRIPE_SECRET_KEY (must be a test-mode key starting with sk_test_)");
  }

  if (!webhookSecret) {
    missing.push("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET");
  } else if (!webhookSecret.startsWith("whsec_")) {
    missing.push("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET (must start with whsec_)");
  }

  if (target === "local" && !appUrl) {
    missing.push("DAYFORGE_BILLING_APP_URL");
  }

  if (!portalConfigurationId) {
    missing.push("DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID (the sandbox customer-portal configuration, bpc_...)");
  } else if (!portalConfigurationId.startsWith("bpc_")) {
    missing.push("DAYFORGE_BILLING_PORTAL_CONFIGURATION_ID (must start with bpc_)");
  }

  if (target === "railway_sandbox" && !webhookEndpointId) {
    missing.push("JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID (the sandbox webhook endpoint, we_...)");
  } else if (webhookEndpointId && !webhookEndpointId.startsWith("we_")) {
    missing.push("JOYSTICK_STRIPE_WEBHOOK_ENDPOINT_ID (must start with we_)");
  }

  if (!allowlistedAccountId) {
    missing.push("JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID (must provide explicitly approved test account ID)");
  }

  if (missing.length > 0) {
    return {
      status: "BLOCKED",
      reason: `Missing or invalid Stripe provider test-mode configuration: ${missing.join(", ")}`,
      missingConfig: missing,
      details: { target },
    };
  }

  // The real onboarding store uses process.env.DATABASE_URL, not the dbConnection
  // passed to this harness. Guard BOTH against accidentally writing elsewhere.
  const dbUrl = options?.databaseUrl ?? process.env.DATABASE_URL;
  if (target === "railway_sandbox") {
    if (!insideRailway()) {
      return {
        status: "FAILED",
        failureStep: "railway_target_guard",
        reason: "The railway_sandbox target runs only inside the deployed service: railway ssh --service bldg-admin-api -- sh -c 'cd /app && npx tsx scripts/run-stripe-provider-acceptance.ts --target=railway-sandbox'",
      };
    }
    if (!options?.dbConnection && (!dbUrl || process.env.DATABASE_URL !== dbUrl)) {
      return {
        status: "FAILED",
        failureStep: "database_safety_guard",
        reason: "The railway_sandbox target uses the deployed service's own DATABASE_URL for every write",
      };
    }
  } else if (!options?.dbConnection) {
    if (!dbUrl) {
      return { status: "BLOCKED", reason: "Missing disposable DATABASE_URL", missingConfig: ["DATABASE_URL"] };
    }
    let parsed: URL;
    try { parsed = new URL(dbUrl); } catch {
      return { status: "FAILED", failureStep: "database_url", reason: "Invalid DATABASE_URL" };
    }
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname) ||
        parsed.pathname !== "/joystick_stripe_acceptance" ||
        process.env.DATABASE_URL !== dbUrl) {
      return {
        status: "FAILED",
        failureStep: "database_safety_guard",
        reason: "Stripe acceptance requires a local /joystick_stripe_acceptance database matching DATABASE_URL for all store writes",
      };
    }
  }

  // Where the owner's password login is tried: the app itself, on a loopback HTTP origin.
  const loginOriginSource =
    target === "railway_sandbox"
      ? process.env.JOYSTICK_STRIPE_ACCEPTANCE_LOGIN_ORIGIN?.trim() ||
        (process.env.PORT?.trim() ? `http://127.0.0.1:${process.env.PORT.trim()}` : "")
      : appUrl!;
  const appOrigin = loopbackHttpOrigin(loginOriginSource);
  if (!appOrigin) {
    return {
      status: "FAILED",
      failureStep: "app_origin_guard",
      reason:
        target === "railway_sandbox"
          ? "The deployed app's loopback origin is unknown: PORT is unset (or JOYSTICK_STRIPE_ACCEPTANCE_LOGIN_ORIGIN is not a loopback http origin)"
          : "Only a local isolated HTTP application origin is permitted",
    };
  }

  let db: Connection;
  if (options?.dbConnection) {
    db = options.dbConnection;
  } else {
    try {
      db = await mysql.createConnection(dbUrl!);
    } catch (err: any) {
      return {
        status: "FAILED",
        failureStep: "database_connection",
        reason: `Failed to connect to database: ${err.message}`,
      };
    }
  }

  try {
    const [dbRows] = await db.query("SELECT DATABASE() AS name");
    const database = (dbRows as any[])[0];
    const name = String(database?.name ?? "");
    // Local runs: must be the explicitly dedicated test database.
    if (target === "local" && name !== "joystick_stripe_acceptance") {
      return {
        status: "FAILED",
        failureStep: "database_safety_guard",
        reason: `Refusing Stripe acceptance execution outside designated disposable test database: ${name}`,
      };
    }

    const stripe =
      options?.stripeClient ??
      new Stripe(secretKey!, { apiVersion: STRIPE_API_VERSION as any });

    // Step 1: Verify Stripe Account against explicit allowlist
    let account: Stripe.Account;
    try {
      account = await stripe.accounts.retrieve();
    } catch (err: any) {
      return {
        status: "FAILED",
        failureStep: "account_retrieval",
        reason: `Failed to retrieve Stripe account: ${err.message}`,
      };
    }

    if (account.id !== allowlistedAccountId) {
      return {
        status: "FAILED",
        failureStep: "account_allowlist_check",
        reason: `Retrieved account ID ${account.id} does not match explicitly allowlisted ID ${allowlistedAccountId}`,
      };
    }

    // Explicit safeguard against Laundry Farm
    const displayName = (account.settings?.dashboard?.display_name ?? "").toLowerCase();
    const businessName = (account.business_profile?.name ?? "").toLowerCase();
    if (displayName.includes("laundry farm") || businessName.includes("laundry farm")) {
      return {
        status: "FAILED",
        failureStep: "account_safeguard",
        reason: "REJECTED: Laundry Farm account detected. Must use dedicated JOYSTICK test account.",
      };
    }

    // Test adapters must not reach the real onboarding store at all. That
    // store uses process.env.DATABASE_URL independently of this connection.
    if (injectedDependencies) {
      return {
        status: "FAILED",
        failureStep: "injected_dependencies",
        reason: "Injected Stripe/database adapters are restricted to guard tests and cannot perform real onboarding writes",
      };
    }
    proven.push("account_allowlisted_test_key");

    const details: NonNullable<StripeAcceptanceResult["details"]> = {
      target,
      stripeAccountId: account.id,
      planKey: JOYSTICK_MONTHLY_PLAN_KEY,
      provenSteps: proven,
    };
    const failed = (failure: Failure): StripeAcceptanceResult => ({ status: "FAILED", ...failure, details });

    // Step 2: the sandbox webhook endpoint (required on Railway; checked locally when its id is given)
    if (webhookEndpointId) {
      progress("webhook endpoint");
      let endpoint: Stripe.WebhookEndpoint;
      try {
        endpoint = await stripe.webhookEndpoints.retrieve(webhookEndpointId);
      } catch (err: any) {
        return failed({ failureStep: "webhook_endpoint_retrieval", reason: `Failed to retrieve webhook endpoint ${webhookEndpointId}: ${err.message}` });
      }
      const endpointFailure = checkWebhookEndpoint(endpoint);
      if (endpointFailure) return failed(endpointFailure);
      details.webhookEndpointId = endpoint.id;
      details.webhookEndpointApiVersion = endpoint.api_version ?? undefined;
      proven.push("webhook_endpoint_2026_09_30");
    }

    // Step 3: the plan the app checks out with, synced from DAYFORGE_STRIPE_* exactly as the app does, and its price
    progress("plan and price");
    await syncConfiguredSaasPlan();
    const planKey = JOYSTICK_MONTHLY_PLAN_KEY;
    const [rows] = await db.query(
      "SELECT planKey, stripePriceId, stripeProductId, trialDays FROM dayforge_saas_billing_plans WHERE planKey = ? AND active = true",
      [planKey]
    );
    const plan = (rows as any[])[0];
    if (!plan) {
      return failed({
        failureStep: "plan_catalog_check",
        reason: `Active billing plan '${planKey}' not found in dayforge_saas_billing_plans table (set DAYFORGE_STRIPE_PLAN_KEY=${planKey})`,
      });
    }
    if (plan.trialDays !== JOYSTICK_MONTHLY_TRIAL_DAYS) {
      return failed({
        failureStep: "plan_trial_days_check",
        reason: `Plan '${planKey}' has trialDays = ${plan.trialDays}, expected ${JOYSTICK_MONTHLY_TRIAL_DAYS} (set DAYFORGE_STRIPE_TRIAL_DAYS=0)`,
      });
    }
    const envPriceId = process.env.DAYFORGE_STRIPE_PRICE_ID?.trim();
    if (envPriceId && envPriceId !== plan.stripePriceId) {
      return failed({
        failureStep: "plan_price_config_check",
        reason: `Plan '${planKey}' uses price ${plan.stripePriceId}, but DAYFORGE_STRIPE_PRICE_ID is ${envPriceId}`,
      });
    }

    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(plan.stripePriceId);
    } catch (err: any) {
      return failed({
        failureStep: "stripe_price_retrieval",
        reason: `Failed to retrieve Stripe price ${plan.stripePriceId}: ${err.message}`,
      });
    }
    if (price.livemode !== false) {
      return failed({ failureStep: "test_mode_check", reason: `Stripe price ${price.id} is not a test-mode price` });
    }
    const monthlyCheck = checkAdvertisedStripePrice({
      planKey,
      trialDays: plan.trialDays,
      configuredPriceId: plan.stripePriceId,
      price,
    });
    if (!monthlyCheck.ok) {
      return failed({ failureStep: "stripe_price_validation", reason: monthlyCheck.reason });
    }
    const envProductId = process.env.DAYFORGE_STRIPE_PRODUCT_ID?.trim();
    if (envProductId && idOf(price.product) !== envProductId) {
      return failed({
        failureStep: "stripe_product_check",
        reason: `Stripe price ${price.id} belongs to product ${idOf(price.product)}, expected DAYFORGE_STRIPE_PRODUCT_ID ${envProductId}`,
      });
    }

    const annualPriceFailure = await assertConfiguredAnnualPrice(db, stripe);
    if (annualPriceFailure) return { ...annualPriceFailure, details };
    proven.push("plan_7900_month_no_trial");

    // Step 4: a JOYSTICK signup (the /joystick-start draft) and its Checkout
    progress("signup and checkout");
    const suffix = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
    const testEmail = `stripe-acceptance-${suffix}@example.com`;
    const started = await startJoystickOnboardingDraft({ requestId: randomUUID() });
    const resumeToken = started.resumeToken!;
    let onboarding = started.session;
    for (const [questionKey, answer] of [
      ["daily_work", "Stripe sandbox acceptance: carpet cleaning jobs"],
      ["service_area", "Sandbox"],
      ["avoidance", "following up on estimates"],
    ] as const) {
      onboarding = await saveJoystickDraftAnswer({
        sessionId: onboarding.id,
        resumeToken,
        expectedVersion: onboarding.version,
        questionKey,
        answer,
      });
    }
    onboarding = await generateJoystickDraftPreview({
      sessionId: onboarding.id,
      resumeToken,
      expectedVersion: onboarding.version,
    });
    await saveJoystickOnboardingIdentity({
      sessionId: onboarding.id,
      resumeToken,
      expectedVersion: onboarding.version,
      businessName: `Stripe Acceptance ${suffix}`,
      contactName: "Stripe Acceptance",
      ownerEmail: testEmail,
      timeZone: "America/Los_Angeles",
    });

    // Provider events for this run are created after this moment (two minutes of clock slack).
    const runStartedAt = Math.floor(Date.now() / 1000) - 120;
    const checkout = await createLegacyDayforgeSubscriptionCheckout({
      sessionId: onboarding.id,
      resumeToken,
      planKey,
      requestId: randomUUID(),
      stripe,
    });

    if (!checkout.id || !checkout.url) {
      return failed({
        failureStep: "checkout_creation",
        reason: "Stripe Checkout session creation failed to return session ID or URL",
      });
    }
    details.checkoutSessionId = checkout.id;
    details.checkoutUrl = checkout.url;
    options?.onCheckoutReady?.({ sessionId: checkout.id, url: checkout.url });

    // Stripe Checkout requires a real test-card submission. Give an operator a
    // bounded opportunity to complete the hosted page in the *same* process,
    // retaining the one-time onboarding resume token only in memory.
    const waitMs = Math.max(0, Math.min(600000, Number(process.env.JOYSTICK_STRIPE_CHECKOUT_WAIT_MS || "0") || 0));
    const deadline = Date.now() + waitMs;
    let session = await stripe.checkout.sessions.retrieve(checkout.id, {
      expand: ["subscription", "customer"],
    });
    while (session.status === "open" && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, Math.min(2000, Math.max(1, deadline - Date.now()))));
      session = await stripe.checkout.sessions.retrieve(checkout.id, {
        expand: ["subscription", "customer"],
      });
    }
    if (session.status !== "complete" || !session.subscription) {
      return {
        status: session.status === "expired" ? "FAILED" : "BLOCKED",
        failureStep: session.status === "expired" ? "checkout_expired" : undefined,
        reason: session.status === "expired"
          ? "The Stripe test Checkout expired"
          : "Complete the actual hosted Stripe test Checkout (test card 4242 4242 4242 4242); session creation is not payment-method collection",
        details,
      };
    }

    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;
    details.stripeSubscriptionId = subId;
    details.stripeCustomerId = idOf(session.customer) ?? undefined;

    // Steps 5-6: card on file, no trial, and $79 charged on the first invoice, all in test mode
    progress("first charge");
    const subscription = await stripe.subscriptions.retrieve(subId, {
      expand: ["default_payment_method"],
    });
    const invoiceId = idOf(subscription.latest_invoice);
    const invoice = invoiceId ? await stripe.invoices.retrieve(invoiceId) : null;
    const chargeFailure = checkFirstChargeNoTrial({
      planPriceId: plan.stripePriceId,
      session,
      subscription,
      invoice,
    });
    if (chargeFailure) return failed(chargeFailure);
    if (invoiceSubscriptionId(invoice) !== subId) {
      return failed({
        failureStep: "invoice_subscription_shape",
        reason: `Invoice ${invoiceId} does not name subscription ${subId} where the webhook reads it (invoice.parent.subscription_details)`,
      });
    }
    details.invoiceId = invoiceId ?? undefined;
    details.amountPaidCents = invoice?.amount_paid;
    proven.push("charged_7900_at_checkout_no_trial");

    // Wait for the app's durable receipt of a genuine provider delivery.
    async function waitForReceipt(input: {
      type: string;
      objectId: string;
      matches?: (event: Stripe.Event) => boolean;
    }): Promise<{ event: Stripe.Event; tenantId: string } | null> {
      for (let attempt = 0; attempt < 30; attempt++) {
        const page = await stripe.events.list({
          type: input.type,
          created: { gte: runStartedAt },
          limit: 100,
        });
        const event = page.data.find(candidate =>
          !candidate.livemode &&
          (candidate.data.object as { id?: string }).id === input.objectId &&
          (input.matches?.(candidate) ?? true)
        );
        if (event) {
          const [receiptRows] = await db.query(
            "SELECT status, tenantId FROM dayforge_saas_billing_events WHERE stripeEventId = ? AND objectId = ? AND livemode = 0",
            [event.id, input.objectId]
          );
          const receipt = (receiptRows as Array<{ status: string; tenantId: string | null }>)[0];
          if (receipt?.status === "processed" && receipt.tenantId) {
            return { event, tenantId: receipt.tenantId };
          }
        }
        if (attempt < 29) await new Promise(resolve => setTimeout(resolve, 2000));
      }
      return null;
    }

    async function subscriptionRow(tenantId: string) {
      const [subscriptionRows] = await db.query(
        "SELECT status, cancelAtPeriodEnd, currentPeriodEnd, trialEnd, accessEndsAt, lastInvoicePaidAt FROM dayforge_saas_subscriptions WHERE tenantId = ? AND stripeSubscriptionId = ?",
        [tenantId, subId]
      );
      return (subscriptionRows as Array<Record<string, any>>)[0] ?? null;
    }

    // Step 7: REAL Stripe test-mode deliveries must already have arrived through
    // the application's signature-verifying webhook endpoint. Their durable
    // processed receipts prove the endpoint accepted them. Never fabricate the
    // initial event or use "test_signed_event".
    progress("webhook receipts");
    const delivered = await waitForReceipt({ type: "checkout.session.completed", objectId: checkout.id });
    if (!delivered) {
      return failed({
        failureStep: "provider_webhook_delivery",
        reason: "No processed receipt for a genuine Stripe test-mode checkout.session.completed delivery; verify webhook forwarding and signature",
      });
    }
    const deliveredEvent = delivered.event;
    const deliveredTenantId = delivered.tenantId;
    details.tenantId = deliveredTenantId;
    if (invoiceId) {
      const paidReceipt = await waitForReceipt({ type: "invoice.paid", objectId: invoiceId });
      if (!paidReceipt || paidReceipt.tenantId !== deliveredTenantId) {
        return failed({
          failureStep: "invoice_paid_webhook",
          reason: `No processed receipt for invoice.paid on ${invoiceId}: the webhook did not find the invoice's subscription`,
        });
      }
    }
    const provisionedRow = await subscriptionRow(deliveredTenantId);
    if (
      !provisionedRow ||
      provisionedRow.status !== "active" ||
      provisionedRow.trialEnd !== null ||
      !provisionedRow.currentPeriodEnd ||
      !provisionedRow.lastInvoicePaidAt
    ) {
      return failed({
        failureStep: "subscription_record_check",
        reason: `The stored subscription is not active, paid, untrialed and dated: ${JSON.stringify(provisionedRow)}`,
      });
    }
    proven.push("webhooks_checkout_and_invoice_paid_processed");

    // Step 8: Replay the *same provider event ID* with a valid locally computed
    // Stripe test HMAC signature. This proves the real verifier accepts signed
    // bytes and the persisted event-id gate suppresses duplicate effects.
    // It is a LOCAL SIGNED REPLAY, not a second provider-delivered webhook.
    const rawReplay = JSON.stringify(deliveredEvent);
    const replaySignature = stripe.webhooks.generateTestHeaderString({
      payload: rawReplay,
      secret: webhookSecret!,
    });
    const verifiedReplay = stripe.webhooks.constructEvent(rawReplay, replaySignature, webhookSecret!);
    if (verifiedReplay.id !== deliveredEvent.id) {
      return failed({ failureStep: "replay_signature", reason: "Signed replay did not verify to original Stripe event ID" });
    }
    const replayResult = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(rawReplay),
      signature: replaySignature,
      stripe,
    });
    if (replayResult.status !== "ignored" || replayResult.reason !== "duplicate_event") {
      return failed({
        failureStep: "webhook_replay_idempotency",
        reason: `Signed webhook replay returned '${replayResult.status}' (${replayResult.reason})`,
      });
    }
    const [receiptCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM dayforge_saas_billing_events WHERE stripeEventId = ?",
      [deliveredEvent.id]
    );
    if (Number((receiptCountRows as Array<{count: number}>)[0]?.count ?? 0) !== 1) {
      return failed({ failureStep: "webhook_replay_rows", reason: "Replay created multiple billing-event records" });
    }
    proven.push("replay_ignored");

    // Step 9: Verify exactly one tenant provisioned in database
    const [sessionRows] = await db.query(
      "SELECT tenantId FROM dayforge_saas_onboarding_sessions WHERE id = ?",
      [onboarding.id]
    );
    const tenantId = String((sessionRows as any[])[0]?.tenantId ?? "");
    if (!tenantId || tenantId !== deliveredTenantId) {
      return failed({
        failureStep: "tenant_provisioning_check",
        reason: "Provisioned tenant missing or different from the genuine webhook receipt",
      });
    }

    const [tenantCountRows] = await db.query(
      "SELECT COUNT(*) AS count, MAX(slug) AS slug FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    if (Number((tenantCountRows as any[])[0]?.count ?? 0) !== 1) {
      return failed({
        failureStep: "tenant_count_check",
        reason: `Expected exactly 1 tenant record for ${tenantId}`,
      });
    }
    const tenantSlug = String((tenantCountRows as any[])[0]?.slug ?? "");

    const [subscriptionCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM dayforge_saas_subscriptions WHERE tenantId = ? AND stripeSubscriptionId = ?",
      [tenantId, subId]
    );
    if (Number((subscriptionCountRows as Array<{count: number}>)[0]?.count ?? 0) !== 1) {
      return failed({ failureStep: "subscription_count", reason: "Exactly one matching persisted subscription is required" });
    }
    proven.push("one_tenant_provisioned");

    // Step 10: Activate with an actual bcrypt hash, then prove that the REAL
    // password login endpoint issues an authenticated session for this tenant.
    progress("password and login");
    const testPassword = randomBytes(24).toString("base64url");
    const activated = await activateOnboardingOwner({
      sessionId: onboarding.id,
      resumeToken,
      name: "Stripe Acceptance",
      passwordHash: await bcrypt.hash(testPassword, 12),
    });

    if (activated.tenantId !== tenantId) {
      return failed({
        failureStep: "owner_activation_check",
        reason: `Owner activation tenantId '${activated.tenantId}' does not match provisioned '${tenantId}'`,
      });
    }
    async function login(): Promise<{ ok: boolean; status: number; tenantId?: string; cookie: boolean } | null> {
      try {
        const response = await fetch(new URL("/api/dayforge/auth/login", appOrigin!), {
          method: "POST",
          headers: { "content-type": "application/json", origin: appOrigin! },
          body: JSON.stringify({ slug: tenantSlug, email: testEmail, password: testPassword }),
          signal: AbortSignal.timeout(10000),
        });
        const body = await response.json().catch(() => ({})) as { tenantId?: string };
        return { ok: response.ok, status: response.status, tenantId: body.tenantId, cookie: Boolean(response.headers.get("set-cookie")) };
      } catch {
        return null;
      }
    }
    const firstLogin = await login();
    if (!firstLogin) {
      return failed({ failureStep: "owner_login_connection", reason: "The application login endpoint is unavailable" });
    }
    if (!firstLogin.ok || firstLogin.tenantId !== tenantId || !firstLogin.cookie) {
      return failed({ failureStep: "owner_login", reason: "Actual password login did not return the provisioned tenant and session cookie" });
    }
    proven.push("password_login");

    // Step 11: the same owner comes back and signs in again
    const returningLogin = await login();
    if (!returningLogin?.ok || returningLogin.tenantId !== tenantId || !returningLogin.cookie) {
      return failed({ failureStep: "returning_login", reason: `Returning login failed (HTTP ${returningLogin?.status ?? "unreachable"})` });
    }
    proven.push("returning_login");

    // Step 12: the billing portal opens for this tenant's customer, with the sandbox portal configuration
    progress("billing portal");
    const portal = await createLegacyDayforgeBillingPortalSession({ tenantId, requestId: randomUUID(), stripe });
    const portalConfiguration = idOf(portal.configuration);
    if (
      portal.livemode !== false ||
      portalConfiguration !== portalConfigurationId ||
      portal.customer !== idOf(session.customer) ||
      !portal.url.startsWith("https://billing.stripe.com/")
    ) {
      return failed({
        failureStep: "billing_portal",
        reason: `Portal session: livemode=${portal.livemode}, configuration=${portalConfiguration} (expected ${portalConfigurationId}), customer=${portal.customer}`,
      });
    }
    details.portalConfigurationId = portalConfiguration;
    proven.push("billing_portal_configured");

    // Step 13: cancel at period end, as the portal does; access continues
    progress("cancel at period end");
    const scheduled = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    if (scheduled.livemode !== false || !subscriptionScheduledToCancel(scheduled) || scheduled.status !== "active") {
      return failed({ failureStep: "cancel_at_period_end", reason: `Subscription ${subId} did not schedule its cancellation (status ${scheduled.status})` });
    }
    const scheduledReceipt = await waitForReceipt({
      type: "customer.subscription.updated",
      objectId: subId,
      matches: event => subscriptionScheduledToCancel(event.data.object),
    });
    const scheduledRow = scheduledReceipt ? await subscriptionRow(tenantId) : null;
    if (!scheduledRow || !scheduledRow.cancelAtPeriodEnd || scheduledRow.status !== "active" || scheduledRow.accessEndsAt !== null) {
      return failed({
        failureStep: "cancel_at_period_end_webhook",
        reason: `customer.subscription.updated was not processed into a still-active, set-to-end subscription: ${JSON.stringify(scheduledRow)}`,
      });
    }
    const stillIn = await login();
    if (!stillIn?.ok || stillIn.tenantId !== tenantId) {
      return failed({ failureStep: "access_until_period_end", reason: `Login refused before the period ended (HTTP ${stillIn?.status ?? "unreachable"})` });
    }
    proven.push("cancel_at_period_end_keeps_access");

    // Step 14: the subscription ends (canceled now in test mode, standing in for the period end); access ends
    progress("subscription ends");
    const ended = await stripe.subscriptions.cancel(subId, { invoice_now: false, prorate: false });
    if (ended.livemode !== false || ended.status !== "canceled") {
      return failed({ failureStep: "subscription_end", reason: `Subscription ${subId} is '${ended.status}' after cancel` });
    }
    const endedReceipt = await waitForReceipt({ type: "customer.subscription.deleted", objectId: subId });
    const endedRow = endedReceipt ? await subscriptionRow(tenantId) : null;
    if (!endedRow || endedRow.status !== "canceled" || !endedRow.accessEndsAt) {
      return failed({
        failureStep: "subscription_deleted_webhook",
        reason: `customer.subscription.deleted was not processed into ended access: ${JSON.stringify(endedRow)}`,
      });
    }
    const afterEnd = await login();
    if (!afterEnd || afterEnd.ok || afterEnd.cookie) {
      return failed({ failureStep: "access_after_end", reason: `Login after the subscription ended was not refused (HTTP ${afterEnd?.status ?? "unreachable"})` });
    }
    proven.push("subscription_end_refuses_login");

    // Only a real provider session, real webhook receipts, a valid signed replay,
    // durable subscription/tenant, real logins, the configured portal and both
    // cancellation steps can lead here.
    return { status: "PASSED", details: { ...details, tenantId } };
  } finally {
    await db.end();
  }
}
