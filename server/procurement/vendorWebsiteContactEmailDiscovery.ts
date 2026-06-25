// Slice 82b. Safe, read-only website contact-email discovery -- finds a
// vendor's real direct email when it is not on the homepage but IS on a
// linked contact/about/services page. This module never sends anything:
// no email, no SMS, no form submission, no phone call, no browser
// automation, no JavaScript execution. Every fetch is a plain GET, capped
// in count, time, and response size, restricted to the candidate's own
// hostname, and never follows an external link.

const MAX_PAGES = 3;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 500_000;
const CONTACT_PAGE_HINTS = ["contact-us", "contact", "about-us", "about", "service-areas", "service-area", "services"];
const SKIPPED_LINK_EXTENSIONS = /\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|mov|avi|zip|rar|doc|docx|xls|xlsx)(\?|#|$)/i;

const EMAIL_DISCOVERY_STATUSES = ["email_found", "no_email_found", "website_unreachable", "skipped_no_website", "invalid_website"] as const;
export type EmailDiscoveryStatus = (typeof EMAIL_DISCOVERY_STATUSES)[number];

const DISCOVERY_SOURCES = ["homepage", "contact_page", "about_page", "service_page", "footer", "mailto"] as const;
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

export type WebsiteContactEmailDiscoveryResult = {
  emailDiscoveryStatus: EmailDiscoveryStatus;
  emailsFound: string[];
  primaryEmail: string | null;
  pagesChecked: string[];
  emailEvidence: string[];
  contactFormDetected: boolean;
  phoneDetected: boolean;
  discoverySource: DiscoverySource | null;
  requiresHumanReview: boolean;
};

function emptyResult(status: EmailDiscoveryStatus): WebsiteContactEmailDiscoveryResult {
  return {
    emailDiscoveryStatus: status, emailsFound: [], primaryEmail: null, pagesChecked: [], emailEvidence: [],
    contactFormDetected: false, phoneDetected: false, discoverySource: null, requiresHumanReview: false,
  };
}

type FetchPageResult = { status: "ok"; html: string } | { status: "failed"; reason: string };

/** Single safe, read-only GET -- never a form submission, never JS execution, never a POST. */
async function safeFetchPage(url: string, fetchFn: typeof fetch): Promise<FetchPageResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { method: "GET", signal: controller.signal, redirect: "follow" });
    if (!response.ok) return { status: "failed", reason: `http_status_${response.status}` };
    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = await response.text();
      return { status: "ok", html: text.slice(0, MAX_RESPONSE_BYTES) };
    }
    const decoder = new TextDecoder();
    let collected = "";
    let totalBytes = 0;
    while (totalBytes < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        collected += decoder.decode(value, { stream: true });
      }
    }
    try { await reader.cancel(); } catch { /* best-effort */ }
    return { status: "ok", html: collected.slice(0, MAX_RESPONSE_BYTES) };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error";
    return { status: "failed", reason };
  } finally {
    clearTimeout(timeout);
  }
}

const HREF_PATTERN = /href\s*=\s*["']([^"'#]+)/gi;

/** Same-hostname links only -- never follows an external link. */
function extractSameHostLinks(baseUrl: URL, html: string): string[] {
  const links = new Set<string>();
  for (const match of Array.from(html.matchAll(HREF_PATTERN))) {
    const raw = match[1];
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (resolved.hostname !== baseUrl.hostname) continue;
    if (SKIPPED_LINK_EXTENSIONS.test(resolved.pathname)) continue;
    resolved.hash = "";
    links.add(resolved.toString());
  }
  return Array.from(links);
}

/** Pages whose URL hints at being a contact/about/services page rank first; homepage is never re-added. */
function rankContactLikeLinks(links: string[], homepageUrl: string): string[] {
  const candidates = links.filter(link => link !== homepageUrl);
  const scored = candidates.map(link => {
    const lower = link.toLowerCase();
    const hintIndex = CONTACT_PAGE_HINTS.findIndex(hint => lower.includes(hint));
    return { link, score: hintIndex === -1 ? CONTACT_PAGE_HINTS.length : hintIndex };
  });
  return scored
    .filter(entry => entry.score < CONTACT_PAGE_HINTS.length)
    .sort((a, b) => a.score - b.score)
    .map(entry => entry.link);
}

const MAILTO_PATTERN = /mailto:([^"'?\s>]+)/gi;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const INVALID_EMAIL_PATTERN = /^(noreply|no-reply|donotreply|do-not-reply|test|example)@|@example\.(com|org|net)$/i;
const PHONE_PATTERN = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;

function stripScriptsAndStyles(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
}

/**
 * Extracts and validates real emails only -- never invents one from the
 * domain name, never guesses info@domain.com unless it literally
 * appears, and rejects obvious placeholder/fake addresses.
 */
function extractValidEmails(html: string): { emails: string[]; foundViaMailto: boolean } {
  const cleaned = stripScriptsAndStyles(html);
  const found = new Set<string>();
  let foundViaMailto = false;
  for (const match of Array.from(cleaned.matchAll(MAILTO_PATTERN))) {
    const email = decodeURIComponent(match[1]).toLowerCase().split("?")[0];
    if (email && !INVALID_EMAIL_PATTERN.test(email)) {
      found.add(email);
      foundViaMailto = true;
    }
  }
  for (const match of Array.from(cleaned.matchAll(EMAIL_PATTERN))) {
    const email = match[0].toLowerCase();
    if (!INVALID_EMAIL_PATTERN.test(email)) found.add(email);
  }
  return { emails: Array.from(found), foundViaMailto };
}

function detectContactForm(html: string): boolean {
  return /<form\b/i.test(html);
}

function detectPhone(html: string): boolean {
  return PHONE_PATTERN.test(stripScriptsAndStyles(html));
}

function discoverySourceForPage(pageUrl: string, isHomepage: boolean, foundViaMailto: boolean): DiscoverySource {
  if (foundViaMailto) return "mailto";
  if (isHomepage) return "homepage";
  const lower = pageUrl.toLowerCase();
  if (lower.includes("contact")) return "contact_page";
  if (lower.includes("about")) return "about_page";
  return "service_page";
}

export type DiscoverWebsiteContactEmailInput = {
  candidateName: string;
  website: string | null;
  fetchFn?: typeof fetch;
};

/**
 * Max 3 pages total (homepage + up to 2 linked contact-like pages),
 * same hostname only, GET only, no form submission, no JS execution.
 * Stops as soon as a real email is found -- never crawls the whole site.
 */
export async function discoverWebsiteContactEmail(input: DiscoverWebsiteContactEmailInput): Promise<WebsiteContactEmailDiscoveryResult> {
  if (!input.website) return emptyResult("skipped_no_website");

  let baseUrl: URL;
  try {
    baseUrl = new URL(input.website);
    if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") return emptyResult("invalid_website");
  } catch {
    return emptyResult("invalid_website");
  }

  const fetchFn = input.fetchFn ?? fetch;
  const pagesChecked: string[] = [];
  const allEmails = new Set<string>();
  const emailEvidence: string[] = [];
  let contactFormDetected = false;
  let phoneDetected = false;
  let discoverySource: DiscoverySource | null = null;
  let anyFetchSucceeded = false;

  const homepageResult = await safeFetchPage(input.website, fetchFn);
  pagesChecked.push(input.website);

  let homepageHtml: string | null = null;
  if (homepageResult.status === "ok") {
    anyFetchSucceeded = true;
    homepageHtml = homepageResult.html;
    const { emails, foundViaMailto } = extractValidEmails(homepageHtml);
    contactFormDetected = detectContactForm(homepageHtml);
    phoneDetected = detectPhone(homepageHtml);
    if (emails.length > 0) {
      emails.forEach(email => allEmails.add(email));
      discoverySource = discoverySourceForPage(input.website, true, foundViaMailto);
      emailEvidence.push(`Found on homepage: ${emails.join(", ")}`);
    }
  }

  if (allEmails.size === 0 && homepageHtml) {
    const links = rankContactLikeLinks(extractSameHostLinks(baseUrl, homepageHtml), input.website);
    for (const link of links) {
      if (pagesChecked.length >= MAX_PAGES) break;
      if (allEmails.size > 0) break;
      const pageResult = await safeFetchPage(link, fetchFn);
      pagesChecked.push(link);
      if (pageResult.status !== "ok") continue;
      anyFetchSucceeded = true;
      const { emails, foundViaMailto } = extractValidEmails(pageResult.html);
      contactFormDetected = contactFormDetected || detectContactForm(pageResult.html);
      phoneDetected = phoneDetected || detectPhone(pageResult.html);
      if (emails.length > 0) {
        emails.forEach(email => allEmails.add(email));
        discoverySource = discoverySourceForPage(link, false, foundViaMailto);
        emailEvidence.push(`Found on ${link}: ${emails.join(", ")}`);
      }
    }
  }

  const emailsFound = Array.from(allEmails);
  const primaryEmail = emailsFound[0] ?? null;
  const emailDiscoveryStatus: EmailDiscoveryStatus = primaryEmail
    ? "email_found"
    : anyFetchSucceeded ? "no_email_found" : "website_unreachable";

  return {
    emailDiscoveryStatus, emailsFound, primaryEmail, pagesChecked, emailEvidence,
    contactFormDetected, phoneDetected, discoverySource, requiresHumanReview: false,
  };
}
