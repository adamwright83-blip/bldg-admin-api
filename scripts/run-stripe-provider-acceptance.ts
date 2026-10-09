/* LEGACY DAYFORGE COMPATIBILITY: retained historical billing environment identifiers only; canonical product is JOYSTICK. */
import { runStripeProviderAcceptance } from "../server/saas/stripeProviderAcceptance";

// Run only with dedicated JOYSTICK Stripe TEST credentials, local test MySQL,
// and a running local JOYSTICK app receiving Stripe's signed test webhooks.
// The resume token/password never leave this process.
const result = await runStripeProviderAcceptance({
  onCheckoutReady: ({ sessionId, url }) => {
    process.stdout.write(
      "\nStripe test Checkout created (" + sessionId +
      "). Complete it in a browser now:\n" + url + "\n\n"
    );
  },
});
process.stdout.write(JSON.stringify({
  status: result.status,
  reason: result.reason,
  failureStep: result.failureStep,
  missingConfig: result.missingConfig,
  details: result.details,
}, null, 2) + "\n");
process.exitCode = result.status === "PASSED" ? 0 : result.status === "BLOCKED" ? 2 : 1;
