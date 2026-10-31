/* LEGACY DAYFORGE COMPATIBILITY: retained historical billing environment identifiers only; canonical product is JOYSTICK. */
import {
  runStripeProviderAcceptance,
  type StripeAcceptanceTarget,
} from "../server/saas/stripeProviderAcceptance";

/**
 * The JOYSTICK Stripe SANDBOX acceptance run: checkout ($79/month, no trial, charged at checkout), the real webhook
 * deliveries, tenant provisioning, password, login, returning login, billing portal and cancellation. Test mode only:
 * an sk_live_/rk_live_ key, or anything that is not sk_test_, stops it before any Stripe call.
 *
 * Inside the deployed service (the sandbox webhook endpoint delivers to it; its database is reachable only there):
 *   railway ssh --service bldg-admin-api -- sh -c 'cd /app && JOYSTICK_STRIPE_CHECKOUT_WAIT_MS=600000 npx tsx scripts/run-stripe-provider-acceptance.ts --target=railway-sandbox'
 * Locally, against a loopback app, a local joystick_stripe_acceptance database and `stripe listen --forward-to`:
 *   JOYSTICK_STRIPE_CHECKOUT_WAIT_MS=300000 pnpm exec tsx scripts/run-stripe-provider-acceptance.ts
 *
 * Every variable it needs is in docs/billing/JOYSTICK_STRIPE_SANDBOX.md. The resume token and password never leave
 * this process; only the test Checkout URL is printed.
 */
function targetFromArgs(args: string[]): StripeAcceptanceTarget | null {
  const index = args.findIndex(arg => arg === "--target" || arg.startsWith("--target="));
  if (index < 0) return "local";
  const raw = args[index]!.includes("=") ? args[index]!.split("=")[1] : args[index + 1];
  if (raw === "railway-sandbox" || raw === "railway_sandbox") return "railway_sandbox";
  if (raw === "local") return "local";
  return null;
}

const target = targetFromArgs(process.argv.slice(2));
if (!target) {
  process.stdout.write("Unknown --target. Use --target=railway-sandbox inside Railway, or omit it for a local run.\n");
  process.exit(2);
}

const result = await runStripeProviderAcceptance({
  target,
  onCheckoutReady: ({ sessionId, url }) => {
    process.stdout.write(
      "\nStripe TEST-MODE Checkout created (" + sessionId +
      "). Complete it in a browser now with a Stripe test card (4242 4242 4242 4242, any future date, any CVC):\n" +
      url + "\n\n"
    );
  },
  onProgress: step => process.stdout.write(`… ${step}\n`),
});
process.stdout.write(JSON.stringify({
  status: result.status,
  reason: result.reason,
  failureStep: result.failureStep,
  missingConfig: result.missingConfig,
  details: result.details,
}, null, 2) + "\n");
process.exitCode = result.status === "PASSED" ? 0 : result.status === "BLOCKED" ? 2 : 1;
