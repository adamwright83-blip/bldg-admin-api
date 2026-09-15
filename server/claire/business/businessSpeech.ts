import { formatInTimeZone } from "date-fns-tz";
import {
  BUILDING_LABEL,
  BUSINESS_LINE_LABEL,
  SOURCE_LABEL,
  type BuildingKey,
  type LedgerFilters,
  type LineageBreakdown,
} from "../../analytics/businessLineage";
import type { CustomerDetail, CustomerSummary, OrderBrief } from "../../analytics/businessMetrics";
import { addDaysYmd, daysInclusive, formatBusinessDate } from "../../analytics/businessPeriods";
import type { BusinessMetric, BusinessQuery, BusinessQueryResult } from "../../analytics/businessQuery";
import type { DataFreshness } from "../../analytics/dataFreshness";
import type { CustomerAspect, FreshnessAspect, LineageScope, OrderAspect } from "./businessLanguage";

/**
 * Every sentence Claire speaks about business data is built here from a
 * deterministic result. Numbers enter only through Speech.money/count/pct/
 * date/time, which records them as facts the grounding check can verify.
 */

export type ClaireSurface = "voice" | "text";

export type SpeechHint =
  | { kind: "freshness"; aspect: FreshnessAspect }
  | { kind: "composition_building"; buildings: BuildingKey[] }
  | { kind: "customer_aspect"; aspect: CustomerAspect | null }
  | { kind: "order_ingested" }
  | { kind: "combined"; labels: string[] };

export type SpeakContext = {
  surface: ClaireSurface;
  previous: BusinessQuery | null;
  refinement: boolean;
  utterance: string;
  today: string;
  disclosed: string[];
  timeZone: string;
  hint?: SpeechHint | null;
};

export function formatMoney(cents: number, exact = false): string {
  const dollars = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  if (!exact && dollars >= 100) return `${sign}$${Math.round(dollars).toLocaleString("en-US")}`;
  return `${sign}$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatBusinessDateTime(iso: string, timeZone: string, today: string): string {
  const at = new Date(iso);
  const day = formatInTimeZone(at, timeZone, "yyyy-MM-dd");
  const clock = formatInTimeZone(at, timeZone, "h:mm a");
  if (day === today) return `today at ${clock}`;
  if (day === addDaysYmd(today, -1)) return `yesterday at ${clock}`;
  return `${formatBusinessDate(day, day.slice(0, 4) !== today.slice(0, 4))} at ${clock}`;
}

export class Speech {
  readonly facts: string[] = [];
  readonly sentences: string[] = [];
  readonly disclosures: string[] = [];

  constructor(
    readonly surface: ClaireSurface,
    readonly timeZone = "America/Los_Angeles",
    readonly today = ""
  ) {}

  private fact(value: string): string {
    this.facts.push(value);
    return value;
  }
  money(cents: number, exact = false): string {
    return this.fact(formatMoney(cents, exact));
  }
  count(value: number): string {
    return this.fact(value.toLocaleString("en-US"));
  }
  pct(value: number): string {
    const abs = Math.abs(value);
    const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
    return this.fact(this.surface === "voice" ? `${text} percent` : `${text}%`);
  }
  label(value: string): string {
    return this.fact(value);
  }
  date(ymd: string, includeYear = false): string {
    return this.fact(formatBusinessDate(ymd, includeYear || (Boolean(this.today) && ymd.slice(0, 4) !== this.today.slice(0, 4))));
  }
  time(iso: string): string {
    return this.fact(formatBusinessDateTime(iso, this.timeZone, this.today));
  }
  say(sentence: string): void {
    if (sentence.trim()) this.sentences.push(sentence);
  }
  text(): string {
    return this.sentences.join(" ").replace(/\s+/g, " ").trim();
  }
}

export const plural = (n: number, singular: string, pluralForm = `${singular}s`) => (n === 1 ? singular : pluralForm);
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function during(label: string): string {
  if (label === "all time") return "over all time";
  if (/^(today|yesterday|this |last |since )/.test(label)) return label;
  return `in ${label}`;
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

const TOTALS_METRICS = new Set<BusinessMetric>(["revenue", "orders", "aov", "revenue_drivers"]);

function metricNoun(metric: BusinessMetric): string {
  switch (metric) {
    case "revenue":
    case "revenue_drivers":
    case "profit":
    case "composition":
      return "revenue";
    case "orders":
    case "latest_sales":
    case "biggest_orders":
      return "order";
    case "aov":
      return "average order value";
    case "open_orders":
      return "open-order";
    case "top_customers":
    case "frequent_customers":
    case "customer_share":
      return "top-customer";
    case "customer_history":
      return "customer";
    case "data_coverage":
      return "data coverage";
    case "data_freshness":
      return "data freshness";
    case "period_ranking":
      return "ranking";
    default:
      return "customer";
  }
}

export function unavailableSentence(metric: BusinessMetric): string {
  if (metric === "data_freshness") return "I couldn't check the import records just now, so I won't guess whether the data is current.";
  return `I couldn't get a reliable ${metricNoun(metric)} number just now, so I won't guess.`;
}

// ── Scope wording ────────────────────────────────────────────────────────────

export type ScopeWords = { service: string; prefix: string | null; suffix: string };

function processorWord(processor: string): string {
  switch (processor) {
    case "stripe":
      return "Stripe-backed";
    case "clearent":
      return "Clearent card";
    case "cash":
      return "cash";
    default:
      return "unrecorded-payment";
  }
}

export function scopeWords(query: Pick<BusinessQuery, "filters" | "serviceType">): ScopeWords {
  const filters: LedgerFilters = query.filters ?? {};
  const service = query.serviceType === "wash_fold" ? "wash-and-fold " : query.serviceType === "dry_cleaning" ? "dry-cleaning " : "";
  const parts: string[] = [];
  if (filters.businessLines?.length === 1) parts.push(BUSINESS_LINE_LABEL[filters.businessLines[0]!]);
  else if (filters.sources?.length === 1) parts.push(filters.sources[0] === "cleancloud" ? "CleanCloud" : "Goldline-order");
  if (filters.processors?.length === 1) parts.push(processorWord(filters.processors[0]!));
  const suffix: string[] = [];
  if (filters.customerLabel) suffix.push(`from ${filters.customerLabel}`);
  if (filters.includeBuildings?.length) suffix.push(`at ${joinList(filters.includeBuildings.map(key => BUILDING_LABEL[key]))}`);
  if (filters.excludeBuildings?.length) suffix.push(`excluding ${joinList(filters.excludeBuildings.map(key => BUILDING_LABEL[key]))}`);
  if (filters.addressLabel) suffix.push(filters.addressLabel);
  return { service, prefix: parts.length ? parts.join(" ") : null, suffix: suffix.length ? ` ${suffix.join(" ")}` : "" };
}

function revenueSubject(scope: ScopeWords): string {
  return scope.prefix ? `${scope.prefix} ${scope.service}revenue${scope.suffix}` : `paid ${scope.service}revenue${scope.suffix}`;
}

function orderSubject(scope: ScopeWords): string {
  return scope.prefix ? `${scope.prefix} ${scope.service}` : `paid ${scope.service}`;
}

function describeCriteria(minOrders: number, speech: Speech): string {
  if (minOrders <= 1) return "at least one paid order";
  if (minOrders === 2) return "at least two paid orders";
  return `at least ${speech.count(minOrders)} paid orders`;
}

function namesOf(members: Array<{ displayName: string }>, surface: ClaireSurface, speech: Speech): string {
  const cap = surface === "voice" ? 8 : 20;
  const shown = members.slice(0, cap).map(member => member.displayName);
  const rest = members.length - shown.length;
  return rest > 0 ? `${shown.join(", ")}, and ${speech.count(rest)} more` : joinList(shown);
}

// ── Coverage notes ───────────────────────────────────────────────────────────

function coverageNotes(result: Extract<BusinessQueryResult, { status: "ok" }>, speech: Speech, context: SpeakContext): void {
  const coverage = result.coverage;
  if (!coverage) return;
  const moneyMetric = TOTALS_METRICS.has(result.query.metric) || result.query.metric === "profit" || result.query.metric === "composition";
  const once = (key: string, sentence: () => string) => {
    if (context.disclosed.includes(key) || speech.disclosures.includes(key)) return;
    speech.disclosures.push(key);
    speech.say(sentence());
  };
  if (coverage.failedSources.length && coverage.loadedSources.length) {
    speech.say(
      `That only includes ${joinList(coverage.loadedSources.map(source => SOURCE_LABEL[source]))}; I couldn't reach ${joinList(coverage.failedSources.map(source => SOURCE_LABEL[source]))} just now.`
    );
  }
  const filters = result.query.filters ?? {};
  const nativeExcluded =
    Boolean(filters.sources?.length && !filters.sources.includes("laundry_butler")) ||
    Boolean(filters.businessLines?.length && !filters.businessLines.includes("laundry_butler")) ||
    Boolean(filters.processors?.length && !filters.processors.includes("stripe"));
  const placeScoped = Boolean(filters.includeBuildings?.length || filters.addressAny?.length || filters.addressTerms?.length || filters.customerKeys?.length);
  if (coverage.unverifiedNativeCount > 0 && moneyMetric && !nativeExcluded && !placeScoped) {
    once(
      `unverified:${coverage.unverifiedNativeCount}:${coverage.unverifiedNativeCents}`,
      () =>
        `It leaves out ${speech.count(coverage.unverifiedNativeCount)} Goldline ${plural(coverage.unverifiedNativeCount, "order")} marked paid without a payment record, worth ${speech.money(coverage.unverifiedNativeCents)}.`
    );
  }
  if (coverage.overlap.status === "suspected" && !result.query.filterUnion?.length) {
    once(
      `overlap:${coverage.overlap.suspectedPairs}:${coverage.overlap.suspectedCents}`,
      () =>
        `${capitalize(speech.count(coverage.overlap.suspectedPairs))} CleanCloud ${plural(coverage.overlap.suspectedPairs, "order")} match a Goldline order for the same customer, day, and amount, so this may double-count up to ${speech.money(coverage.overlap.suspectedCents)}.`
    );
  }
  if (coverage.serviceFilterUnclassified) {
    const { orders, cents } = coverage.serviceFilterUnclassified;
    once(
      `unclassified:${orders}:${cents}`,
      () =>
        `${capitalize(speech.count(orders))} CleanCloud ${plural(orders, "order")} worth ${speech.money(cents)} couldn't be classified as laundry or dry cleaning, so ${orders === 1 ? "it's" : "they're"} not in that.`
    );
  }
  if (filters.processors?.includes("clearent") && moneyMetric) {
    once(
      "clearent_basis",
      () => "That's CleanCloud's record of Clearent card payments; Clearent's own settlement reports aren't added on top of it."
    );
  }
  if (coverage.union && coverage.union.overlapOrders > 0) {
    speech.say(
      `${capitalize(speech.count(coverage.union.overlapOrders))} of those ${plural(coverage.union.overlapOrders, "order fits", "orders fit")} more than one of those, so each only counts once.`
    );
  }
  if (moneyMetric && /\b(total|all (?:of )?(?:our|the) |everything|whole business|company)\b/i.test(context.utterance)) {
    speech.say("That's paid orders in Goldline and CleanCloud; cash drawer and coin-op sales aren't connected.");
  }
}

// ── Totals ───────────────────────────────────────────────────────────────────

function speakTotals(
  result: Extract<BusinessQueryResult, { status: "ok" }>,
  data: Extract<Extract<BusinessQueryResult, { status: "ok" }>["data"], { kind: "totals" }>,
  speech: Speech,
  context: SpeakContext
): void {
  const { query, period, comparisonPeriod } = result;
  const label = speech.label(period.label);
  const tense = period.end >= context.today ? "is" : "was";
  const scope = scopeWords(query);
  const current = data.current;
  const previous = data.previous;
  const compLabel = comparisonPeriod ? speech.label(comparisonPeriod.label) : "";
  const periodOnlyRefinement =
    context.refinement &&
    context.previous?.metric === query.metric &&
    !previous &&
    JSON.stringify(context.previous?.filters ?? null) === JSON.stringify(query.filters ?? null);

  if (context.hint?.kind === "combined") {
    speech.say(
      `Together, ${joinList(context.hint.labels)} ${during(label)} come to ${speech.money(current.revenueCents)} across ${speech.count(current.orderCount)} ${plural(current.orderCount, "order")}.`
    );
    return;
  }

  if (query.metric === "orders") {
    const noun = orderSubject(scope);
    if (previous && comparisonPeriod) {
      const a = current.orderCount;
      const b = previous.orderCount;
      const outcome =
        a === b
          ? "the same number"
          : a > b
            ? `so ${label} had ${speech.count(a - b)} more`
            : `so ${compLabel} had ${speech.count(b - a)} more`;
      speech.say(
        `${capitalize(label)} had ${speech.count(a)} ${noun}${plural(a, "order")}${scope.suffix} and ${compLabel} had ${speech.count(b)}, ${outcome}.`
      );
      return;
    }
    speech.say(
      `There ${current.orderCount === 1 ? (tense === "is" ? "is" : "was") : tense === "is" ? "are" : "were"} ${speech.count(current.orderCount)} ${noun}${plural(current.orderCount, "order")}${scope.suffix} ${during(label)}.`
    );
    return;
  }

  if (query.metric === "aov") {
    const noun = scope.prefix ? `${scope.prefix} ${scope.service}` : scope.service;
    if (current.aovCents == null) {
      speech.say(`There were no ${orderSubject(scope)}orders${scope.suffix} ${during(label)}, so there's no average order value.`);
      return;
    }
    speech.say(
      `Average ${noun}order value${scope.suffix} ${during(label)} ${tense} ${speech.money(current.aovCents, true)} across ${speech.count(current.orderCount)} paid ${plural(current.orderCount, "order")}.`
    );
    if (previous?.aovCents != null && comparisonPeriod) {
      const diff = current.aovCents - previous.aovCents;
      speech.say(
        diff === 0
          ? `That's the same as ${compLabel}.`
          : `That's ${diff > 0 ? "up" : "down"} from ${speech.money(previous.aovCents, true)} ${during(compLabel)}.`
      );
    }
    return;
  }

  if (query.metric === "revenue_drivers") {
    const comparison = data.comparison;
    if (!comparison || !previous || !comparisonPeriod) return;
    const customersFirst = /\bwho\b/i.test(context.utterance);
    const movers = data.movers ?? [];
    const moverSentence = () => {
      if (!movers.length) return "No single customer moved it.";
      const entries = movers.map(
        mover => `${mover.displayName}, ${mover.deltaCents > 0 ? "up" : "down"} ${speech.money(Math.abs(mover.deltaCents))}`
      );
      return `The biggest customer ${plural(movers.length, "mover was", "movers were")} ${joinList(entries)}.`;
    };
    if (customersFirst) {
      speech.say(moverSentence());
      speech.say(
        `Overall ${revenueSubject(scope)} went from ${speech.money(previous.revenueCents)} ${during(compLabel)} to ${speech.money(current.revenueCents)} ${during(label)}.`
      );
      return;
    }
    if (previous.revenueCents === 0) {
      speech.say(
        `${capitalize(revenueSubject(scope))} ${during(label)} ${tense} ${speech.money(current.revenueCents)}, and there was none recorded ${during(compLabel)}, so there's nothing to break down.`
      );
      return;
    }
    const direction = comparison.revenueChangeCents >= 0 ? "up" : "down";
    speech.say(
      `${capitalize(revenueSubject(scope))} ${during(label)} ${tense} ${speech.money(current.revenueCents)}, ${direction} ${speech.pct(comparison.revenueChangePct ?? 0)} from ${speech.money(previous.revenueCents)} ${during(compLabel)}.`
    );
    const volume = Math.abs(comparison.volumeEffectCents ?? 0);
    const aov = Math.abs(comparison.aovEffectCents ?? 0);
    if (comparison.revenueChangeCents !== 0) {
      speech.say(
        volume >= aov
          ? `Most of that is order volume: ${speech.count(current.orderCount)} paid orders versus ${speech.count(previous.orderCount)}.`
          : `Most of that is average order value: ${speech.money(current.aovCents ?? 0, true)} versus ${speech.money(previous.aovCents ?? 0, true)}.`
      );
      if (movers.length) speech.say(moverSentence());
    }
    return;
  }

  // revenue
  const subject = revenueSubject(scope);
  speech.say(
    periodOnlyRefinement
      ? `${capitalize(during(label))}, ${subject} ${tense} ${speech.money(current.revenueCents)} across ${speech.count(current.orderCount)} ${plural(current.orderCount, "order")}.`
      : `${capitalize(subject)} ${during(label)} ${tense} ${speech.money(current.revenueCents)} across ${speech.count(current.orderCount)} ${plural(current.orderCount, "order")}.`
  );
  if (previous && comparisonPeriod && data.comparison) {
    if (previous.revenueCents === 0) {
      speech.say(
        current.revenueCents === 0 ? `There was none ${during(compLabel)} either.` : `There was no ${subject} recorded ${during(compLabel)}.`
      );
    } else if (data.comparison.revenueChangeCents === 0) {
      speech.say(`That's flat against ${compLabel}.`);
    } else {
      speech.say(
        `That's ${data.comparison.revenueChangeCents > 0 ? "up" : "down"} ${speech.pct(data.comparison.revenueChangePct ?? 0)} from ${compLabel}, which had ${speech.money(previous.revenueCents)}.`
      );
    }
  }
}

// ── Composition ──────────────────────────────────────────────────────────────

export function speakComposition(breakdown: LineageBreakdown, periodLabel: string, speech: Speech, hint?: SpeechHint | null): void {
  const when = during(periodLabel);
  if (hint?.kind === "composition_building") {
    for (const building of hint.buildings) {
      const slice = breakdown.byBuilding.find(item => item.key === building);
      const name = BUILDING_LABEL[building];
      if (!breakdown.total.orders) {
        speech.say(`There's nothing ${when} to break down.`);
      } else if (!slice) {
        speech.say(`No, none of that was ${name}.`);
      } else if (slice.orders === breakdown.total.orders) {
        speech.say(`Yes, all of it was ${name}: ${speech.money(slice.cents)} across ${speech.count(slice.orders)} ${plural(slice.orders, "order")}.`);
      } else {
        speech.say(
          `Yes. ${capitalize(speech.money(slice.cents))} across ${speech.count(slice.orders)} of those ${speech.count(breakdown.total.orders)} orders was ${name}.`
        );
      }
    }
    return;
  }
  if (!breakdown.total.orders) {
    speech.say(`There's nothing ${when} to break down.`);
    return;
  }
  const butler = breakdown.byBusinessLine.find(slice => slice.key === "laundry_butler");
  const farm = breakdown.byBusinessLine.find(slice => slice.key === "laundry_farm");
  const unattributed = breakdown.byBusinessLine.find(slice => slice.key === "unattributed");
  if (butler && farm) speech.say("That's both businesses.");
  else if (butler || farm) speech.say(`That's all ${(butler ?? farm)!.label}${unattributed ? " that I can attribute" : ""}.`);
  if (butler) {
    speech.say(
      `Laundry Butler, Goldline's own Stripe-paid orders, was ${speech.money(butler.cents)} across ${speech.count(butler.orders)} ${plural(butler.orders, "order")}.`
    );
  }
  if (farm) {
    const clearent = breakdown.byProcessor.find(slice => slice.key === "clearent");
    const cash = breakdown.byProcessor.find(slice => slice.key === "cash");
    const other = breakdown.byProcessor.find(slice => slice.key === "other_or_unknown");
    let detail = "";
    if (clearent && clearent.orders === farm.orders) detail = ", all on Clearent cards";
    else if (clearent || cash || other) {
      const parts = [
        clearent ? `${speech.money(clearent.cents)} on Clearent cards` : null,
        cash ? `${speech.money(cash.cents)} cash` : null,
        other ? `${speech.money(other.cents)} with no recorded payment method` : null,
      ].filter((part): part is string => Boolean(part));
      detail = `: ${joinList(parts)}`;
    }
    speech.say(
      `Laundry Farm, through CleanCloud, was ${speech.money(farm.cents)} across ${speech.count(farm.orders)} ${plural(farm.orders, "order")}${detail}.`
    );
    const residents = breakdown.laundryFarmBuildingResidents;
    if (residents.orders > 0) {
      speech.say(
        `${capitalize(speech.count(residents.orders))} of the Laundry Farm orders, ${speech.money(residents.cents)}, ${residents.orders === 1 ? "was" : "were"} for OPUS LA or Century Park East residents.`
      );
    }
  }
  if (unattributed) {
    speech.say(
      `${capitalize(speech.money(unattributed.cents))} across ${speech.count(unattributed.orders)} CleanCloud ${plural(unattributed.orders, "order")} I can't assign to either business, because CleanCloud isn't paired to a named store.`
    );
  }
}

// ── Orders ───────────────────────────────────────────────────────────────────

function customerOf(order: OrderBrief): string {
  return order.customerName ?? "an unnamed customer";
}

function speakOrders(
  result: Extract<BusinessQueryResult, { status: "ok" }>,
  data: Extract<Extract<BusinessQueryResult, { status: "ok" }>["data"], { kind: "orders" }>,
  speech: Speech,
  context: SpeakContext
): void {
  const scope = scopeWords(result.query);
  const noun = scope.prefix ? `${scope.prefix} ` : "";
  const allTime = result.query.period.kind === "all_time";
  const when = allTime ? "on record" : during(speech.label(result.period.label));
  if (!data.orders.length) {
    speech.say(`I don't see any ${noun}paid orders${scope.suffix} ${when}.`);
    return;
  }
  const first = data.orders[0]!;
  if (data.orders.length === 1) {
    if (data.ordering === "latest") {
      speech.say(
        `The newest ${noun}sale I have${scope.suffix} is ${speech.money(first.cents, true)} for ${customerOf(first)}, paid ${speech.time(first.occurredAt)}.`
      );
    } else if (data.ordering === "earliest") {
      speech.say(
        `The first ${noun}order on record${scope.suffix} was ${speech.money(first.cents, true)} for ${customerOf(first)}, paid ${speech.date(first.date, true)}.`
      );
    } else {
      speech.say(
        `The biggest single ${noun}order${scope.suffix} ${when} was ${speech.money(first.cents, true)} for ${customerOf(first)}, on ${speech.date(first.date)}.`
      );
    }
    if (context.hint?.kind === "order_ingested") {
      speech.say(first.ingestedAt ? `Goldline imported it ${speech.time(first.ingestedAt)}.` : "It's a Goldline order, so it wasn't imported.");
    }
    return;
  }
  const word = data.ordering === "latest" ? "most recent" : data.ordering === "earliest" ? "first" : "biggest";
  speech.say(
    `The ${speech.count(data.orders.length)} ${word} ${noun}orders${scope.suffix} are ${joinList(
      data.orders.map(order => `${speech.money(order.cents, true)} for ${customerOf(order)} on ${speech.date(order.date)}`)
    )}.`
  );
}

export function describeOrderLineage(order: OrderBrief, speech: Speech): string {
  if (order.source === "cleancloud") {
    const line = order.businessLine === "laundry_farm" ? ", a Laundry Farm sale" : "";
    const paid =
      order.processor === "clearent" ? ", paid on a Clearent card" : order.processor === "cash" ? ", paid in cash" : "";
    const number = order.orderNumber ? ` ${speech.label(order.orderNumber)}` : "";
    return `it's CleanCloud order${number}${line}${paid}.`;
  }
  const number = order.orderNumber ? ` ${speech.label(order.orderNumber)}` : "";
  return `it's Goldline order${number}, a Laundry Butler sale paid through Stripe.`;
}

export function speakOrderAspect(input: {
  order: OrderBrief;
  aspect: OrderAspect;
  asked: LineageScope | null;
  speech: Speech;
}): void {
  const { order, aspect, asked, speech } = input;
  switch (aspect) {
    case "who":
      speech.say(order.customerName ? `It was for ${order.customerName}.` : "That order doesn't have a customer name on it.");
      return;
    case "amount":
      speech.say(`${speech.money(order.cents, true)}.`);
      return;
    case "when":
      speech.say(`It was paid ${speech.time(order.occurredAt)}.`);
      return;
    case "what":
      speech.say(
        order.summary
          ? `It was ${speech.label(order.summary)}, for ${speech.money(order.cents, true)}.`
          : `The record doesn't itemize it; it was ${speech.money(order.cents, true)}.`
      );
      return;
    case "ingested":
      speech.say(order.ingestedAt ? `Goldline imported it ${speech.time(order.ingestedAt)}.` : "It's a Goldline order, so there was no import.");
      return;
    case "source": {
      let opener = "";
      if (asked) {
        const matches =
          Boolean(asked.sources?.includes(order.source)) ||
          Boolean(order.businessLine && asked.businessLines?.includes(order.businessLine)) ||
          Boolean(order.processor && asked.processors?.includes(order.processor));
        opener = matches ? "Yes, " : "No, ";
      }
      const body = describeOrderLineage(order, speech);
      speech.say(opener ? `${opener}${body}` : capitalize(body));
      if (order.ingestedAt) speech.say(`Goldline imported it ${speech.time(order.ingestedAt)}.`);
      return;
    }
    case "before":
      return;
  }
}

// ── Freshness ────────────────────────────────────────────────────────────────

function ymdIn(iso: string, timeZone: string): string {
  return formatInTimeZone(new Date(iso), timeZone, "yyyy-MM-dd");
}

export function speakFreshness(freshness: DataFreshness, aspect: FreshnessAspect, speech: Speech): void {
  const tz = freshness.timeZone;
  const imported = freshness.gumball.receipts.filter(receipt => receipt.status === "imported");
  const lastImport = imported[0] ?? null;
  const todayImports = imported.filter(receipt => ymdIn(receipt.at, tz) === freshness.today);
  const attempts = freshness.gumball.attempts;
  const todayProblems = (attempts ?? []).filter(attempt => ymdIn(attempt.at, tz) === freshness.today && attempt.outcome !== "imported");
  const sale = freshness.cleancloud.latestSale;

  const describeImport = (receipt: (typeof imported)[number]) => {
    const inserted = receipt.inserted ?? 0;
    const updated = receipt.updated ?? 0;
    const range =
      receipt.rangeFrom && receipt.rangeTo
        ? receipt.rangeFrom === receipt.rangeTo
          ? ` for ${speech.date(receipt.rangeFrom)}`
          : ` covering ${speech.date(receipt.rangeFrom)} through ${speech.date(receipt.rangeTo)}`
        : "";
    if (inserted + updated === 0) return `nothing new${range}`;
    const parts = [
      inserted ? `${speech.count(inserted)} new` : null,
      updated ? `${speech.count(updated)} updated` : null,
    ].filter((part): part is string => Boolean(part));
    return `${joinList(parts)} CleanCloud ${plural(inserted + updated, "order")}${range}`;
  };
  const lastSuccessSentence = () =>
    lastImport
      ? `The last successful GUMBALL import was ${speech.time(lastImport.at)}: ${describeImport(lastImport)}.`
      : freshness.gumball.lastSuccessAt
        ? `The last successful GUMBALL import was ${speech.time(freshness.gumball.lastSuccessAt)}.`
        : "I don't have any successful GUMBALL import on record.";
  const whyUnknown = () => {
    if (attempts === null) {
      return "Failed attempts weren't being logged before this release, so I can't tell whether it didn't run or failed before reaching Goldline.";
    }
    const since = lastImport?.at ?? "";
    return attempts.some(attempt => attempt.at > since && attempt.outcome !== "imported")
      ? ""
      : "No failed attempt is logged since then either, so it most likely didn't run.";
  };
  const newestSale = () =>
    sale?.paidAt
      ? `The newest CleanCloud sale I can see is ${speech.money(sale.cents, true)} for ${sale.customerName ?? "an unnamed customer"}, paid ${speech.time(sale.paidAt)}.`
      : "";

  if (!freshness.gumball.paired && (aspect === "gumball_today" || aspect === "gumball_working")) {
    speech.say("GUMBALL isn't paired to a CleanCloud store for this business, so it can't import anything.");
    if (freshness.cleancloud.latestIngestedAt) speech.say(`CleanCloud data last came in ${speech.time(freshness.cleancloud.latestIngestedAt)}.`);
    return;
  }

  switch (aspect) {
    case "gumball_today":
    case "gumball_working": {
      if (todayImports.length) {
        const receipt = todayImports[0]!;
        const opener = aspect === "gumball_today" ? "Yes." : "It's running.";
        speech.say(`${opener} GUMBALL imported ${speech.time(receipt.at)}: ${describeImport(receipt)}.`);
        speech.say(newestSale());
        return;
      }
      if (todayProblems.length) {
        const attempt = todayProblems[0]!;
        speech.say(`GUMBALL tried ${speech.time(attempt.at)} but didn't import${attempt.message ? `: ${attempt.message}` : ""}.`);
        speech.say(lastSuccessSentence());
        return;
      }
      const daysSince = lastImport ? daysInclusive(ymdIn(lastImport.at, tz), freshness.today) - 1 : null;
      if (aspect === "gumball_today") speech.say("I don't see a GUMBALL import today.");
      else speech.say(daysSince !== null && daysSince <= 1 ? "It ran recently." : "I can't verify that it's running right now.");
      speech.say(lastSuccessSentence());
      if (daysSince === null || daysSince > 1) speech.say(whyUnknown());
      speech.say(newestSale());
      return;
    }
    case "cleancloud_updated": {
      const latestIngested = freshness.cleancloud.latestIngestedAt;
      if (!latestIngested) {
        speech.say("I don't have any CleanCloud data imported.");
        return;
      }
      const sameImport = lastImport && Math.abs(Date.parse(lastImport.at) - Date.parse(latestIngested)) < 10 * 60 * 1000;
      speech.say(
        `CleanCloud data last came in ${speech.time(latestIngested)}${sameImport ? `, when GUMBALL brought in ${describeImport(lastImport!)}` : ""}.`
      );
      speech.say(newestSale());
      return;
    }
    case "data_current": {
      const through = lastImport?.rangeTo ?? (sale?.paidAt ? ymdIn(sale.paidAt, tz) : null);
      if (!through) {
        speech.say("I can't tell. There's no CleanCloud import on record.");
        return;
      }
      const behind = daysInclusive(through, freshness.today) - 1;
      speech.say(
        behind <= 1
          ? `Yes. CleanCloud is current through ${speech.date(through)}.`
          : `Not quite. CleanCloud is only current through ${speech.date(through)}, ${speech.count(behind)} days ago.`
      );
      speech.say(lastSuccessSentence());
      if (behind > 1) speech.say(whyUnknown());
      return;
    }
    case "cleancloud_today": {
      if (!todayImports.length) {
        speech.say("GUMBALL hasn't imported anything today, so I can't count today's CleanCloud orders yet.");
        speech.say(lastSuccessSentence());
        return;
      }
      const count = freshness.cleancloud.salesToday;
      speech.say(
        `${capitalize(speech.count(count))} CleanCloud ${plural(count, "sale")} dated today ${count === 1 ? "is" : "are"} in so far, from the import ${speech.time(todayImports[0]!.at)}.`
      );
      return;
    }
  }
}

// ── Customers ────────────────────────────────────────────────────────────────

function averageOthers(detail: CustomerDetail): number | null {
  if (!detail.lastOrder || detail.orderCount < 2) return null;
  return Math.round((detail.revenueCents - detail.lastOrder.cents) / (detail.orderCount - 1));
}

export function describeCustomerOption(detail: CustomerDetail, speech: Speech): string {
  const building = detail.buildings[0] ? ` at ${BUILDING_LABEL[detail.buildings[0]]}` : "";
  const last = detail.lastOrderDate ? `, last ordered ${speech.date(detail.lastOrderDate)}` : "";
  return `${detail.displayName}${building}${last}`;
}

export function speakCustomerDetail(detail: CustomerDetail, aspect: CustomerAspect | null, periodLabel: string, speech: Speech): void {
  const name = detail.displayName;
  const when = during(periodLabel);
  const allTime = periodLabel === "all time";
  const orders = (n: number) => plural(n, "order");
  if (detail.orderCount === 0) {
    speech.say(`${name} has no paid orders ${when}.`);
    if (detail.daysSinceLastOrder !== null) {
      speech.say(`The last one on record was ${speech.count(detail.daysSinceLastOrder)} days ago.`);
    }
    return;
  }
  switch (aspect) {
    case "count":
      speech.say(`${name} has ${speech.count(detail.orderCount)} paid ${orders(detail.orderCount)} ${when}.`);
      return;
    case "last":
      speech.say(
        `${name}'s last paid order was ${speech.date(detail.lastOrder!.date)}, for ${speech.money(detail.lastOrder!.cents, true)}.`
      );
      return;
    case "first":
      speech.say(
        `${name}'s first paid order ${allTime ? "on record" : when} was ${speech.date(detail.firstOrder!.date, true)}, for ${speech.money(detail.firstOrder!.cents, true)}.`
      );
      return;
    case "average":
      speech.say(
        `${name}'s average order ${when} is ${speech.money(Math.round(detail.revenueCents / detail.orderCount), true)} across ${speech.count(detail.orderCount)} paid ${orders(detail.orderCount)}.`
      );
      return;
    case "largest":
      speech.say(`${name}'s largest order ${when} was ${speech.money(detail.largestOrder!.cents, true)} on ${speech.date(detail.largestOrder!.date)}.`);
      return;
    case "cadence":
      speech.say(
        detail.medianGapDays === null
          ? `${name} has only ${speech.count(detail.orderCount)} paid ${orders(detail.orderCount)} ${when}, so there's no ordering rhythm yet.`
          : `${name} usually orders about every ${speech.count(Math.round(detail.medianGapDays))} days, with ${speech.count(detail.orderCount)} paid orders ${when}.`
      );
      return;
    case "trend": {
      if (detail.medianGapDays === null || detail.daysSinceLastOrder === null) {
        speech.say(`${name} doesn't have enough orders to tell whether the rhythm is changing.`);
        return;
      }
      const usual = Math.round(detail.medianGapDays);
      const since = detail.daysSinceLastOrder;
      const verdict =
        since > usual * 1.5 ? "so yes, that's well past normal" : since > usual ? "which is a little longer than usual" : "so no, that's within the normal rhythm";
      speech.say(
        `It's been ${speech.count(since)} days since ${name}'s last order; normally it's about ${speech.count(usual)} days between orders, ${verdict}.`
      );
      return;
    }
    case "what_last": {
      const last = detail.lastOrder!;
      speech.say(
        last.summary
          ? `${name}'s last order, on ${speech.date(last.date)}, was ${speech.label(last.summary)}, for ${speech.money(last.cents, true)}.`
          : `${name}'s last order was ${speech.date(last.date)} for ${speech.money(last.cents, true)}; the record doesn't itemize it.`
      );
      return;
    }
    case "last_vs_normal": {
      const average = averageOthers(detail);
      const last = detail.lastOrder!;
      if (average === null) {
        speech.say(`${name} only has one paid order ${when}, so there's nothing to compare it to.`);
        return;
      }
      const relation = last.cents === average ? "the same as" : last.cents > average ? "bigger than" : "smaller than";
      speech.say(
        `${name}'s last order was ${speech.money(last.cents, true)}, ${relation} the ${speech.money(average, true)} average of the others.`
      );
      return;
    }
    case "address":
      speech.say(
        detail.addresses.length
          ? `The address on ${name}'s orders is ${detail.addresses[0]}.`
          : `${name}'s orders don't carry an address.`
      );
      return;
    case "business": {
      const lines = detail.businessLines.map(line => BUSINESS_LINE_LABEL[line]);
      speech.say(lines.length ? `${name} orders through ${joinList(lines)}.` : `I can't attribute ${name}'s orders to a business line.`);
      return;
    }
    default:
      if (allTime) {
        speech.say(
          `${name} has spent ${speech.money(detail.revenueCents)} across ${speech.count(detail.orderCount)} paid ${orders(detail.orderCount)} since ${speech.date(detail.firstOrderDate!, true)}; the most recent was ${speech.date(detail.lastOrderDate!)}.`
        );
      } else {
        speech.say(
          `${name} has ${speech.money(detail.revenueCents)} in paid revenue across ${speech.count(detail.orderCount)} ${orders(detail.orderCount)} ${when}; the most recent was ${speech.date(detail.lastOrderDate!)}.`
        );
      }
  }
}

export function speakCustomerComparison(
  a: CustomerDetail,
  b: CustomerDetail,
  aspect: CustomerAspect | null,
  periodLabel: string,
  speech: Speech
): void {
  const when = during(periodLabel);
  if (aspect === "cadence" || aspect === "trend") {
    const gapA = a.medianGapDays;
    const gapB = b.medianGapDays;
    if (gapA !== null && gapB !== null) {
      const winner = gapA === gapB ? null : gapA < gapB ? a : b;
      speech.say(
        `${a.displayName} orders about every ${speech.count(Math.round(gapA))} days and ${b.displayName} about every ${speech.count(Math.round(gapB))}${winner ? `, so ${winner.displayName} orders more often` : ", about the same"}.`
      );
      return;
    }
    const winner = a.orderCount === b.orderCount ? null : a.orderCount > b.orderCount ? a : b;
    speech.say(
      `${a.displayName} has ${speech.count(a.orderCount)} paid ${plural(a.orderCount, "order")} ${when} and ${b.displayName} has ${speech.count(b.orderCount)}${winner ? `, so ${winner.displayName} orders more often` : ""}.`
    );
    return;
  }
  if (aspect === "last") {
    if (!a.lastOrderDate || !b.lastOrderDate) {
      const known = a.lastOrderDate ? a : b;
      speech.say(known.lastOrderDate ? `Only ${known.displayName} has a paid order ${when}, on ${speech.date(known.lastOrderDate)}.` : `Neither has a paid order ${when}.`);
      return;
    }
    const [recent, other] = a.lastOrderDate >= b.lastOrderDate ? [a, b] : [b, a];
    speech.say(
      a.lastOrderDate === b.lastOrderDate
        ? `They both last ordered on ${speech.date(a.lastOrderDate)}.`
        : `${recent.displayName} ordered most recently, on ${speech.date(recent.lastOrderDate!)}; ${other.displayName}'s last order was ${speech.date(other.lastOrderDate!)}.`
    );
    return;
  }
  speech.say(
    `${a.displayName} has ${speech.money(a.revenueCents)} across ${speech.count(a.orderCount)} paid ${plural(a.orderCount, "order")} ${when}; ${b.displayName} has ${speech.money(b.revenueCents)} across ${speech.count(b.orderCount)}.`
  );
  if (a.revenueCents !== b.revenueCents) {
    speech.say(`${(a.revenueCents > b.revenueCents ? a : b).displayName} has spent more.`);
  }
}

// ── Result dispatcher ────────────────────────────────────────────────────────

function bucketLabel(key: string, groupBy: "month" | "week" | "day", speech: Speech): string {
  if (groupBy === "month") {
    const includeYear = Boolean(speech.today) && key.slice(0, 4) !== speech.today.slice(0, 4);
    return speech.label(formatBusinessDate(`${key}-01`).replace(/ 1$/, "") + (includeYear ? ` ${key.slice(0, 4)}` : ""));
  }
  if (groupBy === "week") return `the week of ${speech.date(key)}`;
  return speech.date(key);
}

export function speakBusinessResult(
  result: BusinessQueryResult,
  context: SpeakContext
): { text: string; facts: string[]; disclosures: string[] } {
  const speech = new Speech(context.surface, context.timeZone, context.today);
  const query = result.query;

  if (result.status === "unavailable") {
    if (query.metric === "profit") {
      speech.say(
        "I can't calculate profit: Goldline doesn't have payroll or supply costs connected, and I couldn't reach the revenue data just now either."
      );
    } else {
      speech.say(unavailableSentence(query.metric));
    }
    return { text: speech.text(), facts: speech.facts, disclosures: speech.disclosures };
  }

  const { data, period } = result;
  const label = speech.label(period.label);
  const scope = scopeWords(query);
  switch (data.kind) {
    case "totals":
      speakTotals(result, data, speech, context);
      break;
    case "composition":
      speakComposition(data.breakdown, label, speech, context.hint);
      break;
    case "orders":
      speakOrders(result, data, speech, context);
      break;
    case "freshness":
      speakFreshness(data.freshness, context.hint?.kind === "freshness" ? context.hint.aspect : "gumball_working", speech);
      break;
    case "open_orders":
      speech.say(
        `There ${data.openTotal === 1 ? "is" : "are"} ${speech.count(data.openTotal)} open ${plural(data.openTotal, "order")} in Goldline's own order flow right now, and ${speech.count(data.awaitingPayment)} ${data.awaitingPayment === 1 ? "is" : "are"} waiting on payment.`
      );
      break;
    case "customers": {
      const { population } = data;
      const previous = context.previous;
      const identities = plural(population.count, "customer identity", "customer identities");
      if (query.listMembers) {
        const singular = /\bwhich customer\b(?!s)|\bwho is\b|\bwho lives\b/i.test(context.utterance);
        speech.say(
          population.count === 0
            ? query.metric === "dormant_customers"
              ? `Nobody${query.filters?.customerKeys?.length ? " in that group" : scope.suffix} has gone without an order ${during(label)}.`
              : `Nobody matches that${scope.suffix}.`
            : singular && population.count === 1
              ? `That's ${population.members[0]!.displayName}.`
              : `They are ${namesOf(population.members, context.surface, speech)}.`
        );
        break;
      }
      if (query.metric === "new_customers") {
        speech.say(
          `${capitalize(speech.count(population.count))} of the ${speech.count(data.activeCount ?? 0)} active customer ${plural(data.activeCount ?? 0, "identity", "identities")} ${during(label)} had no paid order in the year before.`
        );
      } else if (query.metric === "dormant_customers") {
        speech.say(
          `${capitalize(speech.count(population.count))} ${identities}${scope.suffix} had ${query.minOrders > 1 ? describeCriteria(query.minOrders, speech) : "a paid order"} in the year before that but none ${during(label)}.`
        );
      } else {
        const sameMetric = context.refinement && previous?.metric === "active_customers";
        const periodChanged = sameMetric && JSON.stringify(previous!.period) !== JSON.stringify(query.period);
        const minChanged = sameMetric && previous!.minOrders !== query.minOrders;
        if (sameMetric && minChanged && !periodChanged && query.minOrders > previous!.minOrders) {
          speech.say(`That leaves ${speech.count(population.count)}.`);
        } else if (sameMetric && periodChanged && !minChanged) {
          speech.say(`Using ${label}, it's ${speech.count(population.count)}.`);
        } else if (sameMetric) {
          speech.say(`Counting customers with ${describeCriteria(query.minOrders, speech)} ${during(label)}${scope.suffix}, it's ${speech.count(population.count)}.`);
        } else {
          speech.say(
            `If we count active as ${describeCriteria(query.minOrders, speech)} ${during(label)}${scope.suffix}, that's ${speech.count(population.count)} ${identities}.`
          );
        }
      }
      if (population.unmatchedCount > 0 && (!context.refinement || previous?.metric !== query.metric)) {
        speech.say(
          `${capitalize(speech.count(population.unmatchedCount))} of those ${population.unmatchedCount === 1 ? "is an order" : "are orders"} with no phone, email, or customer ID, so each counts on its own.`
        );
      }
      break;
    }
    case "top_customers": {
      if (!data.members.length) {
        speech.say(`I don't see any paid orders${scope.suffix} ${during(label)}.`);
        break;
      }
      const shown = data.members.slice(0, query.limit);
      if (data.rankedBy === "orders") {
        const entries = shown.map(member => `${member.displayName} with ${speech.count(member.orderCount)} ${plural(member.orderCount, "order")}`);
        speech.say(
          `The ${shown.length === 1 ? "customer who ordered" : "customers who ordered"} most often${scope.suffix} ${during(label)} ${shown.length === 1 ? "is" : "are"} ${joinList(entries)}.`
        );
        break;
      }
      const entries = shown.map(member => `${member.displayName} with ${speech.money(member.revenueCents)}`);
      speech.say(
        `Your top ${shown.length === 1 ? "customer" : `${speech.count(shown.length)} customers`} by paid revenue${scope.suffix} ${during(label)} ${shown.length === 1 ? "is" : "are"} ${joinList(entries)}.`
      );
      break;
    }
    case "customer_share":
      if (!data.totalCents) {
        speech.say(`I don't see any paid revenue${scope.suffix} ${during(label)}.`);
        break;
      }
      speech.say(
        `Your top ${speech.count(data.top.length)} ${plural(data.top.length, "customer")}${scope.suffix} ${during(label)} brought in ${speech.money(data.topCents)} of ${speech.money(data.totalCents)}, or ${speech.pct(data.sharePct ?? 0)}.`
      );
      break;
    case "period_ranking": {
      let rows = data.rows;
      let excludedCurrent = false;
      if (query.rank === "worst") {
        const current =
          data.groupBy === "month" ? context.today.slice(0, 7) : data.groupBy === "day" ? context.today : null;
        if (current && rows.some(row => row.key === current)) {
          rows = rows.filter(row => row.key !== current);
          excludedCurrent = true;
        }
      }
      if (!rows.length) {
        speech.say(`I don't see enough paid orders${scope.suffix} ${during(label)} to rank.`);
        break;
      }
      const top = rows[0]!;
      const word = query.rank === "worst" ? (data.groupBy === "day" ? "slowest" : "weakest") : "best";
      speech.say(
        `Your ${word} ${data.groupBy}${scope.suffix} ${during(label)} was ${bucketLabel(top.key, data.groupBy, speech)}, with ${speech.money(top.revenueCents)} across ${speech.count(top.orderCount)} ${plural(top.orderCount, "order")}.`
      );
      if (excludedCurrent) speech.say(`I left out the current ${data.groupBy}, since it isn't over.`);
      break;
    }
    case "customer_history": {
      const name = query.customerName ?? query.filters?.customerLabel ?? "that customer";
      if (!data.details.length) {
        speech.say(`I don't see a customer named ${name} in paid orders ${during(label)}.`);
      } else if (data.details.length > 1) {
        speech.say(
          `I found ${speech.count(data.details.length)} customers matching ${name}: ${joinList(data.details.slice(0, 4).map(detail => describeCustomerOption(detail, speech)))}. Which one do you mean?`
        );
      } else {
        speakCustomerDetail(data.details[0]!, context.hint?.kind === "customer_aspect" ? context.hint.aspect : null, label, speech);
      }
      break;
    }
    case "profit": {
      const costGaps = data.missing
        .filter(item => /payroll|labor|supply|cost/i.test(`${item.source} ${item.prevents}`))
        .map(item => (/payroll|labor/i.test(item.source) ? "payroll" : /supply/i.test(item.source) ? "supply costs" : item.source.toLowerCase()));
      const gaps = costGaps.length ? joinList(Array.from(new Set(costGaps))) : "cost data";
      speech.say(
        `I can give you revenue: ${revenueSubject(scope)} ${during(label)} ${period.end >= context.today ? "is" : "was"} ${speech.money(data.revenue.revenueCents)}. But I can't calculate trustworthy profit, because Goldline doesn't have ${gaps} connected.`
      );
      break;
    }
    case "data_coverage": {
      const connected = data.completeness.connected.map(item => item.source);
      const missing = data.completeness.missing.map(item => item.source.replace(/\s*\(.*\)/, "").toLowerCase());
      speech.say(
        `${connected.length ? `Goldline has ${joinList(connected)} connected.` : "Goldline doesn't have any paid-order source connected yet."} It doesn't have ${joinList(missing)}.`
      );
      break;
    }
  }
  if (data.kind !== "freshness" && data.kind !== "orders" && data.kind !== "customer_history") {
    coverageNotes(result, speech, context);
  }
  return { text: speech.text(), facts: speech.facts, disclosures: speech.disclosures };
}
