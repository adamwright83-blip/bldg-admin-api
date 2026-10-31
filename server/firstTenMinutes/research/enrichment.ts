import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FetchLike } from "../providerFetch";
import type { CoverageLedger } from "./coverage";
import { redactSensitive } from "./privacy";

/**
 * Controlled public enrichment: help resolve who a business is from what it publishes about itself. Never a
 * replacement for the person's own sources, never required, never a broker.
 *
 * What it may read:
 *  - a business's own public website, only for a domain that the person's own sent mail or signature already names,
 *    and only its home page's title and description (robots.txt honoured);
 *  - LinkedIn and Instagram: nothing. Neither offers an official API that lets a third party look up another
 *    person's or business's profile without that account's own authorization, and scraping them is not permitted.
 *    The interface answers `unsupported` for them, so callers can report the gap honestly.
 *
 * Off unless JOYSTICK_PUBLIC_ENRICHMENT=on. Plain https to a public hostname only (no IP literals, no localhost, no
 * internal names), short timeouts, small responses.
 */
export type EnrichmentResult =
  | { status: "found"; source: "website"; domain: string; url: string; title: string | null; description: string | null }
  | { status: "not_found" | "disallowed" | "failed"; source: "website"; domain: string; reason: string }
  | { status: "unsupported"; source: "linkedin" | "instagram"; reason: string }
  | { status: "disabled"; source: "website" | "linkedin" | "instagram"; reason: string };

export interface PublicEnricher {
  website(domain: string): Promise<EnrichmentResult>;
  social(network: "linkedin" | "instagram", handle: string): Promise<EnrichmentResult>;
}

export const ENRICHMENT_FLAG = "JOYSTICK_PUBLIC_ENRICHMENT";

const NO_SOCIAL_API =
  "No official API lets a third party read this profile without the account owner's own authorization; JOYSTICK does not scrape it.";

/** A hostname that is public and plain: letters, digits, hyphens and dots, with a real top-level domain. */
export function publicHostname(domain: string): string | null {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|intranet|corp|home|lan|railway\.internal)$/.test(host)) return null;
  return host;
}

/** Domains that are mail providers, not businesses. */
const MAIL_PROVIDERS = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "live.com"]);
export const isMailProvider = (domain: string) => MAIL_PROVIDERS.has(domain.toLowerCase());

function robotsDisallowAll(robots: string): boolean {
  let applies = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(key)) applies = value === "*" || /joystick/i.test(value);
    else if (applies && /^disallow$/i.test(key) && value === "/") return true;
  }
  return false;
}

/** Whether an IP address is private, loopback, link-local, or otherwise not the public internet. */
export function privateAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (isIP(ip) === 6) return ip === "::" || ip === "::1" || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith("ff");
  return true;
}

export type Resolver = (hostname: string) => Promise<string[]>;
const systemResolver: Resolver = async hostname => (await lookup(hostname, { all: true })).map(entry => entry.address);

/**
 * GET one public page. Redirects are followed by hand, at most three, and every hop (the first included) must be
 * plain https to a public hostname that resolves only to public addresses: a public site can't bounce the request
 * to an internal address.
 */
async function bounded(fetcher: FetchLike, url: string, maxBytes: number, resolve: Resolver): Promise<{ ok: boolean; status: number; text: string }> {
  let target = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    const parsed = new URL(target);
    if (parsed.protocol !== "https:" || parsed.port || !publicHostname(parsed.hostname) || publicHostname(parsed.hostname) !== parsed.hostname.replace(/^www\./, "")) {
      throw new Error("not a public https address");
    }
    const addresses = await resolve(parsed.hostname);
    if (!addresses.length || addresses.some(privateAddress)) throw new Error("not a public address");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetcher(target, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "JOYSTICK-onboarding (public business lookup)" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { ok: false, status: response.status, text: "" };
        target = new URL(location, target).toString();
        continue;
      }
      const text = (await response.text()).slice(0, maxBytes);
      return { ok: response.ok, status: response.status, text };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too many redirects");
}

const decode = (text: string) =>
  text.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export function publicEnricher(ledger: CoverageLedger, deps: { fetch?: FetchLike; env?: NodeJS.ProcessEnv; resolve?: Resolver } = {}): PublicEnricher {
  const env = deps.env ?? process.env;
  const enabled = env[ENRICHMENT_FLAG]?.trim().toLowerCase() === "on";
  const fetcher = deps.fetch ?? fetch;
  const resolve = deps.resolve ?? systemResolver;
  return {
    async website(domain) {
      const host = publicHostname(domain);
      if (!enabled) return { status: "disabled", source: "website", reason: `${ENRICHMENT_FLAG} is off` };
      if (!host || isMailProvider(host)) {
        ledger.record({ source: "public_web", operation: "website", target: domain, status: "excluded", items: 0, reason: "not a public business domain" });
        return { status: "disallowed", source: "website", domain, reason: "not a public business domain" };
      }
      try {
        const robots = await bounded(fetcher, `https://${host}/robots.txt`, 20_000, resolve).catch(() => null);
        if (robots?.ok && robotsDisallowAll(robots.text)) {
          ledger.record({ source: "public_web", operation: "website", target: host, status: "excluded", items: 0, reason: "robots.txt" });
          return { status: "disallowed", source: "website", domain: host, reason: "robots.txt disallows it" };
        }
        const page = await bounded(fetcher, `https://${host}/`, 200_000, resolve);
        if (!page.ok) {
          ledger.record({ source: "public_web", operation: "website", target: host, status: "failed", items: 0, reason: String(page.status) });
          return { status: "failed", source: "website", domain: host, reason: String(page.status) };
        }
        const title = page.text.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1];
        const description =
          page.text.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)?.[1] ??
          page.text.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,500})["']/i)?.[1];
        ledger.record({ source: "public_web", operation: "website", target: host, status: title || description ? "ok" : "empty", items: title || description ? 1 : 0 });
        if (!title && !description) return { status: "not_found", source: "website", domain: host, reason: "no title or description" };
        return {
          status: "found",
          source: "website",
          domain: host,
          url: `https://${host}/`,
          title: title ? redactSensitive(decode(title)) : null,
          description: description ? redactSensitive(decode(description)) : null,
        };
      } catch (error) {
        ledger.record({ source: "public_web", operation: "website", target: host, status: "failed", items: 0, reason: error instanceof Error && error.name === "AbortError" ? "timeout" : "error" });
        return { status: "failed", source: "website", domain: host, reason: "unreachable" };
      }
    },
    async social(network) {
      return { status: "unsupported", source: network, reason: NO_SOCIAL_API };
    },
  };
}
