import { defaultBusinessQuery, defaultBusinessQueryDeps, runBusinessQuery } from "../analytics/businessQuery";
import { readObjectiveArea } from "./strategicEvidenceReaders";

export type WinBackContact = {
  identityId: string;
  name: string;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  paidOrders: number;
  lifetimeCents: number;
  /** Usual gap between orders, when they ordered more than once. */
  medianGapDays: number | null;
  lastOrderSummary: string | null;
  phone: string | null;
  email: string | null;
};

const keyValue = (keys: string[], kind: "phone" | "email") =>
  keys.find(k => k.startsWith(`${kind}:`))?.slice(kind.length + 1) ?? null;

/**
 * The prepared call sheet for the objective-area win-back: lapsed customers in
 * the operator's stated neighborhood, highest lifetime spend first, with the
 * contact details already on their own orders. Read-only; it contacts no one.
 */
export async function readWinBackDossier(input: {
  tenantId: string;
  canonicalOperatorId: string;
  timeZone: string;
  now: Date;
  limit?: number;
}): Promise<{ area: string; lapsedCount: number; contacts: WinBackContact[] } | null> {
  const area = await readObjectiveArea(input);
  if (!area) return null;
  const deps = { ...defaultBusinessQueryDeps, now: () => input.now, timeZone: () => input.timeZone };
  const dormant = await runBusinessQuery(
    input.tenantId,
    { ...defaultBusinessQuery("dormant_customers"), listMembers: true, limit: 50, filters: area.filters },
    deps
  );
  if (dormant.status !== "ok" || dormant.data.kind !== "customers") return null;
  const top = [...dormant.data.population.members]
    .filter(m => m.matched)
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, input.limit ?? 5);
  const contacts: WinBackContact[] = [];
  for (const member of top) {
    const history = await runBusinessQuery(
      input.tenantId,
      { ...defaultBusinessQuery("customer_history"), customerName: member.displayName, filters: area.filters },
      deps
    ).catch(() => null);
    const detail =
      history?.status === "ok" && history.data.kind === "customer_history"
        ? history.data.details.find(d => d.identityId === member.identityId)
        : undefined;
    contacts.push({
      identityId: member.identityId,
      name: member.displayName,
      lastOrderDate: member.lastOrderDate,
      daysSinceLastOrder: detail?.daysSinceLastOrder ?? null,
      paidOrders: member.orderCount,
      lifetimeCents: member.revenueCents,
      medianGapDays: detail?.medianGapDays ?? null,
      lastOrderSummary: detail?.lastOrder?.summary ?? null,
      phone: detail ? keyValue(detail.identityKeys, "phone") : null,
      email: detail ? keyValue(detail.identityKeys, "email") : null,
    });
  }
  return { area: area.label, lapsedCount: dormant.data.population.count, contacts };
}
