/**
 * Resolve a hashed StrategyEngine dormant snapshot id back to an operational
 * customer row. Phone numbers stay off snapshots, fiction, and public missions.
 * Contact is available only at the authorized send boundary.
 */

import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";
import { listAdminCustomerAggregates } from "../db";
import {
  deriveDormantEligibleCustomers,
  strategyCustomerSnapshotId,
  type DormantEligibleCustomer,
} from "../strategy/snapshotDormantCustomers";
import type { FrozenRescueFacts } from "../../shared/spiritHumanRescue";

export type ResolvedDormantContact = {
  snapshotCustomerId: string;
  firstName: string;
  lastName: string;
  buildingSlug: string | null;
  lastOrderAt: Date;
  paidOrderCount: number;
  historicalSpendCents: number;
  phone: string;
};

export type SendContactResolution =
  | { kind: "ready"; contact: ResolvedDormantContact }
  | { kind: "no_longer_dormant" }
  | { kind: "not_found" };

export async function loadTenantCustomerAggregates(
  tenantId: string,
  aggregates?: AdminCustomerAggregateDbRow[]
): Promise<AdminCustomerAggregateDbRow[]> {
  return aggregates ?? listAdminCustomerAggregates(tenantId);
}

export function freezeFactsFromCandidate(
  candidate: DormantEligibleCustomer
): FrozenRescueFacts {
  return {
    snapshotCustomerId: candidate.id,
    firstName: candidate.firstName,
    ...(candidate.buildingName ? { buildingName: candidate.buildingName } : {}),
    lastOrderAt: candidate.lastOrderAt,
    daysSinceLastOrder: candidate.daysSinceLastOrder,
  };
}

export function resolveSendContactFromAggregates(input: {
  tenantId: string;
  snapshotCustomerId: string;
  rows: AdminCustomerAggregateDbRow[];
  now?: Date;
}): SendContactResolution {
  const now = input.now ?? new Date();
  const eligibleIds = new Set(
    deriveDormantEligibleCustomers(input.rows, {
      tenantId: input.tenantId,
      now,
      limit: Number.MAX_SAFE_INTEGER,
    }).customers.map(item => item.id)
  );
  for (const row of input.rows) {
    const snapshotCustomerId = strategyCustomerSnapshotId(input.tenantId, row);
    if (snapshotCustomerId !== input.snapshotCustomerId) continue;
    if (!eligibleIds.has(snapshotCustomerId)) {
      return { kind: "no_longer_dormant" };
    }
    const phone = row.phone?.trim() ?? "";
    if (!phone) return { kind: "not_found" };
    return {
      kind: "ready",
      contact: {
        snapshotCustomerId,
        firstName: row.firstName.trim(),
        lastName: row.lastName.trim(),
        buildingSlug: row.buildingSlug,
        lastOrderAt: row.lastOrderAt,
        paidOrderCount: row.paidOrderCount,
        historicalSpendCents: Math.round(row.lifetimeSpend * 100),
        phone,
      },
    };
  }
  return { kind: "not_found" };
}

export function resolveDormantContactFromAggregates(input: {
  tenantId: string;
  snapshotCustomerId: string;
  rows: AdminCustomerAggregateDbRow[];
  now?: Date;
}): ResolvedDormantContact | null {
  const result = resolveSendContactFromAggregates(input);
  return result.kind === "ready" ? result.contact : null;
}

export async function resolveSendContact(input: {
  tenantId: string;
  snapshotCustomerId: string;
  now?: Date;
  aggregates?: AdminCustomerAggregateDbRow[];
}): Promise<SendContactResolution> {
  const rows = await loadTenantCustomerAggregates(input.tenantId, input.aggregates);
  return resolveSendContactFromAggregates({
    tenantId: input.tenantId,
    snapshotCustomerId: input.snapshotCustomerId,
    rows,
    now: input.now,
  });
}

export async function resolveDormantContact(input: {
  tenantId: string;
  snapshotCustomerId: string;
  now?: Date;
  aggregates?: AdminCustomerAggregateDbRow[];
}): Promise<ResolvedDormantContact | null> {
  const result = await resolveSendContact(input);
  return result.kind === "ready" ? result.contact : null;
}

export function freezeFactsFromContact(
  contact: Omit<ResolvedDormantContact, "phone">,
  now: Date
): {
  snapshotCustomerId: string;
  firstName: string;
  lastOrderAt: string;
  daysSinceLastOrder: number;
  paidOrderCount: number;
  historicalSpendCents: number;
} {
  const elapsedMs = now.getTime() - contact.lastOrderAt.getTime();
  const daysSinceLastOrder = Math.max(0, Math.floor(elapsedMs / 86_400_000));
  return {
    snapshotCustomerId: contact.snapshotCustomerId,
    firstName: contact.firstName,
    lastOrderAt: contact.lastOrderAt.toISOString(),
    daysSinceLastOrder,
    paidOrderCount: contact.paidOrderCount,
    historicalSpendCents: contact.historicalSpendCents,
  };
}
