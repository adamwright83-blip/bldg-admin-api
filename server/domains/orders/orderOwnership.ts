import type { Order } from "../../../drizzle/schema";

type OrderOwnershipRecord = Pick<
  Order,
  "tenantId" | "vendorId" | "bldgUserId"
>;

export class OrderOwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderOwnershipError";
  }
}

/**
 * Legacy native laundry rows with no tenant belong to the explicit legacy
 * "default" tenant. This normalizes persisted data only; it never turns a
 * missing actor/session tenant into default authority.
 */
export function canonicalOrderTenantId(
  tenantId: string | null | undefined
): string {
  const trimmed = tenantId?.trim() ?? "";
  return trimmed || "default";
}

export function hasOrderTenantAuthority(input: {
  order: { tenantId?: string | null };
  tenantId: string | null | undefined;
  allowCrossTenant?: boolean;
  allowLegacyDefaultWildcard?: boolean;
}): boolean {
  const actorTenantId = input.tenantId?.trim() ?? "";
  if (!actorTenantId) return false;
  if (input.allowCrossTenant) return true;

  const orderTenantId = canonicalOrderTenantId(input.order.tenantId);
  if (
    input.allowLegacyDefaultWildcard &&
    actorTenantId === "default"
  ) {
    return true;
  }
  return orderTenantId === actorTenantId;
}

export function assertOrderTenantAuthority(input: {
  order: { tenantId?: string | null };
  tenantId: string | null | undefined;
  allowCrossTenant?: boolean;
  allowLegacyDefaultWildcard?: boolean;
  label?: string;
}): string {
  const tenantId = input.tenantId?.trim() ?? "";
  if (!tenantId) {
    throw new OrderOwnershipError(
      `${input.label ?? "Order"} access requires tenant authority`
    );
  }
  if (!hasOrderTenantAuthority(input)) {
    throw new OrderOwnershipError(
      `${input.label ?? "Order"} does not belong to tenant`
    );
  }
  return tenantId;
}

/**
 * Vendor policy is path-specific. Some existing status paths allow an
 * unassigned order while intake/detail paths require assignment. Callers must
 * state which already-established behavior they are preserving.
 */
export function assertOrderVendorAuthority(input: {
  order: { vendorId?: number | null };
  vendorId: number;
  allowUnassigned: boolean;
  label?: string;
}): void {
  const assignedVendorId = input.order.vendorId;
  if (assignedVendorId == null) {
    if (input.allowUnassigned) return;
    throw new OrderOwnershipError(
      `${input.label ?? "Order"} is not assigned to vendor`
    );
  }
  if (assignedVendorId !== input.vendorId) {
    throw new OrderOwnershipError(
      `${input.label ?? "Order"} does not belong to vendor`
    );
  }
}

export function assertOrderResidentAuthority(input: {
  order: { bldgUserId?: number | null };
  residentId: number | null | undefined;
  label?: string;
}): number {
  const stored = input.order.bldgUserId;
  if (
    !Number.isSafeInteger(stored) ||
    stored == null ||
    stored <= 0 ||
    !Number.isSafeInteger(input.residentId) ||
    input.residentId == null ||
    input.residentId <= 0 ||
    stored !== input.residentId
  ) {
    throw new OrderOwnershipError(
      `${input.label ?? "Order"} does not belong to resident`
    );
  }
  return stored;
}
