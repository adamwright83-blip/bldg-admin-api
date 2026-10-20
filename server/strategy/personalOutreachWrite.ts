/**
 * Live read for operator-initiated personal outreach.
 * Marketing SMS opt-in is not required here. Recorded opt-out, a contact
 * restriction, a missing relationship, a stale book, and a missing stop
 * option still block. The automated path keeps evaluateDormantOutreach.
 */
import { DEFAULT_DOCTRINE } from "../../shared/claireProactive";
import { normalizeIdentityPhone } from "../analytics/customerIdentityResolution";
import {
  claireCustomerTruthWithholdingSentence,
} from "../analytics/customerTruthFreshnessDiagnostic";
import {
  customerTruthDispositionOf,
  loadBusinessSourceCoverage,
  type CustomerTruthDisposition,
} from "../analytics/sourceCoverage";
import {
  defaultBusinessQuery,
  defaultBusinessQueryDeps,
  runBusinessQuery,
} from "../analytics/businessQuery";
import { checkCommunicationPermission } from "./communicationPermissionService";
import {
  lastOutreachForKeys,
  loadDormantContactFacts,
  permissionForKeys,
} from "./dormantOutreachGate";
import {
  evaluatePersonalOutreach,
  type PersonalOutreachBlock,
} from "./personalOutreachEligibility";
import { SILVER_LAKE_AREA_TERMS } from "./silverLakeEligibility";
import { readObjectiveArea } from "./strategicEvidenceReaders";

/**
 * Whose objective a roster serves, when the customers live in another book: the signed-in tenant and the operator's
 * canonical identity hold the focus (e.g. "maximize sales in Silver Lake"), and the roster's own `tenantId` is the
 * book the customers, consent and drafts come from. Omitted, the roster's tenant is both.
 */
export type OutreachObjectiveScope = { tenantId: string; canonicalOperatorId: string };

function objectiveAreaFor(input: { tenantId: string; canonicalOperatorId: string; objective?: OutreachObjectiveScope }) {
  return readObjectiveArea(
    input.objective
      ? { ...input.objective, orderBookTenantId: input.tenantId }
      : { tenantId: input.tenantId, canonicalOperatorId: input.canonicalOperatorId }
  );
}

export class PersonalOutreachBlocked extends Error {
  readonly code = "personal_outreach_blocked" as const;
  readonly blocks: PersonalOutreachBlock[];

  constructor(explanation: string, blocks: PersonalOutreachBlock[]) {
    super(explanation);
    this.name = "PersonalOutreachBlocked";
    this.blocks = blocks;
  }
}

export type PersonalOutreachContact = {
  identityId: string;
  name: string;
  phone: string | null;
  daysSinceLastOrder: number | null;
  paidOrders: number;
  lifetimeCents: number;
  lastOrderDate: string | null;
  lastOrderSummary: string | null;
  smsConsent: "opted_in" | "opted_out" | "expired" | "unknown";
  blocks: PersonalOutreachBlock[];
};

export type PersonalOutreachRoster = {
  area: string;
  freshness: CustomerTruthDisposition;
  lapsedCount: number | null;
  emptyMeansNoLapsedCustomers: boolean;
  withheldReason: string | null;
  contacts: PersonalOutreachContact[];
};

export type PersonalHandoffIdentity = {
  customerId: string;
  customerName: string;
  phone: string;
  daysSinceLastOrder: number;
  territoryId: string;
  territoryName: string;
  suggestedMessage: string;
};

const NOT_AN_EMPTY_LIST =
  "Missing customers are not proof that nobody is inactive.";

function withheldRoster(input: {
  area: string;
  freshness: CustomerTruthDisposition;
  reason: string;
}): PersonalOutreachRoster {
  return {
    area: input.area,
    freshness: input.freshness,
    lapsedCount: null,
    emptyMeansNoLapsedCustomers: false,
    withheldReason: input.reason,
    contacts: [],
  };
}

function addressMatchesArea(address: string, areaLabel: string): boolean {
  const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const terms = [areaLabel, ...SILVER_LAKE_AREA_TERMS];
  return terms.some(term => new RegExp(`\\b${escape(term)}\\b`, "i").test(address));
}

function territoryMatches(areaLabel: string, requested: string | undefined): boolean {
  const left = areaLabel.toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = (requested ?? areaLabel).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function daysBetween(lastOrderDate: string, today: string): number {
  const last = Date.parse(`${lastOrderDate.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return Math.round((now - last) / 86_400_000);
}

export function buildPersonalSuggestedMessage(name: string, daysSinceLastOrder: number): string {
  const firstName = name.split(" ")[0] || name;
  return `Hey ${firstName}! It's Adam from Laundry Farm. It's been about ${daysSinceLastOrder} days since your last pickup. We can take laundry off your plate when you want. Reply STOP if you don't want these texts.`;
}

export async function readPersonalOutreachRoster(input: {
  tenantId: string;
  canonicalOperatorId: string;
  timeZone: string;
  now: Date;
  territoryId?: string;
  limit?: number;
  objective?: OutreachObjectiveScope;
}): Promise<PersonalOutreachRoster | null> {
  if (!input.tenantId.trim()) return null;
  const area = await objectiveAreaFor(input).catch(() => null);
  if (!area) {
    return withheldRoster({
      area: "Silver Lake",
      freshness: "source_unavailable",
      reason: `The recovery objective could not be read. ${NOT_AN_EMPTY_LIST}`,
    });
  }
  if (!territoryMatches(area.label, input.territoryId)) {
    return withheldRoster({
      area: area.label,
      freshness: "current",
      reason: `This village is ${area.label}, not ${input.territoryId ?? "the requested territory"}. No one from another area is shown.`,
    });
  }
  let coverage: Awaited<ReturnType<typeof loadBusinessSourceCoverage>> | null = null;
  try {
    coverage = await loadBusinessSourceCoverage({ tenantId: input.tenantId, now: input.now });
  } catch {
    coverage = null;
  }
  const freshness = customerTruthDispositionOf(coverage);
  if (!coverage || freshness !== "current") {
    const cleancloud = coverage?.sources.find(source => source.sourceId === "cleancloud");
    const gap = cleancloud && cleancloud.status !== "fresh" ? ` CleanCloud coverage is ${cleancloud.status}.` : "";
    return withheldRoster({
      area: area.label,
      freshness,
      reason: `${claireCustomerTruthWithholdingSentence(freshness) ?? "CleanCloud customer truth could not be read."}${gap} ${NOT_AN_EMPTY_LIST}`,
    });
  }
  const deps = { ...defaultBusinessQueryDeps, now: () => input.now, timeZone: () => input.timeZone };
  const dormant = await runBusinessQuery(
    input.tenantId,
    { ...defaultBusinessQuery("dormant_customers"), listMembers: true, limit: 200, filters: area.filters },
    deps
  );
  if (dormant.status !== "ok" || dormant.data.kind !== "customers") {
    return withheldRoster({
      area: area.label,
      freshness,
      reason:
        dormant.status === "unavailable"
          ? `${dormant.reason} ${NOT_AN_EMPTY_LIST}`
          : `Dormant customers could not be read. ${NOT_AN_EMPTY_LIST}`,
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
  const members = [...dormant.data.population.members]
    .filter(member => member.matched)
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, input.limit ?? 8);
  const contacts: PersonalOutreachContact[] = [];
  for (const member of members) {
    const history = await runBusinessQuery(
      input.tenantId,
      { ...defaultBusinessQuery("customer_history"), customerName: member.displayName, filters: area.filters },
      deps
    ).catch(() => null);
    const detail =
      history?.status === "ok" && history.data.kind === "customer_history"
        ? history.data.details.find(item => item.identityId === member.identityId)
        : undefined;
    if (!detail) continue;
    const keys = detail.identityKeys ?? [];
    const phone = keys.find(key => key.startsWith("phone:"))?.slice("phone:".length) ?? null;
    const phoneDigits = normalizeIdentityPhone(phone);
    const smsDigits = phoneDigits && phoneDigits.length === 10 ? phoneDigits : null;
    const permission = permissionForKeys(facts, input.tenantId, keys.length ? keys : smsDigits ? [`phone:${smsDigits}`] : []);
    const restriction = await checkCommunicationPermission({
      tenantId: input.tenantId,
      subjectType: "customer",
      subjectId: member.identityId,
      channel: "sms",
      now: input.now,
    }).catch(() => null);
    const address = (detail.addresses ?? []).join(" ");
    const days = detail.daysSinceLastOrder ?? (member.lastOrderDate ? daysBetween(member.lastOrderDate, today) : null);
    const decision = evaluatePersonalOutreach({
      tenantId: input.tenantId,
      freshness,
      sourceReadable: true,
      matched: member.matched,
      inTerritory: address ? addressMatchesArea(address, area.label) : true,
      paidOrders: member.orderCount,
      capturedCents: member.revenueCents,
      lastOrderDate: member.lastOrderDate,
      dormant: true,
      contradictingRecentOrder: days !== null && days < DEFAULT_DOCTRINE.dormantQuietDays,
      phoneDigits: smsDigits,
      optedOut: permission.state === "opted_out" || restriction?.permissionStatus === "opted_out",
      contactRestricted: !restriction || restriction.permissionStatus === "refused" || restriction.allowed === false,
      permissionReadable: facts.readable && restriction !== null,
      lastOutreachOn: lastOutreachForKeys(
        facts,
        input.tenantId,
        keys.length ? keys : smsDigits ? [`phone:${smsDigits}`] : [],
        smsDigits
      ),
      today,
    });
    if (!decision.eligible) continue;
    contacts.push({
      identityId: member.identityId,
      name: member.displayName,
      phone,
      daysSinceLastOrder: days,
      paidOrders: member.orderCount,
      lifetimeCents: member.revenueCents,
      lastOrderDate: member.lastOrderDate,
      lastOrderSummary: detail.lastOrder?.summary ?? null,
      smsConsent: permission.state,
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
          ? `No dormant customer in this area currently has a recorded paid relationship, a phone, and a clear window. A phone number is not an existing relationship. Opt-outs stay blocked. ${NOT_AN_EMPTY_LIST}`
          : `Opt-out records could not be read, so nobody is offered a handoff. ${NOT_AN_EMPTY_LIST}`
        : null,
    contacts,
  };
}

export async function assertPersonalOutreachHandoff(input: {
  tenantId: string;
  canonicalOperatorId: string;
  customerId: string;
  messageBody: string;
  territoryId?: string;
  now?: Date;
  timeZone?: string;
  objective?: OutreachObjectiveScope;
}): Promise<PersonalHandoffIdentity> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? "America/Los_Angeles";
  const today = now.toISOString().slice(0, 10);
  const area = await objectiveAreaFor(input).catch(() => null);
  if (!area) {
    throw new PersonalOutreachBlocked(
      `The recovery objective could not be read. ${NOT_AN_EMPTY_LIST}`,
      ["source_unreadable"]
    );
  }
  let coverage: Awaited<ReturnType<typeof loadBusinessSourceCoverage>> | null = null;
  try {
    coverage = await loadBusinessSourceCoverage({ tenantId: input.tenantId, now });
  } catch {
    coverage = null;
  }
  const freshness = customerTruthDispositionOf(coverage);
  if (!coverage || freshness !== "current") {
    const decision = evaluatePersonalOutreach({
      tenantId: input.tenantId,
      freshness,
      sourceReadable: false,
      matched: false,
      inTerritory: false,
      paidOrders: 0,
      capturedCents: 0,
      lastOrderDate: null,
      dormant: false,
      contradictingRecentOrder: false,
      phoneDigits: null,
      optedOut: false,
      contactRestricted: false,
      permissionReadable: false,
      lastOutreachOn: null,
      today,
      approvedMessage: input.messageBody,
    });
    const cleancloud = coverage?.sources.find(source => source.sourceId === "cleancloud");
    const gap = cleancloud && cleancloud.status !== "fresh" ? ` CleanCloud coverage is ${cleancloud.status}.` : "";
    throw new PersonalOutreachBlocked(
      `${claireCustomerTruthWithholdingSentence(freshness) ?? decision.explanation}${gap} ${NOT_AN_EMPTY_LIST}`,
      decision.blocks
    );
  }
  const deps = { ...defaultBusinessQueryDeps, now: () => now, timeZone: () => timeZone };
  const dormant = await runBusinessQuery(
    input.tenantId,
    { ...defaultBusinessQuery("dormant_customers"), listMembers: true, limit: 200, filters: area.filters },
    deps
  );
  if (dormant.status !== "ok" || dormant.data.kind !== "customers") {
    throw new PersonalOutreachBlocked(
      `Dormant customers could not be read. ${NOT_AN_EMPTY_LIST}`,
      ["source_unreadable"]
    );
  }
  const member = dormant.data.population.members.find(item => item.identityId === input.customerId);
  if (!member) {
    throw new PersonalOutreachBlocked(
      `This person is not in the current inactive set for ${area.label}. A phone number is not an existing relationship. ${NOT_AN_EMPTY_LIST}`,
      ["unmatched_identity"]
    );
  }
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
  const phone = keys.find(key => key.startsWith("phone:"))?.slice("phone:".length) ?? null;
  const phoneDigits = normalizeIdentityPhone(phone);
  const smsDigits = phoneDigits && phoneDigits.length === 10 ? phoneDigits : null;
  const facts = await loadDormantContactFacts({ tenantId: input.tenantId, now });
  const permission = permissionForKeys(
    facts,
    input.tenantId,
    keys.length ? keys : smsDigits ? [`phone:${smsDigits}`] : []
  );
  const restriction = await checkCommunicationPermission({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: member.identityId,
    channel: "sms",
    now,
  }).catch(() => null);
  const address = (detail?.addresses ?? []).join(" ");
  const days = detail?.daysSinceLastOrder ?? (member.lastOrderDate ? daysBetween(member.lastOrderDate, today) : null);
  const decision = evaluatePersonalOutreach({
    tenantId: input.tenantId,
    freshness,
    sourceReadable: true,
    matched: member.matched,
    inTerritory: territoryMatches(area.label, input.territoryId) && (address ? addressMatchesArea(address, area.label) : true),
    paidOrders: member.orderCount,
    capturedCents: member.revenueCents,
    lastOrderDate: member.lastOrderDate,
    dormant: true,
    contradictingRecentOrder: days !== null && days < DEFAULT_DOCTRINE.dormantQuietDays,
    phoneDigits: smsDigits,
    optedOut: permission.state === "opted_out" || restriction?.permissionStatus === "opted_out",
    contactRestricted: !restriction || restriction.permissionStatus === "refused" || restriction.allowed === false,
    permissionReadable: facts.readable && restriction !== null,
    lastOutreachOn: lastOutreachForKeys(
      facts,
      input.tenantId,
      keys.length ? keys : smsDigits ? [`phone:${smsDigits}`] : [],
      smsDigits
    ),
    today,
    approvedMessage: input.messageBody,
  });
  if (!decision.eligible || !smsDigits || !phone) {
    throw new PersonalOutreachBlocked(decision.explanation, decision.blocks.length ? decision.blocks : ["unmatched_identity"]);
  }
  return {
    customerId: member.identityId,
    customerName: member.displayName,
    phone,
    daysSinceLastOrder: days ?? DEFAULT_DOCTRINE.dormantQuietDays,
    territoryId: input.territoryId ?? "silver-lake",
    territoryName: area.label,
    suggestedMessage: buildPersonalSuggestedMessage(member.displayName, days ?? DEFAULT_DOCTRINE.dormantQuietDays),
  };
}
