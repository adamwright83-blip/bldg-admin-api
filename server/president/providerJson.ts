/** Extract a single JSON object from provider prose/fences. The trailing citation
 * appendix is not instructions and is never executed. Validation remains caller-owned. */
export function parseProviderJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("Provider returned no JSON object");
  let depth = 0,
    quoted = false,
    escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      const value = JSON.parse(text.slice(start, i + 1));
      if ("$schema" in value) {
        if (value.$schema !== "https://json-schema.org/draft/2020-12/schema")
          throw new Error("Unrecognized provider transport schema");
        delete value.$schema;
      }
      return value;
    }
  }
  throw new Error("Provider returned incomplete JSON");
}
