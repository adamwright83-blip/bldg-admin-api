import { defaultBusinessQuery, defaultBusinessQueryDeps, runBusinessQuery } from "../analytics/businessQuery";
import { claireCustomerTruthWithholdingSentence } from "../analytics/customerTruthFreshnessDiagnostic";
import {
  customerTruthDispositionOf,
  loadBusinessSourceCoverage,
  type CustomerTruthDisposition,
} from "../analytics/sourceCoverage";
import { normalizeIdentityPhone } from "../analytics/customerIdentityResolution";
import { readObjectiveArea } from "./strategicEvidenceReaders";
import {
  evaluateDormantOutreach,
  lastOutreachForKeys,
  loadDormantContactFacts,
  permissionForKeys,
  type DormantOutreachBlock,
  type SmsPermissionState,
} from "./dormantOutreachGate";

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
  smsConsent: SmsPermissionState;
  phoneOnFile: boolean;
  permissionSource: string | null;
  permissionCapturedAt: string | null;
  blocks: DormantOutreachBlock[];
};

export type WinBackDossier = {
  area: string;
  freshness: CustomerTruthDisposition;
  /** Null when an empty list must not be read as "no lapsed customers". */
  lapsedCount: number | null;
  emptyMeansNoLapsedCustomers: boolean;
  withheldReason: string | null;
  contacts: WinBackContact[];
};

const keyValue = (keys: string[], kind: "phone" | "email") =>
  keys.find(k => k.startsWith(`${kind}:`))?.slice(kind.length + 1) ?? null;

function withheld(input: {
  area: string;
  freshness: CustomerTruthDisposition;
  reason: string;
}): WinBackDossier {
  return {
    area: input.area,
    freshness: input.freshness,
    lapsedCount: null,
    emptyMeansNoLapsedCustomers: false,
    withheldReason: input.reason,
    contacts: [],
  };
}

/**
 * The prepared call sheet for the objective-area win-back. Read-only.
 * Personalized contacts require a current book, a real paid history, a
 * 10-digit phone, and recorded SMS consent. A phone number is not consent.
 */
export async function readWinBackDossier(input: {
  tenantId: string;
  canonicalOperatorId: string;
  timeZone: string;
  now: Date;
  limit?: number;
}): Promise<WinBackDossier | null> {
  if (!input.tenantId.trim()) return null;
  const area = await readObjectiveArea(input);
  if (!area) return null;
  const coverage = await loadBusinessSourceCoverage({
    tenantId: input.tenantId,
    now: input.now,
  }).catch(() => null);
  const freshness = customerTruthDispositionOf(coverage);
  if (freshness !== "current") {
    return withheld({
      area: area.label,
      freshness,
      reason:
        claireCustomerTruthWithholdingSentence(freshness) ??
        `CleanCloud customer truth is ${freshness}. Personalized outreach is withheld until the book is current.`,
    });
  }
  const deps = { ...defaultBusinessQueryDeps, now: () => input.now, timeZone: () => input.timeZone };
  const dormant = await runBusinessQuery(
    input.tenantId,
    { ...defaultBusinessQuery("dormant_customers"), listMembers: true, limit: 50, filters: area.filters },
    deps
  );
  if (dormant.status !== "ok" || dormant.data.kind !== "customers") {
    return withheld({
      area: area.label,
      freshness,
      reason:
        dormant.status === "unavailable"
          ? dormant.reason
          : "Dormant customers could not be read. That is not an empty customer list.",
    });
  }
  if (dormant.data.population.count === 0) {
    return {
      area: area.label,
      freshness,
      lapsedCount: 0,
      emptyMeansNoLapsedCustomers: true,
      withheldReason: null,
      contacts: [],
    };
  }
  const facts = await loadDormantContactFacts({ tenantId: input.tenantId, now: input.now });
  const today = input.now.toISOString().slice(0, 10);
  const top = [...dormant.data.population.members]
    .filter(member => member.matched)
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
        ? history.data.details.find(item => item.identityId === member.identityId)
        : undefined;
    const keys = detail?.identityKeys ?? [];
    const phone = detail ? keyValue(keys, "phone") : null;
    const phoneDigits = normalizeIdentityPhone(phone);
    const smsDigits = phoneDigits && phoneDigits.length === 10 ? phoneDigits : null;
    const permission = permissionForKeys(facts, input.tenantId, keys.length ? keys : phone ? [`phone:${phoneDigits}`] : []);
    const lastOutreachOn = lastOutreachForKeys(
      facts,
      input.tenantId,
      keys.length ? keys : phoneDigits ? [`phone:${phoneDigits}`] : [],
      smsDigits
    );
    const decision = evaluateDormantOutreach({
      tenantId: input.tenantId,
      freshness,
      matched: member.matched,
      inTerritory: true,
      paidOrders: member.orderCount,
      capturedCents: member.revenueCents,
      lastOrderDate: member.lastOrderDate,
      dormant: true,
      contradictingRecentOrder: false,
      phoneDigits: smsDigits,
      permission: permission.state,
      permissionReadable: facts.readable,
      lastOutreachOn,
      today,
    });
    if (!decision.eligible || !detail) continue;
    contacts.push({
      identityId: member.identityId,
      name: member.displayName,
      lastOrderDate: member.lastOrderDate,
      daysSinceLastOrder: detail.daysSinceLastOrder ?? null,
      paidOrders: member.orderCount,
      lifetimeCents: member.revenueCents,
      medianGapDays: detail.medianGapDays ?? null,
      lastOrderSummary: detail.lastOrder?.summary ?? null,
      phone,
      email: keyValue(keys, "email"),
      smsConsent: permission.state,
      phoneOnFile: Boolean(smsDigits),
      permissionSource: permission.sourceReference,
      permissionCapturedAt: permission.capturedAt,
      blocks: decision.blocks,
    });
  }
  return {
    area: area.label,
    freshness,
    lapsedCount: dormant.data.population.count,
    emptyMeansNoLapsedCustomers: false,
    withheldReason:
      contacts.length === 0
        ? facts.readable
          ? "No dormant customer in this area currently has recorded SMS consent, a 10-digit phone, and a clear outreach window. A phone number on an order is not consent."
          : "Contact permission could not be read. A phone number on an order is not SMS consent, so nobody is eligible."
        : null,
    contacts,
  };
}
