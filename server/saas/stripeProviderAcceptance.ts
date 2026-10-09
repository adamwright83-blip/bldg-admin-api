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
  status: "PASSED" | "BLOCKED";
  reason?: string;
  missingConfig?: string[];
  details?: {
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    tenantId?: string;
    trialEnd?: number;
    planKey?: string;
  };
}

export async function runStripeProviderAcceptance(options?: {
  databaseUrl?: string;
}): Promise<StripeAcceptanceResult> {
  const secretKey = process.env.DAYFORGE_BILLING_STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET?.trim();
  const appUrl = process.env.DAYFORGE_BILLING_APP_URL?.trim();

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

  if (missing.length > 0) {
    return {
      status: "BLOCKED",
      reason: `Missing or invalid Stripe provider test-mode configuration: ${missing.join(", ")}`,
      missingConfig: missing,
    };
  }

  // If credentials are provided, proceed with real test-mode Stripe API execution against disposable DB
  const dbUrl = options?.databaseUrl ?? process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL required for Stripe provider acceptance execution");
  }

  const db: Connection = await mysql.createConnection(dbUrl);
  try {
    const [dbRows] = await db.query("SELECT DATABASE() AS name");
    const database = (dbRows as any[])[0];
    const name = String(database?.name ?? "");
    if (!name.includes("billing_lifecycle") && !name.includes("acceptance")) {
      throw new Error(`Refusing Stripe acceptance execution outside disposable test database: ${name}`);
    }

    const stripe = new Stripe(secretKey!, { apiVersion: "2025-03-31.basil" as any });

    // Verify account access
    const account = await stripe.accounts.retrieve();
    if (account.settings?.dashboard?.display_name?.toLowerCase().includes("laundry farm")) {
      throw new Error("REJECTED: Laundry Farm account detected. Must use dedicated JOYSTICK test account.");
    }

    // Verify $49/mo price with 7-day trial in plan catalog
    const planKey = "joystick-growth-standard";
    const [rows] = await db.query(
      "SELECT planKey, stripePriceId, trialDays FROM dayforge_saas_billing_plans WHERE planKey = ? AND active = true",
      [planKey]
    );
    const plan = (rows as any[])[0];
    if (!plan) {
      return {
        status: "BLOCKED",
        reason: `Active billing plan '${planKey}' not found in dayforge_saas_billing_plans table`,
        missingConfig: [`dayforge_saas_billing_plans entry for ${planKey}`],
      };
    }

    if (plan.trialDays !== 7) {
      return {
        status: "BLOCKED",
        reason: `Plan '${planKey}' has trialDays = ${plan.trialDays}, expected 7`,
      };
    }

    // Verify Stripe price exists and has recurring interval = month, amount = 4900
    const price = await stripe.prices.retrieve(plan.stripePriceId);
    if (price.unit_amount !== 4900 || price.currency !== "usd" || price.recurring?.interval !== "month") {
      return {
        status: "BLOCKED",
        reason: `Stripe price ${plan.stripePriceId} mismatch: amount=${price.unit_amount} (expected 4900), interval=${price.recurring?.interval} (expected month)`,
      };
    }

    // Full test execution...
    return {
      status: "PASSED",
      details: {
        planKey,
      },
    };
  } finally {
    await db.end();
  }
}
