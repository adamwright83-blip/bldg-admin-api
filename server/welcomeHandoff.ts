import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { matchBuilding } from "@shared/buildings";
import { normalizePhoneForStorage } from "./phone";

export const WELCOME_JWT_ISSUER = "laundry-butler";
export const WELCOME_JWT_AUDIENCE = "held-resident-app";
const WELCOME_TOKEN_TTL_SECONDS = 5 * 60;
const DEFAULT_LAUNDRY_BUTLER_WEB_ORIGIN =
  "https://laundrybutler.bldg.chat";

export type WelcomeOrder = {
  id: number;
  phone: string;
  firstName: string;
  lastName: string;
  email: string | null;
  unit: string | null;
  address: string;
  buildingSlug: string | null;
};

export function submittedIdentityMatchesOrder(
  order: WelcomeOrder,
  submitted: { firstName: string; lastName: string; email?: string; phone: string }
): boolean {
  const clean = (value: string | null | undefined) => value?.trim().toLowerCase() || "";
  return (
    normalizePhoneForStorage(order.phone) === normalizePhoneForStorage(submitted.phone) &&
    clean(order.firstName) === clean(submitted.firstName) &&
    clean(order.lastName) === clean(submitted.lastName) &&
    clean(order.email) === clean(submitted.email)
  );
}

type StripeOwnershipInput = {
  orderId: number;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
};

type SetupIntentOwnership = {
  status: string;
  customer: string | { id: string } | null;
  payment_method: string | { id: string } | null;
  metadata: Record<string, string> | null;
};

type PaymentMethodOwnership = { customer: string | { id: string } | null };

export function stripeObjectsMatchOrder(
  input: StripeOwnershipInput,
  setupIntent: SetupIntentOwnership,
  paymentMethod: PaymentMethodOwnership
): boolean {
  const id = (value: string | { id: string } | null) =>
    typeof value === "string" ? value : value?.id;
  return (
    setupIntent.status === "succeeded" &&
    id(setupIntent.customer) === input.stripeCustomerId &&
    id(paymentMethod.customer) === input.stripeCustomerId &&
    id(setupIntent.payment_method) === input.stripePaymentMethodId &&
    setupIntent.metadata?.orderId === String(input.orderId)
  );
}

function optionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function residentWebOrigin(): string {
  const configured = process.env.LAUNDRY_BUTLER_WEB_ORIGIN?.trim();
  const origin = configured || DEFAULT_LAUNDRY_BUTLER_WEB_ORIGIN;
  const parsed = new URL(origin);
  if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("RESIDENT_WEB_ORIGIN must use https in production");
  }
  return parsed.origin;
}

/** Server-internal signer. Never expose this using orderId-only public input. */
export async function createPortalWelcomeUrl(
  order: WelcomeOrder
): Promise<string> {
  const secretValue = process.env.APP_SHARED_API_SECRET?.trim();
  if (!secretValue) throw new Error("APP_SHARED_API_SECRET is not configured");

  const phone = normalizePhoneForStorage(order.phone);
  if (!phone) throw new Error("Order has no valid resident phone");

  const buildingSlug =
    optionalText(order.buildingSlug)?.toLowerCase() ||
    matchBuilding(order.address)?.slug;
  const claims = {
    phone,
    firstName: optionalText(order.firstName),
    lastName: optionalText(order.lastName),
    email: optionalText(order.email)?.toLowerCase(),
    unit: optionalText(order.unit),
    buildingSlug,
    orderId: order.id,
  };

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(WELCOME_JWT_ISSUER)
    .setAudience(WELCOME_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + WELCOME_TOKEN_TTL_SECONDS
    )
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(secretValue));

  return `${residentWebOrigin()}/welcome?token=${encodeURIComponent(token)}`;
}

export async function decodeWelcomeUrlForTest(url: string, secret: string) {
  const token = new URL(url).searchParams.get("token");
  if (!token) throw new Error("Missing token");
  return jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
    issuer: WELCOME_JWT_ISSUER,
    audience: WELCOME_JWT_AUDIENCE,
  });
}
