import { desc, eq, sql } from "drizzle-orm";
import { cleancloudPaidOrders, dayDirectorProcessingLocations, orders } from "../../../drizzle/schema";
import { getDb } from "../../db";
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
    const db = await getDb();
    if (db) {
      const [accounts, locations, nativeNames, cloudNames] = await Promise.all([
        listAccountRefs(tenantId).catch(() => []),
        db
          .select({ name: dayDirectorProcessingLocations.name })
          .from(dayDirectorProcessingLocations)
          .where(eq(dayDirectorProcessingLocations.tenantId, tenantId))
          .limit(20)
          .catch(() => []),
        db
          .select({ first: orders.firstName, last: orders.lastName })
          .from(orders)
          .where(sql`COALESCE(${orders.tenantId}, 'default') = ${tenantId}`)
          .orderBy(desc(orders.id))
          .limit(300)
          .catch(() => []),
        db
          .select({ name: cleancloudPaidOrders.customerName })
          .from(cleancloudPaidOrders)
          .where(eq(cleancloudPaidOrders.tenantId, tenantId))
          .orderBy(desc(cleancloudPaidOrders.id))
          .limit(300)
          .catch(() => []),
      ]);
      accounts.forEach(account => words.add(account.name));
      locations.forEach(location => location.name && words.add(location.name));
      nativeNames.forEach(row => {
        const name = `${row.first ?? ""} ${row.last ?? ""}`.trim();
        if (name && !/test|proxy/i.test(name)) words.add(name);
      });
      cloudNames.forEach(row => row.name && words.add(row.name.trim()));
    }
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
