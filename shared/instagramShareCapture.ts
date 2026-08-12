import { canonicalizeInstagramUrl } from "./salesIntel";

const URL_CANDIDATE = /https?:\/\/[^\s<>"']+/gi;

function trimSharedUrlCandidate(value: string): string {
  return value.replace(/[),.;!?\]]+$/g, "").trim();
}

/**
 * Android share sheets are inconsistent about whether an app places a shared
 * link in the Web Share Target `url` field or embeds it inside `text`. Treat
 * both as untrusted input, then keep only a URL our existing Instagram
 * canonicalizer can justify.
 */
export function extractInstagramUrlFromSharedData(input: {
  url?: string | null;
  text?: string | null;
  title?: string | null;
}): string | null {
  const candidates: string[] = [];
  for (const value of [input.url, input.text, input.title]) {
    if (!value) continue;
    if (/^https?:\/\//i.test(value.trim())) candidates.push(value.trim());
    for (const match of value.matchAll(URL_CANDIDATE)) {
      if (match[0]) candidates.push(match[0]);
    }
  }

  for (const raw of candidates) {
    const candidate = trimSharedUrlCandidate(raw);
    if (canonicalizeInstagramUrl(candidate)) return candidate;
  }
  return null;
}

export function instagramShareParamsFromLocation(search: string): {
  sharedUrl: string | null;
  wasShareTargetLaunch: boolean;
} {
  const params = new URLSearchParams(search);
  const shareFields = {
    title: params.get("share_title"),
    text: params.get("share_text"),
    url: params.get("share_url"),
  };
  const wasShareTargetLaunch = Object.values(shareFields).some(Boolean);
  return {
    sharedUrl: extractInstagramUrlFromSharedData(shareFields),
    wasShareTargetLaunch,
  };
}
