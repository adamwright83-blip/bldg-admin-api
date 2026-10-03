/** Where "Join the waitlist" goes. Relative = the waitlist page that ships with this site (public/waitlist.html).
 *  Swap for a Tally / Google Form / Steam wishlist link whenever you have one. */
export const WAITLIST_URL = "waitlist.html";
/** Optional: POST endpoint for event counts. Empty = events are only counted locally. */
export const ANALYTICS_URL = "";

type Props = Record<string, string | number | boolean>;
export function track(name: string, props: Props = {}) {
  try {
    const raw = localStorage.getItem("sc.stats");
    const s = raw ? JSON.parse(raw) : {};
    s[name] = (s[name] || 0) + 1;
    localStorage.setItem("sc.stats", JSON.stringify(s));
  } catch { /* private mode: fine */ }
  if (ANALYTICS_URL) {
    try { navigator.sendBeacon(ANALYTICS_URL, JSON.stringify({ name, props, t: Date.now() })); } catch { /* ignore */ }
  }
  if (import.meta.env?.DEV) console.debug("[track]", name, props);
}

export const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
