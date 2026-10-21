import { BUILDINGS, buildingFromSlug, matchBuilding, type BuildingConfig } from "../../shared/buildings";
import { extractCustomerNames } from "../claire/business/businessLanguage";
import { listActiveTenantMemberships } from "../saas/tenantAccess";
import { listTenantUnpaidOrders } from "../domains/orders/unpaidOrderReadService";
import { parsePeriodPhrase, resolvePeriod, type PeriodSpec } from "./businessPeriods";
import { resolveCustomerIdentities } from "./customerIdentityResolution";
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
export type CompanyQuestionAspect = "revenue" | "orders" | "health" | "buildings" | "customers";
export type CompanyBusinessScope = "laundry_farm" | "default" | "both" | "clarify";
export type CompanyBuildingFocus = "opus_la" | "century_park_east" | "shared";

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

export type CompanyBusinessBuilding = {
  bucket: string;
  label: string;
  figures: CompanyMoneyFigures;
  /** Distinct customers in this business at this building. Unmatched orders are not counted. */
  customerCount: number;
};

export type CompanyBusinessSlice = {
  tenantId: string;
  label: string;
  figures: CompanyMoneyFigures;
  customerCount: number;
  /** Distinct customers at OPUS LA and Century Park East. Not summed across buildings. */
  sharedBuildingCustomerCount: number;
  buildings: CompanyBusinessBuilding[];
};

export type LaundryFarmCompanyView = {
  reader: typeof LAUNDRY_FARM_COMPANY_READER;
  timeZone: typeof LAUNDRY_FARM_COMPANY_TIME_ZONE;
  period: { start: string; end: string; label: string };
  scope: "company" | "single_tenant" | "unauthorized";
  mayStateCompanyTotal: boolean;
  mayStateDeduplicatedTotal: boolean;
  /** The requested ledgers loaded completely. A business left unread on purpose is not a gap. */
  bookComplete: boolean;
  tenantsRead: string[];
  tenantsUnread: string[];
  /** One slice per business ledger. Never a merged customer list. */
  businesses: CompanyBusinessSlice[];
  totals: CompanyMoneyFigures;
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
  /** Which business ledger to read. `both` is an intentional cross-business request. */
  scope: CompanyBusinessScope;
  building: CompanyBuildingFocus | null;
};

export function businessDisplayName(tenantId: string): string {
  if (tenantId === LAUNDRY_FARM_TENANT_ID) return "Laundry Farm";
  if (tenantId === LAUNDRY_BUTLER_TENANT_ID) return "Laundry Butler";
  return tenantId;
}

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
  scope: CompanyBusinessScope;
  building: CompanyBuildingFocus | null;
  /** Names the family. The company reader, not this metric, is the authority. */
  metric: "revenue" | "orders";
};

export type CompanyViewEvidencePayload = {
  companyView: true;
  aspect: CompanyQuestionAspect;
  questionPeriod: PeriodSpec;
  scope: CompanyBusinessScope;
  building: CompanyBuildingFocus | null;
  view: LaundryFarmCompanyView;
};

const PROFIT_QUESTION = /\b(?:profit|margin)\b/;
const CUSTOMER_QUESTION = /\bcustomers?\b/;
/** Same outstanding-order forms the tenant reader already sends to open orders. */
const OPEN_ORDER_QUESTION = /\b(?:open orders?|orders? (?:in progress|outstanding|awaiting payment|still open)|unpaid orders?)\b/;
const SERVICE_LINE_SPLIT = /\bcore\s+laundry\s+farm\b|\bservice\s+line\b/;
const EXPLICIT_SERVICE = /\b(?:wash(?:\s*&\s*|\s+and\s+)fold|dry[\s-]?clean(?:ing)?|fluff\s*(?:and|&)\s*fold)\b/;
const PAYMENT_RAIL = /\b(?:clean\s?cloud|clearant|clearent|stripe)\b/;
const FARM_BUSINESS = /\blaundry\s+farm\b/;
const BUTLER_BUSINESS = /\blaundry\s+butler\b/;
const BOTH_BUSINESSES = /\bboth\s+businesses\b|\b(?:combined|across both|cross-business)\b/;
const WHY_QUESTION = /\bwhy\b/;
const AOV_QUESTION = /\b(?:average\s+order(?:\s+value)?|aov)\b/;
/** Same comparison forms the tenant reader already sends to the comparison reader. */
const COMPARISON_QUESTION = /\b(?:compar(?:e|ed|ing|ison)|versus|vs\.?|up or down|trend|growth|grew|shrank|change from)\b/;
const BUILDING_NAME = /\bopus(?:\s+la)?\b|\bcentury\s+park(?:\s+east)?\b|\bcpe\b/;
const BOTH_BUILDINGS = /\bopus(?:\s+la)?\b[\s\S]{0,80}\b(?:century\s+park(?:\s+east)?|cpe)\b|\b(?:century\s+park(?:\s+east)?|cpe)\b[\s\S]{0,80}\bopus(?:\s+la)?\b/;
const NOT_A_CUSTOMER = new Set(["we", "you", "i", "they", "laundry", "the", "opus", "century", "it", "she", "he", "our"]);

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
    (CUSTOMER_QUESTION.test(text) && !whichBusinessCustomers(text)) ||
    OPEN_ORDER_QUESTION.test(text) ||
    SERVICE_LINE_SPLIT.test(text) ||
    EXPLICIT_SERVICE.test(text) ||
    PAYMENT_RAIL.test(text) ||
    WHY_QUESTION.test(text) ||
    AOV_QUESTION.test(text) ||
    /\bgross\b/.test(text) ||
    /\b(?:do you think|should i|should we|focus on|to grow|recommend)\b/.test(text) ||
    /\b(?:last|latest|recent|most recent|first|biggest|largest)\s+(?:\d+\s+|[a-z]+\s+)?(?:sales?|orders?)\b/.test(text) ||
    namedCustomerAsk(text)
  );
}

function namedCustomerAsk(text: string): boolean {
  const match = /\b(?:did|has|have)\s+([a-z]+)\s+(?:generate[ds]?|spend|spent|make|made|order(?:ed)?)\b/.exec(text);
  return Boolean(match && !NOT_A_CUSTOMER.has(match[1]!));
}

function companyPeriod(text: string): PeriodSpec {
  return parsePeriodPhrase(text, new Date(), LAUNDRY_FARM_COMPANY_TIME_ZONE) ?? { kind: "this_month" };
}

/** An unnamed building slice stays on the tenant reader. A named business may still carry a building. */
function unnamedBuildingSlice(text: string): boolean {
  if (!BUILDING_NAME.test(text) || BOTH_BUILDINGS.test(text)) return false;
  if (FARM_BUSINESS.test(text) || BUTLER_BUSINESS.test(text) || explicitBoth(text)) return false;
  if (/^how (?:did|does|is|has|was)\s+(?:opus(?: la)?|century park(?: east)?|cpe)\b/.test(text)) return false;
  return true;
}

function activeBusiness(activeTenantId: string | undefined): "laundry_farm" | "default" | null {
  if (activeTenantId === LAUNDRY_FARM_TENANT_ID || activeTenantId === LAUNDRY_BUTLER_TENANT_ID) return activeTenantId;
  return null;
}

function explicitBoth(text: string): boolean {
  if (/\bboth\s+businesses\b/.test(text)) return true;
  if (/\b(?:across both|cross-business)\b/.test(text)) return true;
  if (/\bcombined\b/.test(text) && /\b(?:business|businesses|make|made|revenue|sales|total|orders)\b/.test(text)) return true;
  const farm = FARM_BUSINESS.test(text);
  const butler = BUTLER_BUSINESS.test(text);
  return farm && butler && /\b(?:and|compare|versus|vs\.?|both)\b/.test(text);
}

function whichBusinessCustomers(text: string): boolean {
  return /\bwhich\s+business\b/.test(text) && /\bcustomers?\b/.test(text);
}

function unclearCrossBusiness(text: string): boolean {
  if (explicitBoth(text) || whichBusinessCustomers(text)) return false;
  if (FARM_BUSINESS.test(text) || BUTLER_BUSINESS.test(text)) return false;
  return /\bbusinesses\b/.test(text);
}

function buildingFocus(text: string): CompanyBuildingFocus | null {
  if (BOTH_BUILDINGS.test(text) || /\bthese\s+buildings\b/.test(text)) return "shared";
  if (/\bopus(?:\s+la)?\b/.test(text)) return "opus_la";
  if (/\bcentury\s+park(?:\s+east)?\b|\bcpe\b/.test(text)) return "century_park_east";
  return null;
}

function namedBusiness(text: string): CompanyBusinessScope | null {
  if (unclearCrossBusiness(text)) return "clarify";
  if (explicitBoth(text) || whichBusinessCustomers(text)) return "both";
  if (FARM_BUSINESS.test(text)) return "laundry_farm";
  if (BUTLER_BUSINESS.test(text)) return "default";
  return null;
}

function unqualifiedRevenue(text: string): boolean {
  const asks = /\b(?:what|how)\b/.test(text);
  if (asks && /\b(?:revenue|sales)\b/.test(text)) return true;
  if (/\blaundry\s+farm\b/.test(text) && /\b(?:make|made|do|did|generate[ds]?|bring|brought)\b/.test(text)) return true;
  if (
    /\bhow much (?:have|did|does|do) (?:we|the company|the business)\b/.test(text) &&
    /\b(?:made|make|brought\s+in|do|doing|done)\b/.test(text)
  ) {
    return true;
  }
  return /^how much business (?:are we getting|did we (?:do|get)|have we (?:done|gotten))\b/.test(text);
}

function unqualifiedOrders(text: string): boolean {
  if (!/\borders?\b/.test(text) || /\b(?:revenue|sales)\b/.test(text)) return false;
  if (/\b(?:we|our)\b/.test(text) || /\blaundry\s+farm\b/.test(text) || /\b(?:the company|the business)\b/.test(text)) return true;
  return (
    /\bhow many\b/.test(text) &&
    (parsePeriodPhrase(text, new Date(), LAUNDRY_FARM_COMPANY_TIME_ZONE) != null ||
      /\b(?:were there|came in|are there|have there been)\b/.test(text))
  );
}

function questionShape(
  text: string,
  scope: CompanyBusinessScope,
  active: "laundry_farm" | "default" | null
): LaundryFarmCompanyQuestion | null {
  const period = companyPeriod(text);
  const building = buildingFocus(text);
  if (scope === "clarify") return { aspect: "revenue", period, scope, building };
  const resolved = scope === "both" || scope === "laundry_farm" || scope === "default" ? scope : active;
  if (!resolved) return null;
  if (whichBusinessCustomers(text)) {
    return { aspect: "customers", period, scope: "both", building: building ?? "shared" };
  }
  const health =
    (/^how(?:'s| is| are) (?:we|things|the business|laundry farm|laundry butler)\b/.test(text) ||
      /^how are we doing\b/.test(text)) &&
    !/\b(?:make|made|generate|generated|revenue|sales)\b/.test(text);
  if (health) return { aspect: "health", period, scope: resolved, building };
  if (building && !/\b(?:revenue|sales|orders|made|make)\b/.test(text)) {
    return { aspect: "buildings", period, scope: resolved, building };
  }
  if (unqualifiedOrders(text)) return { aspect: "orders", period, scope: resolved, building };
  if (unqualifiedRevenue(text) || /\b(?:make|made|revenue|sales)\b/.test(text)) {
    return { aspect: building ? "buildings" : "revenue", period, scope: resolved, building };
  }
  if (
    /^how (?:did|does|is|has|was)\s+(?:opus(?: la)?|century park(?: east)?|cpe)\b/.test(text) &&
    /\b(?:do|doing|done|perform(?:ed|ing)?)\b/.test(text)
  ) {
    return { aspect: "buildings", period, scope: resolved, building: building ?? "opus_la" };
  }
  return null;
}

function directCompanyQuestion(text: string, activeTenantId?: string): LaundryFarmCompanyQuestion | null {
  if (whichBusinessCustomers(text)) {
    return questionShape(text, "both", activeBusiness(activeTenantId));
  }
  if (companyQuestionBlocked(text)) return null;
  if (unclearCrossBusiness(text)) return questionShape(text, "clarify", null);
  const named = namedBusiness(text);
  const intentionalCross = named === "both" || explicitBoth(text) || whichBusinessCustomers(text);
  if (COMPARISON_QUESTION.test(text) && !intentionalCross && !BOTH_BUILDINGS.test(text)) return null;
  if (unnamedBuildingSlice(text)) return null;
  if (named === "clarify") return questionShape(text, "clarify", null);
  if (named) return questionShape(text, named, activeBusiness(activeTenantId));
  if (BOTH_BUILDINGS.test(text) && activeBusiness(activeTenantId)) {
    return questionShape(text, activeBusiness(activeTenantId)!, activeBusiness(activeTenantId));
  }
  return questionShape(text, activeBusiness(activeTenantId) ?? "clarify", activeBusiness(activeTenantId));
}

function companyFollowUp(
  text: string,
  prior: LaundryFarmCompanyQuestion | null,
  activeTenantId?: string
): LaundryFarmCompanyQuestion | null {
  if (!prior || prior.scope === "clarify" || companyQuestionBlocked(text) || directCompanyQuestion(text, activeTenantId)) {
    return null;
  }
  const continuation = /^(?:(?:and|also|okay|ok|so|then)\b[\s,.-]*)?(?:what|how)\s+about\b|^(?:and|also)\b/.test(text);
  const period = parsePeriodPhrase(text, new Date(), LAUNDRY_FARM_COMPANY_TIME_ZONE);
  const building = buildingFocus(text);
  const named = namedBusiness(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const shiftResidue = text
    .replace(/\b(?:and|also|okay|ok|so|then|what|how|about|just|only|please|the|a|an|in|for|of|on|from|at)\b/g, " ")
    .replace(/\b(?:laundry\s+farm|laundry\s+butler|both\s+businesses)\b/g, " ")
    .replace(/\b(?:last|this|next|past|previous|prior)\s+(?:\d+\s+)?(?:day|days|week|weeks|month|months|year|years)\b/g, " ")
    .replace(/\b(?:today|yesterday|august|september|october|november|december|january|february|march|april|may|june|july)\b/g, " ")
    .replace(/\b(?:opus(?:\s+la)?|century\s+park(?:\s+east)?|cpe|these\s+buildings)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const shortShift = wordCount <= 8 && shiftResidue.length === 0 && Boolean(period || building || named);
  if (!(continuation || shortShift)) return null;
  if (!period && !building && !named) return null;
  const scope = named && named !== "clarify" ? named : prior.scope;
  const aspect =
    building && !/\b(?:revenue|sales|orders|made)\b/.test(text)
      ? "buildings"
      : /\borders\b/.test(text) && !/\b(?:revenue|sales|made)\b/.test(text)
        ? "orders"
        : prior.aspect;
  return { aspect, period: period ?? prior.period, scope, building: building ?? prior.building };
}

/**
 * Laundry Farm and Laundry Butler are separate businesses.
 * A bare "we" question reads the active business only.
 * An explicit business name selects that business.
 * Both businesses are read only for an intentional cross-business request.
 * Unclear cross-business wording asks for clarification.
 * A named customer, unpaid orders, growth, a payment rail, and an unnamed
 * building slice stay on the tenant reader.
 */
export function matchLaundryFarmCompanyQuestion(
  utterance: string,
  prior: LaundryFarmCompanyQuestion | null = null,
  activeTenantId?: string
): LaundryFarmCompanyQuestion | null {
  const text = normalizeCompanyUtterance(utterance);
  if (!text) return null;
  if (extractCustomerNames(utterance).length > 0) return null;
  const direct = directCompanyQuestion(text, activeTenantId);
  if (direct?.scope === "clarify" && !unclearCrossBusiness(text) && !namedBusiness(text)) return null;
  return direct ?? companyFollowUp(text, prior, activeTenantId);
}

export function companyViewRequest(question: LaundryFarmCompanyQuestion): LaundryFarmCompanyViewRequest {
  return {
    companyView: true,
    aspect: question.aspect,
    period: question.period,
    scope: question.scope,
    building: question.building,
    metric: question.aspect === "orders" ? "orders" : "revenue",
  };
}

const BUSINESS_SCOPES = new Set<CompanyBusinessScope>(["laundry_farm", "default", "both", "clarify"]);

export function isLaundryFarmCompanyViewRequest(query: unknown): query is LaundryFarmCompanyViewRequest {
  if (!query || typeof query !== "object") return false;
  const value = query as { companyView?: unknown; aspect?: unknown; period?: unknown; scope?: unknown };
  return (
    value.companyView === true &&
    typeof value.aspect === "string" &&
    value.period != null &&
    typeof value.period === "object" &&
    typeof value.scope === "string" &&
    BUSINESS_SCOPES.has(value.scope as CompanyBusinessScope)
  );
}

export function companyQuestionFromParameters(parameters: unknown): LaundryFarmCompanyQuestion | null {
  if (!isLaundryFarmCompanyViewRequest(parameters)) return null;
  if (
    parameters.aspect !== "revenue" &&
    parameters.aspect !== "orders" &&
    parameters.aspect !== "health" &&
    parameters.aspect !== "buildings" &&
    parameters.aspect !== "customers"
  ) {
    return null;
  }
  const building = parameters.building;
  return {
    aspect: parameters.aspect,
    period: parameters.period,
    scope: parameters.scope,
    building: building === "opus_la" || building === "century_park_east" || building === "shared" ? building : null,
  };
}

export function requestedTenantIdsFor(question: LaundryFarmCompanyQuestion): string[] {
  if (question.scope === "both") return [...LAUNDRY_FARM_COMPANY_TENANTS];
  if (question.scope === "laundry_farm" || question.scope === "default") return [question.scope];
  return [];
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

function matchedCustomerCount(sales: readonly CompanySaleInput[]): number {
  const positive = sales.filter(sale => sale.recordedSalesCents > 0);
  const { groups } = resolveCustomerIdentities(positive, sale => sale.identity ?? {});
  return groups.filter(group => group.matched).length;
}

function businessSlices(
  sales: readonly CompanySaleInput[],
  unpaidSupplied: boolean,
  catalog: readonly BuildingConfig[]
): CompanyBusinessSlice[] {
  const tenantIds = [...new Set(sales.map(sale => sale.tenantId))];
  return tenantIds
    .map(tenantId => {
      const mine = sales.filter(sale => sale.tenantId === tenantId);
      const money = emptyMoney();
      for (const sale of mine) addSale(money, sale);
      const byBuilding = new Map<string, { label: string; sales: CompanySaleInput[] }>();
      for (const sale of mine) {
        const attribution = attributeCompanyBuilding(sale, catalog);
        const group = byBuilding.get(attribution.bucket) ?? { label: attribution.label, sales: [] };
        group.sales.push(sale);
        byBuilding.set(attribution.bucket, group);
      }
      return {
        tenantId,
        label: businessDisplayName(tenantId),
        figures: finishMoney(money, unpaidSupplied),
        customerCount: matchedCustomerCount(mine),
        sharedBuildingCustomerCount: matchedCustomerCount(
          mine.filter(sale => {
            const bucket = attributeCompanyBuilding(sale, catalog).bucket;
            return bucket === "opus_la" || bucket === "century_park_east";
          })
        ),
        buildings: [...byBuilding.entries()]
          .map(([bucket, group]) => {
            const buildingMoney = emptyMoney();
            for (const sale of group.sales) addSale(buildingMoney, sale);
            return {
              bucket,
              label: group.label,
              figures: finishMoney(buildingMoney, false),
              customerCount: matchedCustomerCount(group.sales),
            };
          })
          .sort((a, b) => bucketRank(a.bucket) - bucketRank(b.bucket)),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
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
  bookComplete?: boolean;
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
    bookComplete: input.bookComplete ?? input.mayStateCompanyTotal,
    tenantsRead: input.tenantsRead,
    tenantsUnread: input.tenantsUnread,
    businesses: businessSlices(counted, input.unpaid != null, catalog),
    totals: finishMoney(totalsMoney, input.unpaid != null),
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
  /** When set, only these businesses are read. The other ledger stays out. */
  requestedTenantIds?: readonly string[];
  /** A cross-business request fails closed unless every requested business is authorized. */
  requireAllRequested?: boolean;
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
  const requested = input.requestedTenantIds?.filter(tenantId =>
    (LAUNDRY_FARM_COMPANY_TENANTS as readonly string[]).includes(tenantId)
  );
  if (input.requireAllRequested && requested?.some(tenantId => !authorized.has(tenantId))) {
    return composeLaundryFarmCompanyView({
      period: { start: period.start, end: period.end, label: period.label },
      scope: "unauthorized",
      mayStateCompanyTotal: false,
      tenantsRead: [],
      tenantsUnread: [...LAUNDRY_FARM_COMPANY_TENANTS],
      sales: [],
      unpaid: null,
    });
  }
  const allowed = (requested ?? [...LAUNDRY_FARM_COMPANY_TENANTS]).filter(tenantId => authorized.has(tenantId));
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
  const universe = requested ?? [...LAUNDRY_FARM_COMPANY_TENANTS];
  const tenantsUnread: string[] = universe.filter(tenantId => !allowed.includes(tenantId));
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
    bookComplete: booksComplete && tenantsUnread.length === 0 && tenantsRead.length > 0,
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
