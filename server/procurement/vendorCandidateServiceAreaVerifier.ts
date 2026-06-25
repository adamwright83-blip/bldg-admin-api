// Slice 81a. Verifies whether a Google-Places-discovered candidate
// plausibly serves the mission's target ZIP/building before it is
// treated as outreach-ready, and classifies what contact channel is
// actually available. This module never sends anything: no email, no
// SMS, no calls, no form submissions, no Yelp. The only network
// activity it performs is a single safe, capped, read-only GET of the
// candidate's own homepage -- never a form submission, never
// JavaScript execution, never a multi-page crawl.

const SERVICE_AREA_STATUSES = [
  "verified_serves_target", "likely_serves_target", "unverified", "likely_out_of_area", "out_of_area",
] as const;
export type ServiceAreaStatus = (typeof SERVICE_AREA_STATUSES)[number];

const CONTACT_ROUTES = [
  "email_available", "contact_form_available", "phone_available", "sms_or_call_required", "unknown",
] as const;
export type ContactRoute = (typeof CONTACT_ROUTES)[number];

const OUTREACH_READINESS_VALUES = [
  "email_ready", "manual_email_needed", "form_required", "sms_or_call_required", "not_outreach_ready",
] as const;
export type OutreachReadiness = (typeof OUTREACH_READINESS_VALUES)[number];

const VERIFICATION_SOURCES = ["google_places", "website", "google_places_and_website", "not_checked"] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

const VERIFICATION_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export type VerificationConfidence = (typeof VERIFICATION_CONFIDENCE_VALUES)[number];

export type ServiceAreaVerification = {
  serviceAreaStatus: ServiceAreaStatus;
  serviceAreaReasons: string[];
  targetZipMatched: boolean;
  targetBuildingMatched: boolean;
  candidateAddressZip: string | null;
  distanceMilesToTarget: number | null;
  websiteChecked: boolean;
  /**
   * Slice 81b. The same plain-text snippet (already capped, already
   * stripped of HTML) this module extracted internally -- exposed so a
   * downstream structured interpreter can read it without performing a
   * second fetch of the candidate's site.
   */
  websiteTextSnippet: string;
  websiteServiceAreas: string[];
  websiteMentionsTargetZip: boolean;
  websiteMentionsTargetBuilding: boolean;
  contactRoute: ContactRoute;
  emailAddressesFound: string[];
  contactFormDetected: boolean;
  phoneFound: boolean;
  outreachReadiness: OutreachReadiness;
  verificationSource: VerificationSource;
  verificationConfidence: VerificationConfidence;
};

/**
 * Approximate centroid for each known HELD-serviced building's ZIP --
 * derived from public knowledge, not a new data source. Only ZIPs HELD
 * actually services are listed here; an unrecognized target ZIP simply
 * means distance cannot be computed (distanceMilesToTarget stays
 * null), it never invents a centroid.
 */
const KNOWN_TARGET_ZIP_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  "90027": { lat: 34.1141, lng: -118.2932 }, // OPUS LA
  "90067": { lat: 34.0567, lng: -118.4159 }, // Century Park East
};

/**
 * Slice 81e. Exposes the same centroid table used for distance
 * scoring so discovery can bias its Google Places search toward the
 * mission's actual target area -- never invents a centroid for an
 * unconfigured ZIP.
 */
export function getKnownTargetZipCentroid(zip: string | null): { lat: number; lng: number } | null {
  if (!zip) return null;
  return KNOWN_TARGET_ZIP_CENTROIDS[zip] ?? null;
}

const DISTANCE_LIKELY_THRESHOLD_MILES = 12;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);
  const h = sinHalfLat * sinHalfLat
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinHalfLng * sinHalfLng;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function extractZipFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/g);
  if (!match || match.length === 0) return null;
  // A formatted US address ends with the ZIP (e.g. "..., CA 91306, USA")
  // -- take the last 5-digit run found, not the first (avoids matching
  // a 5-digit street number).
  return match[match.length - 1];
}

const MAX_WEBSITE_FETCH_BYTES = 500_000;
const WEBSITE_FETCH_TIMEOUT_MS = 5_000;

export type WebsiteFetchResult =
  | { status: "ok"; text: string }
  | { status: "skipped"; reason: "no_website" }
  | { status: "failed"; reason: string };

/**
 * Single safe, read-only GET of a candidate's homepage. Never submits
 * a form, never executes JavaScript, never follows a crawl beyond the
 * one URL given. Caps both the wait (timeout) and the response size
 * (stops reading once MAX_WEBSITE_FETCH_BYTES is reached) so a slow or
 * huge page can never block or balloon this call.
 */
export async function fetchWebsiteTextSnippet(
  url: string | null | undefined,
  options?: { fetchFn?: typeof fetch },
): Promise<WebsiteFetchResult> {
  if (!url) return { status: "skipped", reason: "no_website" };
  const fetchFn = options?.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBSITE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, { method: "GET", signal: controller.signal, redirect: "follow" });
    if (!response.ok) return { status: "failed", reason: `http_status_${response.status}` };
    const reader = response.body?.getReader?.();
    if (!reader) {
      const text = await response.text();
      return { status: "ok", text: text.slice(0, MAX_WEBSITE_FETCH_BYTES) };
    }
    const decoder = new TextDecoder();
    let collected = "";
    let totalBytes = 0;
    while (totalBytes < MAX_WEBSITE_FETCH_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        collected += decoder.decode(value, { stream: true });
      }
    }
    try { await reader.cancel(); } catch { /* best-effort */ }
    return { status: "ok", text: collected.slice(0, MAX_WEBSITE_FETCH_BYTES) };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "fetch_error";
    return { status: "failed", reason };
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const MAILTO_PATTERN = /mailto:([^"'?\s>]+)/gi;

function extractEmails(html: string, plainText: string): string[] {
  const found = new Set<string>();
  for (const m of Array.from(html.matchAll(MAILTO_PATTERN))) found.add(m[1].toLowerCase());
  for (const m of Array.from(plainText.matchAll(EMAIL_PATTERN))) found.add(m[0].toLowerCase());
  return Array.from(found);
}

function detectContactForm(html: string): boolean {
  return /<form\b/i.test(html);
}

const SERVICE_AREA_SECTION_PATTERN = /service\s*area[s]?|areas?\s+we\s+serve|we\s+serve|coverage\s+area/i;

/**
 * v0, deterministic-only extraction of a website's listed service
 * areas: looks for a "service area(s)" / "areas we serve" section and
 * returns the comma/line-separated place names that follow it. This is
 * intentionally narrow -- it will miss phrasings like "the Greater LA
 * area" or "Hollywood and surrounding neighborhoods" that a human (or
 * a bounded LLM read of the same text) would correctly interpret. See
 * the Slice 81a report's recommended follow-up for the LLM-based
 * upgrade that mirrors how Slice 77a's deterministic query planner was
 * later upgraded to a real Claude call in Slice 77b.
 */
function extractWebsiteServiceAreas(plainText: string): string[] {
  const match = plainText.match(SERVICE_AREA_SECTION_PATTERN);
  if (!match) return [];
  const tail = plainText.slice(match.index! + match[0].length, match.index! + match[0].length + 500);
  return tail
    .split(/[,|•\n]/)
    .map(part => part.trim())
    .filter(part => part.length > 1 && part.length < 60)
    .slice(0, 25);
}

export type VerifyServiceAreaInput = {
  candidate: {
    address: string | null;
    website: string | null;
    phone: string | null;
    coordinates: { lat: number; lng: number } | null;
  };
  targetZip: string | null;
  targetBuildingName: string | null;
  fetchFn?: typeof fetch;
};

export async function verifyCandidateServiceArea(input: VerifyServiceAreaInput): Promise<ServiceAreaVerification> {
  const reasons: string[] = [];
  const candidateAddressZip = extractZipFromAddress(input.candidate.address);
  const targetZip = input.targetZip;
  const targetZipMatched = !!targetZip && !!candidateAddressZip && candidateAddressZip === targetZip;

  let distanceMilesToTarget: number | null = null;
  if (targetZip && input.candidate.coordinates) {
    const centroid = KNOWN_TARGET_ZIP_CENTROIDS[targetZip];
    if (centroid) distanceMilesToTarget = Math.round(haversineDistanceMiles(input.candidate.coordinates, centroid) * 10) / 10;
  }

  if (targetZipMatched) {
    reasons.push(`Business address ZIP matches target ZIP ${targetZip}`);
  } else if (candidateAddressZip && targetZip) {
    reasons.push(
      distanceMilesToTarget !== null
        ? `Business address ZIP ${candidateAddressZip} is approximately ${distanceMilesToTarget} miles from target ${targetZip}`
        : `Business address ZIP ${candidateAddressZip} does not match target ZIP ${targetZip}`,
    );
  }

  const websiteResult = await fetchWebsiteTextSnippet(input.candidate.website, { fetchFn: input.fetchFn });
  const websiteChecked = websiteResult.status === "ok";
  let plainText = "";
  let rawHtml = "";
  if (websiteResult.status === "ok") {
    rawHtml = websiteResult.text;
    plainText = stripHtml(rawHtml);
  } else if (websiteResult.status === "failed") {
    reasons.push(`Website could not be checked: ${websiteResult.reason}`);
  }

  const websiteServiceAreas = websiteChecked ? extractWebsiteServiceAreas(plainText) : [];
  const targetZipText = targetZip ?? "";
  const websiteMentionsTargetZip = websiteChecked && targetZipText.length > 0 && plainText.includes(targetZipText);
  const targetBuildingName = input.targetBuildingName;
  const websiteMentionsTargetBuilding = websiteChecked
    && !!targetBuildingName
    && plainText.toLowerCase().includes(targetBuildingName.toLowerCase());

  if (websiteChecked && websiteServiceAreas.length > 0 && !websiteMentionsTargetZip && !websiteMentionsTargetBuilding) {
    reasons.push(`Website lists service areas (${websiteServiceAreas.slice(0, 6).join(", ")}) that do not explicitly include ${targetZip ?? "the target area"}${targetBuildingName ? ` or ${targetBuildingName}` : ""}`);
  }
  if (websiteMentionsTargetZip) reasons.push(`Website explicitly mentions target ZIP ${targetZip}`);
  if (websiteMentionsTargetBuilding) reasons.push(`Website explicitly mentions ${targetBuildingName}`);

  const emailAddressesFound = websiteChecked ? extractEmails(rawHtml, plainText) : [];
  const contactFormDetected = websiteChecked && detectContactForm(rawHtml);
  const phoneFound = !!input.candidate.phone;

  let contactRoute: ContactRoute;
  let outreachReadiness: OutreachReadiness;
  if (emailAddressesFound.length > 0) {
    contactRoute = "email_available";
    outreachReadiness = "email_ready";
  } else if (contactFormDetected) {
    contactRoute = "contact_form_available";
    outreachReadiness = "form_required";
  } else if (phoneFound) {
    contactRoute = "phone_available";
    outreachReadiness = "sms_or_call_required";
  } else {
    contactRoute = "unknown";
    outreachReadiness = "not_outreach_ready";
  }
  if (contactFormDetected && phoneFound && emailAddressesFound.length === 0) {
    reasons.push("Website lists a contact form but no email; phone number is available from Google Places");
  }

  let serviceAreaStatus: ServiceAreaStatus;
  if (targetZipMatched || websiteMentionsTargetZip || websiteMentionsTargetBuilding) {
    serviceAreaStatus = "verified_serves_target";
  } else if (websiteChecked && websiteServiceAreas.length > 0) {
    // The site has an explicit, specific service-area list that does
    // not name the target -- this is a real negative signal, not mere
    // absence of evidence.
    serviceAreaStatus = distanceMilesToTarget !== null && distanceMilesToTarget <= DISTANCE_LIKELY_THRESHOLD_MILES
      ? "unverified"
      : "likely_out_of_area";
  } else if (distanceMilesToTarget !== null && distanceMilesToTarget <= DISTANCE_LIKELY_THRESHOLD_MILES) {
    serviceAreaStatus = "likely_serves_target";
    reasons.push(`Business address is within ${DISTANCE_LIKELY_THRESHOLD_MILES} miles of the target area (no explicit confirmation found)`);
  } else {
    serviceAreaStatus = "unverified";
    if (reasons.length === 0) reasons.push("No address ZIP/distance or website evidence available to confirm service area");
  }

  let verificationSource: VerificationSource;
  if (websiteChecked && (input.candidate.address || input.candidate.coordinates)) verificationSource = "google_places_and_website";
  else if (input.candidate.address || input.candidate.coordinates) verificationSource = "google_places";
  else if (websiteChecked) verificationSource = "website";
  else verificationSource = "not_checked";

  let verificationConfidence: VerificationConfidence;
  if (serviceAreaStatus === "verified_serves_target") verificationConfidence = "high";
  else if (serviceAreaStatus === "likely_serves_target" || serviceAreaStatus === "likely_out_of_area") verificationConfidence = "medium";
  else verificationConfidence = "low";

  return {
    serviceAreaStatus,
    serviceAreaReasons: reasons,
    targetZipMatched,
    targetBuildingMatched: websiteMentionsTargetBuilding,
    candidateAddressZip,
    distanceMilesToTarget,
    websiteChecked,
    websiteTextSnippet: plainText,
    websiteServiceAreas,
    websiteMentionsTargetZip,
    websiteMentionsTargetBuilding,
    contactRoute,
    emailAddressesFound,
    contactFormDetected,
    phoneFound,
    outreachReadiness,
    verificationSource,
    verificationConfidence,
  };
}
