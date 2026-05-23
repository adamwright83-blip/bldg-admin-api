import dotenv from "dotenv";
import Stripe from "stripe";
import { getOrderById, updateOrderIntake, ensurePickupCompletedOperationsEventForOrder } from "../server/db";
import { centsToDollars } from "../shared/pricing";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
  dotenv.config({ path: ".env.local", override: false });
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const orderId = Number(argValue("order-id") ?? argValue("orderId") ?? "");
const paymentIntentId = argValue("payment-intent") ?? argValue("paymentIntent");

if (!Number.isInteger(orderId) || orderId <= 0) {
  console.error("Missing or invalid --order-id=123");
  process.exit(1);
}

if (!paymentIntentId?.startsWith("pi_")) {
  console.error("Missing or invalid --payment-intent=pi_xxx");
  process.exit(1);
}

const stripeKey = process.env.STRIPE_SECRET_KEY_OVERRIDE || process.env.STRIPE_SECRET_KEY || "";
if (!stripeKey || stripeKey.length < 20) {
  console.error("STRIPE_SECRET_KEY or STRIPE_SECRET_KEY_OVERRIDE must be set.");
  process.exit(1);
}

const before = await getOrderById(orderId);
if (!before) {
  console.error(`Order #${orderId} not found.`);
  process.exit(1);
}

const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" as any });
const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

if (paymentIntent.status !== "succeeded") {
  console.error(`PaymentIntent ${paymentIntent.id} is ${paymentIntent.status}, not succeeded.`);
  process.exit(1);
}

if (paymentIntent.amount < 50) {
  console.error(`PaymentIntent ${paymentIntent.id} amount ${paymentIntent.amount} is below Stripe minimum.`);
  process.exit(1);
}

const paidAt = new Date(paymentIntent.created * 1000);
await updateOrderIntake(orderId, {
  paid: true,
  paidAt,
  stripePaymentIntentId: paymentIntent.id,
  total: centsToDollars(paymentIntent.amount),
  status: "processing",
});
const eventResult = await ensurePickupCompletedOperationsEventForOrder(orderId, {
  actorDisplayName: "Admin charge repair",
  actualEventTimestamp: paidAt,
  reason: "stripe_payment_repair",
});
const after = await getOrderById(orderId);

console.log(JSON.stringify({
  ok: true,
  paymentIntent: {
    id: paymentIntent.id,
    status: paymentIntent.status,
    amountCents: paymentIntent.amount,
    paidAt: paidAt.toISOString(),
  },
  operationsEvent: eventResult,
  before: {
    id: before.id,
    paid: before.paid,
    paidAt: before.paidAt,
    total: before.total,
    status: before.status,
    stripePaymentIntentId: before.stripePaymentIntentId,
  },
  after: after && {
    id: after.id,
    paid: after.paid,
    paidAt: after.paidAt,
    total: after.total,
    status: after.status,
    stripePaymentIntentId: after.stripePaymentIntentId,
  },
}, null, 2));
