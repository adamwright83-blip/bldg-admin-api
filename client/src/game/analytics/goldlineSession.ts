/**
 * Client-side Goldline session correlation.
 *
 * One stable session id per browser tab's Goldline mount, held in
 * sessionStorage so a reload within the same tab keeps the same id (durable
 * enough to associate session behavior with business actions) while a fresh
 * tab always gets a new one. `crypto.randomUUID()` only — never a counter or
 * timestamp, so ids cannot be guessed or correlated across tabs.
 */
const STORAGE_KEY = "goldline:session:id";

export function getGoldlineSessionId(): string {
  if (typeof window === "undefined") return crypto.randomUUID();
  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.sessionStorage.setItem(STORAGE_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
