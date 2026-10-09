/* LEGACY DAYFORGE COMPATIBILITY: retained historical Stripe environment literals and billing plan references only; canonical product is JOYSTICK. */
import mysql, { type Connection } from "mysql2/promise";
import Stripe from "stripe";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
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
    checkoutSessionId?: string;
    checkoutUrl?: string;
  };
}

export interface RunStripeAcceptanceOptions {
  databaseUrl?: string;
  allowlistedAccountId?: string;
  stripeClient?: Stripe;
  dbConnection?: Connection;
  onCheckoutReady?: (details: { sessionId: string; url: string }) => void;
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

  // Injected clients are useful for unit tests, never for a real-provider PASSED result.
  const injectedDependencies = Boolean(options?.stripeClient || options?.dbConnection);
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

  // The real onboarding store uses process.env.DATABASE_URL, not the dbConnection
  // passed to this harness. Guard BOTH against accidentally writing elsewhere.
  const dbUrl = options?.databaseUrl ?? process.env.DATABASE_URL;
  if (!options?.dbConnection) {
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
  let appOrigin: string;
  try {
    const parsed = new URL(appUrl!);
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.protocol !== "http:") {
      return { status: "FAILED", failureStep: "app_origin_guard", reason: "Only a local isolated HTTP application origin is permitted" };
    }
    appOrigin = parsed.origin;
  } catch {
    return { status: "FAILED", failureStep: "app_origin_guard", reason: "Invalid test application URL" };
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
    // Strict safety check: must be explicitly dedicated test database
    if (name !== "joystick_stripe_acceptance") {
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

    if (checkout.url) options?.onCheckoutReady?.({ sessionId: checkout.id, url: checkout.url });

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
          : "Complete the actual hosted Stripe test Checkout; session creation is not payment-method collection",
        details: {
          planKey,
          stripeAccountId: account.id,
          checkoutSessionId: checkout.id,
          checkoutUrl: checkout.url ?? undefined,
        },
      };
    }
    if (injectedDependencies) {
      return {
        status: "FAILED",
        failureStep: "injected_dependencies",
        reason: "Injected Stripe/database adapters cannot establish REAL_STRIPE_PROVIDER_PASSED",
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

    // Step 7: A REAL Stripe test-mode event must already have arrived through
    // the application's signature-verifying webhook endpoint. Its durable
    // processed receipt proves the endpoint accepted the original delivery.
    // Never fabricate the initial event or use "test_signed_event".
    let deliveredEvent: Stripe.Event | undefined;
    let deliveredTenantId: string | undefined;
    for (let attempt = 0; attempt < 20; attempt++) {
      const eventPage = await stripe.events.list({ type: "checkout.session.completed", limit: 100 });
      deliveredEvent = eventPage.data.find(event =>
        !event.livemode && (event.data.object as { id?: string }).id === checkout.id
      );
      if (deliveredEvent) {
        const [receiptRows] = await db.query(
          "SELECT status, tenantId FROM dayforge_saas_billing_events WHERE stripeEventId = ? AND objectId = ? AND livemode = 0",
          [deliveredEvent.id, checkout.id]
        );
        const receipt = (receiptRows as Array<{ status: string; tenantId: string | null }>)[0];
        if (receipt?.status === "processed" && receipt.tenantId) {
          deliveredTenantId = receipt.tenantId;
          break;
        }
      }
      if (attempt < 19) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    if (!deliveredEvent || !deliveredTenantId) {
      return {
        status: "FAILED",
        failureStep: "provider_webhook_delivery",
        reason: "No processed receipt for a genuine Stripe test-mode checkout.session.completed delivery; verify webhook forwarding and signature",
      };
    }

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
      return { status: "FAILED", failureStep: "replay_signature", reason: "Signed replay did not verify to original Stripe event ID" };
    }
    const replayResult = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from(rawReplay),
      signature: replaySignature,
      stripe,
    });
    if (replayResult.status !== "ignored" || replayResult.reason !== "duplicate_event") {
      return {
        status: "FAILED",
        failureStep: "webhook_replay_idempotency",
        reason: `Signed webhook replay returned '${replayResult.status}' (${replayResult.reason})`,
      };
    }
    const [receiptCountRows] = await db.query(
      "SELECT COUNT(*) AS count FROM dayforge_saas_billing_events WHERE stripeEventId = ?",
      [deliveredEvent.id]
    );
    if (Number((receiptCountRows as Array<{count: number}>)[0]?.count ?? 0) !== 1) {
      return { status: "FAILED", failureStep: "webhook_replay_rows", reason: "Replay created multiple billing-event records" };
    }

    // Step 9: Verify exactly one tenant provisioned in database
    const [sessionRows] = await db.query(
      "SELECT tenantId FROM dayforge_saas_onboarding_sessions WHERE id = ?",
      [started.session.id]
    );
    const tenantId = String((sessionRows as any[])[0]?.tenantId ?? "");
    if (!tenantId || tenantId !== deliveredTenantId) {
      return {
        status: "FAILED",
        failureStep: "tenant_provisioning_check",
        reason: "Provisioned tenant missing or different from the genuine webhook receipt",
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

    const [subscriptionRows] = await db.query(
      "SELECT COUNT(*) AS count FROM dayforge_saas_subscriptions WHERE tenantId = ? AND stripeSubscriptionId = ?",
      [tenantId, subId]
    );
    if (Number((subscriptionRows as Array<{count: number}>)[0]?.count ?? 0) !== 1) {
      return { status: "FAILED", failureStep: "subscription_count", reason: "Exactly one matching persisted subscription is required" };
    }

    // Step 10: Activate with an actual bcrypt hash, then prove that the REAL
    // password login endpoint issues an authenticated session for this tenant.
    const testPassword = randomBytes(24).toString("base64url");
    const activated = await activateOnboardingOwner({
      sessionId: started.session.id,
      resumeToken: started.resumeToken!,
      name: "Stripe Tester",
      passwordHash: await bcrypt.hash(testPassword, 12),
    });

    if (activated.tenantId !== tenantId) {
      return {
        status: "FAILED",
        failureStep: "owner_activation_check",
        reason: `Owner activation tenantId '${activated.tenantId}' does not match provisioned '${tenantId}'`,
      };
    }
    let loginResponse: Response;
    try {
      loginResponse = await fetch(new URL("/api/dayforge/auth/login", appOrigin), {
        method: "POST",
        headers: { "content-type": "application/json", origin: appOrigin },
        body: JSON.stringify({ slug: `stripe-${suffix}`, email: testEmail, password: testPassword }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return { status: "FAILED", failureStep: "owner_login_connection", reason: "Isolated application login endpoint is unavailable" };
    }
    const loginBody = await loginResponse.json().catch(() => ({})) as { tenantId?: string };
    if (!loginResponse.ok || loginBody.tenantId !== tenantId || !loginResponse.headers.get("set-cookie")) {
      return { status: "FAILED", failureStep: "owner_login", reason: "Actual password login did not return the provisioned tenant and session cookie" };
    }

    // Only a real provider session, real webhook receipt, valid signed replay,
    // durable subscription/tenant and real login can lead here.
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
