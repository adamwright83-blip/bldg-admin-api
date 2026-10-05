/** MySQL JSON may reorder object keys. Identity is semantic, never driver order. */
export function canonicalJson(value: unknown): string {
  function ordered(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(ordered);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, item]) => [k, ordered(item)])
      );
    return v;
  }
  return JSON.stringify(ordered(value));
}
