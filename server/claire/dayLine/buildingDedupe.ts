/**
 * One spoken line per building.
 *
 * Production 2026-10-20: the opening was "Still open: The Louise, Los Feliz Towers, The Louise Los Feliz,
 * sageLA…" because two follow-ups for Los Feliz Towers (accounts 15 and 17, different ids, same name) and
 * two account rows for one address at 1633 N Edgemont ("The Louise" and "The Louise Los Feliz") were each
 * read out. Stops are collapsed by normalized title, by resolved physical entity, and by normalized address.
 */
export type DedupableStop = {
  id: string;
  title: string;
  address?: string | null;
  physicalEntityId?: string | null;
};

const STREET_WORDS: Array<[RegExp, string]> = [
  [/\bboulevard\b/g, "blvd"], [/\bstreet\b/g, "st"], [/\bavenue\b/g, "ave"], [/\bdrive\b/g, "dr"],
  [/\bnorth\b/g, "n"], [/\bsouth\b/g, "s"], [/\beast\b/g, "e"], [/\bwest\b/g, "w"], [/\broad\b/g, "rd"],
];

export function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(token => token && token !== "the")
    .join(" ");
}

/** Street line only ("1633 n edgemont st"): drops unit, city, state and zip so two spellings of one place agree. */
export function normalizeAddressKey(address: string | null | undefined): string | null {
  if (!address) return null;
  let text = address.toLowerCase().split(/[,\n]/)[0] ?? "";
  text = text.replace(/[.#]/g, " ");
  for (const [pattern, replacement] of STREET_WORDS) text = text.replace(pattern, replacement);
  text = text.replace(/\b(?:apt|unit|suite|ste|floor|fl)\b.*$/, "").replace(/\s+/g, " ").trim();
  return /\d/.test(text) && text.split(" ").length >= 2 ? text : null;
}

/** Keeps the first stop of each building/title. Order is preserved. */
export function dedupeStopsByBuilding<T extends DedupableStop>(stops: T[]): T[] {
  const seenTitle = new Map<string, number>();
  const seenEntity = new Map<string, number>();
  const seenAddress = new Map<string, number>();
  const out: T[] = [];
  for (const stop of stops) {
    const title = normalizeTitleKey(stop.title);
    const address = normalizeAddressKey(stop.address);
    const entity = stop.physicalEntityId?.trim() || null;
    const hit = [title ? seenTitle.get(title) : undefined, entity ? seenEntity.get(entity) : undefined, address ? seenAddress.get(address) : undefined].find(
      (value): value is number => typeof value === "number"
    );
    if (hit !== undefined) continue;
    const index = out.length;
    out.push(stop);
    if (title) seenTitle.set(title, index);
    if (entity) seenEntity.set(entity, index);
    if (address) seenAddress.set(address, index);
  }
  return out;
}
