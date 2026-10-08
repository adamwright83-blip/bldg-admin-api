import { listRecentCleanCloudCustomerNames } from "../../analytics/cleancloudCustomerReadService";
import { listDayDirectorProcessingLocationNames } from "../../planning/dayDirector/dayDirectorService";
import { listRecentTenantOrderCustomerNames } from "../../domains/orders/unpaidOrderReadService";
import { listAccountRefs } from "./accountKnowledge";

/**
 * The names in Adam's business that a phone line mishears ("kit treats",
 * "open late", "Lugo's Lavon Zaria"): accounts, buildings, processing
 * locations, and recent customers. Used as speech-recognition hints and as
 * the only spellings the briefing model may substitute for a misheard name.
 */

const STATIC_VOCABULARY = [
  "Laundry Butler",
  "Laundry Farm",
  "CleanCloud",
  "Clearent",
  "Stripe",
  "GUMBALL",
  "Day Line",
  "OPUS LA",
  "Century Park East",
  "fluff and fold",
  "wash and fold",
  "dry cleaning",
  "gym towels",
  "payroll deposit",
];

const cache = new Map<string, { at: number; words: string[] }>();
const TTL_MS = 10 * 60 * 1000;

export async function loadBusinessVocabulary(tenantId: string, now = Date.now()): Promise<string[]> {
  const cached = cache.get(tenantId);
  if (cached && now - cached.at < TTL_MS) return cached.words;
  const words = new Set<string>(STATIC_VOCABULARY);
  try {
    const [accounts, locations, nativeNames, cloudNames] = await Promise.all([
      listAccountRefs(tenantId).catch(() => []),
      listDayDirectorProcessingLocationNames(tenantId).catch(() => []),
      listRecentTenantOrderCustomerNames(tenantId).catch(() => []),
      listRecentCleanCloudCustomerNames(tenantId).catch(() => []),
    ]);
    accounts.forEach(account => words.add(account.name));
    locations.forEach(name => name && words.add(name));
    nativeNames.forEach(name => {
      if (name && !/test|proxy/i.test(name)) words.add(name);
    });
    cloudNames.forEach(name => name && words.add(name));
  } catch (error) {
    console.warn("[Claire] business vocabulary unavailable", error instanceof Error ? error.message : error);
  }
  const list = Array.from(words).filter(word => word.length >= 2 && word.length <= 100).slice(0, 400);
  cache.set(tenantId, { at: now, words: list });
  return list;
}

const BASE_HINTS = [
  "got it", "I'm good", "that's enough", "end call", "hang up", "goodbye", "yes", "no", "tomorrow", "today", "before noon",
  "pickup", "pick up", "drop off", "deliver", "revenue", "last 30 days", "Laundry Butler", "Laundry Farm", "Clearent",
];

/** Twilio <Gather hints>: at most 500 comma-separated entries of up to 100 characters. */
export function speechHints(vocabulary: string[]): string {
  const entries = Array.from(new Set([...BASE_HINTS, ...vocabulary]))
    .map(entry => entry.replace(/,/g, " ").trim())
    .filter(entry => entry && entry.length <= 100)
    .slice(0, 480);
  return entries.join(", ");
}

/** Tests only. */
export function clearBusinessVocabularyCache(): void {
  cache.clear();
}
