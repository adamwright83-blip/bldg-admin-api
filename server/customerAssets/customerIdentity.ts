import { createHash } from "node:crypto";

export type CustomerIdentityInput = {
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  unit?: string | null;
  buildingSlug?: string | null;
  address?: string | null;
};

function normalized(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

export function rawCustomerIdentityKey(input: CustomerIdentityInput): string {
  const phone = normalized(input.phone).replace(/\D/g, "");
  if (phone.length >= 7) return `phone:${phone}`;
  return [input.firstName, input.lastName, input.unit, input.buildingSlug, input.address]
    .map(normalized)
    .join("|");
}

export function customerIdentityHash(tenantId: string, input: CustomerIdentityInput): string {
  return createHash("sha256")
    .update(`${tenantId}:${rawCustomerIdentityKey(input)}`)
    .digest("hex");
}

export function customerAssetId(tenantId: string, input: CustomerIdentityInput): string {
  return `customer:${customerIdentityHash(tenantId, input)}`;
}
