import type { BuildingKey, BusinessLine, LedgerFilters, LedgerSource, PaymentProcessor } from "../../analytics/businessLineage";
import { findNeighborhood } from "../../analytics/laNeighborhoods";

/**
 * Adam's business vocabulary → structured scope. Pure and deterministic; used
 * by Claire's analytical parser before any model is consulted. Recognizing a
 * word never grants a number: every scope still runs through the ledger.
 */

export function normalizeUtterance(text: string): string {
  return text.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ");
}

export type LineageScope = Pick<LedgerFilters, "businessLines" | "processors" | "sources">;

/**
 * `allowClearance`: telephone speech recognition hears "Clearent" as
 * "clearance"; accept that only in a revenue/sales conversation.
 */
export function lineageScope(lower: string, allowClearance: boolean): LineageScope | null {
  const businessLines: BusinessLine[] = [];
  if (/\blaundry ?butler\b|\bbutler\b/.test(lower)) businessLines.push("laundry_butler");
  if (/\blaundry ?farm\b|\bthe farm\b/.test(lower)) businessLines.push("laundry_farm");
  const processors: PaymentProcessor[] = [];
  if (/\bstripe\b/.test(lower)) processors.push("stripe");
  if (/\bclear ?ent\b|\bclarent\b|\bxplor ?pay\b|\bexplore ?pay\b/.test(lower) || (allowClearance && /\bclearances?\b/.test(lower))) {
    processors.push("clearent");
  }
  if (/\bcash\b/.test(lower)) processors.push("cash");
  const sources: LedgerSource[] = [];
  if (/\bclean ?cloud\b/.test(lower)) sources.push("cleancloud");
  if (/\bgoldline(?:'s)? own\b|\bnative (?:orders?|goldline)\b|\bgoldline orders?\b/.test(lower)) sources.push("laundry_butler");
  if (!businessLines.length && !processors.length && !sources.length) return null;
  return {
    businessLines: businessLines.length ? businessLines : null,
    processors: processors.length ? processors : null,
    sources: sources.length ? sources : null,
  };
}

export function buildingMentions(lower: string): BuildingKey[] {
  const found: BuildingKey[] = [];
  if (/\bopus(?: la)?\b/.test(lower)) found.push("opusla");
  if (/\bcentury park(?: east)?\b|\bcpe\b/.test(lower)) found.push("centuryparkeast");
  return found;
}

const EXCLUDING = /\b(exclud\w*|except|without|not counting|minus|leave out|leaving out|take out|taking out)\b/;

export function buildingScope(lower: string): { include?: BuildingKey[]; exclude?: BuildingKey[] } | null {
  const mentioned = buildingMentions(lower);
  if (!mentioned.length) return null;
  return EXCLUDING.test(lower) ? { exclude: mentioned } : { include: mentioned };
}

export type AddressScope = Pick<LedgerFilters, "addressAny" | "addressTerms" | "addressLabel">;

const STREET_SUFFIX = "(avenue|ave|street|st|boulevard|blvd|drive|dr|road|rd|place|pl|way|lane|ln|court|ct|terrace|ter)";

export function addressScope(text: string): AddressScope | null {
  const lower = normalizeUtterance(text);
  const neighborhood = findNeighborhood(lower);
  if (neighborhood) {
    return {
      addressAny: [...neighborhood.zips, neighborhood.label.toLowerCase()],
      addressTerms: null,
      addressLabel: `in ${neighborhood.label}`,
    };
  }
  const street = new RegExp(`\\b(?:on|at|off|along)\\s+([a-z][a-z'-]+(?:\\s[a-z][a-z'-]+)?)\\s+${STREET_SUFFIX}\\b`, "i").exec(text);
  if (street) {
    const name = street[1]!.replace(/^the\s+/i, "").trim();
    const title = name.replace(/\b[a-z]/g, letter => letter.toUpperCase());
    const suffix = street[2]!.toLowerCase();
    const suffixLabel =
      { ave: "Avenue", avenue: "Avenue", st: "Street", street: "Street", blvd: "Boulevard", boulevard: "Boulevard", dr: "Drive", drive: "Drive", rd: "Road", road: "Road", pl: "Place", place: "Place", ln: "Lane", lane: "Lane", ct: "Court", court: "Court", ter: "Terrace", terrace: "Terrace", way: "Way" }[suffix] ?? suffix;
    return { addressAny: null, addressTerms: [name.toLowerCase()], addressLabel: `on ${title} ${suffixLabel}` };
  }
  return null;
}

export function isCompositionQuestion(lower: string, scopeMentioned: boolean): boolean {
  if (
    /\b(what(?:'s| is| was) (?:that|this|it) made (?:up )?of|what makes up (?:that|this)|break (?:that|it|this) down|where did (?:that|it|this|the money) come from|what(?:'s| is) in (?:that|this) (?:number|total)|which business(?:es)? (?:is|was|were) (?:that|this|it)|what(?:'s| is) (?:that|this) (?:composed|made) of|split (?:that|it) (?:up|out))\b/.test(
      lower
    )
  ) {
    return true;
  }
  return (
    scopeMentioned &&
    /\b(?:is|was|does|did|are|were) (?:that|this|it|those)\b/.test(lower) &&
    /\b(only|too|also|both|include|includes|including|all of it|just|or)\b/.test(lower)
  );
}

/** Arithmetic on numbers already in the thread — not a Day Line "add". */
export function isCombineRequest(lower: string): boolean {
  return /\b(?:add (?:them|those|these|those two|both|it all|them all)(?: up| together)|(?:put|add) (?:them|those) together|sum (?:(?:of|up) )?(?:them|those|these|both)|total(?: of)? (?:them|those|both)|combined?|all together)\b/.test(
    lower
  );
}

export type SaleOrdering = "latest" | "earliest" | "largest";

export function saleOrdering(lower: string): SaleOrdering | null {
  if (!/\b(sales?|orders?|transactions?|payments?|purchases?)\b/.test(lower)) return null;
  if (/\bhow (?:many|much)\b|\brevenue\b|\btotal\b|\bawaiting\b|\bunpaid\b|\bopen orders?\b|\bowe/.test(lower)) return null;
  const between = "(?:[\\w-]+ ){0,3}";
  if (new RegExp(`\\b(first|earliest|oldest) ${between}(sale|order|transaction|payment|purchase)`).test(lower)) return "earliest";
  if (new RegExp(`\\b(biggest|largest|highest|most expensive) (?:single )?${between}(sale|order|ticket|transaction|purchase)`).test(lower)) {
    return "largest";
  }
  if (new RegExp(`\\b(latest|newest|most recent|last|recent) ${between}(sale|order|transaction|payment|purchase)s?\\b`).test(lower)) {
    return "latest";
  }
  return null;
}

export type OrderAspect = "who" | "amount" | "when" | "source" | "what" | "before" | "ingested";

export function orderFocusAspect(lower: string): OrderAspect | null {
  const text = lower.replace(/[?.!]+$/, "").trim();
  if (/\bwho (?:was|is) (?:it|that|this)(?: order| sale)? for\b|\bwhose (?:order|sale) (?:was|is) (?:it|that|this)\b|\bwho (?:was|is) the customer\b|\bwho bought (?:it|that)\b|^who\b.*\bfor$/.test(text)) {
    return "who";
  }
  if (/\b(?:the )?(?:order|sale|one) before (?:that|it|this)\b|\bprevious (?:order|sale)\b|\bbefore that one\b|^and before that$/.test(text)) {
    return "before";
  }
  if (/\bwhen (?:was|did) (?:that|it|this)(?: order| sale)? (?:get )?(?:imported|come in|sync|synced|arrive)\b/.test(text)) return "ingested";
  if (/^(?:and |so )?how much(?: was (?:it|that|this))?$|\bhow much was (?:it|that|this|the (?:order|sale))\b|\bwhat was the (?:amount|total)\b|\bhow big was (?:it|that)\b/.test(text)) {
    return "amount";
  }
  if (/\bwhen (?:did|was) (?:that|it|this)(?: order| sale)?(?: (?:happen|placed|paid|made|come in))?\b|\bwhat time was (?:that|it)\b|\bwhat day was (?:that|it)\b/.test(text)) {
    return "when";
  }
  if (
    /\b(?:was|is) (?:that|it|this)(?: order| sale)?\b.*\b(clean ?cloud|stripe|clear ?ent|clearance|cash|laundry ?(?:butler|farm)|goldline|native)\b|\bwhere did (?:that|it) come from\b|\bwhat source\b|\bwhich (?:system|business)\b/.test(
      text
    )
  ) {
    return "source";
  }
  if (/\bwhat (?:did (?:they|he|she) (?:order|get)|was in (?:it|that(?: order)?)|was (?:it|that) for)\b|\bwhat was ordered\b/.test(text)) return "what";
  return null;
}

export type CustomerAspect =
  | "summary"
  | "spend"
  | "count"
  | "last"
  | "first"
  | "average"
  | "largest"
  | "cadence"
  | "trend"
  | "what_last"
  | "last_vs_normal"
  | "address"
  | "business";

export function customerAspect(lower: string): CustomerAspect | null {
  if (/\b(bigger|smaller|larger) than (?:normal|usual|average|typical)|\bbigger or smaller\b|\bsmaller or bigger\b/.test(lower)) return "last_vs_normal";
  if (/\bwhat did (?:he|she|they|[a-z]+) (?:order|get)\b|\bwhat was (?:in )?(?:his|her|their|[a-z]+'s) last order\b/.test(lower)) return "what_last";
  if (/\b(ordering less|less often|less frequently|slowing down|dropped off|falling off|ordering more|more often now|fallen off)\b/.test(lower)) {
    return "trend";
  }
  if (/\bhow often\b|\bnormally order\b|\busually order\b|\bfrequency\b|\bhow frequently\b|\borders? more (?:often|frequently)\b/.test(lower)) return "cadence";
  if (/\b(first order|first time|when did [a-z]+ start|first one)\b/.test(lower)) return "first";
  if (/\b(last (?:one|order|time)|most recent(?:ly)?|latest order|last ordered|when did [a-z]+(?: [a-z]+)? last|when was (?:his|her|their|[a-z]+'s) last)\b/.test(lower)) {
    return "last";
  }
  if (/\baverage\b|\btypical order\b/.test(lower)) return "average";
  if (/\b(biggest|largest) order\b/.test(lower)) return "largest";
  if (/\bhow many (?:orders|times)\b|^how many\??$|\bnumber of orders\b|\border count\b/.test(lower)) return "count";
  if (/\b(spent|spend|spending|generated?|worth|paid us|paid me|revenue)\b/.test(lower)) return "spend";
  if (/\b(address|live|lives|where does)\b/.test(lower)) return "address";
  if (/\b(laundry butler or laundry farm|which business|butler or (?:the )?farm)\b/.test(lower)) return "business";
  return null;
}

export const PRONOUN = /\b(he|him|his|she|her|hers|they|them|their|that customer|this customer|that person)\b/;

export type RankingQuestion = { groupBy: "month" | "week" | "day"; rank: "best" | "worst" };

export function rankingQuestion(lower: string): RankingQuestion | null {
  const match = /\b(best|strongest|biggest|highest|top|worst|weakest|slowest|lowest)\s+(month|week|day)\b/.exec(lower);
  if (!match) return null;
  return {
    groupBy: match[2] as RankingQuestion["groupBy"],
    rank: /worst|weakest|slowest|lowest/.test(match[1]!) ? "worst" : "best",
  };
}

export function isShareQuestion(lower: string): boolean {
  return (
    /\b(percent(?:age)?|share|portion|how much) of (?:our |my |the )?(?:revenue|sales|business)\b.*\btop\b/.test(lower) ||
    /\btop \w+ customers?\b.*\b(percent|percentage|share)\b/.test(lower)
  );
}

export function isFrequencyRanking(lower: string): boolean {
  return /\b(order(?:s|ed)? (?:the )?most (?:often|frequently)|most frequent(?:ly)?|order most|most orders|orders? the most)\b/.test(lower);
}

/** A question asking for the people who ordered — not a relative clause like "people who ordered more than once". */
export function isWhoOrderedQuestion(lower: string): boolean {
  return (
    /(?:^|[.?!]\s+)(?:and |so |okay |ok |now |then )?who (?:ordered|bought|placed|has ordered|have ordered|orders (?:from|at|there)|are the (?:residents|customers)|lives|live)\b/.test(
      lower
    ) || /\bwhich (?:[a-z]+ ){0,3}(?:customers?|residents?|people) (?:ordered|live|lives|are (?:at|in)|at|in|who)\b/.test(lower)
  );
}

export type FreshnessAspect = "gumball_today" | "gumball_working" | "cleancloud_updated" | "data_current" | "cleancloud_today";

export function freshnessAspect(lower: string): FreshnessAspect | null {
  const gumball = /\bgum ?balls?\b|\bgumball ?pals\b/.test(lower);
  if (gumball) {
    return /\b(today|this morning|tonight|this afternoon)\b/.test(lower) ? "gumball_today" : "gumball_working";
  }
  const cleancloud = /\bclean ?cloud\b/.test(lower);
  if (cleancloud && /\bhow many\b/.test(lower) && /\b(today|this morning|came in|come in)\b/.test(lower)) return "cleancloud_today";
  if (
    (cleancloud || /\bdata\b/.test(lower)) &&
    /\b(last (?:update|updated|sync|synced|import|imported|refresh|refreshed)|latest (?:import|sync|update)|when (?:was|did) (?:the )?(?:latest |last )?(?:clean ?cloud )?(?:data )?(?:update|updated|import|imported|sync|synced|come in|refresh))\b/.test(
      lower
    )
  ) {
    return "cleancloud_updated";
  }
  if (
    /\b(?:is|are) (?:the |our |my )?(?:clean ?cloud |business |sales )?data (?:current|up to date|fresh|stale|behind|caught up)\b|\bis clean ?cloud (?:current|up to date|behind|caught up)\b|\bimport(?:ed)? anything (?:today|this morning)\b/.test(
      lower
    )
  ) {
    return /\banything\b/.test(lower) ? "gumball_today" : "data_current";
  }
  return null;
}

const NAME_STOP = new Set(
  [
    "I", "The", "OPUS", "Opus", "LA", "CPE", "Century", "Park", "East", "Goldline", "CleanCloud", "Clean", "Cloud", "Stripe",
    "Clearent", "Claire", "Laundry", "Butler", "Farm", "Wash", "Fold", "Dry", "Cleaning", "Last", "This", "That", "Those", "These",
    "Today", "Tomorrow", "Yesterday", "What", "How", "Who", "Which", "When", "Where", "Why", "January", "February", "March", "April",
    "May", "June", "July", "August", "September", "October", "November", "December", "Monday", "Tuesday", "Wednesday", "Thursday",
    "Friday", "Saturday", "Sunday", "Revenue", "Orders", "Customers", "Us", "We", "Me", "My", "Our", "It", "He", "She", "They",
    "Them", "His", "Her", "Their", "Him", "Is", "Was", "Did", "Does", "Has", "Have", "Only", "Just", "Exclude", "Include", "Yes",
    "No", "Previous", "Compare", "GUMBALL", "Gumball", "Los", "Feliz", "Avenue", "Street", "Louise", "KITH", "Coast", "Adam",
    "Sales", "Sale", "Order", "Customer", "Business", "Profit", "Cash", "Now", "And", "Or", "Also", "Actually", "Okay", "Ok",
    "Morning", "Thirty", "Sixty", "Ninety", "AOV", "All", "Time", "Year", "Month", "Week", "Day", "Days", "Please", "Hey",
  ].map(value => value.toLowerCase())
);

function cleanName(raw: string): string | null {
  const tokens = raw
    .replace(/'s\b/g, "")
    .split(/\s+/)
    // A name token is a capitalized word: never a contraction ("I'm", "I've") or a single letter.
    .filter(token => token && !NAME_STOP.has(token.toLowerCase()) && /^[A-Z][a-z]+(?:-[A-Za-z][a-z]+)?$/.test(token));
  return tokens.length ? tokens.join(" ") : null;
}

/** Capitalized person names as typed or as telephone transcription capitalizes them. */
export function extractCustomerNames(text: string): string[] {
  const names: string[] = [];
  const push = (raw: string | undefined) => {
    const name = raw ? cleanName(raw) : null;
    if (name && !names.some(existing => existing.toLowerCase() === name.toLowerCase())) names.push(name);
  };
  const patterns = [
    /\b(?:did|has|does|is|was|about|for|from|by|of|to|and|with|versus|vs\.?|than|compare|between)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)/g,
    /\b([A-Z][a-zA-Z-]+(?:\s+[A-Z][a-zA-Z-]+)?)'s\b/g,
    /^(?:what about|how about|and|now)\s+([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)\W*$/g,
    /\bwhen did ([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?) (?:last|first)/g,
    /^([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+)?)\?$/g,
  ];
  for (const pattern of patterns) {
    for (const match of Array.from(text.matchAll(pattern))) push(match[1]);
  }
  const named = /\bcustomer (?:named|called)\s+([A-Za-z'-]+(?:\s+[A-Za-z'-]+)?)/i.exec(text);
  if (named) {
    const value = named[1]!.replace(/\b[a-z]/g, letter => letter.toUpperCase());
    push(value);
  }
  return names;
}
