import { BUILDINGS, buildingFromSlug, matchBuilding, type BuildingConfig } from "../../shared/buildings";
import { listActiveTenantMemberships } from "../saas/tenantAccess";
import { listTenantUnpaidOrders } from "../domains/orders/unpaidOrderReadService";
import { parsePeriodPhrase, resolvePeriod, type PeriodSpec } from "./businessPeriods";
import { reconcileLedgerSpan } from "./canonicalRevenue";
import { findSuspectedCrossSourcePairs, loadPaidOrderLedger, type PaidOrderEvent, type PaidOrderLedger } from "./paidOrderLedger";

/**
 * Read-only Laundry Farm company view.
 *
 * Laundry Farm is the company. `laundry_farm` and `default` stay separate
 * tenant books. This reader loads each authorized book through the canonical
 * paid-order ledger and states one company picture: building first, payment
 * rail second. It does not merge tenant rows or write payments.
 */
export const LAUNDRY_FARM_TENANT_ID = "laundry_farm";
export const LAUNDRY_BUTLER_TENANT_ID = "default";
export const LAUNDRY_FARM_COMPANY_TENANTS = [LAUNDRY_FARM_TENANT_ID, LAUNDRY_BUTLER_TENANT_ID] as const;
export const LAUNDRY_FARM_COMPANY_TIME_ZONE = "America/Los_Angeles" as const;
export const LAUNDRY_FARM_COMPANY_READER = "readLaundryFarmCompanyView" as const;

/** Synthetic proof fixtures. They are not customers and never enter this view. */
export const NON_CUSTOMER_PROOF_IDS = [
  "dgoal_proof_silver_lake_objective",
  "mission_winback_silver-lake",
] as const;

export type CompanyPaymentRail = "stripe" | "cleancloud_clearant" | "other";
export type CompanyQuestionAspect = "revenue" | "orders" | "health" | "buildings" | "breakdown";

export type CompanyMoneyFigures = {
  recordedSalesCents: number;
  /** Null when any positive sale in the slice has no capture evidence. Not zero. */
  capturedPaymentsCents: number | null;
  capturedPaymentsKnownCents: number;
  /** Signed. A refund is negative. */
  refundCents: number;
  /** Sum of canonical admitted cents. Not a deduplicated cross-rail total. */
  netRevenueCents: number;
  /** Null unless an unpaid-order source supplied every amount. Never invented. */
  unpaidBalanceCents: number | null;
  orderCount: number;
};

export type CompanyRailSlice = {
  rail: CompanyPaymentRail;
  label: string;
  figures: CompanyMoneyFigures;
};

export type CompanyBuildingSlice = {
  bucket: string;
  label: string;
  kind: "building" | "unassigned_building" | "regular_apartments";
  figures: CompanyMoneyFigures;
  rails: CompanyRailSlice[];
};

export type LaundryFarmCompanyView = {
  reader: typeof LAUNDRY_FARM_COMPANY_READER;
  timeZone: typeof LAUNDRY_FARM_COMPANY_TIME_ZONE;
  period: { start: string; end: string; label: string };
  scope: "company" | "single_tenant" | "unauthorized";
  mayStateCompanyTotal: boolean;
  mayStateDeduplicatedTotal: boolean;
  tenantsRead: string[];
  tenantsUnread: string[];
  totals: CompanyMoneyFigures;
  /** The same admitted sales, partitioned by authorized business book. Never inferred from payment rail. */
  businessRevenue: Array<{ tenantId: string; figures: CompanyMoneyFigures }>;
  buildings: CompanyBuildingSlice[];
  overlap: {
    status: "none" | "unresolved";
    /** Included on both rails. Not subtracted from recorded sales. */
    unresolvedIncludedCents: number;
    unresolvedPairCount: number;
    /** Canonical within-book withholding. Not added back into recorded sales. */
    withheldCents: number;
    withheldCount: number;
  };
  excludedProofCount: number;
};

export type CompanySaleInput = {
  tenantId: string;
  eventKey: string;
  businessDate: string;
  rail: CompanyPaymentRail;
  address?: string | null;
  buildingSlug?: string | null;
  identity?: PaidOrderEvent["identity"];
  customerName?: string | null;
  recordedSalesCents: number;
  capturedPaymentsCents: number | null;
  refundCents: number;
  /** Canonical admitted cents for the row, including a negative refund row. */
  admittedCents?: number;
  proofIds?: string[];
};

export type CompanyUnpaidInput = {
  tenantId: string;
  totalCents: number | null;
  address?: string | null;
  buildingSlug?: string | null;
  customerRef?: string | null;
};

export type CompanySaleDecision = {
  keptTenantId: string;
  keptEventKey: string;
  otherTenantId: string;
  otherEventKey: string;
  decision: "same_sale" | "distinct_sales";
  evidenceReference: string;
};

export type LaundryFarmCompanyQuestion = {
  aspect: CompanyQuestionAspect;
  period: PeriodSpec;
};

const RAIL_LABEL: Record<CompanyPaymentRail, string> = {
  stripe: "Stripe",
  cleancloud_clearant: "CleanCloud / Clearant",
  other: "Other",
};

const LUXURY_UNSPECIFIED_SLUG = /^(luxury|highrise|high-rise|luxury-high-rise|luxury-highrise|unassigned-luxury|luxury-building)$/i;
const LUXURY_UNSPECIFIED_ADDRESS = /\bluxury\b|\bhigh[-\s]?rise\b/i;

type BuildingAttribution = {
  bucket: string;
  label: string;
  kind: CompanyBuildingSlice["kind"];
};

function normalizedSlug(slug: string | null | undefined): string {
  return String(slug ?? "").trim().toLowerCase();
}

function catalogMatch(address: string | null | undefined, catalog: readonly BuildingConfig[]): BuildingConfig | undefined {
  if (!address) return undefined;
  if (catalog === BUILDINGS) return matchBuilding(address);
  const lower = address.toLowerCase();
  return catalog.find(building => building.addressKeywords.some(keyword => lower.includes(keyword.toLowerCase())));
}

function catalogSlug(slug: string | null | undefined, catalog: readonly BuildingConfig[]): BuildingConfig | undefined {
  const value = normalizedSlug(slug);
  if (!value) return undefined;
  if (catalog === BUILDINGS) return buildingFromSlug(value);
  return catalog.find(building => building.slug === value || building.slugAliases.some(alias => alias.toLowerCase() === value));
}

function buildingLabel(building: BuildingConfig): string {
  if (building.id === "opus_la") return "OPUS LA";
  if (building.id === "century_park_east") return "Century Park East";
  return building.name;
}

/**
 * Building comes from address and property slug. Tenant id is not an input.
 * A luxury sale whose building is not confident is Unassigned, never Regular.
 */
export function attributeCompanyBuilding(
  input: { address?: string | null; buildingSlug?: string | null },
  catalog: readonly BuildingConfig[] = BUILDINGS
): BuildingAttribution {
  const fromAddress = catalogMatch(input.address, catalog);
  const fromSlug = catalogSlug(input.buildingSlug, catalog);
  const building = fromAddress ?? fromSlug;
  if (building) return { bucket: building.id, label: buildingLabel(building), kind: "building" };
  const slug = normalizedSlug(input.buildingSlug);
  const address = String(input.address ?? "");
  if ((slug && LUXURY_UNSPECIFIED_SLUG.test(slug)) || LUXURY_UNSPECIFIED_ADDRESS.test(address)) {
    return { bucket: "unassigned_building", label: "Unassigned building", kind: "unassigned_building" };
  }
  return { bucket: "regular_apartments", label: "Regular apartments / other", kind: "regular_apartments" };
}

export type LaundryFarmCompanyViewRequest = {
  companyView: true;
  aspect: CompanyQuestionAspect;
  period: PeriodSpec;
  /** Names the family. The company reader, not this metric, is the authority. */
  metric: "revenue" | "orders";
};

export type CompanyViewEvidencePayload = {
  companyView: true;
  aspect: CompanyQuestionAspect;
  questionPeriod: PeriodSpec;
  view: LaundryFarmCompanyView;
};

const PROFIT_QUESTION = /\b(?:profit|margin)\b/;
const CUSTOMER_QUESTION = /\bcustomers?\b/;
const OPEN_ORDER_QUESTION = /\bopen\s+orders?\b/;
const SERVICE_LINE_SPLIT = /\blaundry\s+butler\b|\bcore\s+laundry\s+farm\b|\bservice\s+line\b/;
const SINGLE_RAIL_FILTER = /\b(?:through|via|using|on)\s+(?:the\s+)?(?:clean\s?cloud|clearant|stripe|laundry\s+butler)\b/;
const LAUNDRY_FARM_SERVICE_LINE = /\blaundry\s+farm\b[\s\S]{0,48}\b(?:make|made|generate|generated)\b|\b(?:make|made|generate|generated)\b[\s\S]{0,48}\blaundry\s+farm\b/;
const BUILDING_NAME = /\bopus(?:\s+la)?\b|\bcentury\s+park(?:\s+east)?\b|\bcpe\b/;
const BOTH_BUILDINGS = /\bopus(?:\s+la)?\b[\s\S]{0,80}\b(?:century\s+park(?:\s+east)?|cpe)\b|\b(?:century\s+park(?:\s+east)?|cpe)\b[\s\S]{0,80}\bopus(?:\s+la)?\b/;

/** A breakdown must be requested; unqualified revenue remains the combined company number. */
function asksBusinessRevenueBreakdown(text: string, inheritedRevenue = false): boolean {
  // Never silently turn a service-, payment-method-, or building-filtered question into a company-wide sum.
  if (/\b(?:wash[\s-]*(?:(?:and|&)[\s-]*)?fold|dry[-\s]?clean(?:ing)?|cash|opus|century\s+park|cpe)\b/.test(text)) return false;
  const split = /\b(?:break\s+(?:it\s+|that\s+)?down|breakdown|split|separately|by\s+business|each\s+business|versus|vs\.?|compare)\b/.test(text);
  const aboutRevenue = /\b(?:revenue|sales|income|money|earnings|made|brought\s+in)\b/.test(text) || inheritedRevenue;
  const aboutBusiness = /\b(?:laundry\s+(?:farm|butler)|clean\s?cloud|stripe|businesses|business|each)\b/.test(text);
  return split && aboutRevenue && (aboutBusiness || /\b(?:breakdown|break\s+(?:it\s+|that\s+)?down|split)\b/.test(text));
}

function normalizeCompanyUtterance(utterance: string): string {
  return utterance
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .replace(/[?.!]+$/g, "")
    .replace(/^(?:(?:hey|hi|ok|okay|so|well|um|uh|and|also|claire)[, ]+)+/, "")
    .trim();
}

function companyQuestionBlocked(text: string): boolean {
  return (
    PROFIT_QUESTION.test(text) ||
    CUSTOMER_QUESTION.test(text) ||
    OPEN_ORDER_QUESTION.test(text) ||
    SERVICE_LINE_SPLIT.test(text) ||
    SINGLE_RAIL_FILTER.test(text) ||
    LAUNDRY_FARM_SERVICE_LINE.test(text)
  );
}

function companyPeriod(text: string): PeriodSpec {
  return parsePeriodPhrase(text, new Date(), LAUNDRY_FARM_COMPANY_TIME_ZONE) ?? { kind: "this_month" };
}

function directCompanyQuestion(text: string): LaundryFarmCompanyQuestion | null {
  if (asksBusinessRevenueBreakdown(text)) return { aspect: "breakdown", period: companyPeriod(text) };
  if (companyQuestionBlocked(text)) return null;
  if (
    /^how(?:'s| is| are) (?:laundry farm|the company|the business)\b/.test(text) &&
    !/\b(?:make|made|generate|generated|revenue|sales)\b/.test(text)
  ) {
    return { aspect: "health", period: companyPeriod(text) };
  }
  if (BOTH_BUILDINGS.test(text) && /\b(?:business|revenue|sales|made|orders|getting|compared|versus|vs)\b/.test(text)) {
    return { aspect: "buildings", period: companyPeriod(text) };
  }
  if (
    /^how (?:did|does|is|has|was)\s+(?:opus(?: la)?|century park(?: east)?|cpe)\b/.test(text) &&
    /\b(?:do|doing|done|perform(?:ed|ing)?)\b/.test(text)
  ) {
    return { aspect: "buildings", period: companyPeriod(text) };
  }
  if (/^how many (?:paid )?orders\b/.test(text) && /\bwe\b/.test(text)) {
    return { aspect: "orders", period: companyPeriod(text) };
  }
  if (/^(?:what(?:'s| is| was| were)|how(?:'s| is| much is| are)) (?:my|our) (?:revenue|sales)\b/.test(text)) {
    return { aspect: "revenue", period: companyPeriod(text) };
  }
  if (/^(?:what(?:'s|s| is| was)|how much(?: is| was)?)\s+(?:(?:the|our)\s+)?(?:(?:current|monthly|month'?s|months|month-to-date|this month)\s+){0,3}(?:revenue|sales)\b/.test(text)) {
    return { aspect: "revenue", period: companyPeriod(text) };
  }
  if (/^how much have we (?:made|brought in)\b/.test(text)) {
    return { aspect: "revenue", period: companyPeriod(text) };
  }
  if (/^how much business are we getting\b/.test(text)) {
    return { aspect: BUILDING_NAME.test(text) ? "buildings" : "revenue", period: companyPeriod(text) };
  }
  return null;
}

function companyFollowUp(text: string, prior: LaundryFarmCompanyQuestion | null): LaundryFarmCompanyQuestion | null {
  if (!prior || companyQuestionBlocked(text) || directCompanyQuestion(text)) return null;
  const continuation = /^(?:(?:and|also|okay|ok|so|then)\b[\s,.-]*)?(?:what|how)\s+about\b|^(?:and|also)\b/.test(text);
  const period = parsePeriodPhrase(text, new Date(), LAUNDRY_FARM_COMPANY_TIME_ZONE);
  const building = BUILDING_NAME.test(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const shortShift =
    wordCount <= 6 &&
    Boolean(period || building) &&
    !/\b(?:revenue|sales|profit|customers?|orders|made)\b/.test(text);
  if (!(continuation || shortShift) || (!period && !building)) return null;
  const aspect =
    building && !/\b(?:revenue|sales|orders|made)\b/.test(text)
      ? "buildings"
      : /\borders\b/.test(text) && !/\b(?:revenue|sales|made)\b/.test(text)
        ? "orders"
        : prior.aspect;
  return { aspect, period: period ?? prior.period };
}

/**
 * Company-level revenue, orders, health, and building questions.
 * A named customer, a profit question, a service-line split, or a single-rail
 * filter stays on the existing tenant reader.
 */
export function matchLaundryFarmCompanyQuestion(
  utterance: string,
  prior: LaundryFarmCompanyQuestion | null = null
): LaundryFarmCompanyQuestion | null {
  const text = normalizeCompanyUtterance(utterance);
  if (!text) return null;
  if (prior && asksBusinessRevenueBreakdown(text, prior.aspect === "revenue" || prior.aspect === "breakdown")) {
    return { aspect: "breakdown", period: parsePeriodPhrase(text, new Date(), LAUNDRY_FARM_COMPANY_TIME_ZONE) ?? prior.period };
  }
  return directCompanyQuestion(text) ?? companyFollowUp(text, prior);
}

export function companyViewRequest(question: LaundryFarmCompanyQuestion): LaundryFarmCompanyViewRequest {
  return {
    companyView: true,
    aspect: question.aspect,
    period: question.period,
    metric: question.aspect === "orders" ? "orders" : "revenue",
  };
}

export function isLaundryFarmCompanyViewRequest(query: unknown): query is LaundryFarmCompanyViewRequest {
  if (!query || typeof query !== "object") return false;
  const value = query as { companyView?: unknown; aspect?: unknown; period?: unknown };
  return value.companyView === true && typeof value.aspect === "string" && value.period != null && typeof value.period === "object";
}

export function companyQuestionFromParameters(parameters: unknown): LaundryFarmCompanyQuestion | null {
  if (!isLaundryFarmCompanyViewRequest(parameters)) return null;
  if (
    parameters.aspect !== "revenue" &&
    parameters.aspect !== "orders" &&
    parameters.aspect !== "health" &&
    parameters.aspect !== "buildings" &&
    parameters.aspect !== "breakdown"
  ) {
    return null;
  }
  return { aspect: parameters.aspect, period: parameters.period };
}

export function isCompanyViewEvidencePayload(payload: unknown): payload is CompanyViewEvidencePayload {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as { companyView?: unknown; view?: { reader?: unknown }; aspect?: unknown };
  return value.companyView === true && value.view?.reader === LAUNDRY_FARM_COMPANY_READER && typeof value.aspect === "string";
}

function proofBlob(parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join("\n");
}

export function isNonCustomerProof(parts: Array<string | null | undefined>): boolean {
  const blob = proofBlob(parts);
  return NON_CUSTOMER_PROOF_IDS.some(id => blob.includes(id));
}

export function companySaleFromPaidEvent(tenantId: string, event: PaidOrderEvent): CompanySaleInput {
  const rail: CompanyPaymentRail = event.source === "laundry_butler" ? "stripe" : event.source === "cleancloud" ? "cleancloud_clearant" : "other";
  return {
    tenantId,
    eventKey: event.eventKey,
    businessDate: event.businessDate,
    rail,
    address: event.address ?? null,
    buildingSlug: event.buildingSlug ?? null,
    identity: event.identity,
    customerName: event.customerName,
    recordedSalesCents: event.cents > 0 ? event.cents : 0,
    capturedPaymentsCents: rail === "stripe" && event.authorityReceiptId && event.cents >= 0 ? event.cents : null,
    refundCents: event.cents < 0 ? event.cents : 0,
    admittedCents: event.cents,
    proofIds: [event.eventKey, event.orderNumber ?? "", event.identity.cleancloudCustomerId ?? "", event.customerName ?? ""],
  };
}

function composite(tenantId: string, eventKey: string): string {
  return `${tenantId}:${eventKey}`;
}

function emptyMoney(): CompanyMoneyFigures & { captureComplete: boolean; unpaidKnown: boolean } {
  return {
    recordedSalesCents: 0,
    capturedPaymentsCents: 0,
    capturedPaymentsKnownCents: 0,
    refundCents: 0,
    netRevenueCents: 0,
    unpaidBalanceCents: 0,
    orderCount: 0,
    captureComplete: true,
    unpaidKnown: true,
  };
}

function finishMoney(money: ReturnType<typeof emptyMoney>, unpaidSupplied: boolean): CompanyMoneyFigures {
  return {
    recordedSalesCents: money.recordedSalesCents,
    capturedPaymentsCents: money.captureComplete ? money.capturedPaymentsKnownCents : null,
    capturedPaymentsKnownCents: money.capturedPaymentsKnownCents,
    refundCents: money.refundCents,
    netRevenueCents: money.netRevenueCents,
    unpaidBalanceCents: !unpaidSupplied || !money.unpaidKnown ? null : money.unpaidBalanceCents,
    orderCount: money.orderCount,
  };
}

function addSale(money: ReturnType<typeof emptyMoney>, sale: CompanySaleInput): void {
  const admitted = sale.admittedCents ?? (sale.capturedPaymentsCents ?? sale.recordedSalesCents) + sale.refundCents;
  money.recordedSalesCents += sale.recordedSalesCents;
  money.refundCents += sale.refundCents;
  money.netRevenueCents += admitted;
  if (sale.recordedSalesCents > 0) {
    money.orderCount += 1;
    if (sale.capturedPaymentsCents == null) money.captureComplete = false;
    else money.capturedPaymentsKnownCents += sale.capturedPaymentsCents;
  }
}

function addUnpaid(money: ReturnType<typeof emptyMoney>, cents: number | null): void {
  if (cents == null) {
    money.unpaidKnown = false;
    return;
  }
  money.unpaidBalanceCents = (money.unpaidBalanceCents ?? 0) + cents;
}

function bucketRank(bucket: string): number {
  if (bucket === "opus_la") return 0;
  if (bucket === "century_park_east") return 1;
  if (bucket === "unassigned_building") return 8;
  if (bucket === "regular_apartments") return 9;
  return 2;
}

function railRank(rail: CompanyPaymentRail): number {
  if (rail === "stripe") return 0;
  if (rail === "cleancloud_clearant") return 1;
  return 2;
}

export function composeLaundryFarmCompanyView(input: {
  period: { start: string; end: string; label: string };
  scope: LaundryFarmCompanyView["scope"];
  mayStateCompanyTotal: boolean;
  tenantsRead: string[];
  tenantsUnread: string[];
  sales: readonly CompanySaleInput[];
  unpaid: readonly CompanyUnpaidInput[] | null;
  decisions?: readonly CompanySaleDecision[];
  withheld?: { count: number; cents: number };
  catalog?: readonly BuildingConfig[];
}): LaundryFarmCompanyView {
  const catalog = input.catalog ?? BUILDINGS;
  const inPeriod = (date: string) => date >= input.period.start && date <= input.period.end;
  let excludedProofCount = 0;
  const sales = input.sales.filter(sale => {
    if (!inPeriod(sale.businessDate)) return false;
    const proof = isNonCustomerProof([
      sale.eventKey,
      sale.customerName,
      sale.identity?.cleancloudCustomerId,
      ...(sale.proofIds ?? []),
    ]);
    if (proof) excludedProofCount += 1;
    return !proof;
  });
  const drop = new Set<string>();
  const distinct = new Set<string>();
  for (const decision of input.decisions ?? []) {
    if (!decision.evidenceReference.trim()) continue;
    const kept = composite(decision.keptTenantId, decision.keptEventKey);
    const other = composite(decision.otherTenantId, decision.otherEventKey);
    const pair = [kept, other].sort().join("|");
    if (decision.decision === "same_sale") drop.add(other);
    if (decision.decision === "distinct_sales") distinct.add(pair);
  }
  const counted = sales.filter(sale => !drop.has(composite(sale.tenantId, sale.eventKey)));
  const probes: PaidOrderEvent[] = counted
    .filter(sale => sale.recordedSalesCents > 0 && (sale.rail === "stripe" || sale.rail === "cleancloud_clearant"))
    .map(sale => ({
      source: sale.rail === "stripe" ? "laundry_butler" : "cleancloud",
      eventKey: composite(sale.tenantId, sale.eventKey),
      occurredAt: new Date(`${sale.businessDate}T20:00:00.000Z`),
      businessDate: sale.businessDate,
      cents: sale.recordedSalesCents,
      serviceType: null,
      customerName: sale.customerName ?? null,
      identity: sale.identity ?? {},
    }));
  const pairs = findSuspectedCrossSourcePairs(probes).filter(pair => {
    const key = [pair.native.eventKey, pair.cleancloud.eventKey].sort().join("|");
    return !distinct.has(key);
  });
  const unresolvedIncludedCents = pairs.reduce((sum, pair) => sum + pair.cleancloud.cents, 0);
  const withheld = input.withheld ?? { count: 0, cents: 0 };
  const groups = new Map<string, { attribution: BuildingAttribution; sales: CompanySaleInput[]; unpaid: CompanyUnpaidInput[] }>();
  const ensure = (attribution: BuildingAttribution) => {
    const group = groups.get(attribution.bucket) ?? { attribution, sales: [], unpaid: [] };
    groups.set(attribution.bucket, group);
    return group;
  };
  for (const sale of counted) {
    ensure(attributeCompanyBuilding(sale, catalog)).sales.push(sale);
  }
  const unpaidRows = (input.unpaid ?? []).filter(row => {
    if (isNonCustomerProof([row.customerRef])) {
      excludedProofCount += 1;
      return false;
    }
    return true;
  });
  for (const row of unpaidRows) ensure(attributeCompanyBuilding(row, catalog)).unpaid.push(row);

  const buildings: CompanyBuildingSlice[] = [...groups.values()]
    .map(group => {
      const byRail = new Map<CompanyPaymentRail, ReturnType<typeof emptyMoney>>();
      const buildingMoney = emptyMoney();
      for (const sale of group.sales) {
        addSale(buildingMoney, sale);
        const railMoney = byRail.get(sale.rail) ?? emptyMoney();
        addSale(railMoney, sale);
        byRail.set(sale.rail, railMoney);
      }
      for (const row of group.unpaid) addUnpaid(buildingMoney, row.totalCents);
      const unpaidSupplied = input.unpaid != null;
      return {
        bucket: group.attribution.bucket,
        label: group.attribution.label,
        kind: group.attribution.kind,
        figures: finishMoney(buildingMoney, unpaidSupplied),
        rails: [...byRail.entries()]
          .map(([rail, money]) => ({ rail, label: RAIL_LABEL[rail], figures: finishMoney(money, false) }))
          .sort((a, b) => railRank(a.rail) - railRank(b.rail)),
      };
    })
    .filter(building => building.figures.orderCount > 0 || building.figures.refundCents !== 0 || building.figures.unpaidBalanceCents)
    .sort((a, b) => bucketRank(a.bucket) - bucketRank(b.bucket) || a.label.localeCompare(b.label));

  const businessRevenue = input.tenantsRead.map(tenantId => {
    const money = emptyMoney();
    for (const sale of counted) if (sale.tenantId === tenantId) addSale(money, sale);
    return { tenantId, figures: finishMoney(money, false) };
  });
  const totalsMoney = emptyMoney();
  for (const sale of counted) addSale(totalsMoney, sale);
  for (const row of unpaidRows) addUnpaid(totalsMoney, row.totalCents);
  const overlapUnresolved = pairs.length > 0 || withheld.count > 0;
  return {
    reader: LAUNDRY_FARM_COMPANY_READER,
    timeZone: LAUNDRY_FARM_COMPANY_TIME_ZONE,
    period: input.period,
    scope: input.scope,
    mayStateCompanyTotal: input.mayStateCompanyTotal,
    mayStateDeduplicatedTotal: input.mayStateCompanyTotal && !overlapUnresolved,
    tenantsRead: input.tenantsRead,
    tenantsUnread: input.tenantsUnread,
    totals: finishMoney(totalsMoney, input.unpaid != null),
    businessRevenue,
    buildings,
    overlap: {
      status: overlapUnresolved ? "unresolved" : "none",
      unresolvedIncludedCents,
      unresolvedPairCount: pairs.length,
      withheldCents: withheld.cents,
      withheldCount: withheld.count,
    },
    excludedProofCount,
  };
}

function dollarsToCents(total: unknown): number | null {
  if (total == null || total === "") return null;
  const value = Number(total);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

async function membershipTenantIds(operatorUserId: string): Promise<string[]> {
  if (!operatorUserId.trim()) return [];
  try {
    const [{ getUserByOpenId }, { resolveAccessibleTenantIdsForUser }] = await Promise.all([
      import("../db"),
      import("../platform/tenancy/tenantRouter"),
    ]);
    const user = await getUserByOpenId(operatorUserId);
    if (user && (user.role === "admin" || user.role === "driver" || user.role === "user")) {
      const accessible = await resolveAccessibleTenantIdsForUser({
        openId: user.openId,
        role: user.role,
        tenantId: user.tenantId,
      });
      return [...accessible.keys()];
    }
  } catch {
    // The user record is unavailable. Memberships are the remaining authority.
  }
  try {
    const memberships = await listActiveTenantMemberships(operatorUserId);
    return memberships.map(membership => membership.tenantId);
  } catch {
    return [];
  }
}

async function readUnpaid(tenantId: string): Promise<CompanyUnpaidInput[] | null> {
  try {
    const rows = await listTenantUnpaidOrders(tenantId);
    return rows.map(row => ({
      tenantId,
      totalCents: dollarsToCents(row.total),
      address: row.address,
      buildingSlug: row.buildingSlug,
      customerRef: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || null,
    }));
  } catch {
    return null;
  }
}

export type CompanyLedgerWindow = {
  tenantId: string;
  startUtc: Date;
  endExclusiveUtc: Date;
  timeZone: string;
};

export async function readLaundryFarmCompanyView(input: {
  operatorUserId: string;
  now?: Date;
  period?: PeriodSpec;
  authorizedTenantIds?: readonly string[];
  loadAuthorizedTenantIds?: (operatorUserId: string) => Promise<readonly string[]>;
  loadLedger?: (window: CompanyLedgerWindow) => Promise<PaidOrderLedger>;
  loadUnpaid?: (tenantId: string) => Promise<readonly CompanyUnpaidInput[] | null>;
  catalog?: readonly BuildingConfig[];
}): Promise<LaundryFarmCompanyView> {
  const now = input.now ?? new Date();
  const period = resolvePeriod(input.period ?? { kind: "this_month" }, now, LAUNDRY_FARM_COMPANY_TIME_ZONE);
  const authorized = new Set(
    input.authorizedTenantIds ??
      (await (input.loadAuthorizedTenantIds ?? membershipTenantIds)(input.operatorUserId))
  );
  const allowed = LAUNDRY_FARM_COMPANY_TENANTS.filter(tenantId => authorized.has(tenantId));
  const periodLabel = period.label;
  if (!allowed.length) {
    return composeLaundryFarmCompanyView({
      period: { start: period.start, end: period.end, label: periodLabel },
      scope: "unauthorized",
      mayStateCompanyTotal: false,
      tenantsRead: [],
      tenantsUnread: [...LAUNDRY_FARM_COMPANY_TENANTS],
      sales: [],
      unpaid: null,
    });
  }
  const loadLedger = input.loadLedger ?? (window => loadPaidOrderLedger(window));
  const loadUnpaidRows = input.loadUnpaid ?? readUnpaid;
  const sales: CompanySaleInput[] = [];
  const decisions: CompanySaleDecision[] = [];
  const tenantsRead: string[] = [];
  const tenantsUnread: string[] = LAUNDRY_FARM_COMPANY_TENANTS.filter(tenantId => !allowed.includes(tenantId));
  let withheldCount = 0;
  let withheldCents = 0;
  let unpaid: CompanyUnpaidInput[] | null = [];
  let booksComplete = true;
  for (const tenantId of allowed) {
    try {
      const ledger = await loadLedger({
        tenantId,
        startUtc: period.startUtc,
        endExclusiveUtc: period.endExclusiveUtc,
        timeZone: LAUNDRY_FARM_COMPANY_TIME_ZONE,
      });
      if (ledger.completeness === "unavailable") {
        tenantsUnread.push(tenantId);
        booksComplete = false;
        continue;
      }
      if (ledger.completeness !== "complete" || ledger.failedSources.length > 0) booksComplete = false;
      const book = reconcileLedgerSpan(ledger, { start: period.start, end: period.end });
      withheldCount += book.suspectedWithheld.count;
      withheldCents += book.suspectedWithheld.cents;
      for (const event of book.includedEvents) sales.push(companySaleFromPaidEvent(tenantId, event));
      for (const decision of ledger.reconciliationEvidence?.decisions ?? []) {
        if (!decision.evidenceReference.trim()) continue;
        decisions.push({
          keptTenantId: tenantId,
          keptEventKey: decision.keptEventKey,
          otherTenantId: tenantId,
          otherEventKey: decision.otherEventKey,
          decision: decision.decision,
          evidenceReference: decision.evidenceReference,
        });
      }
      tenantsRead.push(tenantId);
      if (unpaid) {
        try {
          const rows = await loadUnpaidRows(tenantId);
          if (rows == null) unpaid = null;
          else unpaid.push(...rows);
        } catch {
          unpaid = null;
        }
      }
    } catch {
      tenantsUnread.push(tenantId);
      booksComplete = false;
    }
  }
  const bothRead = tenantsRead.includes(LAUNDRY_FARM_TENANT_ID) && tenantsRead.includes(LAUNDRY_BUTLER_TENANT_ID);
  return composeLaundryFarmCompanyView({
    period: { start: period.start, end: period.end, label: periodLabel },
    scope: bothRead ? "company" : tenantsRead.length ? "single_tenant" : "unauthorized",
    mayStateCompanyTotal: bothRead && booksComplete && tenantsUnread.length === 0,
    tenantsRead,
    tenantsUnread,
    sales,
    unpaid,
    decisions,
    withheld: { count: withheldCount, cents: withheldCents },
    catalog: input.catalog,
  });
}

type AnalysisRow = Array<string | number | null>;

/** One row per building and rail for the canonical events of a single tenant book. */
export function companyBuildingTableRows(events: readonly PaidOrderEvent[], tenantId = "tenant"): AnalysisRow[] {
  const dates = events.map(event => event.businessDate).sort();
  const view = composeLaundryFarmCompanyView({
    period: {
      start: dates[0] ?? "0001-01-01",
      end: dates.at(-1) ?? "9999-12-31",
      label: "window",
    },
    scope: "single_tenant",
    mayStateCompanyTotal: false,
    tenantsRead: [tenantId],
    tenantsUnread: [],
    sales: events.map(event => companySaleFromPaidEvent(tenantId, event)),
    unpaid: null,
  });
  return view.buildings.flatMap(building =>
    building.rails.map(rail => [
      building.bucket,
      building.label,
      rail.rail,
      rail.figures.recordedSalesCents,
      rail.figures.capturedPaymentsCents,
      rail.figures.refundCents,
      rail.figures.netRevenueCents,
      rail.figures.orderCount,
      rail.figures.unpaidBalanceCents,
    ])
  );
}
