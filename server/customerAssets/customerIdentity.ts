import { createHash } from "node:crypto";

export type CustomerIdentityInput = {
  phone?: string | null;
  email?: string | null;
  bldgUserId?: number | null;
  firstName?: string | null;
  lastName?: string | null;
  unit?: string | null;
  buildingSlug?: string | null;
  address?: string | null;
};

function normalized(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizedPhone(value: string | null | undefined): string {
  let digits = normalized(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits;
}

/** Pre-stable-identity key retained only for persisted churn/recovery joins. */
export function legacyRawCustomerIdentityKey(
  input: CustomerIdentityInput
): string {
  const phone = normalizedPhone(input.phone);
  if (phone.length >= 7) return `phone:${phone}`;
  return [
    input.firstName,
    input.lastName,
    input.unit,
    input.buildingSlug,
    input.address,
  ]
    .map(normalized)
    .join("|");
}

export function rawCustomerIdentityKey(input: CustomerIdentityInput): string {
  const phone = normalizedPhone(input.phone);
  if (phone.length >= 7) return `phone:${phone}`;
  if (input.bldgUserId != null && input.bldgUserId > 0)
    return `bldg-user:${input.bldgUserId}`;
  const email = normalized(input.email);
  if (email.includes("@")) return `email:${email}`;
  return [
    input.firstName,
    input.lastName,
    input.unit,
    input.buildingSlug,
    input.address,
  ]
    .map(normalized)
    .join("|");
}

function hashIdentityKey(tenantId: string, key: string): string {
  return createHash("sha256").update(`${tenantId}:${key}`).digest("hex");
}

export function customerIdentityHash(
  tenantId: string,
  input: CustomerIdentityInput
): string {
  return hashIdentityKey(tenantId, rawCustomerIdentityKey(input));
}

export function legacyCustomerIdentityHash(
  tenantId: string,
  input: CustomerIdentityInput
): string {
  return hashIdentityKey(tenantId, legacyRawCustomerIdentityKey(input));
}

/** Canonical identity plus any distinct persisted legacy churn key. */
export function customerIdentityHashes(
  tenantId: string,
  input: CustomerIdentityInput
): string[] {
  return Array.from(
    new Set([
      customerIdentityHash(tenantId, input),
      legacyCustomerIdentityHash(tenantId, input),
    ])
  );
}

export function customerAssetId(
  tenantId: string,
  input: CustomerIdentityInput
): string {
  return `customer:${customerIdentityHash(tenantId, input)}`;
}
