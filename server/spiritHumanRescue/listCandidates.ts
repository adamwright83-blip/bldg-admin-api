import { loadDormantEligibleCustomers } from "../strategy/snapshotDormantCustomers";
import type { DormantEligibleCustomer } from "../strategy/snapshotDormantCustomers";

export async function listDormantRescueCandidates(input: {
  tenantId: string;
  now?: Date;
}): Promise<DormantEligibleCustomer[]> {
  const result = await loadDormantEligibleCustomers({
    tenantId: input.tenantId,
    now: input.now ?? new Date(),
  });
  return result.customers;
}
