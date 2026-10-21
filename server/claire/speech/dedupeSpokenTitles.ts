/**
 * Collapse work titles that name the same thing before Claire SAYS them.
 *
 * On 2026-10-20 the evening Day Line held two "Los Feliz Towers" follow-ups with
 * different ids, plus "The Louise" and "The Louise Los Feliz" for one building,
 * and Claire read all four out. Speech only: nothing here touches the rows (W3
 * owns writer-side duplicates). Two titles collapse when their normalized keys
 * are equal, or when one key is a whole-word prefix of the other.
 */
const FILLER = /\b(?:follow[\s-]?up(?:\s+(?:with|at|on))?|visit|call|pitch|the|at|with|on|to)\b/g;

export function spokenTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(FILLER, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeSpokenTitles(titles: readonly string[]): string[] {
  const out: string[] = [];
  const keys: string[] = [];
  for (const raw of titles) {
    const title = raw.replace(/\s+/g, " ").replace(/[.!?]+$/g, "").trim();
    if (!title) continue;
    const key = spokenTitleKey(title) || title.toLowerCase();
    const dup = keys.some(existing => existing === key || existing.startsWith(`${key} `) || key.startsWith(`${existing} `));
    if (dup) continue;
    keys.push(key);
    out.push(title);
  }
  return out;
}
