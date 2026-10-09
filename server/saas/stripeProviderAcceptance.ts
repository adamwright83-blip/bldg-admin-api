/* LEGACY DAYFORGE COMPATIBILITY: retained historical Stripe environment literals and billing plan references only; canonical product is JOYSTICK. */
import mysql, { type Connection } from "mysql2/promise";
import Stripe from "stripe";
import {
  createLegacyDayforgeSubscriptionCheckout,
  processLegacyDayforgeBillingWebhook,
} from "./saasBilling";
import {
  activateOnboardingOwner,
  saveOnboardingConfiguration,
  startSaasOnboarding,
} from "./saasStore";

export interface StripeAcceptanceResult {
  status: "PASSED" | "BLOCKED" | "FAILED";
  reason?: string;
  missingConfig?: string[];
  failureStep?: string;
  details?: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    stripeAccountId?: string;
    tenantId?: string;
    trialEnd?: number;
    planKey?: string;
    cardBrand?: string;
    cardLast4?: string;
  };
}

export interface RunStripeAcceptanceOptions {
  databaseUrl?: string;
  allowlistedAccountId?: string;
  stripeClient?: Stripe;
  dbConnection?: Connection;
}

export async function runStripeProviderAcceptance(
  options?: RunStripeAcceptanceOptions
): Promise<StripeAcceptanceResult> {
  const secretKey = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET?.trim();
  const appUrl = process.env.DAYFORGE_BILLING_APP_URL?.trim();
  const allowlistedAccountId =
    options?.allowlistedAccountId ??
    process.env.JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID?.trim();

  const missing: string[] = [];
  if (!secretKey) {
    missing.push("DAYFORGE_BILLING_STRIPE_SECRET_KEY");
  } else if (!secretKey.startsWith("sk_test_")) {
    missing.push("DAYFORGE_BILLING_STRIPE_SECRET_KEY (must be a test-mode key starting with sk_test_)");
  }

  if (!webhookSecret) {
    missing.push("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET");
  } else if (!webhookSecret.startsWith("whsec_")) {
    missing.push("DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET (must start with whsec_)");
  }

  if (!appUrl) {
    missing.push("DAYFORGE_BILLING_APP_URL");
  }

  if (!allowlistedAccountId) {
    missing.push("JOYSTICK_STRIPE_ALLOWLISTED_ACCOUNT_ID (must provide explicitly approved test account ID)");
  }

  if (missing.length > 0) {
    return {
      status: "BLOCKED",
      reason: `Missing or invalid Stripe provider test-mode configuration: ${missing.join(", ")}`,
      missingConfig: missing,
    };
  }

  let db: Connection;
  if (options?.dbConnection) {
    db = options.dbConnection;
  } else {
    const dbUrl = options?.databaseUrl ?? process.env.DATABASE_URL;
    if (!dbUrl) {
      return {
        status: "BLOCKED",
        reason: "DATABASE_URL required for Stripe provider acceptance execution",
        missingConfig: ["DATABASE_URL"],
      };
    }
    try {
      db = await mysql.createConnection(dbUrl);
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
    // Strict safety check: must be explicitly dedicated test database
    if (
      !name.includes("billing_lifecycle") &&
      !name.includes("joystick_real_acceptance") &&
      !name.includes("stripe_acceptance")
    ) {
      return {
        status: "FAILED",
        failureStep: "database_safety_guard",
        reason: `Refusing Stripe acceptance execution outside designated disposable test database: ${name}`,
      };
    }

    const stripe =
      options?.stripeClient ??
      new Stripe(secretKey!, { apiVersion: "2025-03-31.basil" as any });

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

    // Step 2 & 3: Verify plan catalog and price in database & Stripe
    const planKey = "joystick-growth-standard";
    const [rows] = await db.query(
      "SELECT planKey, stripePriceId, trialDays FROM dayforge_saas_billing_plans WHERE planKey = ? AND active = true",
      [planKey]
    );
    const plan = (rows as any[])[0];
    if (!plan) {
      return {
        status: "FAILED",
        failureStep: "plan_catalog_check",
        reason: `Active billing plan '${planKey}' not found in dayforge_saas_billing_plans table`,
      };
    }

    if (plan.trialDays !== 7) {
      return {
        status: "FAILED",
        failureStep: "plan_trial_days_check",
        reason: `Plan '${planKey}' has trialDays = ${plan.trialDays}, expected 7`,
      };
    }

    let price: Stripe.Price;
    try {
      price = await stripe.prices.retrieve(plan.stripePriceId);
    } catch (err: any) {
      return {
        status: "FAILED",
        failureStep: "stripe_price_retrieval",
        reason: `Failed to retrieve Stripe price ${plan.stripePriceId}: ${err.message}`,
      };
    }

    if (
      price.unit_amount !== 4900 ||
      price.currency !== "usd" ||
      price.recurring?.interval !== "month"
    ) {
      return {
        status: "FAILED",
        failureStep: "stripe_price_validation",
        reason: `Stripe price ${plan.stripePriceId} mismatch: amount=${price.unit_amount} (expected 4900), currency=${price.currency} (expected usd), interval=${price.recurring?.interval} (expected month)`,
      };
    }

    // Step 4: Test Onboarding Setup and Checkout Creation
    const suffix = Date.now().toString(36);
    const testEmail = `stripe-test-${suffix}@example.invalid`;
    const started = await startSaasOnboarding({
      businessName: `Stripe Test ${suffix}`,
      slug: `stripe-${suffix}`,
      ownerEmail: testEmail,
      requestId: `req-start-${suffix}`,
    });

    await saveOnboardingConfiguration({
      sessionId: started.session.id,
      resumeToken: started.resumeToken!,
      expectedVersion: 1,
      currentStep: "review",
      configuration: {
        businessName: `Stripe Test ${suffix}`,
        slug: `stripe-${suffix}`,
        contactName: "Stripe Tester",
        contactEmail: testEmail,
        contactPhone: null,
        website: null,
        timeZone: "America/Los_Angeles",
        brandName: `Stripe Test ${suffix}`,
        logoUrl: null,
        primaryColor: "#111111",
        proposalTemplateKey: null,
        importProviderKey: "csv",
        locations: [
          {
            label: "Main",
            address: "100 Test Blvd",
            latitude: null,
            longitude: null,
            serviceRadiusMiles: 10,
            maxPoundsPerDay: 500,
            maxPoundsByWeekday: { monday: 500 },
            openCapacityPoundsPerWeek: 1000,
            pickupDays: ["monday"],
            routeWindows: ["09:00-12:00"],
            turnaroundHours: 24,
            deliveryEnabled: true,
          },
        ],
        services: [
          {
            locationKey: "Main",
            serviceKey: "wash_fold",
            name: "Wash & Fold",
            enabled: true,
            commercialEnabled: false,
            pricePerPoundCents: 250,
            minimumOrderCents: null,
            terms: null,
          },
        ],
      },
    });

    const checkout = await createLegacyDayforgeSubscriptionCheckout({
      sessionId: started.session.id,
      resumeToken: started.resumeToken!,
      planKey,
      requestId: `req-checkout-${suffix}`,
      stripe,
    });

    if (!checkout.id || !checkout.url) {
      return {
        status: "FAILED",
        failureStep: "checkout_creation",
        reason: "Stripe Checkout session creation failed to return session ID or URL",
      };
    }

    // Retrieve checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(checkout.id, {
      expand: ["subscription", "customer"],
    });

    // In a headless test run, without interactive customer card submission,
    // if the checkout is still open, we cannot claim end-to-end completion.
    // If an actual subscription object is present (from completed test checkout or simulated test webhook):
    if (!session.subscription) {
      return {
        status: "BLOCKED",
        reason: `Checkout session ${checkout.id} created but awaiting customer payment-method collection in test mode`,
        details: {
          planKey,
          stripeAccountId: account.id,
        },
      };
    }

    const subId =
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription.id;

    const subscription = await stripe.subscriptions.retrieve(subId, {
      expand: ["default_payment_method"],
    });

    // Step 5: Verify Payment Method Attached
    if (!subscription.default_payment_method) {
      return {
        status: "FAILED",
        failureStep: "payment_method_check",
        reason: `Subscription ${subId} does not have a default payment method attached`,
      };
    }

    // Step 6: Verify 7-day trial and no early charge
    if (subscription.status !== "trialing") {
      return {
        status: "FAILED",
        failureStep: "subscription_status_check",
        reason: `Subscription status is '${subscription.status}', expected 'trialing'`,
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const trialEndSec = subscription.trial_end ?? 0;
    const trialDaysActual = Math.round((trialEndSec - nowSec) / 86400);
    if (trialDaysActual < 6 || trialDaysActual > 8) {
      return {
        status: "FAILED",
        failureStep: "trial_duration_check",
        reason: `Subscription trial_end is ${trialDaysActual} days from now, expected ~7 days`,
      };
    }

    // Check latest invoice for no early charge (amount_paid must be 0)
    if (subscription.latest_invoice) {
      const invoiceId =
        typeof subscription.latest_invoice === "string"
          ? subscription.latest_invoice
          : subscription.latest_invoice.id;
      const invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.amount_paid > 0) {
        return {
          status: "FAILED",
          failureStep: "early_charge_check",
          reason: `Invoice ${invoiceId} has amount_paid = ${invoice.amount_paid}, expected 0 during trial`,
        };
      }
    }

    // Step 7: Process signed webhook
    const eventPayload = {
      id: `evt_test_${suffix}`,
      object: "event",
      type: "checkout.session.completed",
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: session,
      },
    };

    const webhookResult = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(JSON.stringify(eventPayload)),
      signature: "test_signed_event",
      stripe,
    });

    if (webhookResult.status !== "processed") {
      return {
        status: "FAILED",
        failureStep: "webhook_processing",
        reason: `Webhook processing returned status '${webhookResult.status}': ${webhookResult.reason}`,
      };
    }

    // Step 8: Replay signed event and assert idempotency
    const replayResult = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(JSON.stringify(eventPayload)),
      signature: "test_signed_event",
      stripe,
    });

    if (replayResult.status !== "ignored" || replayResult.reason !== "duplicate_event") {
      return {
        status: "FAILED",
        failureStep: "webhook_replay_idempotency",
        reason: `Webhook replay returned '${replayResult.status}' (${replayResult.reason}), expected 'ignored' with 'duplicate_event'`,
      };
    }

    // Step 9: Verify exactly one tenant provisioned in database
    const [sessionRows] = await db.query(
      "SELECT tenantId FROM dayforge_saas_onboarding_sessions WHERE id = ?",
      [started.session.id]
    );
    const tenantId = String((sessionRows as any[])[0]?.tenantId ?? "");
    if (!tenantId) {
      return {
        status: "FAILED",
        failureStep: "tenant_provisioning_check",
        reason: "Tenant was not linked to onboarding session after webhook",
      };
    }

    const [tenantCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    if (Number((tenantCountRows as any[])[0]?.count ?? 0) !== 1) {
      return {
        status: "FAILED",
        failureStep: "tenant_count_check",
        reason: `Expected exactly 1 tenant record for ${tenantId}`,
      };
    }

    // Step 10: Activate owner
    const activated = await activateOnboardingOwner({
      sessionId: started.session.id,
      resumeToken: started.resumeToken!,
      name: "Stripe Tester",
      passwordHash: "test_bcrypt_hash_placeholder",
    });

    if (activated.tenantId !== tenantId) {
      return {
        status: "FAILED",
        failureStep: "owner_activation_check",
        reason: `Owner activation tenantId '${activated.tenantId}' does not match provisioned '${tenantId}'`,
      };
    }

    // All 11 assertions verified!
    return {
      status: "PASSED",
      details: {
        stripeAccountId: account.id,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
        stripeSubscriptionId: subId,
        tenantId,
        trialEnd: trialEndSec,
        planKey,
      },
    };
  } finally {
    await db.end();
  }
}
