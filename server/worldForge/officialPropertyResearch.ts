import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_BYTES = 500_000;
const TIMEOUT_MS = 7_000;

export type OfficialResearchFact = {
  factType: "amenity" | "architecture" | "service" | "management" | "positioning";
  value: string;
  sourceUrl: string;
  excerpt: string;
};

export type OfficialPropertyResearchResult =
  | { status: "ok" | "partial"; sourceUrl: string; title: string | null; facts: OfficialResearchFact[]; retrievedAt: string }
  | { status: "invalid_url" | "blocked_target" | "unreachable"; reason: string };

function privateIp(address: string) {
  if (!isIP(address)) return true;
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.startsWith("10.") || address.startsWith("127.") || address.startsWith("169.254.") || address.startsWith("192.168.")) return true;
  const parts = address.split(".").map(Number);
  if (parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:");
}

export async function assertPublicResearchUrl(rawUrl: string, lookupFn = lookup): Promise<URL> {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported_protocol");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("private_target");
  const resolved = await lookupFn(url.hostname, { all: true });
  if (!resolved.length || resolved.some(item => privateIp(item.address))) throw new Error("private_target");
  return url;
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function visibleText(html: string) {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

const FACT_PATTERNS: Array<{ type: OfficialResearchFact["factType"]; pattern: RegExp }> = [
  { type: "amenity", pattern: /(?:rooftop|resort-style|heated|outdoor) pool|billiards|fitness center|resident lounge|concierge|coworking|dog park|spa|theater/gi },
  { type: "architecture", pattern: /high[- ]rise|mid[- ]century|art deco|historic|glass tower|courtyard|terrace|roof deck/gi },
  { type: "service", pattern: /valet|dry cleaning|laundry service|package service|resident service/gi },
];

export function extractOfficialPropertyFacts(input: { html: string; sourceUrl: string }): OfficialResearchFact[] {
  const text = visibleText(input.html).slice(0, 100_000);
  const facts: OfficialResearchFact[] = [];
  for (const { type, pattern } of FACT_PATTERNS) {
    const seen = new Set<string>();
    for (const match of Array.from(text.matchAll(pattern))) {
      const value = match[0].trim();
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const start = Math.max(0, (match.index ?? 0) - 80);
      const end = Math.min(text.length, (match.index ?? 0) + value.length + 80);
      facts.push({ factType: type, value, sourceUrl: input.sourceUrl, excerpt: text.slice(start, end).trim().slice(0, 240) });
      if (facts.length >= 30) return facts;
    }
  }
  return facts;
}

export async function researchOfficialProperty(input: {
  website: string;
  fetchImpl?: typeof fetch;
  lookupFn?: typeof lookup;
}): Promise<OfficialPropertyResearchResult> {
  let url: URL;
  try {
    url = await assertPublicResearchUrl(input.website, input.lookupFn ?? lookup);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid_url";
    return { status: reason === "private_target" ? "blocked_target" : "invalid_url", reason };
  }
  try {
    const response = await (input.fetchImpl ?? fetch)(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) return { status: "unreachable", reason: `http_${response.status}` };
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml"))
      return { status: "unreachable", reason: "unsupported_content_type" };
    const html = (await response.text()).slice(0, MAX_BYTES);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 255) ?? null;
    const facts = extractOfficialPropertyFacts({ html, sourceUrl: url.toString() });
    return { status: facts.length ? "ok" : "partial", sourceUrl: url.toString(), title, facts, retrievedAt: new Date().toISOString() };
  } catch (error) {
    return { status: "unreachable", reason: error instanceof Error ? error.name : "fetch_failed" };
  }
}
