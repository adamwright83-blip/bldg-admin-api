/**
 * Boss-demo provider status.
 *
 * Inspects the SAME env vars each production adapter reads to decide whether
 * a provider is actually wired up. This never fabricates a status — it only
 * reports what is really present in process.env at call time.
 */

export type ProviderState = "LIVE" | "TEST" | "SIMULATED" | "NOT_CONFIGURED";
export type PrintState =
  | "BROWSER_PDF_FALLBACK"
  | "CONNECTED"
  | "NOT_CONFIGURED";

export type DayforgeProviderStatus = {
  google: ProviderState;
  stripe: ProviderState;
  email: ProviderState;
  sms: ProviderState;
  print: PrintState;
};

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

/** Territory discovery requires separate Places Search and geocoding credentials. */
export function googleProviderStatus(
  env: NodeJS.ProcessEnv = process.env
): ProviderState {
  return present(env.GOOGLE_PLACES_API_KEY) &&
    present(env.GOOGLE_GEOCODING_API_KEY)
    ? "LIVE"
    : "NOT_CONFIGURED";
}

/**
 * server/saas/saasBilling.ts `getDayforgeBillingStripe()` reads
 * DAYFORGE_BILLING_STRIPE_SECRET_KEY (min length 20) — that's the actual
 * adapter DayForge billing uses, distinct from the legacy marketplace
 * STRIPE_SECRET_KEY. A `sk_test_` key reports TEST, a live key reports LIVE.
 */
export function stripeProviderStatus(
  env: NodeJS.ProcessEnv = process.env
): ProviderState {
  const secretKey = env.DAYFORGE_BILLING_STRIPE_SECRET_KEY?.trim();
  if (!secretKey || secretKey.length < 20) return "NOT_CONFIGURED";
  return secretKey.startsWith("sk_live_") ? "LIVE" : "TEST";
}

/** server/procurement/agentMailVendorEmailProvider.ts requires these three env vars. */
export function emailProviderStatus(
  env: NodeJS.ProcessEnv = process.env
): ProviderState {
  const required = [
    "AGENTMAIL_API_KEY",
    "AGENTMAIL_VENDOR_INBOX_ID",
    "AGENTMAIL_VENDOR_INBOX_EMAIL",
  ];
  return required.every(name => present(env[name])) ? "LIVE" : "NOT_CONFIGURED";
}

/** server/_core/sms.ts reads TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER. */
export function smsProviderStatus(
  env: NodeJS.ProcessEnv = process.env
): ProviderState {
  const required = [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
  ];
  return required.every(name => present(env[name])) ? "LIVE" : "NOT_CONFIGURED";
}

/**
 * There is no dedicated print/label provider adapter in this repo today — the
 * product falls back to browser-rendered PDFs. Report that truthfully instead
 * of a status that implies hardware integration exists.
 */
export function printProviderStatus(): PrintState {
  return "BROWSER_PDF_FALLBACK";
}

export function getDayforgeProviderStatus(
  env: NodeJS.ProcessEnv = process.env
): DayforgeProviderStatus {
  return {
    google: googleProviderStatus(env),
    stripe: stripeProviderStatus(env),
    email: emailProviderStatus(env),
    sms: smsProviderStatus(env),
    print: printProviderStatus(),
  };
}
