export type PersistentOperatorTenantScope = {
  tenantId: string;
  operatorUserId: string;
};

export function assertPersistentOperatorTenantScope(
  input: PersistentOperatorTenantScope
): PersistentOperatorTenantScope {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId) throw new Error("persistent operator requires tenantId");
  if (!operatorUserId) throw new Error("persistent operator requires operatorUserId");
  return { tenantId, operatorUserId };
}
