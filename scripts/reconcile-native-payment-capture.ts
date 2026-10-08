/** Explicit historical Payment reconciliation. Default is read-only preview. */
import Stripe from "stripe";
import { getOrderById } from "../server/db";
import { reconcileNativeStripeCapture } from "../server/authority/paymentAdmission";
const value = (name: string) =>
  process.argv
    .find(arg => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const tenantId = value("tenant")?.trim();
const orderId = Number(value("order-id"));
if (!tenantId || !Number.isSafeInteger(orderId) || orderId <= 0)
  throw new Error("Explicit --tenant and --order-id required");
const order = await getOrderById(orderId);
if (!order || order.tenantId !== tenantId || !order.stripePaymentIntentId)
  throw new Error("Established tenant/order/provider evidence required");
const key = process.env.STRIPE_SECRET_KEY;
if (!key)
  throw new Error("STRIPE_SECRET_KEY is required for provider reconciliation");
const stripe = new Stripe(key);
const intent = await stripe.paymentIntents.retrieve(
  order.stripePaymentIntentId
);
const capture = {
  paymentIntentId: intent.id,
  status: intent.status,
  amountReceivedCents: intent.amount_received,
  currency: intent.currency,
};
if (intent.status !== "succeeded")
  throw new Error("Provider capture is not succeeded; no amount admitted");
const apply = process.argv.includes("--apply");
const receipt = apply
  ? await reconcileNativeStripeCapture({ tenantId, orderId, capture })
  : null;
console.log(
  JSON.stringify({
    mode: apply ? "applied" : "preview",
    tenantId,
    orderId,
    capture,
    receiptId: receipt?.id ?? null,
  })
);
