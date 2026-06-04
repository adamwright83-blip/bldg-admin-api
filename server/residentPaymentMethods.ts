import type Stripe from "stripe";
import { findStripeCardByPhone } from "./db";
import { normalizePhoneForStorage } from "./phone";

export type VerifiedResidentCard = {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  cardLast4: string;
  brand: string;
  expMonth: number;
  expYear: number;
};

function customerIdFromPaymentMethod(paymentMethod: Stripe.PaymentMethod): string | null {
  const customer = paymentMethod.customer;
  if (!customer) return null;
  if (typeof customer === "string") return customer;
  if ("id" in customer && typeof customer.id === "string") return customer.id;
  return null;
}

export async function verifyStripePaymentMethodOwnership(
  stripe: Stripe,
  stripeCustomerId: string,
  stripePaymentMethodId: string
): Promise<VerifiedResidentCard | null> {
  const customer = await stripe.customers.retrieve(stripeCustomerId);
  if ("deleted" in customer && customer.deleted) return null;

  const paymentMethod = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
  if (paymentMethod.type !== "card" || !paymentMethod.card) return null;

  const ownerCustomerId = customerIdFromPaymentMethod(paymentMethod);
  if (ownerCustomerId !== stripeCustomerId) return null;

  return {
    stripeCustomerId,
    stripePaymentMethodId,
    cardLast4: paymentMethod.card.last4,
    brand: paymentMethod.card.brand,
    expMonth: paymentMethod.card.exp_month,
    expYear: paymentMethod.card.exp_year,
  };
}

export async function lookupVerifiedResidentCardByPhone(
  stripe: Stripe,
  phone: string
): Promise<VerifiedResidentCard | null> {
  const normalizedPhone = normalizePhoneForStorage(phone);
  if (!normalizedPhone) return null;

  const dbCard = await findStripeCardByPhone(normalizedPhone);
  if (!dbCard) return null;

  return verifyStripePaymentMethodOwnership(
    stripe,
    dbCard.stripeCustomerId,
    dbCard.stripePaymentMethodId
  );
}
