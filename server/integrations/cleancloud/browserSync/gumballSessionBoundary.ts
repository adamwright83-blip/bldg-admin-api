/**
 * Gumball / Jawbreaker browser sessions are CleanCloud evidence sessions.
 * They are not a Google Messages sender and must not be pointed at the
 * operator's personal messages web session.
 */

export const GUMBALL_ALLOWED_ORIGINS = [
  "https://cleancloudapp.com",
  "https://admin.bldg.chat",
] as const;

export const GUMBALL_FORBIDDEN_MESSAGE_ORIGINS = [
  "https://messages.google.com",
  "https://messages.android.com",
] as const;

export function assertGumballNotGoogleMessages(rawUrl: string | null | undefined): void {
  if (!rawUrl) return;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }
  if ((GUMBALL_FORBIDDEN_MESSAGE_ORIGINS as readonly string[]).includes(url.origin)) {
    throw new Error(
      "BLOCKED: Gumball must not attach to Google Messages. That would risk displacing the operator's existing personal web session. Nobody was signed out."
    );
  }
}
