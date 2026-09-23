import { loadDormantEligibleCustomers } from "../strategy/snapshotDormantCustomers";
import type { DormantEligibleCustomer } from "../strategy/snapshotDormantCustomers";

/** Selection payload: hashed id and safe presentation. No contact fields. */
export function toPublicRescueCandidate(candidate: DormantEligibleCustomer): DormantEligibleCustomer {
  return {
    id: candidate.id,
    firstName: candidate.firstName,
    ...(candidate.buildingName ? { buildingName: candidate.buildingName } : {}),
    lastOrderAt: candidate.lastOrderAt,
    daysSinceLastOrder: candidate.daysSinceLastOrder,
  };
}

export async function listDormantRescueCandidates(input: {
  tenantId: string;
  now?: Date;
}): Promise<DormantEligibleCustomer[]> {
  const result = await loadDormantEligibleCustomers({
    tenantId: input.tenantId,
    now: input.now ?? new Date(),
  });
  return result.customers.map(toPublicRescueCandidate);
}
