/**
 * Null and blank order tenants are the legacy laundry tenant. A session
 * tenant is never rewritten to "default" — only stored order rows are.
 */
export function canonicalOrderTenantId(
  tenantId: string | null | undefined
): string {
  if (tenantId == null) return "default";
  const trimmed = tenantId.trim();
  return trimmed.length > 0 ? trimmed : "default";
}

export function orderVisibleToTenant(
  order: { tenantId?: string | null },
  tenantId: string
): boolean {
  return canonicalOrderTenantId(order.tenantId) === tenantId;
}
